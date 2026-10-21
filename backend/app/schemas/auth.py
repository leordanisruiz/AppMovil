from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    identificacion: str = Field(
        min_length=1,
        max_length=64,
        description="Cédula del empleado.",
    )
    password: str = Field(
        min_length=1,
        max_length=64,
        description="Código de Kactus para operadores o contraseña registrada.",
    )


class RegistrationIdentity(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    tipo_documento: str = Field(min_length=1, max_length=32)
    identificacion: str = Field(min_length=1, max_length=64)


class PasswordRegistrationRequest(RegistrationIdentity):
    password: str = Field(
        min_length=8,
        max_length=8,
        pattern=r"^[0-9]{8}$",
        description="Contraseña administrativa de exactamente ocho dígitos.",
    )


class RegistrationValidationResponse(BaseModel):
    pertenece_suma: bool
    puede_registrar: bool
    tipo_usuario: Literal["OPERADOR", "ADMINISTRATIVO"] | None
    nombre_completo: str | None
    mensaje: str


class PasswordRegistrationResponse(BaseModel):
    mensaje: str
    fecha_creacion: datetime


class EmployeeProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    Codigo: str | None
    TipoDocumento: str
    Identificacion: str
    NombreCompleto: str | None
    FechaIngreso: date | datetime | None
    Cargo: str | None
    EstadoEmpleado: str
    RolId: int | None = None


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    empleado: EmployeeProfile
