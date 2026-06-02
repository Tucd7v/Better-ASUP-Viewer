"""NetApp KB article scraper — downloads full text, builds SQLite FTS5 index.

Manual trigger only.  Usage:
  KB_COOKIE="authtoken=<JWT>" python -m services.kb_scraper

- Requires authtoken (JWT) for full content; dekisession alone is NOT sufficient.
- Sitemap auto-refreshes every 24h via kb_search.py
- Run this when you have a fresh auth cookie to scrape new articles
- Incremental: skips already-scraped URLs, safe to interrupt (resumes)
- Login gate detection: aborts immediately if cookie expires mid-run"""

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

# NetApp KB uses authtoken (JWT), not dekisession.
# dekisession alone does NOT bypass the login gate.


def _load_cookie() -> str:
    import os

    # 1. Environment variable (highest priority)
    c = os.environ.get("KB_COOKIE", "")
    if c:
        return c

    # 2. Cookie file
    cookie_file = BASE_DIR / ".kb_cookie"
    if cookie_file.exists():
        return cookie_file.read_text().strip()

    # 3. aiconfig.yaml (lowest priority)
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

# Footer cut-points: any line matching one of these truncates extraction.
_FOOTER_CUT = [
    "Sign in to view",
    "Learn more about our award-winning",
    "Support Policies",
    "NetApp provides no representations",
    "SIGN IN", "New to NetApp?", "Create Account",
    "Environment, Social", "Privacy & Cookie",
    "US Public Sector", "NetApp OnDemand",
    "Data Visionary Centers", "Slavery and Human",
    "NetApp's Response to",
    # Template placeholders (empty sections)
    "partnerNotes_text", "additionalInformation_text",
]


_PRE_PLACEHOLDER = "%%HERMES_PRE_BLOCK_%d%%"


def _extract_text(html: str, title: str = "") -> str:
    """Extract article body from KB page HTML.

    Looks for <section class="mt-content-container"> and extracts clean
    text, stopping at footer markers or the login gate.
    <pre> blocks are preserved as fenced code blocks.
    """
    import re

    # 1. Isolate content section
    m = re.search(
        r'<section class="mt-content-container">(.*?)</section>',
        html, re.DOTALL,
    )
    if not m:
        return ""
    body = m.group(1)

    # 2. Strip scripts and styles
    body = re.sub(r"<script[^>]*>.*?</script>", "", body, flags=re.DOTALL)
    body = re.sub(r"<style[^>]*>.*?</style>", "", body, flags=re.DOTALL)

    # 3. Extract <pre> blocks and replace with placeholders
    pre_blocks: list[str] = []

    def _save_pre(m: re.Match) -> str:
        inner = m.group(1)
        # Convert <br> inside pre to newlines, strip other tags
        inner = re.sub(r"<br\s*/?>", "\n", inner, flags=re.IGNORECASE)
        inner = re.sub(r"<[^>]+>", "", inner)
        inner = unescape(inner)
        inner = re.sub(r"[\u200b\u200c\u200d\u200e\u200f\ufeff]", "", inner)
        # Normalise trailing whitespace per line but keep leading spaces
        lines = [l.rstrip() for l in inner.split("\n")]
        pre_blocks.append("\n".join(lines))
        return _PRE_PLACEHOLDER % (len(pre_blocks) - 1)

    body = re.sub(r"<pre[^>]*>(.*?)</pre>", _save_pre, body, flags=re.DOTALL)

    # 4. Convert remaining HTML to text
    body = re.sub(r"<br\s*/?>", "\n", body, flags=re.IGNORECASE)
    body = re.sub(
        r"</(p|div|h[1-6]|li|tr|section|header|article|table)>",
        "\n", body, flags=re.IGNORECASE,
    )
    body = re.sub(r"<[^>]+>", "", body)
    body = unescape(body)

    # 5. Clean zero-width and control characters, normalise whitespace
    body = re.sub(r"[\u200b\u200c\u200d\u200e\u200f\u2028\u2029\ufeff]", "", body)
    lines = [re.sub(r"\s+", " ", l).strip() for l in body.split("\n")]
    lines = [l for l in lines if len(l) > 1]

    # 6. Truncate at footer markers
    clean: list[str] = []
    for line in lines:
        low = line.lower()
        if any(m.lower() in low for m in _FOOTER_CUT):
            break
        clean.append(line)

    text = "\n".join(clean)

    # 7. Restore <pre> blocks as fenced code blocks
    for i, block in enumerate(pre_blocks):
        placeholder = _PRE_PLACEHOLDER % i
        text = text.replace(placeholder, f"\n```\n{block}\n```\n")

    return text



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
        # Fetch more candidates, then re-rank with title bonus
        rows = c.execute(
            "SELECT a.url, a.title, snippet(articles_fts,2,'<b>','</b>','...',40) "
            "FROM articles_fts f JOIN articles a ON a.url=f.url "
            "WHERE articles_fts MATCH ? "
            "AND a.url NOT LIKE '%/E-Series/%' "
            "AND a.url NOT LIKE '%/SANtricity%' "
            "AND a.url NOT LIKE '%/solidfire/%' "
            "ORDER BY rank LIMIT ?",
            (query, limit * 3),
        ).fetchall()

        # Re-rank: title keyword match gets a big boost
        keywords = query.lower().split()
        def _score(row):
            _, title, _ = row
            title_lower = title.lower()
            bonus = sum(2 for kw in keywords if kw in title_lower)
            return bonus

        rows.sort(key=_score, reverse=True)
        rows = rows[:limit]

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
                    # ── Login gate detection ──────────────────────────
                    if "Sign in to view the entire content" in resp.text:
                        print(
                            "*** KB scraper: LOGIN GATE DETECTED — cookie expired!",
                            flush=True,
                        )
                        print(
                            "*** KB scraper: ABORTING. Re-run with a fresh authtoken cookie.",
                            flush=True,
                        )
                        # ── QQ alert ──────────────────────────────────
                        try:
                            import json, http.client
                            # Signal file that Hermes cron/monitor picks up
                            alert_file = BASE_DIR / "kb_login_gate.alert"
                            alert_file.write_text(json.dumps({
                                "event": "login_gate",
                                "url": url,
                                "title": title,
                                "time": time.time(),
                            }))
                        except Exception:
                            pass
                        return

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

            # Report every 10
            total_done = scraped + skipped
            if total_done % 10 == 0:
                elapsed = time.time() - tick
                rate = 10 / elapsed if elapsed > 0 else 0
                pct = (i + 1) * 100 // total
                eta = (total - i - 1) / max(rate, 0.01) / 3600
                print(f"*** KB scraper: {i+1}/{total} ({pct}%) | {rate:.1f}/s | ETA {eta:.1f}h | [{title[:60]}]", flush=True)
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
