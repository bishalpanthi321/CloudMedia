import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.job import Job, JobStatus, MediaType
from app.schemas.job import JobCreateRequest, JobRead, JobUploadInitRequest, JobUploadInitResponse
from app.models.user import User
from app.core.config import get_settings
from app.services.queue import job_queue
from app.services.storage import storage

router = APIRouter()
settings = get_settings()


def _detect_media_type(content_type: str) -> MediaType:
    if content_type.startswith("image/"):
        return MediaType.image
    if content_type.startswith("video/"):
        return MediaType.video
    raise HTTPException(status_code=400, detail="Unsupported file type. Use image/* or video/*.")


def _build_watermark_text(
    base_text: str | None,
    include_current_time: bool,
    timestamp_format: str,
    current_time_text: str | None,
) -> str | None:
    text = (base_text or "").strip()

    if not include_current_time:
        return text or None

    provided_time = (current_time_text or "").strip()
    if provided_time:
        suffix = provided_time
    else:
        now = datetime.now()
        if timestamp_format == "time":
            suffix = now.strftime("%H:%M:%S")
        else:
            suffix = now.strftime("%Y-%m-%d %H:%M:%S")

    if text:
        return f"{text} | {suffix}"

    return suffix


def _job_to_read(job: Job) -> JobRead:
    if job.output_key:
        job.output_url = storage.public_url(job.output_key, expires_in=settings.s3_presign_expires_seconds)
    else:
        job.output_url = None
    return JobRead.model_validate(job)


@router.post("/upload-url", response_model=JobUploadInitResponse)
def init_job_upload(
    payload: JobUploadInitRequest,
    current_user: User = Depends(get_current_user),
):
    _detect_media_type(payload.content_type)

    ext = Path(payload.filename or "upload.bin").suffix or ".bin"
    input_key = f"uploads/{current_user.id}/{uuid.uuid4()}{ext}"
    upload_url = storage.generate_upload_url(
        input_key,
        payload.content_type,
        settings.s3_presign_expires_seconds,
    )

    return JobUploadInitResponse(
        input_key=input_key,
        upload_url=upload_url,
        expires_in=settings.s3_presign_expires_seconds,
    )


@router.post("", response_model=JobRead, status_code=202)
def create_job(
    payload: JobCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    content_type = payload.content_type or "application/octet-stream"
    media_type = _detect_media_type(content_type)

    if not payload.input_key.startswith(f"uploads/{current_user.id}/"):
        raise HTTPException(status_code=400, detail="Invalid input key")

    if not storage.exists(payload.input_key):
        raise HTTPException(status_code=400, detail="Uploaded media not found in storage")

    resolved_watermark = _build_watermark_text(
        payload.watermark_text,
        payload.include_current_time,
        payload.timestamp_format,
        payload.current_time_text,
    )
    resolved_overlays = [overlay.model_dump() for overlay in payload.text_overlays] if payload.text_overlays else None

    job = Job(
        user_id=current_user.id,
        media_type=media_type,
        status=JobStatus.queued,
        original_filename=payload.original_filename or "unknown",
        content_type=content_type,
        input_key=payload.input_key,
        requested_width=payload.requested_width,
        watermark_text=resolved_watermark,
        text_overlays=resolved_overlays,
    )

    db.add(job)
    db.commit()
    db.refresh(job)

    job_queue.enqueue("app.worker.tasks.process_media_job", str(job.id))
    return _job_to_read(job)


@router.get("", response_model=list[JobRead])
def list_jobs(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    stmt = select(Job).where(Job.user_id == current_user.id).order_by(desc(Job.created_at)).limit(100)
    jobs = db.scalars(stmt).all()
    return [_job_to_read(job) for job in jobs]


@router.get("/{job_id}", response_model=JobRead)
def get_job(job_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = db.get(Job, uuid.UUID(job_id))
    if not job or job.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_to_read(job)


@router.delete("")
def delete_jobs(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    stmt = select(Job).where(Job.user_id == current_user.id)
    jobs = db.scalars(stmt).all()

    deleted = 0
    for job in jobs:
        storage.delete(job.input_key)
        if job.output_key:
            storage.delete(job.output_key)
        db.delete(job)
        deleted += 1

    db.commit()
    return {"deleted": deleted}
