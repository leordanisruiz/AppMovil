from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Identity,
    SmallInteger,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class UsuarioApp(Base):
    __tablename__ = "usuarios_app"
    __table_args__ = (
        UniqueConstraint(
            "tipo_documento",
            "identificacion",
            name="uq_usuarios_app_documento_identificacion",
        ),
        CheckConstraint(
            "rol_id IS NULL OR rol_id IN (1, 2)",
            name="ck_usuarios_app_rol_id",
        ),
        {"schema": "DW_CONFIG"},
    )

    id: Mapped[int] = mapped_column(
        BigInteger,
        Identity(always=False),
        primary_key=True,
    )
    tipo_documento: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
    )
    identificacion: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
    )
    password_hash: Mapped[str] = mapped_column(String(60), nullable=False)
    rol_id: Mapped[int | None] = mapped_column(SmallInteger)
    fecha_creacion: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
