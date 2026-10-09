import uuid
from pathlib import Path
import tempfile

from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.job import Job, JobStatus
from app.services.media_processor import process_media
from app.services.storage import storage


def process_media_job(job_id: str) -> None:
    db: Session = SessionLocal()

    try:
        job = db.get(Job, uuid.UUID(job_id))
        if not job:
            return

        job.status = JobStatus.processing
        db.commit()

        input_suffix = Path(job.input_key).suffix or ".bin"
        with tempfile.NamedTemporaryFile(suffix=input_suffix, delete=False) as input_file:
            input_path = Path(input_file.name)

        try:
            storage.download_to_path(job.input_key, input_path)
            output_bytes, output_ext = process_media(
                media_type=job.media_type,
                input_path=input_path,
                requested_width=job.requested_width,
                watermark_text=job.watermark_text,
                text_overlays=job.text_overlays,
            )
        finally:
            input_path.unlink(missing_ok=True)

        output_key = f"outputs/{job.id}.{output_ext}"
        output_content_type = "image/jpeg" if output_ext == "jpg" else "video/mp4"
        storage.write_bytes(output_key, output_bytes, content_type=output_content_type)

        job.output_key = output_key
        job.output_url = None
        job.status = JobStatus.completed
        job.error_message = None
        db.commit()
    except Exception as exc:
        job = db.get(Job, uuid.UUID(job_id))
        if job:
            job.status = JobStatus.failed
            job.error_message = str(exc)
            db.commit()
        raise
    finally:
        db.close()
