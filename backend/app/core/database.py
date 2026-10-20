from collections.abc import Iterator

from fastapi import HTTPException, status
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


engine: Engine | None = None
SessionLocal: sessionmaker[Session] | None = None

if database_url := get_settings().database_url:
    if database_url.startswith("sqlite"):
        connect_args = {"check_same_thread": False}
    elif database_url.startswith("postgresql"):
        connect_args = {"connect_timeout": 5}
    else:
        connect_args = {}

    engine = create_engine(
        database_url,
        connect_args=connect_args,
        hide_parameters=True,
        pool_pre_ping=True,
    )
    SessionLocal = sessionmaker(
        bind=engine,
        autocommit=False,
        autoflush=False,
    )


def get_db() -> Iterator[Session]:
    if SessionLocal is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="La base de datos no está configurada.",
        )

    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
