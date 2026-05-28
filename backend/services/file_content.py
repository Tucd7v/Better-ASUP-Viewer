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


def _parse_inner_content(content: str) -> str:
    content = re.sub(r"</LR>\s*$", "", content, flags=re.IGNORECASE).strip()
    if not content:
        return ""

    tag_match = re.match(r"<(\w+)([\s\S]*?)/?>", content)
    if tag_match:
        tag_name = tag_match.group(1)
        attributes = tag_match.group(2) or ""
        # strip trailing _N suffix, replace _ with space
        tag_name = re.sub(r"_\d+$", "", tag_name).replace("_", " ")
        attrs = re.findall(r'(\w+)="([^"]*)"', attributes)
        formatted_attrs = " ".join(f'{k}="{v}"' for k, v in attrs)
        return f"{tag_name}: {formatted_attrs}" if formatted_attrs else tag_name

    return re.sub(r"[<>]", "", content).strip()


def _parse_ems_events(content: str, filename: str) -> list[dict]:
    lines = content.split("\n")
    entries = []
    current: dict | None = None
    pending_open = False
    pending_buf: list[str] = []

    def flush_pending():
        nonlocal pending_open, pending_buf
        if not current or not pending_buf:
            return
        joined = " ".join(pending_buf)
        parsed = _parse_inner_content(joined)
        parsed = parsed.replace("&#x0A;", "\n").replace("&apos;", "'")
        if parsed:
            sep = "" if (current["content"].endswith("\n") or parsed.startswith("\n")) else " "
            current["content"] = current["content"] + sep + parsed if current["content"] else parsed
        pending_buf.clear()
        pending_open = False

    for raw in lines:
        line = raw.strip()
        if not line:
            continue

        if line.startswith("<LR "):
            if current is not None:
                flush_pending()
                entries.append(current)

            lr_match = re.match(r"<LR\s+([^>]+)>", line)
            if not lr_match:
                current = None
                continue

            attrs = {m[0]: m[1] for m in re.findall(r'(\w+)="([^"]*)"', lr_match.group(1))}
            date_str = attrs.get("d", "")
            hostname = attrs.get("n", "unknown")
            priority = attrs.get("p", "6")
            origin = attrs.get("o", "")
            level = PRIORITY_MAP.get(int(priority), "info")

            # inline content on same line as <LR>
            inline = line[lr_match.end():].strip()
            inline_content = ""
            if inline and inline not in ("</LR>", "/>", ">"):
                inline_content = _parse_inner_content(inline)
                inline_content = inline_content.replace("&#x0A;", "\n").replace("&apos;", "'")

            content_val = (origin + " " + inline_content).strip() if inline_content else origin

            current = {
                "date": date_str,
                "hostname": hostname,
                "level": level,
                "operation": "",
                "summary": "",
                "content": content_val,
            }
            continue

        if current is None:
            continue

        if line in ("</LR>", "/>", ">"):
            flush_pending()
            continue

        # multi-line tag accumulation
        if not pending_open and re.match(r"^<\w+(\s|$)", line) and not line.endswith(">") and not line.endswith("/>"):
            pending_open = True
            pending_buf = [line]
            continue

        if pending_open:
            pending_buf.append(line)
            if line.endswith(">") or line.endswith("/>"):
                flush_pending()
            continue

        additional = _parse_inner_content(line)
        additional = additional.replace("&#x0A;", "\n").replace("&apos;", "'")
        if additional:
            sep = "" if (current["content"].endswith("\n") or additional.startswith("\n")) else " "
            current["content"] = current["content"] + sep + additional if current["content"] else additional

    if current is not None:
        flush_pending()
        entries.append(current)

    return entries


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
            content = await f.read()

        all_events = _parse_ems_events(content, filename)
        total = len(all_events)
        events = all_events[offset: offset + limit]
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
