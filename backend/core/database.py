from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from core.config import settings, BASE_DIR

_db_path = settings.database_url
if _db_path.startswith("sqlite+aiosqlite:///./"):
    _relative = _db_path[len("sqlite+aiosqlite:///./"):]
    _db_path = f"sqlite+aiosqlite:///{BASE_DIR / _relative}"

engine = create_async_engine(_db_path, echo=False, connect_args={"check_same_thread": False})

AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


async def create_all():
    from models import db as _  # noqa: ensure models are imported
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
