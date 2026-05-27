from __future__ import annotations

import re
from pathlib import Path

import aiofiles

PRIORITY_MAP = {
    0: "emergency",
    1: "alert",
    3: "error",
    4: "warning",
    5: "notice",
    6: "info",
    7: "debug",
}


def _parse_ems_line(raw_line: str) -> dict:
    line = re.sub(r"\s+", " ", raw_line.strip())
    parts = line.split("><")
    header = parts[0]
    body = parts[1] if len(parts) > 1 else ""

    date_match = re.search(r'd="([^"]+)"', header)
    date_str = date_match.group(1) if date_match else ""

    host_match = re.search(r'e="([^"]+)"', header)
    hostname = host_match.group(1) if host_match else ""

    prio_match = re.search(r'p="(\d)"', header)
    level = PRIORITY_MAP.get(int(prio_match.group(1)), "info") if prio_match else "info"

    op_match = re.match(r"([A-Za-z0-9_.]+)", body)
    operation = op_match.group(1) if op_match else ""

    summary_raw = body.split("_1")[0] if "_1" in body else body.split("/>")[0]
    summary = re.sub(r"[<>/]", "", summary_raw).replace("_", " ").strip()

    content_match = re.search(r'_1="([^"]*)"', body)
    content = content_match.group(1) if content_match else ""

    return {
        "date": date_str,
        "hostname": hostname,
        "level": level,
        "operation": operation,
        "summary": summary,
        "content": content,
    }


class FileContentService:
    @staticmethod
    async def read_text(file_path: Path, filename: str, offset: int = 0, limit: int = 500) -> dict:
        async with aiofiles.open(file_path, "r", errors="replace") as f:
            all_lines = await f.readlines()
        total = len(all_lines)
        slice_ = [l.rstrip("\n") for l in all_lines[offset: offset + limit]]
        return {
            "file_type": "text",
            "filename": filename,
            "total_lines": total,
            "offset": offset,
            "lines": slice_,
        }

    @staticmethod
    async def read_ems(file_path: Path, filename: str, offset: int = 0, limit: int = 200) -> dict:
        async with aiofiles.open(file_path, "r", errors="replace") as f:
            all_lines = await f.readlines()

        ems_lines = [l for l in all_lines if l.strip().startswith("<LR")]
        total = len(ems_lines)
        events = [_parse_ems_line(l) for l in ems_lines[offset: offset + limit]]
        return {
            "file_type": "ems",
            "filename": filename,
            "total_events": total,
            "offset": offset,
            "events": events,
        }

    @staticmethod
    async def read_xml(file_path: Path, filename: str) -> dict:
        from lxml import etree

        NS = "http://www.netapp.com/asup"

        async with aiofiles.open(file_path, "rb") as f:
            raw = await f.read()

        try:
            root = etree.fromstring(raw)
        except etree.XMLSyntaxError:
            parser = etree.XMLParser(recover=True)
            root = etree.fromstring(raw, parser=parser)

        columns = []
        for field in root.findall(f".//{{{NS}}}field"):
            ui_name_el = field.find(f"{{{NS}}}ui_name")
            if ui_name_el is not None and ui_name_el.text:
                columns.append(ui_name_el.text)

        rows = []
        for row in root.findall(f".//{{{NS}}}ROW"):
            cells = []
            for cell in row:
                if len(cell) == 0:
                    cells.append(cell.text or "")
                else:
                    cells.append(" ".join(c.text or "" for c in cell.iter() if c.text))
            rows.append(cells)

        return {
            "file_type": "xml",
            "filename": filename,
            "columns": columns,
            "rows": rows,
        }
