from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


TaskState = Literal["PENDIENTE", "EN_PROCESO", "COMPLETADA", "CERRADO"]
EvidenceType = Literal["image", "video"]


class NovedadReferencia(BaseModel):
    model_config = ConfigDict(extra="forbid")

    categoria: Literal["ico", "inasistencias"]
    id_novedad: int = Field(gt=0)


class Evidencia(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nombre: str = Field(min_length=1, max_length=128)
    ruta: str = Field(min_length=1, max_length=512)
    fecha: date
    tipo: EvidenceType = "image"
    fecha_captura: datetime | None = None
    ubicacion: str | None = None
    duracion_segundos: float | None = Field(default=None, ge=0)


class TareaResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int
    novedades_ids: list[int]
    novedades_referencias: list[NovedadReferencia] = Field(default_factory=list)
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
    categoria: Literal["ico", "inasistencias"] | None = None
    fecha_novedad: date | datetime | None
    codigo: int
    tipo_novedad: str | None
    grupo: str | None = None
    subgrupo: str | None = None
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
    novedades_referencias: list[NovedadReferencia] = Field(default_factory=list, max_length=100)
    tipo_tarea_id: int = Field(gt=0)
    descripcion: str = Field(min_length=1, max_length=10_000)

    @field_validator("novedades_ids")
    @classmethod
    def novelty_ids_must_be_unique(cls, values: list[int]) -> list[int]:
        if any(value <= 0 for value in values) or len(set(values)) != len(values):
            raise ValueError("Las novedades deben ser IDs positivos y no repetidos.")
        return values

    @model_validator(mode="after")
    def references_match_ids(self) -> "TareaCreateRequest":
        if self.novedades_referencias:
            references = {(item.categoria, item.id_novedad) for item in self.novedades_referencias}
            if len(references) != len(self.novedades_referencias) or {
                item.id_novedad for item in self.novedades_referencias
            } != set(self.novedades_ids):
                raise ValueError("Las referencias deben ser únicas y coincidir con los IDs de novedades.")
        return self


class TareaAsignacionResponse(BaseModel):
    tarea: TareaResponse
    notificaciones_programadas: int
