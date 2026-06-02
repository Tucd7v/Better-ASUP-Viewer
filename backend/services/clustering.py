from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db import Session, SessionGroup, SessionGroupMember


class ClusteringService:
    """All sessions in a cluster belong to one shared group. No HA-pair matching."""

    @staticmethod
    async def try_group(session: Session, db: AsyncSession) -> str | None:
        if not session.cluster_id or session.cluster_id.startswith("STANDALONE:"):
            return None

        # Check if a group already exists for this cluster
        result = await db.execute(
            select(SessionGroup).where(SessionGroup.cluster_id == session.cluster_id)
        )
        group = result.scalar_one_or_none()

        if group is None:
            group = SessionGroup(
                id=str(uuid.uuid4()),
                cluster_id=session.cluster_id,
                created_at=datetime.utcnow(),
            )
            db.add(group)
            await db.flush()

        # Don't add duplicate members
        existing = await db.execute(
            select(SessionGroupMember).where(
                SessionGroupMember.group_id == group.id,
                SessionGroupMember.session_id == session.id,
            )
        )
        if existing.scalar_one_or_none() is None:
            db.add(SessionGroupMember(group_id=group.id, session_id=session.id))

        await db.commit()
        return group.id
