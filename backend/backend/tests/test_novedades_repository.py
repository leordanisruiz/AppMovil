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
        self.assertIn(
            'BTRIM(fns."Codigo"::text) = BTRIM(CAST(:codigo_operador AS text))',
            sql,
        )
        self.assertIn('fns."Estado" IS NULL', sql)
        self.assertIn(
            "UPPER(BTRIM(fns.\"Estado\")) IN ('PEOCESO', 'PROCESO')",
            sql,
        )
        self.assertEqual(parameters, {"codigo_operador": 809772})

    def test_category_queries_bind_operator_and_apply_required_filters(self) -> None:
        db = Mock()
        db.execute.return_value.mappings.return_value.all.return_value = []
        repository = NovedadesRepository()
        repository.list_by_category(cast(Session, db), codigo_operador=810539, categoria="ico")
        statement, parameters = db.execute.call_args.args
        sql = str(statement)
        self.assertIn('"DW_SUMA"."FactICO"', sql)
        self.assertIn("NOT IN ('VEHICULOS', 'VEHÍCULOS')", sql)
        self.assertIn("fi.\"TipoNovedad\" <> 'I5025'", sql)
        self.assertIn("REGEXP_REPLACE", sql)
        self.assertEqual(parameters, {"codigo_operador": 810539})

        repository.list_by_category(cast(Session, db), codigo_operador=807277, categoria="inasistencias")
        statement, parameters = db.execute.call_args.args
        sql = str(statement)
        self.assertIn('"DW_SUMA"."FactNovedadesSico"', sql)
        self.assertIn('fns."Grupo" LIKE \'%Inasistencia%\'', sql)
        self.assertIn('fns."Estado" IN (\'PEOCESO\', \'PROCESO\')', sql)
        self.assertEqual(parameters, {"codigo_operador": 807277})


if __name__ == "__main__":
    unittest.main()
