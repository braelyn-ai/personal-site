"""add site to events (which site a page view was on: braelyn.ai or blog.braelyn.ai)

Revision ID: c9d0e1f2a3b4
Revises: b7c8d9e0f1a2
Create Date: 2026-11-12 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c9d0e1f2a3b4'
down_revision: Union[str, Sequence[str], None] = 'b7c8d9e0f1a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('events', sa.Column('site', sa.String(), nullable=True))
    op.create_index(op.f('ix_events_site'), 'events', ['site'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_events_site'), table_name='events')
    op.drop_column('events', 'site')
