from pathlib import Path

import yaml
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "sqlite+aiosqlite:///./data/asup.db"
    upload_dir: str = "data/uploads"
    data_dir: str = "data"

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / settings.data_dir
UPLOAD_DIR = BASE_DIR / settings.upload_dir
AI_CONFIG_PATH = BASE_DIR / "aiconfig.yaml"


def load_ai_config() -> dict:
    if not AI_CONFIG_PATH.exists():
        return {}
    try:
        return yaml.safe_load(AI_CONFIG_PATH.read_text()) or {}
    except Exception:
        return {}


def is_ai_auto_analysis_enabled() -> bool:
    cfg = load_ai_config()
    auto_cfg = cfg.get("ai_auto_analysis", {})
    if not isinstance(auto_cfg, dict):
        return True
    return bool(auto_cfg.get("enabled", True))
