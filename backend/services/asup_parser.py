from __future__ import annotations

import asyncio
import hashlib
import uuid
from datetime import datetime
from pathlib import Path

import aiofiles

from models.db import Cluster, FileRecord, Node, Session


HEADER_FIELDS = {
    "X-Netapp-asup-hostname": "hostname",
    "X-Netapp-asup-os-version": "os_version",
    "X-Netapp-asup-cluster-uuid": "cluster_uuid",
    "X-Netapp-asup-generated-on": "generated_on",
    "X-Netapp-asup-serial-num": "serial_num",
}


def _parse_header_content(content: str) -> dict:
    result = {}
    for line in content.splitlines():
        if ": " in line:
            key, _, value = line.partition(": ")
            key = key.strip()
            if key in HEADER_FIELDS:
                result[HEADER_FIELDS[key]] = value.strip()
    return result


def _parse_generated_on(raw: str) -> datetime | None:
    try:
        return datetime.strptime(raw.strip(), "%d%b%Y %H:%M:%S %z")
    except Exception:
        return None


def classify_file(filename: str, first_line: str = "") -> str:
    name_upper = filename.upper()
    ext = filename.rsplit(".", 1)[-1].upper() if "." in filename else ""
    if first_line.startswith("<LR d="):
        return "ems"
    if name_upper == "EMS-LOG-FILE":
        return "ems"
    if ext == "XML":
        return "xml"
    if ext in ("TXT", "LOG", "OUT", "CFG", "CONF", "DAT"):
        return "text"
    if "." not in filename:
        return "text"
    return "unknown"


def _make_node_id(cluster_id: str, hostname: str) -> str:
    return hashlib.sha256(f"{cluster_id}:{hostname}".encode()).hexdigest()[:16]


async def _read_first_line(path: Path) -> str:
    try:
        async with aiofiles.open(path, "r", errors="replace") as f:
            return (await f.readline()).rstrip("\n")
    except Exception:
        return ""


async def _find_header_file(files_dir: Path) -> Path | None:
    for p in files_dir.iterdir():
        if p.is_file() and p.name.upper() == "X-HEADER-DATA.TXT":
            return p
    for p in files_dir.iterdir():
        if not p.is_file():
            continue
        first = await _read_first_line(p)
        if "X-Netapp-asup-hostname:" in first:
            return p
    return None


class ASUPParserService:
    def __init__(self, session_id: str, files_dir: Path, progress_queue: asyncio.Queue):
        self._session_id = session_id
        self._files_dir = files_dir
        self._queue = progress_queue

    async def _put(self, percent: int):
        await self._queue.put({"stage": "parsing", "percent": percent})

    async def parse(self, db_session, session_row: Session) -> tuple[dict, list[FileRecord]]:
        await self._put(0)

        header_path = await _find_header_file(self._files_dir)
        meta: dict = {}
        if header_path:
            async with aiofiles.open(header_path, "r", errors="replace") as f:
                content = await f.read()
            meta = _parse_header_content(content)

        hostname = meta.get("hostname", "unknown")
        os_version = meta.get("os_version", "")
        serial_num = meta.get("serial_num", "")
        cluster_uuid = meta.get("cluster_uuid", "")
        generated_on_raw = meta.get("generated_on", "")

        generated_on = _parse_generated_on(generated_on_raw) if generated_on_raw else None
        cluster_id = cluster_uuid if cluster_uuid else f"STANDALONE:{hostname}"
        node_id = _make_node_id(cluster_id, hostname)
        now = datetime.utcnow()

        cluster = await db_session.get(Cluster, cluster_id)
        if cluster is None:
            cluster = Cluster(
                id=cluster_id,
                first_seen=now,
                last_seen=now,
                node_count=0,
            )
            db_session.add(cluster)
        else:
            cluster.last_seen = now

        node = await db_session.get(Node, node_id)
        if node is None:
            node = Node(
                id=node_id,
                cluster_id=cluster_id,
                hostname=hostname,
                serial_num=serial_num,
                os_version=os_version,
                first_seen=now,
                last_seen=now,
                session_count=0,
            )
            db_session.add(node)
            cluster.node_count = (cluster.node_count or 0) + 1
        else:
            node.last_seen = now
            node.serial_num = serial_num
            node.os_version = os_version

        node.session_count = (node.session_count or 0) + 1

        session_row.node_id = node_id
        session_row.cluster_id = cluster_id
        session_row.hostname = hostname
        session_row.serial_num = serial_num
        session_row.os_version = os_version
        session_row.generated_on = generated_on

        await self._put(30)

        all_files = [p for p in self._files_dir.iterdir() if p.is_file()]
        file_records: list[FileRecord] = []
        total = len(all_files)

        for idx, fp in enumerate(all_files):
            first_line = await _read_first_line(fp)
            file_type = classify_file(fp.name, first_line)
            file_size = fp.stat().st_size
            is_empty = file_size == 0

            fr = FileRecord(
                id=str(uuid.uuid4()),
                session_id=self._session_id,
                filename=fp.name,
                file_path=str(fp),
                file_type=file_type,
                file_size=file_size,
                is_empty=is_empty,
            )
            db_session.add(fr)
            file_records.append(fr)

            if total > 0:
                pct = 30 + int(70 * (idx + 1) / total)
                await self._put(pct)

        await self._put(100)
        return meta, file_records
