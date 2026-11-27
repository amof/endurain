"""1: add activities_streams.track_overview

Revision ID: 3f6b2d8a9c41
Revises: e95a7c1d4b36
Create Date: 2026-11-26 00:00:00.000000

The global map draws every track of a user at once, which the full-resolution samples are too large for. A map stream
now carries a simplified copy of its track as an encoded polyline. The column starts empty: streams written from now on
fill it when they are created, and the activity-streams backfill fills it for the existing ones in the background, so
the upgrade does not wait on every stored track.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3f6b2d8a9c41"
down_revision: str | None = "e95a7c1d4b36"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "activities_streams",
        sa.Column(
            "track_overview",
            sa.Text(),
            nullable=True,
            comment="Map stream only: simplified track as an encoded polyline, empty when there is no line to draw",
        ),
    )


def downgrade() -> None:
    op.drop_column("activities_streams", "track_overview")
