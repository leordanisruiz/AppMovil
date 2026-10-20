import unittest
from typing import Any
from typing import cast
from unittest.mock import Mock

from sqlalchemy.orm import Session

from app.repositories.novedades_repository import NovedadesRepository


class NovedadesRepositoryTests(unittest.TestCase):
    def test_lookup_uses_bound_operator_code_and_process_filter(self) -> None:
        expected_records: list[dict[str, Any]] = [
            {"IdNovedad": 123, "Codigo": "809772", "Estado": "PROCESO"}
        ]
        result = Mock()
        result.mappings.return_value.all.return_value = expected_records
        db = Mock()
        db.execute.return_value = result

        records = NovedadesRepository().list_by_operator_code(
            cast(Session, db),
            codigo_operador=809772,
        )

        self.assertEqual(records, expected_records)
        statement, parameters = db.execute.call_args.args
        sql = str(statement)
        self.assertIn('"DW_SUMA"."FactNovedadesSico"', sql)
        self.assertIn("fns.\"Codigo\" = :codigo_operador", sql)
        self.assertIn("UPPER(fns.\"Estado\") IS NULL", sql)
        self.assertIn(
            "fns.\"Estado\" IN ('PEOCESO', 'PROCESO')",
            sql,
        )
        self.assertEqual(parameters, {"codigo_operador": 809772})


if __name__ == "__main__":
    unittest.main()
