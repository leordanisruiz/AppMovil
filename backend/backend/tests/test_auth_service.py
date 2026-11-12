import unittest
from datetime import date
from typing import Any
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security import decode_access_token, hash_password
from app.models.usuario_app import UsuarioApp
from app.repositories.operador_repository import OperadorRepository
from app.repositories.usuario_app_repository import UsuarioAppRepository
from app.schemas.auth import LoginRequest
from app.services.auth_service import AuthService

_EMPLOYEE = {
    "Codigo": "800010",
    "TipoDocumento": "CC",
    "Identificacion": "5843452",
    "NombreCompleto": "Nombre Apellido",
    "FechaIngreso": date(2020, 1, 2),
    "Cargo": "Operador",
    "EstadoEmpleado": "A",
}


class StubOperadorRepository(OperadorRepository):
    def __init__(
        self,
        record: dict[str, Any] | None = _EMPLOYEE,
        error: Exception | None = None,
    ) -> None:
        self.record = record
        self.error = error
        self.last_identification: str | None = None

    def get_by_identification(
        self,
        db: Session,
        *,
        identificacion: str,
    ) -> dict[str, Any] | None:
        del db
        self.last_identification = identificacion
        if self.error is not None:
            raise self.error
        if self.record is not None and self.record["Identificacion"] == identificacion:
            return self.record
        return None

    def get_by_identity(
        self,
        db: Session,
        *,
        tipo_documento: str,
        identificacion: str,
    ) -> dict[str, Any] | None:
        del db, tipo_documento, identificacion
        return None


class AdministrativeOperadorRepository(StubOperadorRepository):
    def get_by_identification(
        self,
        db: Session,
        *,
        identificacion: str,
    ) -> dict[str, Any]:
        del db
        self.last_identification = identificacion
        return {**_EMPLOYEE, "Codigo": None}


class StubUsuarioAppRepository(UsuarioAppRepository):
    def __init__(self, password_hash: str) -> None:
        self.usuario = UsuarioApp(
            tipo_documento="CC",
            identificacion="5843452",
            password_hash=password_hash,
        )

    def get_by_identity(
        self,
        db: Session,
        *,
        tipo_documento: str,
        identificacion: str,
    ) -> UsuarioApp:
        del db, tipo_documento, identificacion
        return self.usuario


class AuthServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.settings = Settings(
            app_name="Test API",
            environment="test",
            api_v1_prefix="/api/v1",
            database_url=None,
            jwt_secret_key="test-secret-key-with-at-least-32-bytes",
            jwt_algorithm="HS256",
            access_token_expire_minutes=30,
        )
        self.settings_patcher = patch(
            "app.services.auth_service.get_settings",
            return_value=self.settings,
        )
        self.security_settings_patcher = patch(
            "app.core.security.get_settings",
            return_value=self.settings,
        )
        self.settings_patcher.start()
        self.security_settings_patcher.start()
        self.addCleanup(self.settings_patcher.stop)
        self.addCleanup(self.security_settings_patcher.stop)
        self.db = Session()

    def test_active_employee_receives_profile_and_safe_jwt(self) -> None:
        repository = StubOperadorRepository()
        service = AuthService(repository)

        response = service.login(
            self.db,
            identificacion="5843452",
            password="800010",
        )

        self.assertEqual(response.empleado.Codigo, "800010")
        self.assertEqual(repository.last_identification, "5843452")
        self.assertEqual(response.empleado.NombreCompleto, "Nombre Apellido")
        self.assertEqual(response.empleado.EstadoEmpleado, "A")
        self.assertEqual(response.expires_in, 1800)
        payload = decode_access_token(response.access_token)
        self.assertEqual(payload["sub"], "5843452")
        self.assertEqual(payload["TipoDocumento"], "CC")
        self.assertEqual(payload["Identificacion"], "5843452")
        self.assertNotIn("Codigo", payload)

    def test_administrative_user_can_login_with_hashed_password(self) -> None:
        repository = AdministrativeOperadorRepository()
        usuario_repository = StubUsuarioAppRepository(hash_password("12345678"))
        usuario_repository.usuario.rol_id = 2
        service = AuthService(repository, usuario_repository)

        response = service.login(
            self.db,
            identificacion="5843452",
            password="12345678",
        )

        self.assertIsNone(response.empleado.Codigo)
        self.assertEqual(response.empleado.Identificacion, "5843452")
        self.assertEqual(response.empleado.RolId, 2)

    def test_unknown_credentials_return_generic_unauthorized(self) -> None:
        service = AuthService(StubOperadorRepository(record=None))

        with self.assertLogs("app.services.auth_service", level="WARNING") as logs:
            with self.assertRaises(HTTPException) as context:
                service.login(
                    self.db,
                    identificacion="private-identification",
                    password="private-code",
                )

        self.assertEqual(context.exception.status_code, 401)
        self.assertEqual(context.exception.detail, "Credenciales incorrectas.")
        self.assertIn("Login rejected", "\n".join(logs.output))
        self.assertNotIn("private-code", "\n".join(logs.output))
        self.assertNotIn("private-identification", "\n".join(logs.output))

    def test_operator_code_must_match_password(self) -> None:
        service = AuthService(StubOperadorRepository())

        with self.assertRaises(HTTPException) as context:
            service.login(
                self.db,
                identificacion="5843452",
                password="wrong-code",
            )

        self.assertEqual(context.exception.status_code, 401)

    def test_inactive_employee_is_forbidden(self) -> None:
        inactive_record = {**_EMPLOYEE, "EstadoEmpleado": "I"}
        service = AuthService(StubOperadorRepository(record=inactive_record))

        with patch("app.services.auth_service.create_access_token") as create_token:
            with self.assertRaises(HTTPException) as context:
                service.login(
                    self.db,
                    identificacion="5843452",
                    password="800010",
                )

        self.assertEqual(context.exception.status_code, 403)
        create_token.assert_not_called()

    def test_activity_indicator_must_be_exactly_active(self) -> None:
        inactive_record = {**_EMPLOYEE, "EstadoEmpleado": "a"}
        service = AuthService(StubOperadorRepository(record=inactive_record))

        with self.assertRaises(HTTPException) as context:
            service.login(
                self.db,
                identificacion="5843452",
                password="800010",
            )

        self.assertEqual(context.exception.status_code, 403)

    def test_database_errors_do_not_log_credentials(self) -> None:
        database_error = OperationalError(
            "SELECT ...",
            {"codigo": "sensitive-code"},
            RuntimeError("database unavailable"),
        )
        service = AuthService(StubOperadorRepository(error=database_error))

        with self.assertLogs("app.services.auth_service", level="ERROR") as logs:
            with self.assertRaises(HTTPException) as context:
                service.login(
                    self.db,
                    identificacion="5843452",
                    password="sensitive-code",
                )

        self.assertEqual(context.exception.status_code, 503)
        self.assertNotIn("sensitive-code", "\n".join(logs.output))

    def test_login_request_accepts_only_identification_and_password(self) -> None:
        request = LoginRequest(
            identificacion="1080017116",
            password="23099412",
        )
        self.assertEqual(request.identificacion, "1080017116")
        self.assertEqual(request.password, "23099412")


if __name__ == "__main__":
    unittest.main()
