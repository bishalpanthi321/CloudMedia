import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.security import create_guest_access_token
from app.db.session import get_db
from app.models.user import User
from app.schemas.auth import AuthGuestResponse

router = APIRouter()


def _new_guest_name() -> str:
    return f"guest_{uuid.uuid4().hex[:10]}"


@router.post("/guest", response_model=AuthGuestResponse)
def create_guest_token(db: Session = Depends(get_db)):
    user = User(display_name=_new_guest_name(), is_guest=True)
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_guest_access_token(user.id)
    return AuthGuestResponse(
        access_token=token,
        user_id=user.id,
        display_name=user.display_name,
        created_at=user.created_at,
    )
