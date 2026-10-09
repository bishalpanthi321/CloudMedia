from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.job import JobStatus, MediaType


class JobRead(BaseModel):
    id: UUID
    status: JobStatus
    media_type: MediaType
    original_filename: str
    output_url: str | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime | None

    model_config = {"from_attributes": True}


class JobUploadInitRequest(BaseModel):
    filename: str
    content_type: str


class JobUploadInitResponse(BaseModel):
    input_key: str
    upload_url: str
    expires_in: int


class TextOverlayPayload(BaseModel):
    text: str
    x: float
    y: float
    font_size: float
    color: str | None = None


class JobCreateRequest(BaseModel):
    input_key: str
    original_filename: str
    content_type: str
    requested_width: int | None = None
    watermark_text: str | None = None
    text_overlays: list[TextOverlayPayload] = Field(default_factory=list)
    include_current_time: bool = False
    timestamp_format: str = "date_time"
    current_time_text: str | None = None
