import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from sqlalchemy.exc import OperationalError

from app import main


class DatabaseHealthTests(unittest.TestCase):
    def test_reports_database_connected_after_select_one(self) -> None:
        connection = MagicMock()
        connection.execute.return_value.scalar_one.return_value = 1
        engine = MagicMock()
        engine.connect.return_value.__enter__.return_value = connection

        with patch.object(main.database, "engine", engine):
            response = main.database_health_check()

        self.assertEqual(response, {"status": "ok", "database": "connected"})
        connection.execute.assert_called_once()

    def test_reports_unavailable_database_without_driver_details(self) -> None:
        engine = MagicMock()
        engine.connect.side_effect = OperationalError(
            "connection",
            {},
            RuntimeError("private host detail"),
        )

        with patch.object(main.database, "engine", engine):
            with self.assertRaises(HTTPException) as context:
                main.database_health_check()

        self.assertEqual(context.exception.status_code, 503)
        self.assertEqual(
            context.exception.detail,
            "No se pudo conectar a la base de datos configurada.",
        )
        self.assertNotIn("private host detail", context.exception.detail)

    def test_reports_unconfigured_database(self) -> None:
        with patch.object(main.database, "engine", None):
            with self.assertRaises(HTTPException) as context:
                main.database_health_check()

        self.assertEqual(context.exception.status_code, 503)
        self.assertEqual(
            context.exception.detail,
            "DATABASE_URL no está configurada.",
        )


if __name__ == "__main__":
    unittest.main()
