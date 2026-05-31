"""NetApp KB article scraper — downloads full text, builds SQLite FTS5 index.

Manual trigger only.  Usage:
  KB_COOKIE="dekisession=..." python -m services.kb_scraper

- Sitemap auto-refreshes every 24h via kb_search.py
- Run this when you have a fresh auth cookie to scrape new articles
- Incremental: skips already-scraped URLs, safe to interrupt (resumes)"""

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

# ── Config ────────────────────────────────────────────────────────────

_DOCKER = Path("/data/logs").exists()
BASE_DIR = Path("/data/logs") if _DOCKER else Path(__file__).parent.parent / "data"
SITEMAP_PATH = BASE_DIR / "kb_sitemap.xml"
FTS_DB_PATH = BASE_DIR / "kb_fts.db"

# Rate: ~1.5 req/s with jitter
_REQ_DELAY = 1 / 1.5
_JITTER = 0.3

# ── Cookie ────────────────────────────────────────────────────────────


def _load_cookie() -> str:
    import os

    c = os.environ.get("KB_COOKIE", "")
    if c:
        return c
    try:
        import yaml

        cfg_path = Path(__file__).parent.parent / "aiconfig.yaml"
        if cfg_path.exists():
            cfg = yaml.safe_load(cfg_path.read_text()) or {}
            c = cfg.get("kb", {}).get("cookie", "")
    except Exception:
        pass
    return c


# ── HTML extraction ───────────────────────────────────────────────────

_SKIP = [
    "sign in to view", "go back to previous", "expand/collapse",
    "skip to main content", "powered by", "©", "copyright",
    "privacy policy", "terms of use", "site map", "knowledge center",
    "netapp neighborhood", "customer stories", "partner with netapp",
    "general terms", "netapp provides no representations",
    "recommended articles", "product categories", "article review state",
]


def _extract_text(html: str, title: str = "") -> str:
    text = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL)
    text = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.DOTALL)
    text = re.sub(r"<[^>]+>", "\n", text)
    text = unescape(text)
    lines = [re.sub(r"\s+", " ", l).strip() for l in text.split("\n")]
    lines = [l for l in lines if len(l) > 20]

    title_words = set(title.lower().split()[:5]) if title else set()
    found = False
    content: list[str] = []
    for line in lines:
        if not found and title_words:
            if sum(1 for w in title_words if w in line.lower()) >= 2:
                found = True
            continue
        if not found:
            continue
        if any(p in line.lower() for p in _SKIP):
            continue
        content.append(line)
    return "\n".join(content)


# ── Database ──────────────────────────────────────────────────────────


def _conn():
    c = sqlite3.connect(str(FTS_DB_PATH))
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA synchronous=NORMAL")
    return c


def init_db():
    c = _conn()
    c.execute("CREATE TABLE IF NOT EXISTS articles (url TEXT PRIMARY KEY, title TEXT, content TEXT, scraped_at REAL)")
    c.execute("CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(url, title, content)")
    c.execute("CREATE TABLE IF NOT EXISTS progress (id INTEGER PRIMARY KEY, idx INTEGER, total INTEGER, updated REAL)")
    c.commit()
    c.close()


def _load_urls() -> list[tuple[str, str]]:
    xml = SITEMAP_PATH.read_text()
    urls = re.findall(r"<loc>(https://kb\.netapp\.com/([^<]+))</loc>", xml)
    result = []
    for full, path in urls:
        path = path.rstrip("/")
        last = path.split("/")[-1]
        if len(last) < 15 or "_" not in last:
            continue
        result.append((full, last.replace("_", " ")))
    return result


def search_fts(query: str, limit: int = 4) -> list[dict]:
    c = _conn()
    try:
        rows = c.execute(
            "SELECT a.url, a.title, snippet(articles_fts,2,'<b>','</b>','...',40) "
            "FROM articles_fts f JOIN articles a ON a.url=f.url "
            "WHERE articles_fts MATCH ? ORDER BY rank LIMIT ?",
            (query, limit),
        ).fetchall()
        return [{"url": u, "title": t, "snippet": s, "score": 1} for u, t, s in rows]
    except sqlite3.OperationalError:
        return []
    finally:
        c.close()


def progress() -> dict:
    c = _conn()
    r = c.execute("SELECT idx, total, updated FROM progress WHERE id=1").fetchone()
    n = c.execute("SELECT COUNT(*) FROM articles").fetchone()[0]
    c.close()
    if r:
        return {"scraped": n, "idx": r[0], "total": r[1], "pct": round(r[0] * 100 / max(r[1], 1), 1)}
    return {"scraped": 0, "idx": 0, "total": 0, "pct": 0}


# ── Scraper ───────────────────────────────────────────────────────────


async def run():
    cookie = _load_cookie()
    if not cookie:
        print("*** KB scraper: no cookie, skipping", flush=True)
        return

    init_db()
    urls = _load_urls()
    total = len(urls)

    # Resume
    c = _conn()
    row = c.execute("SELECT idx FROM progress WHERE id=1").fetchone()
    start = row[0] if row else 0
    c.execute("INSERT OR REPLACE INTO progress VALUES (1,?,?,?)", (start, total, time.time()))
    c.commit()
    c.close()

    print(f"*** KB scraper: {start}/{total} articles ({start*100//total}%)", flush=True)
    scraped = skipped = 0
    tick = time.time()

    async with httpx.AsyncClient(
        timeout=15,
        headers={"Cookie": cookie, "User-Agent": "NetAppKBIndexer/1.0"},
    ) as client:
        for i in range(start, total):
            url, title = urls[i]

            # Skip if already done
            c = _conn()
            if c.execute("SELECT 1 FROM articles WHERE url=?", (url,)).fetchone():
                c.close()
                skipped += 1
                continue
            c.close()

            try:
                resp = await client.get(url)
                if resp.status_code == 200:
                    text = _extract_text(resp.text, title)
                    if text:
                        c = _conn()
                        c.execute("INSERT OR REPLACE INTO articles VALUES (?,?,?,?)", (url, title, text, time.time()))
                        c.execute("INSERT OR REPLACE INTO articles_fts VALUES (?,?,?)", (url, title, text))
                        c.commit()
                        c.close()
                        scraped += 1
                    else:
                        skipped += 1
                else:
                    skipped += 1
            except Exception:
                skipped += 1

            # Report every 200
            total_done = scraped + skipped
            if total_done % 200 == 0:
                elapsed = time.time() - tick
                rate = 200 / elapsed if elapsed > 0 else 0
                pct = (i + 1) * 100 // total
                eta = (total - i - 1) / max(rate, 0.01) / 3600
                print(f"*** KB scraper: {i+1}/{total} ({pct}%) | {rate:.1f}/s | ETA {eta:.1f}h | {scraped} ok", flush=True)
                tick = time.time()

            # Save progress every 100
            if i % 100 == 0:
                c = _conn()
                c.execute("UPDATE progress SET idx=?, updated=?", (i + 1, time.time()))
                c.commit()
                c.close()

            await asyncio.sleep(_REQ_DELAY + (_JITTER * (hash(url) % 100) / 100 - _JITTER / 2))

    print(f"*** KB scraper: DONE — {scraped} scraped, {skipped} skipped", flush=True)


# ── CLI ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    asyncio.run(run())
