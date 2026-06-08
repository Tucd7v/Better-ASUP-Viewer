from __future__ import annotations

from fastapi import APIRouter

from core.config import is_ai_auto_analysis_enabled
from schemas.api import AppConfigResponse

router = APIRouter()


@router.get("/config", response_model=AppConfigResponse)
async def get_config():
    return AppConfigResponse(
        ai_auto_analysis={"enabled": is_ai_auto_analysis_enabled()}
    )
