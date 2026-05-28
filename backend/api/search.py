from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.db import FileRecord
from services.search import SearchService

router = APIRouter(tags=["search"])


@router.get("/search")
async def search_files(
    session_id: str = Query(...),
    q: str = Query(..., min_length=1),
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """Search across all files in a session."""
    result = await db.execute(
        select(FileRecord).where(FileRecord.session_id == session_id)
    )
    records = result.scalars().all()

    # Run searches concurrently with a semaphore to limit disk I/O
    import asyncio
    _sem = asyncio.Semaphore(50)

    async def _search_one(rec):
        async with _sem:
            matches = await SearchService.search_file(rec, q, max_matches=10)
            return rec, matches

    tasks = [_search_one(rec) for rec in records]
    results = await asyncio.gather(*tasks)

    all_matches: list[dict] = []
    for rec, file_matches in results:
        if file_matches:
            all_matches.append({
                "file_id": rec.id,
                "session_id": rec.session_id,
                "filename": rec.filename,
                "file_type": rec.file_type,
                "matches": file_matches,
            })

    # Sort by total match count descending
    all_matches.sort(key=lambda x: len(x["matches"]), reverse=True)
    
    # Flatten
    flat_matches = []
    for f in all_matches:
        for m in f["matches"]:
            flat_matches.append({
                "file_id": f["file_id"],
                "session_id": f["session_id"],
                "filename": f["filename"],
                "file_type": f["file_type"],
                "line": m["line"],
                "context": m["context"],
            })
    
    return {"matches": flat_matches[:limit]}
