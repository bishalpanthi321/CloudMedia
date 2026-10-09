import logging
import time
from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.api.router import api_router
from app.core.config import get_settings
from app.db.session import engine


def _configure_logging() -> None:
    root_logger = logging.getLogger()
    if not root_logger.handlers:
        logging.basicConfig(
            level=logging.INFO,
            format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        )


_configure_logging()

settings = get_settings()
app = FastAPI(title=settings.app_name)
logger = logging.getLogger("app.api")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.api_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    logger.info("Starting API service", extra={"env": settings.app_env})

    logger.info("Startup phase: validating database connectivity")
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        logger.info("Startup phase complete: database connectivity OK")
    except Exception:
        logger.exception("Startup phase failed: database connectivity check failed")
        raise

    logger.info("Startup phase: applying database migrations")
    alembic_cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    try:
        command.upgrade(alembic_cfg, "head")
        logger.info("Startup phase complete: database migrations applied")
    except BaseException as exc:
        if isinstance(exc, SystemExit):
            logger.exception(
                "Startup phase failed: database migration triggered SystemExit",
                extra={"exit_code": exc.code},
            )
        else:
            logger.exception("Startup phase failed: database migration failed")
        raise

    logger.info("Startup phase: ensuring media root exists", extra={"media_root": settings.media_root})
    Path(settings.media_root).mkdir(parents=True, exist_ok=True)
    logger.info("Startup complete", extra={"media_root": settings.media_root})


@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        logger.exception(
            "Request failed",
            extra={
                "method": request.method,
                "path": request.url.path,
                "duration_ms": duration_ms,
            },
        )
        raise

    duration_ms = round((time.perf_counter() - start) * 1000, 2)
    logger.info(
        "Request completed",
        extra={
            "method": request.method,
            "path": request.url.path,
            "status": response.status_code,
            "duration_ms": duration_ms,
        },
    )
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception(
        "Unhandled exception",
        extra={
            "method": request.method,
            "path": request.url.path,
        },
    )
    return JSONResponse(status_code=500, content={"detail": "Internal Server Error"})


@app.get("/health")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(api_router, prefix="/api")
app.mount("/media", StaticFiles(directory=settings.media_root), name="media")
