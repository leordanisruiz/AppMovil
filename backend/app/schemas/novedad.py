from datetime import date, datetime

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class NovedadesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    codigo_operador: str = Field(
        min_length=1,
        max_length=64,
        description="Código del operador autenticado.",
    )


class Novedad(BaseModel):
    IdNovedad: int
    FechaNovedad: date | datetime | None
    Codigo: int | None
    TipoNovedad: str | None
    Grupo: str | None = None
    Subgrupo: str | None = None
    Descripcion: str | None
    Estado: str | None


class NovedadesResponse(BaseModel):
    total: int
    novedades: list[Novedad]


class PushTokenRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    expo_push_token: str = Field(
        min_length=16,
        max_length=512,
        pattern=r"^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]{1,256}\]$",
        description="Token de dispositivo emitido por Expo Notifications.",
    )
    plataforma: Literal["ios", "android"]


class PushTokenResponse(BaseModel):
    registrado: bool


class PushTokenDeactivationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    expo_push_token: str = Field(
        min_length=16,
        max_length=512,
        pattern=r"^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]{1,256}\]$",
        description="Token de dispositivo emitido por Expo Notifications.",
    )


class PushTokenDeactivationResponse(BaseModel):
    desactivado: bool
