from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import DATA_DIR, UPLOAD_DIR
from core.database import create_all
from api.upload import router as upload_router
from api.files import router as files_router
from api.manager import router as manager_router
from api.templates import router as templates_router
from api.search import router as search_router
from api.chat import router as chat_router

logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

app = FastAPI(title="AiSUP API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    await create_all()
    print("*** SERVER STARTED - upload.py version check: threading+queue ***", flush=True)
    # Pre-load KB sitemap in background (non-blocking)
    import asyncio as _asyncio
    from services.kb_search import kb_search as _kb_search, scrape_articles as _scrape
    _asyncio.create_task(_kb_search.ensure_loaded())
    # Start article scraper in background (can take hours)
    _asyncio.create_task(_scrape())


app.include_router(upload_router, prefix="/api/v1")
app.include_router(files_router, prefix="/api/v1")
app.include_router(manager_router, prefix="/api/v1")
app.include_router(templates_router, prefix="/api/v1")
app.include_router(search_router, prefix="/api/v1")
app.include_router(chat_router, prefix="/api/v1")

_frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
if _frontend_dist.exists():
    from fastapi.staticfiles import StaticFiles as _SF
    app.mount("/assets", _SF(directory=str(_frontend_dist / "assets")), name="assets")

    from fastapi.responses import FileResponse
    from fastapi import Request

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(request: Request, full_path: str):
        if full_path.startswith("api/"):
            from fastapi import HTTPException
            raise HTTPException(status_code=404)
        return FileResponse(str(_frontend_dist / "index.html"))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=False, access_log=False)
