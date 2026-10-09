"""initial users and jobs schema

Revision ID: 20260419_0001
Revises: 
Create Date: 2026-04-19 00:00:00.000000

"""

from __future__ import annotations

import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260419_0001"
down_revision = None
branch_labels = None
depends_on = None


job_status_enum = postgresql.ENUM("queued", "processing", "completed", "failed", name="job_status", create_type=False)
media_type_enum = postgresql.ENUM("image", "video", name="media_type", create_type=False)


def _ensure_users_table(bind) -> None:
    inspector = sa.inspect(bind)
    if "users" in inspector.get_table_names():
        return

    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("display_name", sa.String(length=120), nullable=False, unique=True),
        sa.Column("is_guest", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_users_display_name", "users", ["display_name"], unique=True)


def _ensure_jobs_table(bind) -> None:
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if "jobs" not in tables:
        job_status_enum.create(bind, checkfirst=True)
        media_type_enum.create(bind, checkfirst=True)
        op.create_table(
            "jobs",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("status", job_status_enum, nullable=False),
            sa.Column("media_type", media_type_enum, nullable=False),
            sa.Column("original_filename", sa.String(length=255), nullable=False),
            sa.Column("content_type", sa.String(length=100), nullable=False),
            sa.Column("input_key", sa.String(length=500), nullable=False),
            sa.Column("output_key", sa.String(length=500), nullable=True),
            sa.Column("output_url", sa.String(length=500), nullable=True),
            sa.Column("requested_width", sa.Integer(), nullable=True),
            sa.Column("watermark_text", sa.String(length=120), nullable=True),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        )
        op.create_index("ix_jobs_user_id", "jobs", ["user_id"], unique=False)
        return

    job_columns = {column["name"] for column in inspector.get_columns("jobs")}
    if "user_id" in job_columns:
        return

    guest_user_id = uuid.uuid4()
    bind.execute(
        sa.text(
            "INSERT INTO users (id, display_name, is_guest) VALUES (:id, :display_name, true) "
            "ON CONFLICT (display_name) DO NOTHING"
        ),
        {"id": str(guest_user_id), "display_name": "legacy_guest"},
    )

    lookup = bind.execute(sa.text("SELECT id FROM users WHERE display_name = 'legacy_guest' LIMIT 1")).scalar()
    resolved_guest_id = lookup or str(guest_user_id)

    op.add_column("jobs", sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True))
    bind.execute(sa.text("UPDATE jobs SET user_id = :user_id WHERE user_id IS NULL"), {"user_id": str(resolved_guest_id)})
    op.alter_column("jobs", "user_id", nullable=False)
    op.create_index("ix_jobs_user_id", "jobs", ["user_id"], unique=False)
    op.create_foreign_key("fk_jobs_user_id_users", "jobs", "users", ["user_id"], ["id"], ondelete="CASCADE")


def upgrade() -> None:
    bind = op.get_bind()
    _ensure_users_table(bind)
    _ensure_jobs_table(bind)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "jobs" in inspector.get_table_names():
        with op.batch_alter_table("jobs") as batch_op:
            try:
                batch_op.drop_constraint("fk_jobs_user_id_users", type_="foreignkey")
            except Exception:
                pass
        try:
            op.drop_index("ix_jobs_user_id", table_name="jobs")
        except Exception:
            pass
        try:
            op.drop_column("jobs", "user_id")
        except Exception:
            pass

    if "users" in inspector.get_table_names():
        try:
            op.drop_index("ix_users_display_name", table_name="users")
        except Exception:
            pass
        op.drop_table("users")
