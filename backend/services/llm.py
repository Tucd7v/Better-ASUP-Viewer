from __future__ import annotations

import asyncio
import json
import httpx
import os

SYSTEM_PROMPT = """你是一位资深的 NetApp ONTAP 存储日志分析师。你拥有访问 ASUP 日志的权限。

## 核心原则
- **严格按照用户的具体需求进行分析**，不要主动进行用户未请求的全面检查
- 文件已按功能分类（见下方说明），**只在相关分类的范围内搜索**
- 每次工具调用前先判断：这个操作是否直接服务于用户的当前需求？

## 文件分类说明
列表中的文件已按功能分为以下类别，你可以据此快速定位：
- **事件类/EMS**: 系统事件和告警日志
- **网络类**: 端口、LIF、VLAN、路由、接口组等
- **存储类**: 磁盘、聚合、卷、RAID、快照等
- **服务类**: NFS、CIFS、vserver、审计、认证等
- **集群/HA**: 集群状态、高可用、许可等
- **系统/平台**: 系统配置、硬件平台、SP等
- **性能统计**: CPU、内存、IO、吞吐量等
- **适配器/硬件**: SAS、T6、NIC适配器等
- **内核/驱动**: BSD内部、内核参数等

## 工作流程

1. **查概念** → 第一个调用必须是 `lookup_concept(user_request)`，把用户问题传进去
2. **读文件** → concept 返回的 `matched_files` 里已经包含真实的文件 ID，直接用 `read_file(file_id)` 打开。不要自己从 catalog 里找文件——matched_files 就是正确答案。如果 `found: false`，再按 catalog 中的文件名查找。
3. **输出** → 读完后立即输出结论，只回答用户的问题，不要发散

## 输出要求
- 用中文回答，简洁专业
- **所有事实性结论必须标注来源文件**，使用以下格式：
  [来源: 文件名](ref://FILE_ID?line=行号)
  例如：发现端口 a0c 处于 down 状态 [来源: ifgrps.xml](ref://abc123?line=5)
  注意：FILE_ID 和行号必须从 search_logs 或 read_file 的返回结果中获取
- 使用 Markdown 表格和列表组织信息
"""

# Tool definitions in OpenAI-compatible format
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "读取指定文件的完整内容。优先使用此工具——根据文件名直接打开相关文件，而非先搜索",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_id": {"type": "string", "description": "文件 ID"},
                    "offset": {"type": "integer", "description": "起始行偏移，默认 0"},
                    "limit": {"type": "integer", "description": "读取行数，默认 500"}
                },
                "required": ["file_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "lookup_concept",
            "description": "查询 ONTAP 存储术语对应的文件。系统自动匹配并返回真实文件 ID。直接把返回的 matched_files 列表中的 file_id 传给 read_file 即可，不需要自己再从 catalog 里找。如果 found: false，则按文件名和分类自行判断。",
            "parameters": {
                "type": "object",
                "properties": {
                    "concept": {"type": "string", "description": "用户原始问题全文，直接传入即可。系统会自动提取其中的 ONTAP 术语进行匹配（如 \"几个磁盘\" 会匹配到 \"磁盘\"，\"LIF 状态\" 会匹配到 \"lif\"）"}
                },
                "required": ["concept"]
            }
        }
    },
]

class LLMService:
    def __init__(self):
        self.base_url = "https://api.deepseek.com/v1"
        self.api_key = os.environ.get("DEEPSEEK_API_KEY", "")
        # Fallback: read from Hermes .env
        if not self.api_key:
            hermes_env = os.path.expanduser("~/.hermes/.env")
            if os.path.exists(hermes_env):
                for line in open(hermes_env):
                    line = line.strip()
                    if line.startswith("DEEPSEEK_API_KEY="):
                        self.api_key = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break
        self.model = "deepseek-chat"

    async def chat(self, messages: list[dict], tools: list[dict] | None = None) -> dict:
        """Single LLM call with optional tools."""
        if not self.api_key:
            raise ValueError("DEEPSEEK_API_KEY 环境变量未设置，无法调用 DeepSeek API。请设置后重启服务。")

        body = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.3,
        }
        if tools:
            body["tools"] = tools
            body["tool_choice"] = "auto"

        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{self.base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
            resp.raise_for_status()
            return resp.json()

    async def run_with_tools(
        self,
        user_message: str,
        execute_tool,
    ) -> str:
        """
        Full tool-use loop:
        1. Send user message with system prompt + tools
        2. If LLM requests tools, execute them and send results back
        3. Loop until LLM gives final text response (no more tool calls)
        4. Return the final answer
        """
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ]
        max_turns = 6

        for _ in range(max_turns):
            response = await self.chat(messages, TOOLS)
            choice = response["choices"][0]
            msg = choice["message"]

            if msg.get("tool_calls"):
                # LLM wants to call tools
                messages.append({
                    "role": "assistant",
                    "content": msg.get("content"),
                    "tool_calls": msg["tool_calls"],
                })

                # Execute all tool calls in parallel
                async def _run(tc):
                    func = tc["function"]
                    args = json.loads(func["arguments"])
                    return tc, await execute_tool(func["name"], args)

                results = await asyncio.gather(*[_run(tc) for tc in msg["tool_calls"]])
                for tc, result in results:
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": json.dumps(result, ensure_ascii=False),
                    })
            else:
                # Final answer
                return msg.get("content", "")

        return "分析超时，请简化问题后重试。"
