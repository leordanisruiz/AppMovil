from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, CheckConstraint, DateTime, Identity, Index
from sqlalchemy import String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class TareaOperador(Base):
    __tablename__ = "tareas_operador"
    __table_args__ = (
        CheckConstraint(
            "estado IN ('PENDIENTE', 'EN_PROCESO', 'COMPLETADA', 'CERRADO')",
            name="ck_tareas_operador_estado",
        ),
        CheckConstraint(
            "jsonb_typeof(novedades_ids) = 'array'",
            name="ck_tareas_operador_novedades_ids",
        ),
        CheckConstraint(
            "jsonb_typeof(evidencias) = 'object' "
            "AND jsonb_typeof(evidencias->'evidencias') = 'array'",
            name="ck_tareas_operador_evidencias",
        ),
        Index(
            "ix_tareas_operador_operador_estado_fecha",
            "operador_id",
            "estado",
            text("fecha_creacion DESC"),
        ),
        Index(
            "ix_tareas_operador_evidencias_gin",
            "evidencias",
            postgresql_using="gin",
            postgresql_ops={"evidencias": "jsonb_path_ops"},
        ),
        Index(
            "ix_tareas_operador_novedades_ids_gin",
            "novedades_ids",
            postgresql_using="gin",
            postgresql_ops={"novedades_ids": "jsonb_path_ops"},
        ),
        {"schema": "DW_OPERACIONAL"},
    )

    id: Mapped[int] = mapped_column(
        BigInteger,
        Identity(),
        primary_key=True,
    )
    novedades_ids: Mapped[list[int]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'[]'::jsonb"),
    )
    operador_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    tipo_tarea: Mapped[str] = mapped_column(String(120), nullable=False)
    descripcion: Mapped[str] = mapped_column(Text, nullable=False)
    fecha_creacion: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    usuario_creacion: Mapped[str] = mapped_column(String(128), nullable=False)
    estado: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        server_default=text("'PENDIENTE'"),
    )
    evidencias: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("""'{"evidencias": []}'::jsonb"""),
    )
