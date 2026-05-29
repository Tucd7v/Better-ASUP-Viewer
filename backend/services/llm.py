from __future__ import annotations

import asyncio
import json
import httpx
import os
import yaml
from pathlib import Path

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
2. **读文件** → concept 返回的 `matched_files` 里已经包含真实的文件 ID，直接用 `read_file(file_id)` 打开。如果 `found: false`，用 `find_files(pattern)` 搜索文件名获取 file_id。如果 find_files 也找不到，最后用 `list_catalog` 查看全部文件目录。
3. **输出** → 读完后立即输出结论，只回答用户的问题，不要发散

## 输出要求
- 用中文回答，简洁专业
- **所有事实性结论必须标注来源**，使用内部引用格式（不是真实 URL！）：
  `[文件名](ref://FILE_ID)`
  例如：`[ifgrps.xml](ref://abc123-def-456)` 表示来源是 ifgrps.xml 文件
  其中 FILE_ID 是 read_file 返回结果中的 file_id 字段值，直接原样填入即可
- **禁止生成 http:// 开头的链接**，只使用 ref:// 格式
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
    {
        "type": "function",
        "function": {
            "name": "find_files",
            "description": "按文件名模式搜索 catalog，返回匹配文件的真实 file_id。仅在 lookup_concept 返回 found: false 时使用。传入文件名的部分关键词即可（如 \"ha-interconnect\"）。返回 matched_files 列表，直接拿 file_id 调 read_file。",
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "description": "文件名关键词或模式（如: ha, interconnect, sysconfig, snapmirror）"}
                },
                "required": ["pattern"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_catalog",
            "description": "最后一次手段：列出所有可搜索的文件目录（按节点和分类分组）。仅在 lookup_concept 和 find_files 都找不到时才调用。",
            "parameters": {"type": "object", "properties": {}}
        }
    },
]

class LLMService:
    def __init__(self):
        # Load config from aiconfig.yaml
        config_path = Path(__file__).parent.parent / "aiconfig.yaml"
        self.base_url = "https://api.deepseek.com/v1"
        self.model = "deepseek-chat"
        self.api_key = ""
        if config_path.exists():
            try:
                cfg = yaml.safe_load(config_path.read_text()) or {}
                api_cfg = cfg.get("api", {})
                self.base_url = api_cfg.get("base_url", self.base_url).rstrip("/")
                self.model = api_cfg.get("model", self.model)
                self.api_key = api_cfg.get("api_key", "")
            except Exception:
                pass
        # Env var overrides config file
        self.api_key = os.environ.get("DEEPSEEK_API_KEY", self.api_key)
        # Fallback: Hermes .env
        if not self.api_key:
            hermes_env = os.path.expanduser("~/.hermes/.env")
            if os.path.exists(hermes_env):
                for line in open(hermes_env):
                    line = line.strip()
                    if line.startswith("DEEPSEEK_API_KEY="):
                        self.api_key = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break

    async def chat(self, messages: list[dict], tools: list[dict] | None = None) -> dict:
        """Single LLM call with optional tools."""
        if not self.api_key:
            raise ValueError("API Key 未设置。请在 backend/aiconfig.yaml 中填写 api_key，或设置 DEEPSEEK_API_KEY 环境变量。")

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
        max_turns = 15

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
