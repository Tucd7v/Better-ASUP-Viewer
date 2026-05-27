from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.db import FileRecord, Session
from schemas.api import (
    EmsContentResponse,
    FileRecordOut,
    SessionFilesResponse,
    TextContentResponse,
    XmlContentResponse,
)
from services.file_content import FileContentService

router = APIRouter()


@router.get("/sessions/{session_id}/files", response_model=SessionFilesResponse)
async def list_files(session_id: str, db: AsyncSession = Depends(get_db)):
    session_row = await db.get(Session, session_id)
    if session_row is None:
        raise HTTPException(status_code=404, detail="Session not found")

    result = await db.execute(
        select(FileRecord).where(FileRecord.session_id == session_id)
    )
    records = result.scalars().all()

    return SessionFilesResponse(
        session_id=session_id,
        files=[FileRecordOut.model_validate(r) for r in records],
    )


@router.get("/sessions/{session_id}/files/{file_id}/content")
async def get_file_content(
    session_id: str,
    file_id: str,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=500, ge=1, le=5000),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(FileRecord).where(
            FileRecord.id == file_id,
            FileRecord.session_id == session_id,
        )
    )
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="File not found")

    if record.is_empty:
        return {"file_type": record.file_type, "filename": record.filename, "note": "File is empty"}

    fp = Path(record.file_path)
    if not fp.exists():
        raise HTTPException(status_code=404, detail="File data not found on disk")

    svc = FileContentService()

    if record.file_type == "text":
        data = await svc.read_text(fp, record.filename, offset=offset, limit=limit)
        return TextContentResponse(**data)

    if record.file_type == "ems":
        ems_limit = min(limit, 200)
        data = await svc.read_ems(fp, record.filename, offset=offset, limit=ems_limit)
        return EmsContentResponse(**data)

    if record.file_type == "xml":
        data = await svc.read_xml(fp, record.filename)
        return XmlContentResponse(**data)

    return {"file_type": "unknown", "filename": record.filename, "note": "Cannot render this file type"}
