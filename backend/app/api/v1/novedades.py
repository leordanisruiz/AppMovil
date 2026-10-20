from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.novedad import (
    NovedadesRequest,
    NovedadesResponse,
    PushTokenDeactivationResponse,
    PushTokenDeactivationRequest,
    PushTokenRequest,
    PushTokenResponse,
)
from app.services.novedades_service import novedades_service
from app.services.push_token_service import push_token_service

router = APIRouter()


@router.post(
    "/consultar",
    summary="Consultar novedades del operador autenticado",
    response_model=NovedadesResponse,
    responses={
        401: {"description": "El token no contiene una identidad válida."},
        403: {"description": "El código no corresponde al usuario autenticado."},
        503: {"description": "No se pudieron consultar las novedades."},
    },
)
def consultar_novedades(
    request: Request,
    consulta: NovedadesRequest,
    db: Session = Depends(get_db),
) -> NovedadesResponse:
    token_payload: dict[str, Any] = request.state.token_payload
    tipo_documento = token_payload.get("TipoDocumento")
    identificacion = token_payload.get("Identificacion")
    if not isinstance(tipo_documento, str) or not isinstance(
        identificacion, str
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="El token no contiene una identidad válida.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return novedades_service.consultar(
        db,
        codigo_operador=consulta.codigo_operador,
        tipo_documento=tipo_documento,
        identificacion=identificacion,
    )


@router.post(
    "/push-tokens",
    summary="Registrar dispositivo para notificaciones de novedades",
    response_model=PushTokenResponse,
    responses={
        401: {"description": "Token de acceso inválido."},
        403: {"description": "Solo operadores activos pueden registrar el dispositivo."},
        503: {"description": "El registro de notificaciones no está disponible."},
    },
)
def registrar_push_token(
    request: Request,
    dispositivo: PushTokenRequest,
    db: Session = Depends(get_db),
) -> PushTokenResponse:
    tipo_documento, identificacion = _authenticated_identity(request)
    return push_token_service.register(
        db,
        expo_push_token=dispositivo.expo_push_token,
        plataforma=dispositivo.plataforma,
        tipo_documento=tipo_documento,
        identificacion=identificacion,
    )


@router.delete(
    "/push-tokens",
    summary="Desactivar dispositivo al cerrar sesión",
    response_model=PushTokenDeactivationResponse,
    responses={
        401: {"description": "Token de acceso inválido."},
        503: {"description": "No se pudo desactivar el dispositivo."},
    },
)
def desactivar_push_token(
    request: Request,
    dispositivo: PushTokenDeactivationRequest,
    db: Session = Depends(get_db),
) -> PushTokenDeactivationResponse:
    tipo_documento, identificacion = _authenticated_identity(request)
    return push_token_service.deactivate(
        db,
        expo_push_token=dispositivo.expo_push_token,
        tipo_documento=tipo_documento,
        identificacion=identificacion,
    )


def _authenticated_identity(request: Request) -> tuple[str, str]:
    token_payload: dict[str, Any] = request.state.token_payload
    tipo_documento = token_payload.get("TipoDocumento")
    identificacion = token_payload.get("Identificacion")
    if not isinstance(tipo_documento, str) or not isinstance(
        identificacion, str
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="El token no contiene una identidad válida.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return tipo_documento, identificacion
