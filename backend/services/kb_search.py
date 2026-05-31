"""NetApp KB search — downloads sitemap at startup, provides local keyword search."""

from __future__ import annotations

import logging
import re
import time
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

SITEMAP_URL = "https://kb.netapp.com/sitemap.xml"

import os as _os

_DOCKER_CACHE = Path("/data/logs")
if _DOCKER_CACHE.exists():
    CACHE_DIR = _DOCKER_CACHE
else:
    CACHE_DIR = Path(__file__).parent.parent / "data"

SITEMAP_PATH = CACHE_DIR / "kb_sitemap.xml"
SITEMAP_MAX_AGE = 86400  # 24 hours


class KBSearchService:
    """Loads NetApp KB sitemap and provides local keyword search."""

    def __init__(self):
        self._articles: dict[str, str] = {}  # url → title
        self._loaded = False

    async def ensure_loaded(self):
        """Load sitemap if not already loaded. Safe to call multiple times."""
        if self._loaded:
            return
        self._articles = await self._load_sitemap()
        self._loaded = True
        logger.info(f"KB search loaded: {len(self._articles)} articles")
        print(f"*** KB search loaded: {len(self._articles)} articles from {CACHE_DIR}", flush=True)

    async def _load_sitemap(self) -> dict[str, str]:
        """Download and parse sitemap, extracting article URLs and titles."""
        xml_text = await self._fetch_sitemap()
        return self._parse_sitemap(xml_text)

    async def _fetch_sitemap(self) -> str:
        """Fetch sitemap, using cache if fresh."""
        if SITEMAP_PATH.exists():
            age = SITEMAP_PATH.stat().st_mtime
            if time.time() - age < SITEMAP_MAX_AGE:
                logger.debug("Using cached KB sitemap")
                return SITEMAP_PATH.read_text()

        logger.info("Downloading KB sitemap...")
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(SITEMAP_URL)
            resp.raise_for_status()
            text = resp.text

        SITEMAP_PATH.parent.mkdir(parents=True, exist_ok=True)
        SITEMAP_PATH.write_text(text)
        return text

    @staticmethod
    def _parse_sitemap(xml_text: str) -> dict[str, str]:
        """Extract {url: title} from sitemap XML."""
        articles: dict[str, str] = {}
        urls = re.findall(
            r"<loc>(https://kb\.netapp\.com/([^<]+))</loc>", xml_text
        )
        for full_url, path in urls:
            path = path.rstrip("/")
            parts = path.split("/")
            last = parts[-1]
            if len(last) < 15 or "_" not in last:
                continue
            title = last.replace("_", " ")
            articles[full_url] = title
        return articles

    def search(self, query: str, limit: int = 4) -> list[dict]:
        """Search KB articles — FTS5 if available, otherwise title matching."""
        # Try FTS5 first
        try:
            from services.kb_scraper import search_fts
            results = search_fts(query, limit)
            if results:
                return results
        except Exception:
            pass

        # Fallback: title keyword matching
        if not self._articles:
            return []

        keywords = query.lower().split()
        scored: list[tuple[int, str, str]] = []

        for url, title in self._articles.items():
            title_lower = title.lower()
            score = 0
            for kw in keywords:
                if kw in title_lower:
                    score += 1
            if score > 0:
                scored.append((score, title, url))

        scored.sort(key=lambda x: (-x[0], len(x[1])))

        return [
            {
                "title": title,
                "url": url,
                "snippet": title,
                "score": score,
            }
            for score, title, url in scored[:limit]
        ]


# Singleton
kb_search = KBSearchService()
