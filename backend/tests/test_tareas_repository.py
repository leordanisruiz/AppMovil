import unittest
from typing import Any, cast
from unittest.mock import Mock

from sqlalchemy.orm import Session

from app.repositories import tareas_repository
from app.repositories.tareas_repository import TareasRepository


class TareasRepositoryTests(unittest.TestCase):
    def test_operator_search_casts_searchable_identifiers_to_text(self) -> None:
        expected_rows: list[dict[str, Any]] = [
            {"codigo": "809772", "identificacion": "809772"},
        ]
        result = Mock()
        result.mappings.return_value.all.return_value = expected_rows
        db = Mock()
        db.execute.return_value = result
        repository = TareasRepository()

        rows = repository.search_operators(
            cast(Session, db),
            search="809772",
        )

        self.assertEqual(rows, expected_rows)
        statement, parameters = db.execute.call_args.args
        sql = str(statement)
        self.assertIn(
            'de."Identificacion"::text AS identificacion',
            sql,
        )
        self.assertIn('de."Codigo"::text ILIKE :termino', sql)
        self.assertIn('de."Identificacion"::text ILIKE :termino', sql)
        self.assertEqual(parameters, {"termino": "%809772%"})

    def test_operator_lookups_return_identification_as_text(self) -> None:
        db = Mock()
        repository = TareasRepository()

        repository.get_operator_by_code(
            cast(Session, db),
            codigo_operador=809772,
        )

        statement, parameters = db.execute.call_args.args
        self.assertIn('de."Codigo"::text = :codigo_operador', str(statement))
        self.assertIn(
            'de."Identificacion"::text AS identificacion',
            str(statement),
        )
        self.assertEqual(parameters, {"codigo_operador": "809772"})

    def test_novelty_lookup_returns_identification_as_text(self) -> None:
        db = Mock()
        repository = TareasRepository()

        repository.get_novelty(
            cast(Session, db),
            novedad_id=17,
        )

        statement, parameters = db.execute.call_args.args
        self.assertIn(
            'de."Identificacion"::text AS identificacion',
            str(statement),
        )
        self.assertEqual(parameters, {"novedad_id": 17})

    def test_novelty_lookup_joins_operator_codes_as_text(self) -> None:
        self.assertIn(
            'de."Codigo" = fns."Codigo"::text',
            str(tareas_repository._NOVELTY_BY_ID),
        )

    def test_task_notification_enqueue_compares_employee_and_device_text(self) -> None:
        statement = str(tareas_repository._ENQUEUE_TASK_NOTIFICATIONS)

        self.assertIn(
            'employee."Identificacion"::text = device.identificacion',
            statement,
        )
        self.assertIn(
            'employee."Codigo" = CAST(:operador_id AS text)',
            statement,
        )


if __name__ == "__main__":
    unittest.main()
