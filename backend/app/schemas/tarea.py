from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


TaskState = Literal["PENDIENTE", "EN_PROCESO", "COMPLETADA", "CERRADO"]
EvidenceType = Literal["image", "video"]


class Evidencia(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nombre: str = Field(min_length=1, max_length=128)
    ruta: str = Field(min_length=1, max_length=512)
    fecha: date
    tipo: EvidenceType = "image"


class TareaResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int
    novedades_ids: list[int]
    operador_id: int
    tipo_tarea: str
    descripcion: str
    fecha_creacion: datetime
    usuario_creacion: str
    estado: TaskState
    evidencias: list[Evidencia]


class TareaEstadoUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    estado: Literal["EN_PROCESO", "COMPLETADA"]


class TareaEvidenciasResponse(BaseModel):
    tarea: TareaResponse
    evidencias_agregadas: int


class OperadorAsignacion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    codigo: str
    tipo_documento: str
    identificacion: str
    nombre_completo: str


class NovedadAsignacion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id_novedad: int
    fecha_novedad: date | datetime | None
    codigo: int
    tipo_novedad: str | None
    descripcion: str | None
    estado: str | None
    tipo_documento: str | None = None
    identificacion: str | None = None
    nombre_completo: str | None = None


class TipoTareaResponse(BaseModel):
    id: int
    nombre: str


class TareaCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    operador_id: int = Field(gt=0)
    novedades_ids: list[int] = Field(min_length=1, max_length=100)
    tipo_tarea_id: int = Field(gt=0)
    descripcion: str = Field(min_length=1, max_length=10_000)

    @field_validator("novedades_ids")
    @classmethod
    def novelty_ids_must_be_unique(cls, values: list[int]) -> list[int]:
        if any(value <= 0 for value in values) or len(set(values)) != len(values):
            raise ValueError("Las novedades deben ser IDs positivos y no repetidos.")
        return values


class TareaAsignacionResponse(BaseModel):
    tarea: TareaResponse
    notificaciones_programadas: int
