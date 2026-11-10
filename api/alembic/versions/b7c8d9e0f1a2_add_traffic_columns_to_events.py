"""add traffic columns to events

Revision ID: b7c8d9e0f1a2
Revises: a1b2c3d4e5f6
Create Date: 2026-11-10 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b7c8d9e0f1a2'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

STRINGS = ['path', 'title', 'referrer', 'utm_source', 'utm_medium', 'utm_campaign', 'visitor_id',
           'session_id', 'screen', 'language', 'timezone', 'referrer_host', 'country', 'region',
           'city', 'device', 'browser', 'os']
INTS = ['duration_s', 'scroll_pct']
INDEXED = ['path', 'visitor_id', 'country']


def upgrade() -> None:
    for c in STRINGS:
        op.add_column('events', sa.Column(c, sa.String(), nullable=True))
    for c in INTS:
        op.add_column('events', sa.Column(c, sa.Integer(), nullable=True))
    op.add_column('events', sa.Column('is_bot', sa.Boolean(), nullable=True))
    for c in INDEXED:
        op.create_index(op.f(f'ix_events_{c}'), 'events', [c], unique=False)


def downgrade() -> None:
    for c in INDEXED:
        op.drop_index(op.f(f'ix_events_{c}'), table_name='events')
    for c in STRINGS + INTS + ['is_bot']:
        op.drop_column('events', c)
