from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class AuthGuestResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: UUID
    display_name: str
    created_at: datetime
