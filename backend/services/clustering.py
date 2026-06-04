from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db import Session, SessionGroup, SessionGroupMember

GROUPING_WINDOW = timedelta(minutes=20)


class ClusteringService:
    @staticmethod
    async def try_group(session: Session, db: AsyncSession) -> str | None:
        if not session.cluster_id or session.cluster_id.startswith("STANDALONE:"):
            return None

        if session.generated_on is None:
            return None

        existing_membership = await db.execute(
            select(SessionGroupMember.group_id)
            .where(SessionGroupMember.session_id == session.id)
            .limit(1)
        )
        existing_group_id = existing_membership.scalar_one_or_none()
        if existing_group_id is not None:
            return existing_group_id

        group_ranges = await db.execute(
            select(
                SessionGroup.id,
                func.min(Session.generated_on),
                func.max(Session.generated_on),
            )
            .join(SessionGroupMember, SessionGroupMember.group_id == SessionGroup.id)
            .join(Session, Session.id == SessionGroupMember.session_id)
            .where(
                SessionGroup.cluster_id == session.cluster_id,
                Session.generated_on.is_not(None),
            )
            .group_by(SessionGroup.id)
            .order_by(SessionGroup.created_at.asc())
        )

        for group_id, min_generated_on, max_generated_on in group_ranges.all():
            group_window_start = min_generated_on - GROUPING_WINDOW
            group_window_end = max_generated_on + GROUPING_WINDOW
            if group_window_start <= session.generated_on <= group_window_end:
                db.add(SessionGroupMember(group_id=group_id, session_id=session.id))
                await db.commit()
                return group_id

        group = SessionGroup(
            id=str(uuid.uuid4()),
            cluster_id=session.cluster_id,
            created_at=datetime.utcnow(),
        )
        db.add(group)
        db.add(SessionGroupMember(group_id=group.id, session_id=session.id))
        await db.commit()
        return group.id
