"""NetApp KB search — sitemap + FTS5 full-text index + background article scraper."""

from __future__ import annotations

import asyncio
import logging
import re
import sqlite3
import time
from html import unescape
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
FTS_DB_PATH = CACHE_DIR / "kb_fts.db"

# ── HTML text extraction ────────────────────────────────────────────

_RE_SCRIPT = re.compile(r"<script[^>]*>.*?</script>", re.DOTALL)
_RE_STYLE = re.compile(r"<style[^>]*>.*?</style>", re.DOTALL)
_RE_TAG = re.compile(r"<[^>]+>")
_RE_WS = re.compile(r"\s+")
# Lines to skip (nav, footer, boilerplate)
_SKIP_PATTERNS: list[str] = [
    "sign in to view", "go back to previous", "expand/collapse",
    "skip to main content", "powered by", "©", "copyright",
    "privacy policy", "terms of use", "site map",
    "netapp.com", "netapp neighborhood", "customer stories",
    "partner with netapp", "general terms", "slavery and human",
    "knowledge center", "security advisories",
    "recommended articles", "product categories",
    "article review state", "netapp provides no representations",
    "the information in this document is distributed as is",
]


def extract_text(html: str, title: str = "") -> str:
    """Extract readable article text from HTML, skipping nav/footer."""
    text = _RE_SCRIPT.sub("", html)
    text = _RE_STYLE.sub("", text)
    text = _RE_TAG.sub("\n", text)
    text = unescape(text)
    lines = [_RE_WS.sub(" ", l).strip() for l in text.split("\n")]
    lines = [l for l in lines if len(l) > 20]

    # Find content start: after the article title appears in the page
    content: list[str] = []
    found_title = False
    title_words = set(title.lower().split()[:5]) if title else set()

    for line in lines:
        # Detect article title in page content
        if not found_title and title_words:
            match_count = sum(1 for w in title_words if w in line.lower())
            if match_count >= 2:
                found_title = True
                continue
        if not found_title:
            continue
        # Skip boilerplate
        if any(p in line.lower() for p in _SKIP_PATTERNS):
            continue
        content.append(line)

    return "\n".join(content)


# ── FTS5 database ────────────────────────────────────────────────────

def _get_fts_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(FTS_DB_PATH))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def init_fts_db():
    """Create tables if not exist."""
    conn = _get_fts_conn()
    conn.execute(
        """CREATE TABLE IF NOT EXISTS articles (
            url TEXT PRIMARY KEY, title TEXT, content TEXT, scraped_at REAL
        )"""
    )
    conn.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(url, title, content)"
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS scrape_progress (
            id INTEGER PRIMARY KEY, last_index INTEGER, total INTEGER,
            started_at REAL, updated_at REAL
        )"""
    )
    conn.commit()
    conn.close()


def search_fts(query: str, limit: int = 4) -> list[dict]:
    """Full-text search via FTS5 with snippet extraction."""
    conn = _get_fts_conn()
    try:
        # Use FTS5 full-text search with BM25 ranking, with snippet
        rows = conn.execute(
            """SELECT a.url, a.title, snippet(articles_fts, 2, '<b>', '</b>', '...', 40)
               FROM articles_fts f
               JOIN articles a ON a.url = f.url
               WHERE articles_fts MATCH ?
               ORDER BY rank
               LIMIT ?""",
            (query, limit),
        ).fetchall()
        return [
            {"url": url, "title": title, "snippet": snippet, "score": 1}
            for url, title, snippet in rows
        ]
    except sqlite3.OperationalError:
        # Query syntax error → fall through
        return []
    finally:
        conn.close()


# ── Article scraper ──────────────────────────────────────────────────

# Rate limit: 1.5 req/s with ±0.3s jitter
_SCRAPE_DELAY = 1 / 1.5
_JITTER = 0.3


def _get_cookie() -> str:
    """Read KB auth cookie from aiconfig.yaml or env var."""
    # Try env var first
    cookie = _os.environ.get("KB_COOKIE", "")
    if cookie:
        return cookie
    # Try aiconfig.yaml
    try:
        import yaml

        config_path = Path(__file__).parent.parent / "aiconfig.yaml"
        if config_path.exists():
            cfg = yaml.safe_load(config_path.read_text()) or {}
            kb_cfg = cfg.get("kb", {})
            cookie = kb_cfg.get("cookie", "")
    except Exception:
        pass
    return cookie


async def scrape_articles() -> None:
    """Background task: download all KB articles and index in FTS5."""
    cookie = _get_cookie()
    if not cookie:
        print("*** KB scraper: no cookie set, skipping", flush=True)
        return

    # Load sitemap
    if not SITEMAP_PATH.exists():
        print("*** KB scraper: sitemap not found, skipping", flush=True)
        return

    urls = list(_load_urls_from_sitemap())
    total = len(urls)
    print(f"*** KB scraper: starting, {total} articles to scrape", flush=True)

    # Resume from last position
    conn = _get_fts_conn()
    row = conn.execute("SELECT last_index FROM scrape_progress WHERE id=1").fetchone()
    start_idx = row[0] if row else 0
    conn.execute(
        "INSERT OR REPLACE INTO scrape_progress (id, last_index, total, started_at, updated_at) VALUES (1, ?, ?, ?, ?)",
        (start_idx, total, time.time(), time.time()),
    )
    conn.commit()
    conn.close()

    if start_idx > 0:
        print(f"*** KB scraper: resuming from article {start_idx}/{total}", flush=True)

    # Scrape loop
    scraped = 0
    skipped = 0
    last_save = time.time()

    async with httpx.AsyncClient(
        timeout=30,
        headers={
            "Cookie": cookie,
            "User-Agent": "Mozilla/5.0 (compatible; NetAppKBIndexer/1.0)",
        },
    ) as client:
        for i in range(start_idx, total):
            url, title = urls[i]

            # Check if already scraped
            conn = _get_fts_conn()
            existing = conn.execute(
                "SELECT 1 FROM articles WHERE url=?", (url,)
            ).fetchone()
            conn.close()
            if existing:
                skipped += 1
                if skipped % 500 == 0:
                    print(
                        f"*** KB scraper: {i}/{total} ({i * 100 // total}%), "
                        f"scraped {scraped}, skipped {skipped}",
                        flush=True,
                    )
                continue

            try:
                resp = await client.get(url)
                if resp.status_code == 200:
                    content = extract_text(resp.text, title)
                    if content:
                        conn = _get_fts_conn()
                        conn.execute(
                            "INSERT OR REPLACE INTO articles (url, title, content, scraped_at) VALUES (?, ?, ?, ?)",
                            (url, title, content, time.time()),
                        )
                        conn.execute(
                            "INSERT OR REPLACE INTO articles_fts (url, title, content) VALUES (?, ?, ?)",
                            (url, title, content),
                        )
                        conn.commit()
                        conn.close()
                        scraped += 1
                    else:
                        skipped += 1
                else:
                    skipped += 1
            except Exception as e:
                logger.warning(f"Scrape error {url[:80]}: {e}")
                skipped += 1

            # Progress report every 500 articles
            if (scraped + skipped) % 500 == 0:
                pct = i * 100 // total
                elapsed = time.time() - last_save
                rate = 500 / elapsed if elapsed > 0 else 0
                print(
                    f"*** KB scraper: {i}/{total} ({pct}%), "
                    f"scraped {scraped}, {rate:.1f} req/s",
                    flush=True,
                )
                last_save = time.time()

            # Save progress every 100 articles
            if i % 100 == 0:
                conn = _get_fts_conn()
                conn.execute(
                    "UPDATE scrape_progress SET last_index=?, updated_at=? WHERE id=1",
                    (i + 1, time.time()),
                )
                conn.commit()
                conn.close()

            # Rate limit
            await asyncio.sleep(_SCRAPE_DELAY + (_JITTER * (hash(url) % 100) / 100 - _JITTER / 2))

    print(
        f"*** KB scraper: DONE — {scraped} scraped, {skipped} skipped, {total} total",
        flush=True,
    )


def _load_urls_from_sitemap() -> list[tuple[str, str]]:
    """Parse sitemap and return [(url, title), ...]."""
    xml_text = SITEMAP_PATH.read_text()
    urls = re.findall(r"<loc>(https://kb\.netapp\.com/([^<]+))</loc>", xml_text)
    result: list[tuple[str, str]] = []
    for full_url, path in urls:
        path = path.rstrip("/")
        last = path.split("/")[-1]
        if len(last) < 15 or "_" not in last:
            continue
        title = last.replace("_", " ")
        result.append((full_url, title))
    return result


def get_scrape_progress() -> dict:
    """Return current scrape progress."""
    conn = _get_fts_conn()
    row = conn.execute(
        "SELECT last_index, total, started_at, updated_at FROM scrape_progress WHERE id=1"
    ).fetchone()
    article_count = conn.execute("SELECT COUNT(*) FROM articles").fetchone()[0]
    conn.close()
    if row:
        return {
            "scraped": article_count,
            "total": row[1],
            "progress_pct": round(row[0] * 100 / max(row[1], 1), 1),
            "last_index": row[0],
            "started_at": row[2],
            "updated_at": row[3],
        }
    return {"scraped": 0, "total": 0, "progress_pct": 0}


# ── Service ──────────────────────────────────────────────────────────

class KBSearchService:
    """Loads sitemap + FTS index, provides search via FTS5 or title fallback."""

    def __init__(self):
        self._articles: dict[str, str] = {}
        self._loaded = False
        self._fts_available = False

    async def ensure_loaded(self):
        if self._loaded:
            return
        init_fts_db()
        self._articles = await self._load_sitemap()
        self._fts_available = FTS_DB_PATH.exists() and bool(search_fts("test"))
        self._loaded = True
        mode = "FTS5" if self._fts_available else "title-only"
        print(
            f"*** KB search loaded: {len(self._articles)} articles ({mode}) from {CACHE_DIR}",
            flush=True,
        )

    async def _load_sitemap(self) -> dict[str, str]:
        xml_text = await self._fetch_sitemap()
        articles: dict[str, str] = {}
        urls = re.findall(r"<loc>(https://kb\.netapp\.com/([^<]+))</loc>", xml_text)
        for full_url, path in urls:
            path = path.rstrip("/")
            last = path.split("/")[-1]
            if len(last) < 15 or "_" not in last:
                continue
            articles[full_url] = last.replace("_", " ")
        return articles

    async def _fetch_sitemap(self) -> str:
        if SITEMAP_PATH.exists():
            age = SITEMAP_PATH.stat().st_mtime
            if time.time() - age < SITEMAP_MAX_AGE:
                return SITEMAP_PATH.read_text()
        logger.info("Downloading KB sitemap...")
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(SITEMAP_URL)
            resp.raise_for_status()
            text = resp.text
        SITEMAP_PATH.parent.mkdir(parents=True, exist_ok=True)
        SITEMAP_PATH.write_text(text)
        return text

    def search(self, query: str, limit: int = 4) -> list[dict]:
        """Search KB articles — FTS5 if available, otherwise title matching."""
        # Try FTS5 first
        results = search_fts(query, limit)
        if results:
            return results

        # Fallback: title keyword matching
        if not self._articles:
            return []
        keywords = query.lower().split()
        scored: list[tuple[int, str, str]] = []
        for url, title in self._articles.items():
            title_lower = title.lower()
            score = sum(1 for kw in keywords if kw in title_lower)
            if score > 0:
                scored.append((score, title, url))
        scored.sort(key=lambda x: (-x[0], len(x[1])))
        return [
            {"title": title, "url": url, "snippet": title, "score": score}
            for score, title, url in scored[:limit]
        ]

    @property
    def fts_available(self) -> bool:
        return self._fts_available


# Singleton
kb_search = KBSearchService()
