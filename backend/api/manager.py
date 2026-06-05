from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.database import get_db
from models.db import Cluster, FileRecord, Node, Session, SessionGroup, SessionGroupMember
from schemas.api import (
    ClusterGroupMember,
    ClusterGroupSummary,
    ClusterGroupsResponse,
    ClusterOut,
    ClusterOverviewResponse,
    ClustersResponse,
    GroupMemberOut,
    NodeSessionsResponse,
    NodeSummary,
    SessionGroupOut,
    SessionGroupsResponse,
    SessionSummary,
)

router = APIRouter()


async def _get_cluster_name(db: AsyncSession, cluster_id: str | None) -> str:
    if not cluster_id:
        return ""

    result = await db.execute(
        select(Session.cluster_name)
        .where(Session.cluster_id == cluster_id, Session.cluster_name != "")
        .order_by(Session.uploaded_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none() or ""


async def _get_node_model_name(db: AsyncSession, node_id: str | None) -> str:
    if not node_id:
        return ""

    result = await db.execute(
        select(Session.model_name)
        .where(Session.node_id == node_id, Session.model_name != "")
        .order_by(Session.uploaded_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none() or ""


@router.get("/clusters", response_model=ClustersResponse)
async def list_clusters(
    q: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Cluster).options(selectinload(Cluster.nodes))
    count_stmt = select(func.count(Cluster.id))

    if q:
        pattern = f"%{q}%"
        named_cluster_ids = select(Session.cluster_id).where(Session.cluster_name.ilike(pattern))
        model_cluster_ids = select(Session.cluster_id).where(Session.model_name.ilike(pattern))
        cluster_filter = or_(
            Cluster.id.ilike(pattern),
            Cluster.id.in_(named_cluster_ids),
            Cluster.id.in_(model_cluster_ids),
        )
        stmt = stmt.where(cluster_filter)
        count_stmt = count_stmt.where(cluster_filter)

    count_result = await db.execute(count_stmt)
    total = count_result.scalar_one()

    stmt = stmt.offset(offset).limit(limit)
    result = await db.execute(stmt)
    clusters = result.scalars().all()

    out = []
    for c in clusters:
        nodes = []
        for n in (c.nodes or []):
            nodes.append(
                NodeSummary(
                    id=n.id,
                    hostname=n.hostname,
                    serial_num=n.serial_num or "",
                    model_name=await _get_node_model_name(db, n.id),
                    session_count=n.session_count or 0,
                )
            )
        out.append(
            ClusterOut(
                id=c.id,
                cluster_name=await _get_cluster_name(db, c.id),
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

        # Find group this session belongs to (if any)
        grp_result = await db.execute(
            select(SessionGroupMember.group_id).where(SessionGroupMember.session_id == s.id).limit(1)
        )
        group_id = grp_result.scalar_one_or_none()

        session_summaries.append(
            SessionSummary(
                id=s.id,
                generated_on=s.generated_on,
                uploaded_at=s.uploaded_at,
                os_version=s.os_version or "",
                original_filename=s.original_filename or "",
                file_count=file_count,
                status=s.status,
                model_name=s.model_name or "",
                group_id=group_id,
            )
        )

    return NodeSessionsResponse(node_id=node_id, hostname=node.hostname, sessions=session_summaries)


@router.get("/clusters/{cluster_id}/groups", response_model=ClusterGroupsResponse)
async def cluster_groups(cluster_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(SessionGroup)
        .where(SessionGroup.cluster_id == cluster_id)
        .options(selectinload(SessionGroup.members))
        .order_by(SessionGroup.created_at.desc())
    )
    groups = result.scalars().all()

    out = []
    for g in groups:
        members = []
        for m in g.members:
            s = await db.get(Session, m.session_id)
            if s:
                count_result = await db.execute(
                    select(func.count(FileRecord.id)).where(FileRecord.session_id == s.id)
                )
                members.append(ClusterGroupMember(
                    session_id=s.id,
                    cluster_name=s.cluster_name or "",
                    model_name=s.model_name or "",
                    serial_num=s.serial_num or "",
                    hostname=s.hostname or "",
                    partner_hostname=s.partner_hostname or "",
                    generated_on=s.generated_on,
                    uploaded_at=s.uploaded_at,
                    original_filename=s.original_filename or "",
                    file_count=count_result.scalar_one(),
                    status=s.status,
                ))
        out.append(ClusterGroupSummary(id=g.id, created_at=g.created_at, members=members))

    return ClusterGroupsResponse(groups=out)


@router.get("/clusters/{cluster_id}/overview", response_model=ClusterOverviewResponse)
async def cluster_overview(cluster_id: str, db: AsyncSession = Depends(get_db)):
    from fastapi import HTTPException
    cluster = await db.get(Cluster, cluster_id)
    if cluster is None:
        raise HTTPException(status_code=404, detail="Cluster not found")

    # All groups for this cluster
    grp_result = await db.execute(
        select(SessionGroup)
        .where(SessionGroup.cluster_id == cluster_id)
        .options(selectinload(SessionGroup.members))
        .order_by(SessionGroup.created_at.desc())
    )
    groups = grp_result.scalars().all()
    grouped_session_ids: set[str] = set()

    async def _member(session_id: str) -> ClusterGroupMember | None:
        s = await db.get(Session, session_id)
        if s is None:
            return None
        count_result = await db.execute(
            select(func.count(FileRecord.id)).where(FileRecord.session_id == s.id)
        )
        return ClusterGroupMember(
            session_id=s.id,
            cluster_name=s.cluster_name or "",
            model_name=s.model_name or "",
            serial_num=s.serial_num or "",
            hostname=s.hostname or "",
            partner_hostname=s.partner_hostname or "",
            generated_on=s.generated_on,
            uploaded_at=s.uploaded_at,
            original_filename=s.original_filename or "",
            file_count=count_result.scalar_one(),
            status=s.status,
        )

    group_summaries: list[ClusterGroupSummary] = []
    for g in groups:
        members = []
        for m in g.members:
            grouped_session_ids.add(m.session_id)
            mem = await _member(m.session_id)
            if mem:
                members.append(mem)
        if members:
            group_summaries.append(ClusterGroupSummary(id=g.id, created_at=g.created_at, members=members))

    # Sessions not in any group
    all_sessions_result = await db.execute(
        select(Session)
        .where(Session.cluster_id == cluster_id, Session.status == "done")
        .order_by(Session.generated_on.desc())
    )
    all_sessions = all_sessions_result.scalars().all()
    singles: list[ClusterGroupMember] = []
    for s in all_sessions:
        if s.id not in grouped_session_ids:
            mem = await _member(s.id)
            if mem:
                singles.append(mem)

    return ClusterOverviewResponse(
        cluster_id=cluster_id,
        cluster_name=await _get_cluster_name(db, cluster_id),
        last_seen=cluster.last_seen,
        groups=group_summaries,
        singles=singles,
    )


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(session_id: str, db: AsyncSession = Depends(get_db)):
    from fastapi import HTTPException

    session_row = await db.get(Session, session_id)
    if session_row is None:
        raise HTTPException(status_code=404, detail="Session not found")

    # Delete files from disk
    storage_path = session_row.storage_path
    if storage_path:
        session_dir = Path(storage_path).parent.parent  # original/ -> session_id/
        if session_dir.exists():
            shutil.rmtree(session_dir, ignore_errors=True)

    # Cascade-delete: file_records, group_members, then session
    await db.execute(delete(FileRecord).where(FileRecord.session_id == session_id))
    await db.execute(delete(SessionGroupMember).where(SessionGroupMember.session_id == session_id))

    node_id = session_row.node_id
    cluster_id = session_row.cluster_id
    await db.delete(session_row)
    await db.flush()

    # Decrement node session_count; remove node+cluster if now empty
    if node_id:
        node = await db.get(Node, node_id)
        if node:
            node.session_count = max(0, (node.session_count or 1) - 1)
            if node.session_count == 0:
                await db.delete(node)
                await db.flush()
                if cluster_id:
                    cluster = await db.get(Cluster, cluster_id)
                    if cluster:
                        cluster.node_count = max(0, (cluster.node_count or 1) - 1)
                        if cluster.node_count == 0:
                            await db.delete(cluster)

    await db.commit()


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
                        model_name=s.model_name or "",
                        generated_on=s.generated_on,
                    )
                )
        out.append(
            SessionGroupOut(
                id=g.id,
                cluster_id=g.cluster_id,
                cluster_name=await _get_cluster_name(db, g.cluster_id),
                created_at=g.created_at,
                members=members,
            )
        )

    return SessionGroupsResponse(groups=out)


@router.get("/session-groups/{group_id}", response_model=ClusterGroupSummary)
async def get_session_group(group_id: str, db: AsyncSession = Depends(get_db)):
    from fastapi import HTTPException

    result = await db.execute(
        select(SessionGroup)
        .where(SessionGroup.id == group_id)
        .options(selectinload(SessionGroup.members))
    )
    group = result.scalar_one_or_none()
    if group is None:
        raise HTTPException(status_code=404, detail="Session group not found")

    members = []
    for m in group.members:
        s = await db.get(Session, m.session_id)
        if s:
            count_result = await db.execute(
                select(func.count(FileRecord.id)).where(FileRecord.session_id == s.id)
            )
            members.append(ClusterGroupMember(
                session_id=s.id,
                cluster_name=s.cluster_name or "",
                model_name=s.model_name or "",
                serial_num=s.serial_num or "",
                hostname=s.hostname or "",
                partner_hostname=s.partner_hostname or "",
                generated_on=s.generated_on,
                original_filename=s.original_filename or "",
                file_count=count_result.scalar_one(),
                status=s.status,
            ))
    return ClusterGroupSummary(id=group.id, created_at=group.created_at, members=members)
