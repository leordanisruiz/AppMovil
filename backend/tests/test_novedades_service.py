import unittest
from typing import cast
from unittest.mock import Mock

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.services.novedades_service import NovedadesService


class NovedadesServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.operator_repository = Mock()
        self.novelties_repository = Mock()
        self.service = NovedadesService(
            self.novelties_repository,
            self.operator_repository,
        )
        self.db = cast(Session, Mock())

    def test_returns_novelties_and_total_for_authenticated_operator(self) -> None:
        self.operator_repository.get_by_identity.return_value = {
            "Codigo": "809772"
        }
        self.novelties_repository.list_by_operator_code.return_value = [
            {
                "IdNovedad": 123,
                "FechaNovedad": None,
                "Codigo": "809772",
                "TipoNovedad": "OPERATIVA",
                "Descripcion": "Descripción",
                "Estado": "PROCESO",
            }
        ]

        response = self.service.consultar(
            self.db,
            codigo_operador="809772",
            tipo_documento="CC",
            identificacion="123456",
        )

        self.assertEqual(response.total, 1)
        self.assertEqual(len(response.novedades), 1)
        self.assertEqual(response.novedades[0].Codigo, 809772)
        self.novelties_repository.list_by_operator_code.assert_called_once_with(
            self.db,
            codigo_operador=809772,
        )

    def test_returns_empty_list_and_zero_total_when_no_novelties(self) -> None:
        self.operator_repository.get_by_identity.return_value = {
            "Codigo": "809772"
        }
        self.novelties_repository.list_by_operator_code.return_value = []

        response = self.service.consultar(
            self.db,
            codigo_operador="809772",
            tipo_documento="CC",
            identificacion="123456",
        )

        self.assertEqual(response.total, 0)
        self.assertEqual(response.novedades, [])

    def test_rejects_code_that_does_not_belong_to_authenticated_user(self) -> None:
        self.operator_repository.get_by_identity.return_value = {
            "Codigo": "809773"
        }

        with self.assertRaises(HTTPException) as context:
            self.service.consultar(
                self.db,
                codigo_operador="809772",
                tipo_documento="CC",
                identificacion="123456",
            )

        self.assertEqual(context.exception.status_code, 403)
        self.novelties_repository.list_by_operator_code.assert_not_called()

    def test_rejects_administrative_user_without_operator_code(self) -> None:
        self.operator_repository.get_by_identity.return_value = {
            "Codigo": None
        }

        with self.assertRaises(HTTPException) as context:
            self.service.consultar(
                self.db,
                codigo_operador="809772",
                tipo_documento="CC",
                identificacion="123456",
            )

        self.assertEqual(context.exception.status_code, 403)
        self.novelties_repository.list_by_operator_code.assert_not_called()


if __name__ == "__main__":
    unittest.main()
