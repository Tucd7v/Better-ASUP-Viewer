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

        async with aiofiles.open(file_path, "rb") as f:
            raw = await f.read()

        try:
            root = etree.fromstring(raw)
        except etree.XMLSyntaxError:
            root = etree.fromstring(raw, etree.XMLParser(recover=True))

        asup_ns = root.nsmap.get("asup")
        if asup_ns is None:
            for uri in root.nsmap.values():
                if uri and "asup" in uri.lower() and "ASUP" in uri:
                    asup_ns = uri
                    break

        if asup_ns:
            # Build tag→ui_name mapping from TABLE_INFO fields
            tag_to_col: dict[str, str] = {}
            for field in root.findall(f".//{{{asup_ns}}}field"):
                tag_el = field.find(f"{{{asup_ns}}}tag")
                ui_el = field.find(f"{{{asup_ns}}}ui_name")
                if tag_el is not None and tag_el.text and ui_el is not None and ui_el.text:
                    tag_to_col[tag_el.text.strip()] = ui_el.text.strip()

            row_els = root.findall(f".//{{{asup_ns}}}ROW")
            if tag_to_col and row_els:
                columns = list(tag_to_col.values())
                rows = []
                for row_el in row_els:
                    row_dict: dict[str, str] = {}
                    for cell in row_el:
                        local = etree.QName(cell).localname
                        col_name = tag_to_col.get(local, local)
                        row_dict[col_name] = cell.text or ""
                    rows.append(row_dict)
                return {"file_type": "xml", "filename": filename, "rows": rows}

        # Not a tabular ASUP XML — pretty-print as text
        try:
            text = etree.tostring(root, pretty_print=True).decode("utf-8", errors="replace")
        except Exception:
            text = raw.decode("utf-8", errors="replace")
        lines = text.splitlines()
        return {"file_type": "text", "filename": filename, "total_lines": len(lines), "offset": 0, "lines": lines}
