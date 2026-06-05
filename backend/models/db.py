from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, PrimaryKeyConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base


class Cluster(Base):
    __tablename__ = "clusters"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    first_seen: Mapped[datetime] = mapped_column(DateTime)
    last_seen: Mapped[datetime] = mapped_column(DateTime)
    node_count: Mapped[int] = mapped_column(Integer, default=0)

    nodes: Mapped[list[Node]] = relationship("Node", back_populates="cluster", lazy="selectin")
    sessions: Mapped[list[Session]] = relationship("Session", back_populates="cluster", lazy="noload")
    session_groups: Mapped[list[SessionGroup]] = relationship("SessionGroup", back_populates="cluster", lazy="noload")


class Node(Base):
    __tablename__ = "nodes"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    cluster_id: Mapped[str] = mapped_column(String, ForeignKey("clusters.id"))
    hostname: Mapped[str] = mapped_column(String)
    serial_num: Mapped[str] = mapped_column(String, default="")
    os_version: Mapped[str] = mapped_column(String, default="")
    first_seen: Mapped[datetime] = mapped_column(DateTime)
    last_seen: Mapped[datetime] = mapped_column(DateTime)
    session_count: Mapped[int] = mapped_column(Integer, default=0)

    cluster: Mapped[Cluster] = relationship("Cluster", back_populates="nodes")
    sessions: Mapped[list[Session]] = relationship("Session", back_populates="node", lazy="noload")


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    node_id: Mapped[str | None] = mapped_column(String, ForeignKey("nodes.id"), nullable=True)
    cluster_id: Mapped[str | None] = mapped_column(String, ForeignKey("clusters.id"), nullable=True)
    hostname: Mapped[str] = mapped_column(String, default="")
    partner_hostname: Mapped[str] = mapped_column(String, default="")
    serial_num: Mapped[str] = mapped_column(String, default="")
    os_version: Mapped[str] = mapped_column(String, default="")
    generated_on: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime)
    status: Mapped[str] = mapped_column(String, default="pending")
    error_message: Mapped[str | None] = mapped_column(String, nullable=True)
    original_filename: Mapped[str] = mapped_column(String, default="")
    storage_path: Mapped[str | None] = mapped_column(String, nullable=True)

    node: Mapped[Node | None] = relationship("Node", back_populates="sessions")
    cluster: Mapped[Cluster | None] = relationship("Cluster", back_populates="sessions")
    file_records: Mapped[list[FileRecord]] = relationship("FileRecord", back_populates="session", lazy="noload")
    group_members: Mapped[list[SessionGroupMember]] = relationship("SessionGroupMember", back_populates="session", lazy="noload")


class SessionGroup(Base):
    __tablename__ = "session_groups"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    cluster_id: Mapped[str] = mapped_column(String, ForeignKey("clusters.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime)
    note: Mapped[str | None] = mapped_column(String, nullable=True)

    cluster: Mapped[Cluster] = relationship("Cluster", back_populates="session_groups")
    members: Mapped[list[SessionGroupMember]] = relationship("SessionGroupMember", back_populates="group", lazy="selectin")


class SessionGroupMember(Base):
    __tablename__ = "session_group_members"

    group_id: Mapped[str] = mapped_column(String, ForeignKey("session_groups.id"))
    session_id: Mapped[str] = mapped_column(String, ForeignKey("sessions.id"))

    __table_args__ = (PrimaryKeyConstraint("group_id", "session_id"),)

    group: Mapped[SessionGroup] = relationship("SessionGroup", back_populates="members")
    session: Mapped[Session] = relationship("Session", back_populates="group_members")


class FileRecord(Base):
    __tablename__ = "file_records"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    session_id: Mapped[str] = mapped_column(String, ForeignKey("sessions.id"))
    filename: Mapped[str] = mapped_column(String)
    file_path: Mapped[str] = mapped_column(String)
    file_type: Mapped[str] = mapped_column(String, default="unknown")
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    is_empty: Mapped[bool] = mapped_column(Boolean, default=False)

    session: Mapped[Session] = relationship("Session", back_populates="file_records")


class CanvasTemplate(Base):
    __tablename__ = "canvas_templates"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    session_id: Mapped[str | None] = mapped_column(String, nullable=True)
    group_id: Mapped[str | None] = mapped_column(String, nullable=True)
    split_mode: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime)
    updated_at: Mapped[datetime] = mapped_column(DateTime)
    cards: Mapped[list[TemplateCard]] = relationship("TemplateCard", back_populates="template", lazy="selectin", cascade="all, delete-orphan")
    edges: Mapped[list[TemplateEdge]] = relationship("TemplateEdge", back_populates="template", lazy="selectin", cascade="all, delete-orphan")


class TemplateCard(Base):
    __tablename__ = "template_cards"
    template_id: Mapped[str] = mapped_column(String, ForeignKey("canvas_templates.id"))
    file_id: Mapped[str] = mapped_column(String)
    session_id: Mapped[str] = mapped_column(String)
    filename: Mapped[str] = mapped_column(String, default="")  # NEW
    node_index: Mapped[int] = mapped_column(Integer, default=0)  # NEW (0=first/blue, 1=second/orange)
    pos_x: Mapped[float] = mapped_column(Integer)  # store as integer in DB (pixels)
    pos_y: Mapped[float] = mapped_column(Integer)
    collapsed: Mapped[bool] = mapped_column(Boolean, default=False)
    __table_args__ = (PrimaryKeyConstraint("template_id", "file_id"),)
    template: Mapped[CanvasTemplate] = relationship("CanvasTemplate", back_populates="cards")


class TemplateEdge(Base):
    __tablename__ = "template_edges"
    template_id: Mapped[str] = mapped_column(String, ForeignKey("canvas_templates.id"))
    edge_id: Mapped[str] = mapped_column(String)  # unique edge id within template
    source_file_id: Mapped[str] = mapped_column(String)  # maps to node id (node id = file id)
    target_file_id: Mapped[str] = mapped_column(String)  # maps to node id
    label: Mapped[str | None] = mapped_column(String, nullable=True, default=None)

    __table_args__ = (PrimaryKeyConstraint("template_id", "edge_id"),)

    template: Mapped[CanvasTemplate] = relationship("CanvasTemplate", back_populates="edges")
