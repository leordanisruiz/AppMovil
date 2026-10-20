import hashlib
import logging
from collections.abc import Mapping
from typing import Any
from typing import NoReturn

from cryptography.fernet import Fernet
from fastapi import HTTPException, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.repositories.operador_repository import OperadorRepository
from app.repositories.push_token_repository import PushTokenRepository
from app.schemas.novedad import (
    PushTokenDeactivationResponse,
    PushTokenResponse,
)

logger = logging.getLogger(__name__)


class PushTokenService:
    def __init__(
        self,
        token_repository: PushTokenRepository,
        operator_repository: OperadorRepository,
    ) -> None:
        self._token_repository = token_repository
        self._operator_repository = operator_repository

    def register(
        self,
        db: Session,
        *,
        expo_push_token: str,
        plataforma: str,
        tipo_documento: str,
        identificacion: str,
    ) -> PushTokenResponse:
        try:
            employee = self._operator_repository.get_by_identity(
                db,
                tipo_documento=tipo_documento,
                identificacion=identificacion,
            )
            if not _is_active_operator(employee):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=(
                        "Solo los operadores activos pueden registrar "
                        "notificaciones de novedades."
                    ),
                )

            fernet = _get_fernet()
            self._token_repository.register(
                db,
                token_hash=_hash_token(expo_push_token),
                token_ciphertext=fernet.encrypt(
                    expo_push_token.encode("utf-8")
                ).decode("ascii"),
                tipo_documento=tipo_documento,
                identificacion=identificacion,
                plataforma=plataforma,
            )
        except SQLAlchemyError as exc:
            db.rollback()
            self._raise_database_unavailable(exc)

        logger.info("Expo push token registered for an operator.")
        return PushTokenResponse(registrado=True)

    def deactivate(
        self,
        db: Session,
        *,
        expo_push_token: str,
        tipo_documento: str,
        identificacion: str,
    ) -> PushTokenDeactivationResponse:
        try:
            deactivated = self._token_repository.deactivate(
                db,
                token_hash=_hash_token(expo_push_token),
                tipo_documento=tipo_documento,
                identificacion=identificacion,
            )
        except SQLAlchemyError as exc:
            db.rollback()
            self._raise_database_unavailable(exc)

        logger.info("Expo push token deactivation requested.")
        return PushTokenDeactivationResponse(desactivado=deactivated)

    @staticmethod
    def _raise_database_unavailable(exc: SQLAlchemyError) -> NoReturn:
        logger.error(
            "Push token database operation failed (%s).",
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No se pudo guardar el dispositivo en este momento.",
        ) from None


def _is_active_operator(
    employee: Mapping[str, Any] | None,
) -> bool:
    if not employee:
        return False

    try:
        code_text = str(employee["Codigo"]).strip()
        status_value = employee["EstadoEmpleado"]
        if not code_text.isascii() or not code_text.isdecimal():
            return False
        normalized_code = int(code_text)
    except (KeyError, TypeError, ValueError):
        return False
    return normalized_code > 0 and status_value == "A"


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _get_fernet() -> Fernet:
    key = get_settings().expo_push_token_encryption_key
    if not key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="El registro de notificaciones push no está configurado.",
        )
    try:
        return Fernet(key.encode("ascii"))
    except (ValueError, UnicodeEncodeError):
        logger.error("Expo push token encryption key is invalid.")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="El registro de notificaciones push no está disponible.",
        ) from None


push_token_service = PushTokenService(
    PushTokenRepository(),
    OperadorRepository(),
)
