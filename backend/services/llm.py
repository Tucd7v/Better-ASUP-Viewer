from __future__ import annotations

import asyncio
import json
import httpx
import os

SYSTEM_PROMPT = """你是一位资深的 NetApp ONTAP 存储日志分析师。你拥有访问 ASUP 日志的权限。

## 核心原则
- **严格按照用户的具体需求进行分析**，不要主动进行用户未请求的全面检查
- 文件已按功能分类（见下方说明），**只在相关分类的范围内搜索**，除非用户明确要求跨类别搜索
- 除非用户明确要求"检查集群健康状态"或类似表述，否则**不要主动进行全网扫描式的健康评估**
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

## 工具和流程（严格按顺序执行，每步做完即刻进入下一步）

### 第 1 步：查概念（必须最先执行）
用户提到的**任何** ONTAP 术语（LIF、SVM、快照、aggregate、HA 等），**第一个工具调用必须是 lookup_concept**。
⚠️ 禁止在 lookup_concept 之前调用 read_file 或 search_logs。先搞清楚该读哪些文件，再动手。

### 第 2 步：读文件
根据 lookup_concept 返回的 files 列表（或 catalog 中的文件名），用 read_file 打开相关文件。
**优先读 XML**（结构化、列名+行、信息密度高），再用 text 补充细节。
**同一轮可以并行读多个文件**（例如同时 read_file network-interface.xml 和 ifconfig-*.txt）。
**数量/统计类问题（几个、有哪些、多少）直接读文件，禁止搜索！——catalog 和 concept 已经告诉你文件在哪，读完文件从数据里数出来就行。

### 第 3 步：输出结论（读完后立刻回答，禁止继续搜索）
read_file 返回结果后，**立即**基于已有数据输出分析结论。不要再去读"可能相关"的文件。
用户问什么答什么，不要发散到用户没问的领域。

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
            "description": "查询 ONTAP 存储术语对应的文件查找路径。遇到不确定的 ONTAP 概念时先调用此工具，获取优先查看的文件列表。如果找不到对应术语（found: false），则按文件名和分类自行判断。",
            "parameters": {
                "type": "object",
                "properties": {
                    "concept": {"type": "string", "description": "ONTAP 术语或概念，中英文均可（如: LIF, SVM, 快照, aggregate, HA）"}
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
