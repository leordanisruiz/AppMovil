from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Identity, String, UniqueConstraint, func
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
    fecha_creacion: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
