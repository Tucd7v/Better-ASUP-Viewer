from __future__ import annotations

import asyncio
import json
import queue
import threading
import traceback
import uuid
from datetime import datetime
from pathlib import Path

import aiofiles
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse, JSONResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import UPLOAD_DIR
from core.database import get_db
from models.db import FileRecord, Session
from schemas.api import SessionStatusResponse, UploadResponse
from services.asup_parser import ASUPParserService
from services.clustering import ClusteringService
from services.extract import ExtractService

router = APIRouter()

# Thread-safe queues shared between worker threads and SSE consumers
_progress_queues: dict[str, queue.Queue] = {}


async def _process_session(session_id: str, archive_path: Path, files_dir: Path, q: queue.Queue):
    from core.config import settings, BASE_DIR
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

    print(f"[PROCESS] START session={session_id}", flush=True)

    # Dedicated engine per thread — avoids sharing aiosqlite connections across event loops
    db_url = settings.database_url
    if db_url.startswith("sqlite+aiosqlite:///./"):
        db_url = f"sqlite+aiosqlite:///{BASE_DIR / db_url[len('sqlite+aiosqlite:///./') :]}"
    thread_engine = create_async_engine(db_url, echo=False, connect_args={"check_same_thread": False})
    ThreadSession = async_sessionmaker(thread_engine, class_=AsyncSession, expire_on_commit=False)

    try:
        async with ThreadSession() as db:
            session_row = await db.get(Session, session_id)
            if session_row is None:
                print(f"[PROCESS] session_row not found", flush=True)
                return

            session_row.status = "processing"
            await db.commit()

            try:
                print(f"[PROCESS] extracting...", flush=True)
                extract_svc = ExtractService(session_id, q)
                await extract_svc.extract(archive_path, files_dir)
                print(f"[PROCESS] extract OK: {len(list(files_dir.iterdir()))} files", flush=True)

                print(f"[PROCESS] parsing...", flush=True)
                parser_svc = ASUPParserService(session_id, files_dir, q)
                meta, records = await parser_svc.parse(db, session_row)
                await db.commit()
                print(f"[PROCESS] parse OK: {len(records)} records meta={meta}", flush=True)

                session_row.status = "done"
                await db.commit()
                await ClusteringService.try_group(session_row, db)
                print(f"[PROCESS] DONE", flush=True)

            except BaseException as exc:
                tb = traceback.format_exc()
                msg = str(exc) or repr(exc) or tb
                print(f"[PROCESS] EXCEPTION type={type(exc).__name__}: {msg}\n{tb}", flush=True)
                session_row.status = "error"
                session_row.error_message = msg[:500]
                await db.commit()
                q.put({"_error": msg})
                return

        q.put({"_done": True})
    finally:
        await thread_engine.dispose()


def _run_in_thread(session_id: str, archive_path: Path, files_dir: Path):
    print(f"[THREAD] starting for session={session_id}", flush=True)
    q = _progress_queues.get(session_id)
    if q is None:
        print(f"[THREAD] no queue found, aborting", flush=True)
        return
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(_process_session(session_id, archive_path, files_dir, q))
    except BaseException:
        print(f"[THREAD] unhandled {traceback.format_exc()}", flush=True)
        q.put({"_error": traceback.format_exc()})
    finally:
        loop.close()
        print(f"[THREAD] loop closed for session={session_id}", flush=True)


@router.post("/upload", response_model=UploadResponse, status_code=202)
async def upload_file(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    session_id = str(uuid.uuid4())
    original_dir = UPLOAD_DIR / session_id / "original"
    original_dir.mkdir(parents=True, exist_ok=True)

    filename = file.filename or "upload"
    dest = original_dir / filename

    async with aiofiles.open(dest, "wb") as out:
        while chunk := await file.read(1024 * 1024):
            await out.write(chunk)

    files_dir = UPLOAD_DIR / session_id / "files"
    files_dir.mkdir(parents=True, exist_ok=True)

    now = datetime.utcnow()
    session_row = Session(
        id=session_id,
        uploaded_at=now,
        status="pending",
        original_filename=filename,
        storage_path=str(dest),
    )
    db.add(session_row)
    await db.commit()

    q: queue.Queue = queue.Queue()
    _progress_queues[session_id] = q
    print(f"[UPLOAD] starting thread for session={session_id}", flush=True)

    t = threading.Thread(target=_run_in_thread, args=(session_id, dest, files_dir), daemon=True)
    t.start()
    print(f"[UPLOAD] thread started: {t.name}", flush=True)

    return JSONResponse(
        status_code=202,
        content={"session_id": session_id, "status": "processing"},
    )


@router.get("/sessions/{session_id}/status", response_model=SessionStatusResponse)
async def get_session_status(session_id: str, db: AsyncSession = Depends(get_db)):
    session_row = await db.get(Session, session_id)
    if session_row is None:
        raise HTTPException(status_code=404, detail="Session not found")

    count_result = await db.execute(
        select(func.count(FileRecord.id)).where(FileRecord.session_id == session_id)
    )
    file_count = count_result.scalar_one()

    return SessionStatusResponse(
        session_id=session_id,
        status=session_row.status,
        error_message=session_row.error_message,
        hostname=session_row.hostname or None,
        serial_num=session_row.serial_num or None,
        cluster_id=session_row.cluster_id,
        generated_on=session_row.generated_on,
        file_count=file_count,
    )


@router.get("/sessions/{session_id}/progress")
async def session_progress(session_id: str, db: AsyncSession = Depends(get_db)):
    session_row = await db.get(Session, session_id)
    if session_row is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if session_id not in _progress_queues:
        if session_row.status == "done":

            async def _already_done():
                data = json.dumps({"session_id": session_id, "status": "done"})
                yield f"event: done\ndata: {data}\n\n"

            return StreamingResponse(_already_done(), media_type="text/event-stream")

        if session_row.status == "error":

            async def _already_error():
                data = json.dumps({"message": session_row.error_message or "Unknown error"})
                yield f"event: error\ndata: {data}\n\n"

            return StreamingResponse(_already_error(), media_type="text/event-stream")

    q: queue.Queue = _progress_queues.setdefault(session_id, queue.Queue())

    async def _stream():
        try:
            while True:
                try:
                    # Poll the thread-safe queue without blocking the event loop
                    event = await asyncio.get_event_loop().run_in_executor(
                        None, lambda: q.get(timeout=30)
                    )
                except Exception:
                    yield ": keepalive\n\n"
                    continue

                if "_done" in event:
                    data = json.dumps({"session_id": session_id, "status": "done"})
                    yield f"event: done\ndata: {data}\n\n"
                    break
                elif "_error" in event:
                    data = json.dumps({"message": event["_error"]})
                    yield f"event: error\ndata: {data}\n\n"
                    break
                else:
                    data = json.dumps(event)
                    yield f"event: progress\ndata: {data}\n\n"
        finally:
            _progress_queues.pop(session_id, None)

    return StreamingResponse(_stream(), media_type="text/event-stream")
