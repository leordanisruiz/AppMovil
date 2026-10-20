import unittest
from typing import cast
from unittest.mock import Mock, patch

from cryptography.fernet import Fernet
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.services.push_token_service import PushTokenService


class PushTokenServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.operator_repository = Mock()
        self.token_repository = Mock()
        self.service = PushTokenService(
            self.token_repository,
            self.operator_repository,
        )
        self.db = cast(Session, Mock())
        self.token = "ExpoPushToken[device-token_123456789]"
        self.settings = Mock(
            expo_push_token_encryption_key=Fernet.generate_key().decode(
                "ascii"
            )
        )

    def test_registers_encrypted_token_for_jwt_operator_identity(self) -> None:
        self.operator_repository.get_by_identity.return_value = {
            "Codigo": 809772,
            "EstadoEmpleado": "A",
        }

        with patch(
            "app.services.push_token_service.get_settings",
            return_value=self.settings,
        ):
            response = self.service.register(
                self.db,
                expo_push_token=self.token,
                plataforma="ios",
                tipo_documento="CC",
                identificacion="123456",
            )

        self.assertTrue(response.registrado)
        self.operator_repository.get_by_identity.assert_called_once_with(
            self.db,
            tipo_documento="CC",
            identificacion="123456",
        )
        kwargs = self.token_repository.register.call_args.kwargs
        self.assertNotEqual(kwargs["token_ciphertext"], self.token)
        decrypted_token = Fernet(
            self.settings.expo_push_token_encryption_key.encode("ascii")
        ).decrypt(kwargs["token_ciphertext"].encode("ascii"))
        self.assertEqual(decrypted_token.decode("utf-8"), self.token)
        self.assertEqual(kwargs["plataforma"], "ios")
        self.assertEqual(kwargs["tipo_documento"], "CC")
        self.assertEqual(kwargs["identificacion"], "123456")

    def test_rejects_administrative_profile_without_operator_code(self) -> None:
        self.operator_repository.get_by_identity.return_value = {
            "Codigo": None,
            "EstadoEmpleado": "A",
        }

        with (
            patch(
                "app.services.push_token_service.get_settings",
                return_value=self.settings,
            ),
            self.assertRaises(HTTPException) as context,
        ):
            self.service.register(
                self.db,
                expo_push_token=self.token,
                plataforma="android",
                tipo_documento="CC",
                identificacion="123456",
            )

        self.assertEqual(context.exception.status_code, 403)
        self.token_repository.register.assert_not_called()

    def test_rejects_inactive_or_invalid_operator(self) -> None:
        for operator in (
            {"Codigo": 809772, "EstadoEmpleado": "I"},
            {"Codigo": 0, "EstadoEmpleado": "A"},
            None,
        ):
            with self.subTest(operator=operator):
                self.operator_repository.get_by_identity.return_value = (
                    operator
                )
                with (
                    patch(
                        "app.services.push_token_service.get_settings",
                        return_value=self.settings,
                    ),
                    self.assertRaises(HTTPException),
                ):
                    self.service.register(
                        self.db,
                        expo_push_token=self.token,
                        plataforma="android",
                        tipo_documento="CC",
                        identificacion="123456",
                    )

        self.token_repository.register.assert_not_called()

    def test_deactivates_token_scoped_to_authenticated_identity(self) -> None:
        self.token_repository.deactivate.return_value = True

        response = self.service.deactivate(
            self.db,
            expo_push_token=self.token,
            tipo_documento="CC",
            identificacion="123456",
        )

        self.assertTrue(response.desactivado)
        kwargs = self.token_repository.deactivate.call_args.kwargs
        self.assertEqual(kwargs["tipo_documento"], "CC")
        self.assertEqual(kwargs["identificacion"], "123456")
        self.assertNotEqual(kwargs["token_hash"], self.token)


if __name__ == "__main__":
    unittest.main()
