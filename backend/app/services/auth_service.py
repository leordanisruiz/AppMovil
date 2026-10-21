import logging
from collections.abc import Mapping
from typing import Any, NoReturn

from fastapi import HTTPException, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_access_token, verify_password
from app.repositories.operador_repository import OperadorRepository
from app.repositories.usuario_app_repository import UsuarioAppRepository
from app.schemas.auth import EmployeeProfile, LoginResponse

logger = logging.getLogger(__name__)


class AuthService:
    def __init__(
        self,
        operador_repository: OperadorRepository,
        usuario_app_repository: UsuarioAppRepository | None = None,
    ) -> None:
        self._operador_repository = operador_repository
        self._usuario_app_repository = usuario_app_repository or UsuarioAppRepository()

    def login(
        self,
        db: Session,
        *,
        identificacion: str,
        password: str,
    ) -> LoginResponse:
        role_id: int | None = None
        try:
            employee_record = self._operador_repository.get_by_identification(
                db,
                identificacion=identificacion,
            )
            if employee_record is not None:
                if employee_has_operator_code(employee_record):
                    if str(employee_record["Codigo"]).strip() != password:
                        employee_record = None
                else:
                    authenticated = self._authenticate_administrative_user(
                        db,
                        employee_record=employee_record,
                        identificacion=identificacion,
                        password=password,
                    )
                    if authenticated is None:
                        employee_record = None
                    else:
                        employee_record, role_id = authenticated
        except SQLAlchemyError as exc:
            self._raise_database_unavailable(exc)

        if employee_record is None:
            logger.warning("Login rejected: credentials did not match an employee.")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Credenciales incorrectas.",
                headers={"WWW-Authenticate": "Bearer"},
            )

        employee = _build_employee_profile(employee_record, role_id=role_id)
        if employee.EstadoEmpleado != "A":
            logger.warning("Login rejected: employee is inactive in Kactus.")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="El empleado no está activo en Kactus.",
            )

        settings = get_settings()
        access_token = create_access_token(
            subject=employee.Identificacion,
            document_type=employee.TipoDocumento,
            identification=employee.Identificacion,
        )
        logger.info("Login succeeded.")
        return LoginResponse(
            access_token=access_token,
            expires_in=settings.access_token_expire_minutes * 60,
            empleado=employee,
        )

    def _authenticate_administrative_user(
        self,
        db: Session,
        *,
        employee_record: Mapping[str, Any],
        identificacion: str,
        password: str,
    ) -> tuple[Mapping[str, Any], int | None] | None:
        usuario = self._usuario_app_repository.get_by_identity(
            db,
            tipo_documento=str(employee_record["TipoDocumento"]),
            identificacion=identificacion,
        )

        if usuario is None or not verify_password(password, usuario.password_hash):
            return None
        return employee_record, usuario.rol_id

    @staticmethod
    def _raise_database_unavailable(exc: SQLAlchemyError) -> NoReturn:
        logger.error(
            "Authentication database operation failed (%s).",
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No se pudo consultar la base de datos en este momento.",
        ) from None


def _build_employee_profile(
    employee_record: Mapping[str, Any],
    *,
    role_id: int | None = None,
) -> EmployeeProfile:
    return EmployeeProfile(
        Codigo=(
            str(employee_record["Codigo"])
            if employee_record["Codigo"] is not None
            else None
        ),
        TipoDocumento=str(employee_record["TipoDocumento"]),
        Identificacion=str(employee_record["Identificacion"]),
        NombreCompleto=employee_record["NombreCompleto"],
        FechaIngreso=employee_record["FechaIngreso"],
        Cargo=employee_record["Cargo"],
        EstadoEmpleado=str(employee_record["EstadoEmpleado"]),
        RolId=role_id,
    )


def employee_has_operator_code(employee_record: Mapping[str, Any]) -> bool:
    codigo = employee_record["Codigo"]
    return codigo is not None and bool(str(codigo).strip())


auth_service = AuthService(OperadorRepository())
