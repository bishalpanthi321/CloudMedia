from __future__ import annotations

import logging
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine

from app.core.config import Settings


logger = logging.getLogger("app.db.engine")


def build_engine(settings: Settings) -> Engine:
    logger.info(
        "Creating DB engine with database_url",
        extra={"connect_timeout_seconds": settings.db_connect_timeout_seconds},
    )
    return create_engine(
        settings.database_url,
        future=True,
        pool_pre_ping=True,
        connect_args={"connect_timeout": settings.db_connect_timeout_seconds},
    )
