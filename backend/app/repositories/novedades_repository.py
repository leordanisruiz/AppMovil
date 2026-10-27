from collections.abc import Mapping
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

_NOVEDADES_BY_OPERATOR_CODE_QUERY = text(
    """
    SELECT
        fns."Id" AS "IdNovedad",
        fns."FechaIngreso" AS "FechaNovedad",
        fns."Codigo" AS "Codigo",
        fns."Novedad" AS "TipoNovedad",
        fns."Grupo" AS "Grupo",
        fns."Subgrupo" AS "Subgrupo",
        fns."Detalle" AS "Descripcion",
        fns."Estado" AS "Estado"
    FROM "DW_SUMA"."FactNovedadesSico" AS fns
    WHERE fns."Codigo"::text = CAST(:codigo_operador AS text)
      AND (
          UPPER(fns."Estado") IS NULL
          OR fns."Estado" IN ('PEOCESO', 'PROCESO')
      )
    ORDER BY fns."FechaIngreso" DESC NULLS LAST, fns."Id" DESC
    """
)


class NovedadesRepository:
    def list_by_operator_code(
        self,
        db: Session,
        *,
        codigo_operador: int,
    ) -> list[Mapping[str, Any]]:
        result = db.execute(
            _NOVEDADES_BY_OPERATOR_CODE_QUERY,
            {"codigo_operador": codigo_operador},
        )
        return list(result.mappings().all())
