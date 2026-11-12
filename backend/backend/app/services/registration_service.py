import logging
from collections.abc import Mapping
from typing import Any, NoReturn

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models.usuario_app import UsuarioApp
from app.repositories.operador_repository import OperadorRepository
from app.repositories.usuario_app_repository import UsuarioAppRepository
from app.schemas.auth import (
    PasswordRegistrationResponse,
    RegistrationIdentity,
    RegistrationValidationResponse,
)
from app.services.auth_service import employee_has_operator_code

logger = logging.getLogger(__name__)


def _role_id_from_classification(employee: Mapping[str, Any]) -> int:
    classification = str(employee.get("Clasificacion") or "").strip().upper()
    return 1 if classification in {"ADMINISTRATIVO", "ADMINISTRATIVA"} else 2


def _registration_user_type(role_id: int) -> str:
    return "ADMINISTRATIVO" if role_id == 1 else "OPERADOR"


class RegistrationService:
    def __init__(
        self,
        operador_repository: OperadorRepository,
        usuario_app_repository: UsuarioAppRepository,
    ) -> None:
        self._operador_repository = operador_repository
        self._usuario_app_repository = usuario_app_repository

    def validate_identity(
        self,
        db: Session,
        identity: RegistrationIdentity,
    ) -> RegistrationValidationResponse:
        employee = self._get_active_employee(db, identity)
        if employee_has_operator_code(employee):
            return RegistrationValidationResponse(
                pertenece_suma=True,
                puede_registrar=False,
                tipo_usuario="OPERADOR",
                nombre_completo=employee["NombreCompleto"],
                mensaje=(
                    "No puede crear una contraseña: su contraseña de operador "
                    "es el código asignado en Kactus."
                ),
            )

        role_id = _role_id_from_classification(employee)
        usuario = self._get_registered_user(db, identity)
        if usuario is not None:
            return RegistrationValidationResponse(
                pertenece_suma=True,
                puede_registrar=False,
                tipo_usuario=_registration_user_type(role_id),
                nombre_completo=employee["NombreCompleto"],
                mensaje="El usuario ya tiene una contraseña registrada.",
            )

        return RegistrationValidationResponse(
            pertenece_suma=True,
            puede_registrar=True,
            tipo_usuario=_registration_user_type(role_id),
            nombre_completo=employee["NombreCompleto"],
            mensaje="Identidad validada; puede registrar una contraseña.",
        )

    def register_password(
        self,
        db: Session,
        identity: RegistrationIdentity,
        password: str,
    ) -> PasswordRegistrationResponse:
        employee = self._get_active_employee(db, identity)
        if employee_has_operator_code(employee):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "No puede crear una contraseña: su contraseña de operador "
                    "es el código asignado en Kactus."
                ),
            )

        if self._get_registered_user(db, identity) is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="El usuario ya tiene una contraseña registrada.",
            )

        password_hash = hash_password(password)
        role_id = _role_id_from_classification(employee)
        try:
            usuario = self._usuario_app_repository.create(
                db,
                tipo_documento=identity.tipo_documento,
                identificacion=identity.identificacion,
                password_hash=password_hash,
                rol_id=role_id,
            )
        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="El usuario ya tiene una contraseña registrada.",
            ) from None
        except SQLAlchemyError as exc:
            db.rollback()
            logger.error(
                "Password registration database operation failed (%s).",
                type(exc).__name__,
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No se pudo registrar la contraseña en este momento.",
            ) from None

        logger.info("User password registered with role_id=%s.", role_id)
        return PasswordRegistrationResponse(
            mensaje="Contraseña registrada correctamente.",
            fecha_creacion=usuario.fecha_creacion,
        )

    def _get_active_employee(
        self,
        db: Session,
        identity: RegistrationIdentity,
    ) -> Mapping[str, Any]:
        try:
            employee = self._operador_repository.get_by_identity(
                db,
                tipo_documento=identity.tipo_documento,
                identificacion=identity.identificacion,
            )
        except SQLAlchemyError as exc:
            self._raise_lookup_error(exc)

        if employee is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No se encontró un usuario con esos datos en SUMA.",
            )
        if employee["EstadoEmpleado"] != "A":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="El usuario no está activo en SUMA.",
            )
        return employee

    def _get_registered_user(
        self,
        db: Session,
        identity: RegistrationIdentity,
    ) -> UsuarioApp | None:
        try:
            return self._usuario_app_repository.get_by_identity(
                db,
                tipo_documento=identity.tipo_documento,
                identificacion=identity.identificacion,
            )
        except SQLAlchemyError as exc:
            self._raise_lookup_error(exc)

    @staticmethod
    def _raise_lookup_error(exc: SQLAlchemyError) -> NoReturn:
        logger.error(
            "Registration lookup failed (%s).",
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No se pudo validar el usuario en este momento.",
        ) from None


registration_service = RegistrationService(
    OperadorRepository(),
    UsuarioAppRepository(),
)
