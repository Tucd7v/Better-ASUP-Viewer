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

1. **查概念** → 第一个调用必须是 `lookup_concept(user_request)`，把用户问题传进去。**例外：如果用户消息中明确列出了文件 ID（如 `[xxx] filename`），说明用户已选定文件进行分析（分析模式），此时直接跳到步骤 2，用消息中列出的文件 ID 调用 `scan_file(file_id, keywords)`，不要调用 lookup_concept。**
2. **读文件** → concept 返回的 `matched_files` 里已经包含真实的文件 ID。**先用 `scan_file(file_id, keywords)` 扫描文件关键词，发现异常再用 `read_file(file_id)` 读取完整内容。** 如果 `found: false`，用 `find_files(pattern)` 搜索文件名获取 file_id。如果 find_files 也找不到，最后用 `list_catalog` 查看全部文件目录。
3. **查 KB** → 读完日志文件后，**无论用户是否主动要求**，都必须调用 `search_kb`。从日志中提取错误码/事件名/异常关键词（如 disk.ioMediumError、aggregate offline、HA takeover），翻译为英文技术关键词后搜索。这是标准流程，不是可选项。
4. **输出** → 输出结论，并列出 KB 搜索结果供用户参考。将 KB 文章信息整合在回答中，作为官方参考信息来源。

## 输出要求
- **分析结论必须在 KB 参考信息之前**——先给出对日志的分析和结论，再附上 KB 链接。禁止一上来就丢 KB 结果。
- 用中文回答，简洁专业
- **所有结论必须标注数据来源**，在结论后用括号注明文件名，如：（来源: SYSCONFIG-A.txt）
- 使用 Markdown 表格和列表组织信息
- 回答结构固定为：分析结论 →「📚 NetApp KB 相关文章」小节（列出 search_kb 返回的文章标题和链接）
"""

POST_UPLOAD_SYSTEM_PROMPT = """你是一位资深的 NetApp ONTAP ASUP 自动健康检查助手。你需要在上传解析完成后快速扫描关键日志，生成简洁健康摘要。

## 检查优先级
优先读取并分析以下文件：
1. sysconfig-a：磁盘健康、磁盘型号/状态、错误或故障迹象
2. sysconfig-r：Aggregate/RAID 状态、降级、reconstruct、plex/RAID 异常
3. EMS 日志：error/alert/emergency/warning 等事件
4. all-coredump：panic、core dump、系统崩溃
5. platform-sensors：温度、电压、风扇、电源等传感器异常
6. 文件名包含 alert 的任何文件

## 工具使用
- **先用 scan_file** 快速扫描每个关键文件，关键词用: error|fail|offline|degraded|panic|warning|critical|fault|corrupt|down
- scan_file 只返回匹配行 + 前后 2 行上下文，效率远高于 read_file
- **仅当 scan_file 发现异常时**，再用 read_file(file_id, offset=匹配行号, limit=50) 读取完整上下文
- 读完后如有异常发现，调用 search_kb 查找相关 KB 文章
- 最多约 20 次工具调用

## 输出要求
- 用中文输出，简洁。
- 输出 3-5 条，每条格式：`[✅/⚠️/❌] 类别：发现`
- 如发现异常，在每条下方用 📚 列出相关 KB 文章标题和链接
- 如果没有明显异常，只输出：`✅ 未发现明显异常`
"""

# Tool definitions in OpenAI-compatible format
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "读取指定文件的完整内容。仅当 scan_file 发现异常、需要完整上下文时使用。",
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
            "description": "查询 ONTAP 存储术语对应的文件。系统自动匹配并返回真实文件 ID。直接把返回的 matched_files 列表中的 file_id 传给 scan_file 即可，不需要自己再从 catalog 里找。如果 found: false，则按文件名和分类自行判断。",
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
            "description": "按文件名模式搜索 catalog，返回匹配文件的真实 file_id。仅在 lookup_concept 返回 found: false 时使用。传入文件名的部分关键词即可（如 \"ha-interconnect\"）。返回 matched_files 列表，直接拿 file_id 调 scan_file。",
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
    {
        "type": "function",
        "function": {
            "name": "search_kb",
            "description": "搜索 NetApp 知识库。将日志中的错误码/事件、或用户问题中的技术关键词翻译为英文后搜索。只返回 KB 搜索链接，不抓取正文内容。关键词用空格分隔，请精简到 3-5 个核心词。例如：disk failure 用 'disk failure recovery'；aggregate 满了用 'aggregate full expand'；HA 切换用 'HA takeover giveback'",
            "parameters": {
                "type": "object",
                "properties": {
                    "keywords": {"type": "string", "description": "英文技术关键词，空格分隔，3-5 个词最佳（如: disk SMART failure recovery）"}
                },
                "required": ["keywords"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "scan_file",
            "description": "Scan a file and return only lines matching given keywords (plus 2 context lines before/after). Much faster than read_file — use this first to check files for anomalies. Max 30 matches.",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_id": {"type": "string", "description": "File ID"},
                    "keywords": {"type": "string", "description": "Keywords separated by |. Only lines containing ANY keyword are returned. Example: error|fail|offline|degraded|panic"}
                },
                "required": ["file_id", "keywords"]
            }
        }
    },
]

class LLMService:
    def __init__(self, system_prompt: str = SYSTEM_PROMPT):
        self.system_prompt = system_prompt
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
        max_turns: int = 15,
        max_tool_calls: int | None = None,
    ) -> str:
        """
        Full tool-use loop:
        1. Send user message with system prompt + tools
        2. If LLM requests tools, execute them and send results back
        3. Loop until LLM gives final text response (no more tool calls)
        4. Return the final answer
        """
        messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": user_message},
        ]
        tool_calls_used = 0

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

                tool_calls = msg["tool_calls"]
                executable_tool_calls = tool_calls
                if max_tool_calls is not None:
                    remaining = max(0, max_tool_calls - tool_calls_used)
                    executable_tool_calls = tool_calls[:remaining]
                    tool_calls_used += len(tool_calls)

                # Execute allowed tool calls in parallel
                async def _run(tc):
                    func = tc["function"]
                    args = json.loads(func["arguments"])
                    return tc, await execute_tool(func["name"], args)

                results = await asyncio.gather(*[_run(tc) for tc in executable_tool_calls])
                for tc, result in results:
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": json.dumps(result, ensure_ascii=False),
                    })
                for tc in tool_calls[len(executable_tool_calls):]:
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": json.dumps({"error": "tool call limit reached"}, ensure_ascii=False),
                    })
            else:
                # Final answer
                return msg.get("content", "")

        return "分析超时，请简化问题后重试。"
