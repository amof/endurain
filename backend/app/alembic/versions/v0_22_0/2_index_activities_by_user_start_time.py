"""2: index activities by user and start time

Revision ID: 8c2e5a71d3f0
Revises: 3f6b2d8a9c41
Create Date: 2026-11-27 00:00:00.000000

The global map reads a user's activities newest first, in keyset slices of ``(start_time, id)``. Without an index on
those columns every slice reads and sorts all of the user's activities; with it, a slice is a range of the index.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "8c2e5a71d3f0"
down_revision: str | None = "3f6b2d8a9c41"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index("ix_activities_user_id_start_time_id", "activities", ["user_id", "start_time", "id"])


def downgrade() -> None:
    op.drop_index("ix_activities_user_id_start_time_id", table_name="activities")
