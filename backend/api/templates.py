from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import AsyncSessionLocal
from models.db import CanvasTemplate, TemplateCard, TemplateEdge
from schemas.api import (
    CanvasTemplateOut,
    CreateTemplateRequest,
    TemplateCardOut,
    TemplateEdgeOut,
    TemplateListItem,
    TemplateListResponse,
)

router = APIRouter(tags=["templates"])


@router.get("/templates", response_model=TemplateListResponse)
async def list_templates(session_id: str | None = None, group_id: str | None = None):
    async with AsyncSessionLocal() as session:
        session: AsyncSession
        stmt = select(CanvasTemplate)
        if session_id:
            stmt = stmt.where(CanvasTemplate.session_id == session_id)
        if group_id:
            stmt = stmt.where(CanvasTemplate.group_id == group_id)
        stmt = stmt.order_by(CanvasTemplate.updated_at.desc())
        result = await session.execute(stmt)
        templates = result.scalars().all()

        items = []
        for t in templates:
            items.append(
                TemplateListItem(
                    id=t.id,
                    name=t.name,
                    session_id=t.session_id,
                    group_id=t.group_id,
                    created_at=t.created_at,
                    updated_at=t.updated_at,
                    card_count=len(t.cards),
                )
            )
        return TemplateListResponse(templates=items)


@router.get("/templates/{template_id}", response_model=CanvasTemplateOut)
async def get_template(template_id: str):
    async with AsyncSessionLocal() as session:
        session: AsyncSession
        stmt = select(CanvasTemplate).where(CanvasTemplate.id == template_id)
        result = await session.execute(stmt)
        template = result.scalar_one_or_none()
        if not template:
            raise HTTPException(status_code=404, detail="Template not found")
        return CanvasTemplateOut(
            id=template.id,
            name=template.name,
            session_id=template.session_id,
            group_id=template.group_id,
            split_mode=template.split_mode,
            created_at=template.created_at,
            updated_at=template.updated_at,
            cards=[
                TemplateCardOut(
                    file_id=c.file_id,
                    session_id=c.session_id,
                    filename=c.filename or "",
                    node_index=c.node_index,
                    pos_x=c.pos_x,
                    pos_y=c.pos_y,
                    collapsed=c.collapsed,
                    split_mode=template.split_mode,
                )
                for c in template.cards
            ],
            edges=[
                TemplateEdgeOut(
                    edge_id=e.edge_id,
                    source_file_id=e.source_file_id,
                    target_file_id=e.target_file_id,
                    label=e.label,
                )
                for e in template.edges
            ],
        )


@router.post("/templates", response_model=CanvasTemplateOut, status_code=201)
async def create_template(body: CreateTemplateRequest):
    now = datetime.utcnow()
    template = CanvasTemplate(
        id=str(uuid4()),
        name=body.name,
        session_id=body.session_id,
        group_id=body.group_id,
        split_mode=bool(body.split_mode),
        created_at=now,
        updated_at=now,
    )
    for card in body.cards:
        template.cards.append(
            TemplateCard(
                template_id=template.id,
                file_id=card.file_id,
                session_id=card.session_id,
                filename=card.filename or "",
                node_index=card.node_index,
                pos_x=card.pos_x,
                pos_y=card.pos_y,
                collapsed=card.collapsed,
            )
        )
    for edge in body.edges:
        template.edges.append(
            TemplateEdge(
                template_id=template.id,
                edge_id=edge.edge_id,
                source_file_id=edge.source_file_id,
                target_file_id=edge.target_file_id,
                label=edge.label,
            )
        )

    async with AsyncSessionLocal() as session:
        session: AsyncSession
        session.add(template)
        await session.commit()
        await session.refresh(template)
        return template


@router.delete("/templates/{template_id}", status_code=204)
async def delete_template(template_id: str):
    async with AsyncSessionLocal() as session:
        session: AsyncSession
        stmt = select(CanvasTemplate).where(CanvasTemplate.id == template_id)
        result = await session.execute(stmt)
        template = result.scalar_one_or_none()
        if not template:
            raise HTTPException(status_code=404, detail="Template not found")
        await session.delete(template)
        await session.commit()
