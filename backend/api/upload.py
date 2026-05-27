from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime
from pathlib import Path

import aiofiles
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
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

_progress_queues: dict[str, asyncio.Queue] = {}


async def _process_session(session_id: str, archive_path: Path, files_dir: Path):
    from core.database import AsyncSessionLocal

    queue: asyncio.Queue = _progress_queues.get(session_id, asyncio.Queue())
    _progress_queues[session_id] = queue

    async with AsyncSessionLocal() as db:
        session_row = await db.get(Session, session_id)
        if session_row is None:
            return

        session_row.status = "processing"
        await db.commit()

        try:
            extract_svc = ExtractService(session_id, queue)
            await extract_svc.extract(archive_path, files_dir)

            parser_svc = ASUPParserService(session_id, files_dir, queue)
            await parser_svc.parse(db, session_row)

            session_row.status = "done"
            await db.commit()

            await ClusteringService.try_group(session_row, db)

        except Exception as exc:
            session_row.status = "error"
            session_row.error_message = str(exc)
            await db.commit()
            await queue.put({"_error": str(exc)})
            return

    await queue.put({"_done": True})


@router.post("/upload", response_model=UploadResponse, status_code=202)
async def upload_file(
    background_tasks: BackgroundTasks,
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

    _progress_queues[session_id] = asyncio.Queue()
    background_tasks.add_task(_process_session, session_id, dest, files_dir)

    return UploadResponse(session_id=session_id, status="processing")


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

    queue = _progress_queues.setdefault(session_id, asyncio.Queue())

    async def _stream():
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30.0)
                except asyncio.TimeoutError:
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
