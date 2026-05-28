from __future__ import annotations

import asyncio
import json
import httpx
import os

SYSTEM_PROMPT = """你是一位资深的 NetApp ONTAP 存储日志分析师。你拥有访问 ASUP 日志的权限。

## 你可以使用的工具：
- **list_files()**: 列出当前 session 中所有日志文件，包含文件名、类型、大小。XML 文件会标注列名。
- **search_logs(query, file_type?, limit?)**: 在所有日志文件中搜索关键词，支持按文件类型（text/ems/xml）过滤。
- **read_file(file_id, offset?, limit?)**: 读取指定文件的完整内容。

## 分析流程：
1. 首先用 list_files 了解有哪些文件可用
2. 根据文件名和类型，同时批量搜索健康相关关键词（一次响应中可发起多个 search_logs 并行执行）：
   - 错误/告警: error, failed, fault, panic, fatal
   - 降级: degraded, offline, disconnected, unreachable  
   - 性能: timeout, slow, high latency, bottleneck
   - 配置: misconfigured, inconsistent, mismatch
3. 对搜索结果中有价值的文件，用 read_file 深入查看
4. 综合所有信息，给出专业的集群健康评估

## 输出要求：
- 用中文回答
- 先给出总体健康评级（健康/警告/严重）
- 列出发现的关键问题及影响的节点
- 提供具体的时间线和证据
- 给出可操作的建议
"""

# Tool definitions in OpenAI-compatible format
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "list_files",
            "description": "列出当前 session 中所有可搜索的日志文件",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_logs",
            "description": "在所有日志文件中搜索关键词",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词（英文）"},
                    "file_type": {"type": "string", "enum": ["text", "ems", "xml"], "description": "可选：按文件类型过滤"},
                    "limit": {"type": "integer", "description": "返回结果数上限，默认 20"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "读取指定文件的完整内容",
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
    }
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
        max_turns = 25

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
