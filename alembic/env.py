"""Alembic environment.

Reads the DB URL from XCS_GEN_DB_URL or defaults to ~/.xcs-gen/app.db.
"""

from __future__ import annotations

import os
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

from xcs_gen_web.models import metadata

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)


def _default_db_url() -> str:
    path = Path.home() / ".xcs-gen" / "app.db"
    return f"sqlite:///{path}"


target_metadata = metadata
db_url = os.environ.get("XCS_GEN_DB_URL") or _default_db_url()
config.set_main_option("sqlalchemy.url", db_url)


def run_migrations_offline() -> None:
    context.configure(
        url=db_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,  # SQLite-safe ALTERs
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
