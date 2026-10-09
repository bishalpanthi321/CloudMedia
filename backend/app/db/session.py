from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings
from app.db.engine import build_engine

settings = get_settings()

engine = build_engine(settings)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
