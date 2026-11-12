import unittest
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import UniqueConstraint
from sqlalchemy.orm import Session

from app.core.security import verify_password
from app.models.usuario_app import UsuarioApp
from app.repositories.operador_repository import OperadorRepository
from app.repositories.usuario_app_repository import UsuarioAppRepository
from app.schemas.auth import PasswordRegistrationRequest, RegistrationIdentity
from app.services.registration_service import RegistrationService

_EMPLOYEE = {
    "Codigo": None,
    "TipoDocumento": "CC",
    "Identificacion": "5843452",
    "NombreCompleto": "Nombre Apellido",
    "FechaIngreso": None,
    "Cargo": "Administrativo",
    "Clasificacion": "ADMINISTRATIVO",
    "EstadoEmpleado": "A",
}


class StubOperadorRepository(OperadorRepository):
    def __init__(self, employee: dict[str, Any] | None = _EMPLOYEE) -> None:
        self.employee = employee

    def get_by_identity(
        self,
        db: Session,
        *,
        tipo_documento: str,
        identificacion: str,
    ) -> dict[str, Any] | None:
        del db, tipo_documento, identificacion
        return self.employee


class StubUsuarioAppRepository(UsuarioAppRepository):
    def __init__(self) -> None:
        self.user: UsuarioApp | None = None

    def get_by_identity(
        self,
        db: Session,
        *,
        tipo_documento: str,
        identificacion: str,
    ) -> UsuarioApp | None:
        del db, tipo_documento, identificacion
        return self.user

    def create(
        self,
        db: Session,
        *,
        tipo_documento: str,
        identificacion: str,
        password_hash: str,
        rol_id: int,
    ) -> UsuarioApp:
        del db
        self.user = UsuarioApp(
            tipo_documento=tipo_documento,
            identificacion=identificacion,
            password_hash=password_hash,
            rol_id=rol_id,
            fecha_creacion=datetime.now(timezone.utc),
        )
        return self.user


class RegistrationServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.db = Session()
        self.identity = RegistrationIdentity(
            tipo_documento="CC",
            identificacion="5843452",
        )
        self.user_repository = StubUsuarioAppRepository()
        self.service = RegistrationService(
            StubOperadorRepository(),
            self.user_repository,
        )

    def test_active_administrative_user_can_register(self) -> None:
        result = self.service.validate_identity(self.db, self.identity)

        self.assertTrue(result.pertenece_suma)
        self.assertTrue(result.puede_registrar)
        self.assertEqual(result.tipo_usuario, "ADMINISTRATIVO")
        self.assertEqual(result.nombre_completo, "Nombre Apellido")

    def test_user_table_uses_dw_config_schema_and_identity_primary_key(self) -> None:
        table = UsuarioApp.__table__

        self.assertEqual(table.schema, "DW_CONFIG")
        self.assertEqual(table.primary_key.columns.keys(), ["id"])
        self.assertEqual(
            next(
                constraint.name
                for constraint in table.constraints
                if isinstance(constraint, UniqueConstraint)
            ),
            "uq_usuarios_app_documento_identificacion",
        )

    def test_operator_is_not_allowed_to_register_password(self) -> None:
        employee = {**_EMPLOYEE, "Codigo": "800010"}
        service = RegistrationService(
            StubOperadorRepository(employee),
            self.user_repository,
        )

        result = service.validate_identity(self.db, self.identity)
        self.assertFalse(result.puede_registrar)
        self.assertEqual(result.tipo_usuario, "OPERADOR")
        self.assertEqual(result.nombre_completo, "Nombre Apellido")

        with self.assertRaises(HTTPException) as context:
            service.register_password(self.db, self.identity, "12345678")

        self.assertEqual(context.exception.status_code, 409)
        self.assertIsNone(self.user_repository.user)

    def test_unrecognized_or_inactive_identity_is_rejected(self) -> None:
        missing_service = RegistrationService(
            StubOperadorRepository(None),
            self.user_repository,
        )
        with self.assertRaises(HTTPException) as missing:
            missing_service.validate_identity(self.db, self.identity)
        self.assertEqual(missing.exception.status_code, 404)

        inactive_service = RegistrationService(
            StubOperadorRepository({**_EMPLOYEE, "EstadoEmpleado": "I"}),
            self.user_repository,
        )
        with self.assertRaises(HTTPException) as inactive:
            inactive_service.validate_identity(self.db, self.identity)
        self.assertEqual(inactive.exception.status_code, 403)

    def test_password_is_hashed_and_duplicate_registration_is_rejected(self) -> None:
        response = self.service.register_password(
            self.db,
            self.identity,
            "12345678",
        )

        stored_user = self.user_repository.user
        self.assertIsNotNone(stored_user)
        self.assertNotEqual(stored_user.password_hash, "12345678")
        self.assertTrue(verify_password("12345678", stored_user.password_hash))
        self.assertEqual(response.mensaje, "Contraseña registrada correctamente.")
        self.assertEqual(response.fecha_creacion, stored_user.fecha_creacion)

        with self.assertRaises(HTTPException) as duplicate:
            self.service.register_password(self.db, self.identity, "87654321")
        self.assertEqual(duplicate.exception.status_code, 409)

    def test_registration_password_requires_exactly_eight_ascii_digits(self) -> None:
        for password in ("1234567", "123456789", "1234abcd", "１２３４５６７８"):
            with self.subTest(password=password):
                with self.assertRaises(ValidationError):
                    PasswordRegistrationRequest(
                        tipo_documento="CC",
                        identificacion="5843452",
                        password=password,
                    )

        valid = PasswordRegistrationRequest(
            tipo_documento="CC",
            identificacion="5843452",
            password="12345678",
        )
        self.assertEqual(valid.password, "12345678")


if __name__ == "__main__":
    unittest.main()
