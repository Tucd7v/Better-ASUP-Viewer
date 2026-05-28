from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from core.config import settings, BASE_DIR
from models.db import FileRecord, Session, SessionGroupMember
from services.search import SearchService
from services.file_content import FileContentService
from services.llm import LLMService, SYSTEM_PROMPT, TOOLS

router = APIRouter(tags=["chat"])


# ---------------------------------------------------------------------------
# File classification — group catalog entries by functional category before
# sending to the AI, so the model can quickly orient itself in large dumps.
# ---------------------------------------------------------------------------

CATEGORY_PATTERNS: list[tuple[str, list[str]]] = [
    ("事件类/EMS", ["ems", "event-", "notifyd"]),
    ("网络类", [
        "ifconfig", "ifstat", "netstat", "ifgrp", "vlan", "lif", "port", "route",
        "bgp", "ipsec", "fabriclink", "cdpd", "reachability", "ipspace", "nwd",
        "qos", "arp", "broadcast-domain", "csm-network", "ctran", "network-",
        "vlans", "vsun", "ntp", "pcpconfig", "strongswan", "vifmgr", "vif-ids",
        "vs-failover", "ipfilter", "firewall", "net-object", "cdb-net", "ioxm",
        "ethernet", "svm-migrate-network",
        "netsetup", "ipcache",
    ]),
    ("存储类", [
        "disk", "aggr", "volume", "storage", "raid", "snapshot", "snapmirror",
        "df-", "df.", "partition", "nvm", "flash-card", "sis", "wafl",
        "cross-volume", "qtree", "flexgroup", "copy-offload", "garbage-collection",
        "familyTable", "snaplock", "vvol", "junctionTable", "arw", "smdb",
        "cps-st", "snap-list", "snap-status", "snap-reserve", "snap-sched",
        "vol-", "backup", "cm-daemon", "vldb",
    ]),
    ("服务类", [
        "vserver", "nfs", "cifs", "snmp", "ldap", "kerberos", "ssh", "certificate",
        "web", "audit", "export", "vscan", "appdm", "svm-migrate", "quota",
        "ndmp", "saml", "apache", "php", "qpidd", "mgwd", "notifyd-diagnostics",
        "diff-svcs", "session-limit", "pubsub", "unix-user", "unix-group",
        "nisdb", "ns-cache", "nsswitch", "name-service", "ndo", "security",
        "kmip", "ocsp", "secd", "tpm",
        "crs-", "application-record", "multi-admin", "session-",
    ]),
    ("集群/HA", [
        "cluster", "ha-", "ha_", "bcomd", "boottimes", "license", "upgrade",
        "managed-feature", "coredump", "clam", "config-backup", "auto-update",
        "detect-switchless",
    ]),
    ("系统/平台", [
        "sysconfig", "options", "environment", "registry", "dmesg", "messages",
        "sp-", "sensor", "dimm", "motherboard", "pci", "manufacturing",
        "SYSTEM-SERIAL", "serial-number", "node-info", "timezone",
        "capability-summary", "aps-node", "system-info", "system-manager",
        "node_root", "spmd", "var-etc", "sysmgr", "software_image",
        "DEVICE-INFO", "process-memory",
        "frs-", "memerr",
    ]),
    ("性能统计", [
        "perf", "vm-", "vmstat", "top_", "usage", "stats", "counters", "spinhi",
        "hwassist", "ps-ax", "sockstat",
    ]),
    ("适配器/硬件", [
        "sas", "acp", "t6", "adapter", "device-discovery", "filerBlade",
        "csm-blade", "csm-sessions", "io-", "pci", "mellanox",
    ]),
    ("内核/驱动", [
        "bsd-", "sysctl", "kenv", "charon", "kma", "rdb_dump", "rtag",
    ]),
]

# Files with no analytical value — never expose to the AI.
EXCLUDE_PATTERNS: list[str] = [
    "manifest.xml", "nextIdTable.xml", "log_files.xml", "X-HEADER-DATA",
    "spider-history", "spider-list", "leak-data", "sktrace",
    "mtrace-log", "csm-trace-buffer", "cf_rsrctbl",
    "jm_history", "jm_sched", "aps-aggr-model", "msidTable",
    "nextId", "apache_error", "apache_access", "apache-jail",
    "php", "php-jail", "qpidd", "kmip2-client",
    "sec_cache_config", "name-service-file-version",
    "rpc_program_stats", "rpc_transport_stats", "rpc_queue_stats",
    "rpc_thread_stats", "rpc_periodic_stats", "rpc_func_stats",
    "rpc_max_disp_queue", "rpc_max_disp_thread",
    "hammi-client", "hammi-server",
]

# Per-category cap when rendering the catalog to the AI.
CATEGORY_MAX_FILES = 15


def is_excluded(filename: str) -> bool:
    """Return True if the file should be hidden from the AI entirely."""
    name_lower = filename.lower()
    for p in EXCLUDE_PATTERNS:
        if p.lower() in name_lower:
            return True
    return False


def classify_file(filename: str, file_type: str) -> str:
    """Classify a file into a functional category by filename pattern."""
    name_lower = filename.lower()
    # file_type 'ems' is always event class regardless of name.
    if file_type == "ems":
        return "事件类/EMS"
    for category, patterns in CATEGORY_PATTERNS:
        for p in patterns:
            if p.lower() in name_lower:
                return category
    # Special overrides for files that get misclassified.
    if "spinnp" in name_lower or "spmd" in name_lower:
        return "系统/平台" if "spmd" in name_lower else "存储类"
    return "其他"


class ChatRequest(BaseModel):
    session_ids: list[str] = []
    group_id: str | None = None
    message: str


class ChatResponse(BaseModel):
    answer: str


def _get_engine():
    db_url = settings.database_url
    if db_url.startswith("sqlite+aiosqlite:///./"):
        db_url = f"sqlite+aiosqlite:///{BASE_DIR / db_url[len('sqlite+aiosqlite:///./'):]}"
    return create_async_engine(db_url, echo=False, connect_args={"check_same_thread": False})


async def _resolve_session_ids(session_ids: list[str], group_id: str | None) -> list[str]:
    """Resolve session_ids — if group_id is set, look up group members."""
    if session_ids:
        return list(session_ids)
    if group_id:
        engine = _get_engine()
        SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        async with SessionLocal() as db:
            result = await db.execute(
                select(SessionGroupMember.session_id).where(SessionGroupMember.group_id == group_id)
            )
            return [row[0] for row in result.all()]
    return []


async def _build_context(session_ids: list[str]):
    """Build file catalog across all sessions and return execute_tool closure.
    Shared by /chat and /chat/stream.
    """
    if not session_ids:
        raise ValueError("No session_ids provided")

    engine = _get_engine()
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    # session_id -> (hostname, serial_num)
    session_info: dict[str, tuple[str, str]] = {}
    # session_id -> [catalog_entry, ...]
    catalog_by_session: dict[str, list[dict]] = {}
    # flat catalog list (for list_files tool result)
    catalog: list[dict] = []

    async with SessionLocal() as db:
        for sid in session_ids:
            sess_obj = await db.get(Session, sid)
            session_info[sid] = (
                sess_obj.hostname if sess_obj else "",
                sess_obj.serial_num if sess_obj else "",
            )

            result = await db.execute(
                select(FileRecord).where(
                    FileRecord.session_id == sid,
                    FileRecord.file_type.in_(["text", "ems", "xml"]),
                    FileRecord.is_empty == False,
                )
            )
            records = result.scalars().all()

            entries = []
            for rec in records:
                # Drop files with no analytical value before they ever reach the AI.
                if is_excluded(rec.filename):
                    continue
                hostname, serial = session_info[sid]
                entry = {
                    "file_id": rec.id,
                    "session_id": sid,
                    "filename": rec.filename,
                    "file_type": rec.file_type,
                    "file_size": rec.file_size,
                    "hostname": hostname,
                    "serial_num": serial,
                    "category": classify_file(rec.filename, rec.file_type),
                }
                if rec.file_type == "xml":
                    try:
                        from pathlib import Path
                        svc = FileContentService()
                        data = await svc.read_xml(Path(rec.file_path), rec.filename)
                        rows = data.get("rows", [])
                        if rows:
                            entry["columns"] = list(rows[0].keys())
                    except Exception:
                        entry["columns"] = []
                entries.append(entry)
                catalog.append(entry)
            catalog_by_session[sid] = entries

    async def execute_tool(name: str, args: dict):
        nonlocal engine
        if name == "list_files":
            return catalog

        elif name == "search_logs":
            query = args["query"]
            file_type = args.get("file_type")
            limit = args.get("limit", 20)

            async with SessionLocal() as db2:
                stmt = select(FileRecord).where(
                    FileRecord.session_id.in_(session_ids),
                    FileRecord.file_type.in_(["text", "ems", "xml"]),
                    FileRecord.is_empty == False,
                )
                if file_type:
                    stmt = stmt.where(FileRecord.file_type == file_type)
                recs = (await db2.execute(stmt)).scalars().all()

            sem = asyncio.Semaphore(30)

            async def search_one(rec):
                async with sem:
                    matches = await SearchService.search_file(rec, query, max_matches=5)
                    return rec, matches

            tasks = [search_one(r) for r in recs]
            results = await asyncio.gather(*tasks)

            flat = []
            for rec, matches in results:
                hostname, serial = session_info.get(rec.session_id, ("", ""))
                for m in matches:
                    flat.append({
                        "file_id": rec.id,
                        "session_id": rec.session_id,
                        "filename": rec.filename,
                        "file_type": rec.file_type,
                        "hostname": hostname,
                        "serial_num": serial,
                        "line": m["line"],
                        "context": m["context"],
                    })
            return flat[:limit]

        elif name == "read_file":
            file_id = args["file_id"]
            offset = args.get("offset", 0)
            limit = min(args.get("limit", 500), 2000)

            async with SessionLocal() as db2:
                rec = await db2.get(FileRecord, file_id)
                if rec is None:
                    return {"error": "File not found"}
                # Allow reading any file across resolved session_ids
                if rec.session_id not in session_ids:
                    return {"error": "File not in active sessions"}

            from pathlib import Path
            svc = FileContentService()
            fp = Path(rec.file_path)

            if rec.file_type == "ems":
                data = await svc.read_ems(fp, rec.filename, offset=offset, limit=min(limit, 200))
                return {
                    "filename": rec.filename,
                    "file_type": "ems",
                    "events": data.get("events", []),
                }
            elif rec.file_type == "xml":
                data = await svc.read_xml(fp, rec.filename)
                rows = data.get("rows", [])
                cols = list(rows[0].keys()) if rows else []
                return {
                    "filename": rec.filename,
                    "file_type": "xml",
                    "columns": cols,
                    "rows": rows[offset:offset+limit],
                    "total_rows": len(rows),
                }
            else:
                data = await svc.read_text(fp, rec.filename, offset=offset, limit=limit)
                return {
                    "filename": rec.filename,
                    "file_type": "text",
                    "lines": data.get("lines", []),
                    "total_lines": data.get("total_lines", 0),
                }

        else:
            return {"error": f"Unknown tool: {name}"}

    return catalog, execute_tool, session_info, catalog_by_session


def _format_catalog(
    session_ids: list[str],
    session_info: dict[str, tuple[str, str]],
    catalog_by_session: dict[str, list[dict]],
) -> str:
    """Format catalog grouped by node, then by functional category.

    Files in the "其他" bucket are internal/debug noise and are omitted from
    the prompt entirely. Each category is capped at CATEGORY_MAX_FILES so a
    very large dump doesn't blow up the context window — when truncation
    happens the header notes the total count.
    """
    # Preserve declared category order, with "其他" implicitly last (and skipped).
    category_order = [name for name, _ in CATEGORY_PATTERNS]

    parts: list[str] = []
    for sid in session_ids:
        hostname, serial = session_info.get(sid, ("", ""))
        entries = catalog_by_session.get(sid, [])

        header = f"## Node: {hostname or '(unknown)'} (serial: {serial or 'n/a'}, session: {sid})"
        section_lines: list[str] = [header]

        # Bucket entries by category.
        buckets: dict[str, list[dict]] = {}
        for e in entries:
            cat = e.get("category") or classify_file(e["filename"], e["file_type"])
            buckets.setdefault(cat, []).append(e)

        for cat in category_order:
            files = buckets.get(cat, [])
            if not files:
                continue
            total = len(files)
            shown = files[:CATEGORY_MAX_FILES]
            if total > CATEGORY_MAX_FILES:
                section_lines.append(
                    f"### {cat} ({total} 个文件，仅列出前 {CATEGORY_MAX_FILES} 个代表性的)"
                )
            else:
                section_lines.append(f"### {cat} ({total} 个文件)")
            for e in shown:
                section_lines.append(
                    f"  [{e['file_id']}] {e['filename']} ({e['file_type']}) "
                    f"[session:{e['session_id']}, hostname:{e['hostname'] or 'n/a'}]"
                )

        # "其他" is intentionally not rendered.
        parts.append("\n".join(section_lines))

    return "\n\n".join(parts)


@router.post("/chat", response_model=ChatResponse)
async def chat(body: ChatRequest):
    session_ids = await _resolve_session_ids(body.session_ids, body.group_id)
    if not session_ids:
        raise HTTPException(status_code=400, detail="必须提供 session_ids 或 group_id")

    _, execute_tool, session_info, catalog_by_session = await _build_context(session_ids)

    catalog_text = _format_catalog(session_ids, session_info, catalog_by_session)
    user_message = f"当前分析的节点文件目录如下（按节点分组）：\n\n{catalog_text}\n\n用户问题：{body.message}"

    llm = LLMService()
    try:
        answer = await llm.run_with_tools(user_message, execute_tool)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM 调用失败: {str(e)}")
    return ChatResponse(answer=answer)


@router.post("/chat/stream")
async def chat_stream(body: ChatRequest):
    """Streaming chat with real-time tool call events."""
    session_ids = await _resolve_session_ids(body.session_ids, body.group_id)
    if not session_ids:
        raise HTTPException(status_code=400, detail="必须提供 session_ids 或 group_id")

    _, execute_tool, session_info, catalog_by_session = await _build_context(session_ids)

    catalog_text = _format_catalog(session_ids, session_info, catalog_by_session)
    user_message = f"当前分析的节点文件目录如下（按节点分组）：\n\n{catalog_text}\n\n用户问题：{body.message}"

    async def event_stream():
        try:
            yield f"data: {json.dumps({'type': 'status', 'message': '正在分析文件目录...'}, ensure_ascii=False)}\n\n"

            llm = LLMService()
            messages = [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ]
            max_turns = 25

            for turn in range(max_turns):
                response = await llm.chat(messages, TOOLS)
                choice = response["choices"][0]
                msg = choice["message"]

                if msg.get("tool_calls"):
                    messages.append({
                        "role": "assistant",
                        "content": msg.get("content"),
                        "tool_calls": msg["tool_calls"],
                    })

                    # Stream tool calls
                    for tc in msg["tool_calls"]:
                        func = tc["function"]
                        args = json.loads(func["arguments"])
                        yield f"data: {json.dumps({'type': 'tool_call', 'tool': func['name'], 'args': args}, ensure_ascii=False)}\n\n"

                    # Execute tools in parallel
                    async def _run(tc):
                        func = tc["function"]
                        args = json.loads(func["arguments"])
                        result = await execute_tool(func["name"], args)
                        return tc, result

                    results = await asyncio.gather(*[_run(tc) for tc in msg["tool_calls"]])

                    for tc, result in results:
                        fn = tc["function"]["name"]
                        messages.append({
                            "role": "tool",
                            "tool_call_id": tc["id"],
                            "content": json.dumps(result, ensure_ascii=False),
                        })
                        # Stream tool results (trim for display)
                        yield f"data: {json.dumps({'type': 'tool_result', 'tool': fn, 'result': result}, ensure_ascii=False)}\n\n"

                        # Stream intermediate LLM response
                        if isinstance(result, list) and len(result) > 0:
                            count = len(result)
                            files_list = list(set(r.get("filename", "?") for r in result[:5]))
                            files_str = ", ".join(files_list)
                            status_msg = f"搜索完成 — 在 {count} 条匹配中找到: {files_str}"
                            yield f"data: {json.dumps({'type': 'status', 'message': status_msg}, ensure_ascii=False)}\n\n"
                else:
                    # Final answer
                    yield f"data: {json.dumps({'type': 'done', 'answer': msg.get('content', '')}, ensure_ascii=False)}\n\n"
                    return

            yield f"data: {json.dumps({'type': 'error', 'message': '分析超时'}, ensure_ascii=False)}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
