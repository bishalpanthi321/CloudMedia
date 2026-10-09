"""add text overlays to jobs

Revision ID: 20260510_0002
Revises: 20260419_0001
Create Date: 2026-05-10 00:00:00.000000

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "20260510_0002"
down_revision = "20260419_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "jobs" not in inspector.get_table_names():
        return

    job_columns = {column["name"] for column in inspector.get_columns("jobs")}
    if "text_overlays" in job_columns:
        return

    op.add_column("jobs", sa.Column("text_overlays", postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "jobs" not in inspector.get_table_names():
        return

    job_columns = {column["name"] for column in inspector.get_columns("jobs")}
    if "text_overlays" not in job_columns:
        return

    op.drop_column("jobs", "text_overlays")
