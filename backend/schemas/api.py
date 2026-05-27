from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel


class UploadResponse(BaseModel):
    session_id: str
    status: str


class SessionStatusResponse(BaseModel):
    session_id: str
    status: str
    error_message: Optional[str] = None
    hostname: Optional[str] = None
    serial_num: Optional[str] = None
    cluster_id: Optional[str] = None
    generated_on: Optional[datetime] = None
    file_count: int = 0


class FileRecordOut(BaseModel):
    id: str
    filename: str
    file_type: str
    file_size: int
    is_empty: bool

    model_config = {"from_attributes": True}


class SessionFilesResponse(BaseModel):
    session_id: str
    files: list[FileRecordOut]


class TextContentResponse(BaseModel):
    file_type: str = "text"
    filename: str
    total_lines: int
    offset: int
    lines: list[str]


class EmsEvent(BaseModel):
    date: str
    hostname: str
    level: str
    operation: str
    summary: str
    content: str


class EmsContentResponse(BaseModel):
    file_type: str = "ems"
    filename: str
    total_events: int
    offset: int
    events: list[EmsEvent]


class XmlContentResponse(BaseModel):
    file_type: str = "xml"
    filename: str
    columns: list[str]
    rows: list[list[str]]


class NodeSummary(BaseModel):
    id: str
    hostname: str
    serial_num: str
    session_count: int

    model_config = {"from_attributes": True}


class ClusterOut(BaseModel):
    id: str
    node_count: int
    last_seen: datetime
    nodes: list[NodeSummary]

    model_config = {"from_attributes": True}


class ClustersResponse(BaseModel):
    total: int
    clusters: list[ClusterOut]


class SessionSummary(BaseModel):
    id: str
    generated_on: Optional[datetime]
    uploaded_at: datetime
    os_version: str
    original_filename: str
    file_count: int
    status: str

    model_config = {"from_attributes": True}


class NodeSessionsResponse(BaseModel):
    node_id: str
    hostname: str
    sessions: list[SessionSummary]


class GroupMemberOut(BaseModel):
    session_id: str
    hostname: str
    generated_on: Optional[datetime]


class SessionGroupOut(BaseModel):
    id: str
    cluster_id: str
    created_at: datetime
    members: list[GroupMemberOut]


class SessionGroupsResponse(BaseModel):
    groups: list[SessionGroupOut]
