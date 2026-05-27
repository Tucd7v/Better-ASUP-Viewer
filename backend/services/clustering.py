from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db import Session, SessionGroup, SessionGroupMember

GROUPING_WINDOW = timedelta(hours=1)


class ClusteringService:
    @staticmethod
    async def try_group(session: Session, db: AsyncSession) -> str | None:
        if not session.cluster_id or session.cluster_id.startswith("STANDALONE:"):
            return None

        if session.generated_on is None:
            return None

        window_start = session.generated_on - GROUPING_WINDOW
        window_end = session.generated_on + GROUPING_WINDOW

        already_grouped = select(SessionGroupMember.session_id)

        result = await db.execute(
            select(Session)
            .where(
                Session.cluster_id == session.cluster_id,
                Session.node_id != session.node_id,
                Session.status == "done",
                Session.generated_on >= window_start,
                Session.generated_on <= window_end,
                Session.id.not_in(already_grouped),
            )
            .limit(1)
        )
        peer = result.scalar_one_or_none()

        if peer is None:
            return None

        group = SessionGroup(
            id=str(uuid.uuid4()),
            cluster_id=session.cluster_id,
            created_at=datetime.utcnow(),
        )
        db.add(group)
        db.add(SessionGroupMember(group_id=group.id, session_id=session.id))
        db.add(SessionGroupMember(group_id=group.id, session_id=peer.id))
        await db.commit()
        return group.id
