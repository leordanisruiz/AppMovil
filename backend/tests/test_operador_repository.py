import unittest
from typing import Any
from typing import cast
from unittest.mock import Mock

from sqlalchemy.orm import Session

from app.repositories.operador_repository import OperadorRepository
from app.repositories.usuario_app_repository import UsuarioAppRepository


class OperadorRepositoryTests(unittest.TestCase):
    def test_login_lookup_uses_bound_identification(self) -> None:
        expected_record: dict[str, Any] = {"Codigo": "800010"}
        result = Mock()
        result.mappings.return_value.one_or_none.return_value = expected_record
        db = Mock()
        db.execute.return_value = result
        repository = OperadorRepository()

        record = repository.get_by_identification(
            cast(Session, db),
            identificacion="5843452",
        )

        self.assertIs(record, expected_record)
        statement, parameters = db.execute.call_args.args
        self.assertIn('"DW_SUMA"."DimEmpleados"', str(statement))
        self.assertIn("de.\"Identificacion\" = :identificacion", str(statement))
        self.assertEqual(parameters, {"identificacion": "5843452"})
        self.assertNotIn("5843452", str(statement))

    def test_registered_user_lookup_filters_by_unique_identity(self) -> None:
        expected_user = object()
        db = Mock()
        db.execute.return_value.scalar_one_or_none.return_value = expected_user
        repository = UsuarioAppRepository()

        user = repository.get_by_identity(
            cast(Session, db),
            tipo_documento="C",
            identificacion="1080017116",
        )

        self.assertIs(user, expected_user)
        statement = db.execute.call_args.args[0]
        self.assertIn('"DW_CONFIG".usuarios_app', str(statement))
        self.assertEqual(
            statement.compile().params,
            {"tipo_documento_1": "C", "identificacion_1": "1080017116"},
        )


if __name__ == "__main__":
    unittest.main()
