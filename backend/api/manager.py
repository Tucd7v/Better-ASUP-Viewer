from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.database import get_db
from models.db import Cluster, FileRecord, Node, Session, SessionGroup, SessionGroupMember
from schemas.api import (
    ClusterOut,
    ClustersResponse,
    GroupMemberOut,
    NodeSessionsResponse,
    NodeSummary,
    SessionGroupOut,
    SessionGroupsResponse,
    SessionSummary,
)

router = APIRouter()


@router.get("/clusters", response_model=ClustersResponse)
async def list_clusters(
    q: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Cluster).options(selectinload(Cluster.nodes))

    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(Cluster.id.ilike(pattern))

    count_result = await db.execute(select(func.count(Cluster.id)))
    total = count_result.scalar_one()

    stmt = stmt.offset(offset).limit(limit)
    result = await db.execute(stmt)
    clusters = result.scalars().all()

    out = []
    for c in clusters:
        nodes = [
            NodeSummary(
                id=n.id,
                hostname=n.hostname,
                serial_num=n.serial_num or "",
                session_count=n.session_count or 0,
            )
            for n in (c.nodes or [])
        ]
        out.append(
            ClusterOut(
                id=c.id,
                node_count=c.node_count or 0,
                last_seen=c.last_seen,
                nodes=nodes,
            )
        )

    return ClustersResponse(total=total, clusters=out)


@router.get("/clusters/{cluster_id}/nodes/{node_id}/sessions", response_model=NodeSessionsResponse)
async def node_sessions(
    cluster_id: str,
    node_id: str,
    db: AsyncSession = Depends(get_db),
):
    node = await db.get(Node, node_id)
    if node is None or node.cluster_id != cluster_id:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Node not found")

    result = await db.execute(
        select(Session)
        .where(Session.node_id == node_id)
        .order_by(Session.generated_on.desc())
    )
    sessions = result.scalars().all()

    session_summaries = []
    for s in sessions:
        count_result = await db.execute(
            select(func.count(FileRecord.id)).where(FileRecord.session_id == s.id)
        )
        file_count = count_result.scalar_one()
        session_summaries.append(
            SessionSummary(
                id=s.id,
                generated_on=s.generated_on,
                uploaded_at=s.uploaded_at,
                os_version=s.os_version or "",
                original_filename=s.original_filename or "",
                file_count=file_count,
                status=s.status,
            )
        )

    return NodeSessionsResponse(node_id=node_id, hostname=node.hostname, sessions=session_summaries)


@router.get("/session-groups", response_model=SessionGroupsResponse)
async def list_session_groups(
    cluster_id: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(SessionGroup).options(selectinload(SessionGroup.members))
    if cluster_id:
        stmt = stmt.where(SessionGroup.cluster_id == cluster_id)

    result = await db.execute(stmt)
    groups = result.scalars().all()

    out = []
    for g in groups:
        members = []
        for m in g.members:
            s = await db.get(Session, m.session_id)
            if s:
                members.append(
                    GroupMemberOut(
                        session_id=s.id,
                        hostname=s.hostname or "",
                        generated_on=s.generated_on,
                    )
                )
        out.append(
            SessionGroupOut(
                id=g.id,
                cluster_id=g.cluster_id,
                created_at=g.created_at,
                members=members,
            )
        )

    return SessionGroupsResponse(groups=out)
