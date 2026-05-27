from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    database_url: str = "sqlite+aiosqlite:///./data/asup.db"
    upload_dir: str = "data/uploads"
    data_dir: str = "data"

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / settings.data_dir
UPLOAD_DIR = BASE_DIR / settings.upload_dir
