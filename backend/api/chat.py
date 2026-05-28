from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from core.config import settings, BASE_DIR
from models.db import FileRecord, Session
from services.search import SearchService
from services.file_content import FileContentService
from services.llm import LLMService

router = APIRouter(tags=["chat"])


class ChatRequest(BaseModel):
    session_id: str
    message: str


class ChatResponse(BaseModel):
    answer: str


def _get_engine():
    db_url = settings.database_url
    if db_url.startswith("sqlite+aiosqlite:///./"):
        db_url = f"sqlite+aiosqlite:///{BASE_DIR / db_url[len('sqlite+aiosqlite:///./'):]}"
    return create_async_engine(db_url, echo=False, connect_args={"check_same_thread": False})


@router.post("/chat", response_model=ChatResponse)
async def chat(body: ChatRequest):
    engine = _get_engine()
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with SessionLocal() as db:
        # Gather file catalog for this session
        result = await db.execute(
            select(FileRecord).where(
                FileRecord.session_id == body.session_id,
                FileRecord.file_type.in_(["text", "ems", "xml"]),
                FileRecord.is_empty == False,
            )
        )
        records = result.scalars().all()

        # Build catalog
        catalog = []
        for rec in records:
            entry = {
                "file_id": rec.id,
                "filename": rec.filename,
                "file_type": rec.file_type,
                "file_size": rec.file_size,
            }
            # For XML files, extract column headers
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
            catalog.append(entry)

    # Auto-inject file catalog into the message
    catalog_text = json.dumps(catalog, ensure_ascii=False, indent=2)
    user_message = f"当前分析的 session 文件目录如下：\n\n```json\n{catalog_text}\n```\n\n用户问题：{body.message}"

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
                    FileRecord.session_id == body.session_id,
                    FileRecord.file_type.in_(["text", "ems", "xml"]),
                    FileRecord.is_empty == False,
                )
                if file_type:
                    stmt = stmt.where(FileRecord.file_type == file_type)
                recs = (await db2.execute(stmt)).scalars().all()

            import asyncio
            sem = asyncio.Semaphore(30)

            async def search_one(rec):
                async with sem:
                    matches = await SearchService.search_file(rec, query, max_matches=5)
                    return rec, matches

            tasks = [search_one(r) for r in recs]
            results = await asyncio.gather(*tasks)

            flat = []
            for rec, matches in results:
                for m in matches:
                    flat.append({
                        "file_id": rec.id,
                        "filename": rec.filename,
                        "file_type": rec.file_type,
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

    llm = LLMService()
    try:
        answer = await llm.run_with_tools(user_message, execute_tool)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM 调用失败: {str(e)}")
    return ChatResponse(answer=answer)
