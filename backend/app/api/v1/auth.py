from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.auth import (
    LoginRequest,
    LoginResponse,
    PasswordRegistrationRequest,
    PasswordRegistrationResponse,
    RegistrationIdentity,
    RegistrationValidationResponse,
)
from app.services.auth_service import auth_service
from app.services.registration_service import registration_service

router = APIRouter()


@router.post(
    "/login",
    summary="Iniciar sesión",
    response_model=LoginResponse,
    responses={
        401: {"description": "Credenciales incorrectas."},
        403: {"description": "El empleado no está activo en Kactus."},
        503: {"description": "Kactus o la configuración JWT no están disponibles."},
    },
)
def login(
    credentials: LoginRequest,
    db: Annotated[Session, Depends(get_db)],
) -> LoginResponse:
    return auth_service.login(
        db,
        identificacion=credentials.identificacion,
        password=credentials.password,
    )


@router.post(
    "/validate-registration",
    summary="Validar identidad para registro administrativo",
    response_model=RegistrationValidationResponse,
    responses={
        403: {"description": "El empleado no está activo en SUMA."},
        404: {"description": "El usuario no pertenece a SUMA."},
        503: {"description": "No se pudo consultar SUMA o la tabla de usuarios."},
    },
)
def validate_registration(
    identity: RegistrationIdentity,
    db: Annotated[Session, Depends(get_db)],
) -> RegistrationValidationResponse:
    return registration_service.validate_identity(db, identity)


@router.post(
    "/register-password",
    summary="Registrar contraseña administrativa",
    response_model=PasswordRegistrationResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        403: {"description": "El usuario no está activo en SUMA."},
        404: {"description": "El usuario no pertenece a SUMA."},
        409: {"description": "El usuario ya tiene contraseña o es operador."},
        422: {"description": "La contraseña debe tener exactamente ocho dígitos."},
        503: {"description": "No se pudo guardar el registro."},
    },
)
def register_password(
    credentials: PasswordRegistrationRequest,
    db: Annotated[Session, Depends(get_db)],
) -> PasswordRegistrationResponse:
    identity = RegistrationIdentity(
        tipo_documento=credentials.tipo_documento,
        identificacion=credentials.identificacion,
    )
    return registration_service.register_password(
        db,
        identity,
        credentials.password,
    )
