import unittest
from datetime import timedelta
from unittest.mock import patch

from fastapi import HTTPException

from app.core.config import Settings
from app.core.security import create_access_token, decode_access_token


class SecurityTests(unittest.TestCase):
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
            "app.core.security.get_settings",
            return_value=self.settings,
        )
        self.settings_patcher.start()
        self.addCleanup(self.settings_patcher.stop)

    def test_access_token_round_trip(self) -> None:
        token = create_access_token(
            "5843452",
            "CC",
            "5843452",
        )
        payload = decode_access_token(token)

        self.assertEqual(payload["sub"], "5843452")
        self.assertEqual(payload["TipoDocumento"], "CC")
        self.assertEqual(payload["Identificacion"], "5843452")
        self.assertNotIn("Codigo", payload)
        self.assertIn("exp", payload)
        self.assertIn("iat", payload)

    def test_expired_token_is_rejected(self) -> None:
        token = create_access_token(
            "5843452",
            "CC",
            "5843452",
            expires_delta=timedelta(seconds=-1),
        )

        with self.assertRaises(HTTPException) as context:
            decode_access_token(token)

        self.assertEqual(context.exception.status_code, 401)

    def test_token_creation_requires_a_secret(self) -> None:
        settings_without_secret = Settings(
            app_name=self.settings.app_name,
            environment=self.settings.environment,
            api_v1_prefix=self.settings.api_v1_prefix,
            database_url=self.settings.database_url,
            jwt_secret_key=None,
            jwt_algorithm=self.settings.jwt_algorithm,
            access_token_expire_minutes=self.settings.access_token_expire_minutes,
        )

        with patch(
            "app.core.security.get_settings",
            return_value=settings_without_secret,
        ):
            with self.assertRaises(HTTPException) as context:
                create_access_token("5843452", "CC", "5843452")

        self.assertEqual(context.exception.status_code, 503)

    def test_token_creation_rejects_short_secret(self) -> None:
        settings_with_short_secret = Settings(
            app_name=self.settings.app_name,
            environment=self.settings.environment,
            api_v1_prefix=self.settings.api_v1_prefix,
            database_url=self.settings.database_url,
            jwt_secret_key="too-short",
            jwt_algorithm=self.settings.jwt_algorithm,
            access_token_expire_minutes=self.settings.access_token_expire_minutes,
        )

        with patch(
            "app.core.security.get_settings",
            return_value=settings_with_short_secret,
        ):
            with self.assertRaises(HTTPException) as context:
                create_access_token("5843452", "CC", "5843452")

        self.assertEqual(context.exception.status_code, 503)


if __name__ == "__main__":
    unittest.main()
