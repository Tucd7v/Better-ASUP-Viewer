from __future__ import annotations

from pathlib import Path

from models.db import FileRecord
from services.file_content import FileContentService


class SearchService:
    @staticmethod
    async def search_file(record: FileRecord, query: str, max_matches: int = 20) -> list[dict]:
        matches: list[dict] = []
        fp = Path(record.file_path)
        if not fp.exists() or record.is_empty:
            return matches

        svc = FileContentService()
        q = query.lower()

        if record.file_type == "text":
            data = await svc.read_text(fp, record.filename, offset=0, limit=5000)
            for i, line in enumerate(data.get("lines", [])):
                if q in line.lower():
                    start = max(0, line.lower().index(q) - 30)
                    end = min(len(line), line.lower().index(q) + len(q) + 30)
                    snippet = line[start:end].strip()
                    matches.append({
                        "line": i + 1,
                        "context": snippet,
                    })
                    if len(matches) >= max_matches:
                        break

        elif record.file_type == "ems":
            data = await svc.read_ems(fp, record.filename, offset=0, limit=200)
            for i, evt in enumerate(data.get("events", [])):
                text = (evt.get("summary", "") + " " + evt.get("content", "")).lower()
                if q in text:
                    snippet = evt.get("summary", "") or evt.get("content", "")
                    if len(snippet) > 120:
                        snippet = snippet[:120] + "..."
                    matches.append({
                        "line": i + 1,
                        "context": snippet,
                    })
                    if len(matches) >= max_matches:
                        break

        elif record.file_type == "xml":
            data = await svc.read_xml(fp, record.filename)
            rows = data.get("rows", [])
            if not rows:
                # fallback for XML parsed as text
                lines = data.get("lines", [])
                for i, line in enumerate(lines):
                    if q in line.lower():
                        start = max(0, line.lower().index(q) - 30)
                        end = min(len(line), line.lower().index(q) + len(q) + 30)
                        matches.append({
                            "line": i + 1,
                            "context": line[start:end].strip(),
                        })
                        if len(matches) >= max_matches:
                            break
            else:
                for row_idx, row in enumerate(rows):
                    for val in row.values():
                        if q in str(val).lower():
                            cols = {k: v for k, v in row.items()}
                            matches.append({
                                "line": row_idx + 1,
                                "context": str(cols)[:150],
                            })
                            if len(matches) >= max_matches:
                                break
                    if len(matches) >= max_matches:
                        break

        return matches
