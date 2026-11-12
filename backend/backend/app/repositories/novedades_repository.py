from collections.abc import Mapping
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

ICO_FILTER = """UPPER(fi."Area") NOT IN ('VEHICULOS', 'VEHÍCULOS')
      AND fi."TipoNovedad" <> 'I5025'"""
INASISTENCIAS_FILTER = """fns."Grupo" LIKE '%Inasistencia%'
      AND fns."Estado" IN ('PEOCESO', 'PROCESO')"""

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
    WHERE BTRIM(fns."Codigo"::text) = BTRIM(CAST(:codigo_operador AS text))
      AND (
          fns."Estado" IS NULL
          OR UPPER(BTRIM(fns."Estado")) IN ('PEOCESO', 'PROCESO')
      )
    ORDER BY fns."FechaIngreso" DESC NULLS LAST, fns."Id" DESC
    """
)

_INASISTENCIAS_BY_OPERATOR_CODE_QUERY = text(
    f"""
    SELECT fns."Id" AS "IdNovedad", fns."FechaIngreso" AS "FechaNovedad",
           fns."Codigo" AS "Codigo", fns."Novedad" AS "TipoNovedad",
           fns."Grupo" AS "Grupo", fns."Subgrupo" AS "Subgrupo",
           fns."Detalle" AS "Descripcion", fns."Estado" AS "Estado"
    FROM "DW_SUMA"."FactNovedadesSico" AS fns
    WHERE {INASISTENCIAS_FILTER}
      AND BTRIM(fns."Codigo"::text) = BTRIM(CAST(:codigo_operador AS text))
    ORDER BY fns."FechaIngreso" DESC NULLS LAST, fns."Id" DESC
    """
)

_ICO_BY_OPERATOR_CODE_QUERY = text(
    f"""
    SELECT fi."IdIco" AS "IdNovedad", fi."FechaViaje" AS "FechaNovedad",
           REPLACE(fi."IdSaeConductor"::text, '.0', '') AS "Codigo",
           fi."TipoNovedad" AS "TipoNovedad",
           NULL AS "Grupo", NULL AS "Subgrupo",
           REGEXP_REPLACE(fi."Descripcion", '(?i)/?reportado por.*$', '') AS "Descripcion",
           NULL AS "Estado"
    FROM "DW_SUMA"."FactICO" AS fi
    WHERE {ICO_FILTER}
      AND REPLACE(fi."IdSaeConductor"::text, '.0', '') = CAST(:codigo_operador AS text)
    ORDER BY fi."FechaViaje" DESC NULLS LAST, fi."IdIco" DESC
    """
)


class NovedadesRepository:
    def list_by_category(
        self, db: Session, *, codigo_operador: int, categoria: str
    ) -> list[Mapping[str, Any]]:
        query = {
            "ico": _ICO_BY_OPERATOR_CODE_QUERY,
            "inasistencias": _INASISTENCIAS_BY_OPERATOR_CODE_QUERY,
        }[categoria]
        return list(db.execute(query, {"codigo_operador": codigo_operador}).mappings().all())

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
