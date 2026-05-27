from __future__ import annotations

import asyncio
import gzip
import os
import shutil
import tarfile
from pathlib import Path


class ExtractService:
    def __init__(self, session_id: str, progress_queue: asyncio.Queue):
        self._session_id = session_id
        self._queue = progress_queue

    async def _put(self, stage: str, percent: int):
        await self._queue.put({"stage": stage, "percent": percent})

    async def extract(self, archive_path: Path, dest_dir: Path) -> None:
        dest_dir.mkdir(parents=True, exist_ok=True)
        name = archive_path.name.lower()

        await self._put("extracting", 5)

        if name.endswith(".7z"):
            await self._extract_7z(archive_path, dest_dir)
        elif name.endswith(".tar.gz") or name.endswith(".tgz"):
            await asyncio.to_thread(self._extract_tar, archive_path, dest_dir)
        elif name.endswith(".tar"):
            await asyncio.to_thread(self._extract_tar, archive_path, dest_dir)
        elif name.endswith(".gz"):
            await asyncio.to_thread(self._extract_gz, archive_path, dest_dir)
        else:
            shutil.copy2(archive_path, dest_dir / archive_path.name)

        await self._put("extracting", 50)
        await asyncio.to_thread(self._extract_nested, dest_dir)
        await self._put("extracting", 90)
        await asyncio.to_thread(self._flatten, dest_dir)
        await self._put("extracting", 100)

    async def _extract_7z(self, archive_path: Path, dest_dir: Path) -> None:
        proc = await asyncio.create_subprocess_exec(
            "7z", "x", str(archive_path), f"-o{dest_dir}", "-y",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(f"7z extraction failed: {stderr.decode(errors='replace')}")

    @staticmethod
    def _extract_tar(archive_path: Path, dest_dir: Path) -> None:
        with tarfile.open(archive_path) as tf:
            tf.extractall(dest_dir)

    @staticmethod
    def _extract_gz(archive_path: Path, dest_dir: Path) -> None:
        stem = archive_path.stem
        out_path = dest_dir / stem
        with gzip.open(archive_path, "rb") as gz_f:
            out_path.write_bytes(gz_f.read())

    @staticmethod
    def _extract_nested(dest_dir: Path) -> None:
        tar_exts = (".tar", ".tgz", ".tar.gz", ".tar.bz2", ".tbz", ".tb2")
        for item in list(dest_dir.rglob("*")):
            if not item.is_file():
                continue
            name_lower = item.name.lower()
            if any(name_lower.endswith(e) for e in tar_exts):
                try:
                    with tarfile.open(item) as tf:
                        tf.extractall(item.parent)
                    item.unlink()
                except Exception:
                    pass
            elif name_lower.endswith(".gz") and not name_lower.endswith(".tar.gz"):
                try:
                    stem = item.stem
                    out_path = item.parent / stem
                    with gzip.open(item, "rb") as gz_f:
                        out_path.write_bytes(gz_f.read())
                    item.unlink()
                except Exception:
                    pass

    @staticmethod
    def _flatten(dest_dir: Path) -> None:
        seen: dict[str, int] = {}
        for item in list(dest_dir.rglob("*")):
            if not item.is_file():
                continue
            if item.parent == dest_dir:
                continue
            name = item.name
            if name in seen:
                seen[name] += 1
                parts = name.rsplit(".", 1)
                if len(parts) == 2:
                    name = f"{parts[0]}_{seen[item.name]}.{parts[1]}"
                else:
                    name = f"{name}_{seen[item.name]}"
            else:
                seen[name] = 0
            dest = dest_dir / name
            if not dest.exists():
                shutil.move(str(item), str(dest))

        for sub in list(dest_dir.iterdir()):
            if sub.is_dir():
                shutil.rmtree(sub, ignore_errors=True)
