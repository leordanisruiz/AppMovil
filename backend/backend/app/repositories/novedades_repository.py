from collections.abc import Mapping
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

ICO_FILTER = """UPPER(fi."Area") NOT IN ('VEHICULOS', 'VEHÍCULOS')
      AND fi."TipoNovedad" <> 'I5025'"""
INASISTENCIAS_FILTER = """fns."Grupo" LIKE '%Inasistencia%'
      AND fns."Estado" IN ('PEOCESO', 'PROCESO')"""
DANOS_FILTER = """UPPER(fns."Grupo") ~ 'DA(Ñ|N|Ã)'
      AND fns."Estado" IN ('PEOCESO', 'PROCESO')"""
ISV_FILTER = """fns."Estado" IN ('PEOCESO', 'PROCESO')
      AND UPPER(fns."Novedad") ~ '(ACCIDENTE)'
      AND UPPER(fns."Grupo") !~ 'DA(Ñ|N|Ã)'"""

def _viewed_expression(category: str, id_expression: str) -> str:
    return f"""EXISTS (
        SELECT 1 FROM "DW_CONFIG".novedades_vistas AS viewed
        WHERE viewed.codigo_operador = CAST(:codigo_operador AS text)
          AND viewed.categoria = '{category}'
          AND viewed.id_novedad = {id_expression}
    )"""


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
           fns."Detalle" AS "Descripcion", fns."Estado" AS "Estado",
           {_viewed_expression("inasistencias", 'fns."Id"')} AS "Vista"
    FROM "DW_SUMA"."FactNovedadesSico" AS fns
    WHERE {INASISTENCIAS_FILTER}
      AND BTRIM(fns."Codigo"::text) = BTRIM(CAST(:codigo_operador AS text))
    ORDER BY fns."FechaIngreso" DESC NULLS LAST, fns."Id" DESC
    """
)

_DANOS_BY_OPERATOR_CODE_QUERY = text(
    f"""
    SELECT fns."Id" AS "IdNovedad", fns."FechaIngreso" AS "FechaNovedad",
           fns."Codigo" AS "Codigo", fns."Novedad" AS "TipoNovedad",
           fns."Grupo" AS "Grupo", fns."Subgrupo" AS "Subgrupo",
           fns."Detalle" AS "Descripcion", fns."Estado" AS "Estado",
           fns."Vehiculo"::text AS "Vehiculo", fns."Ruta"::text AS "Ruta",
           {_viewed_expression("danos", 'fns."Id"')} AS "Vista"
    FROM "DW_SUMA"."FactNovedadesSico" AS fns
    WHERE {DANOS_FILTER}
      AND BTRIM(fns."Codigo"::text) = BTRIM(CAST(:codigo_operador AS text))
    ORDER BY fns."FechaIngreso" DESC NULLS LAST, fns."Id" DESC
    """
)

_ISV_BY_OPERATOR_CODE_QUERY = text(
    f"""
    SELECT fns."Id" AS "IdNovedad", fns."FechaIngreso" AS "FechaNovedad",
           fns."Codigo" AS "Codigo", fns."Novedad" AS "TipoNovedad",
           fns."Grupo" AS "Grupo", fns."Subgrupo" AS "Subgrupo",
           fns."Detalle" AS "Descripcion", fns."Estado" AS "Estado",
           fns."Vehiculo"::text AS "Vehiculo", fns."Ruta"::text AS "Ruta",
           {_viewed_expression("isv", 'fns."Id"')} AS "Vista"
    FROM "DW_SUMA"."FactNovedadesSico" AS fns
    WHERE {ISV_FILTER}
      AND fns."Codigo" = CAST(:codigo_operador AS bigint)
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
           NULL AS "Estado", {_viewed_expression("ico", 'fi."IdIco"')} AS "Vista"
    FROM "DW_SUMA"."FactICO" AS fi
    WHERE {ICO_FILTER}
      AND REPLACE(fi."IdSaeConductor"::text, '.0', '') = CAST(:codigo_operador AS text)
    ORDER BY fi."FechaViaje" DESC NULLS LAST, fi."IdIco" DESC
    """
)

_MARK_VIEWED_QUERIES = {
    "ico": text(f"""
        INSERT INTO "DW_CONFIG".novedades_vistas (codigo_operador, categoria, id_novedad)
        SELECT DISTINCT CAST(:codigo_operador AS text), 'ico', fi."IdIco"
        FROM "DW_SUMA"."FactICO" AS fi
        WHERE {ICO_FILTER}
          AND REPLACE(fi."IdSaeConductor"::text, '.0', '') = CAST(:codigo_operador AS text)
          AND fi."IdIco" = :id_novedad
        ON CONFLICT (codigo_operador, categoria, id_novedad)
        DO UPDATE SET visto_en = CURRENT_TIMESTAMP
        RETURNING id_novedad
    """),
    **{
        category: text(f"""
            INSERT INTO "DW_CONFIG".novedades_vistas (codigo_operador, categoria, id_novedad)
            SELECT DISTINCT CAST(:codigo_operador AS text), '{category}', fns."Id"
            FROM "DW_SUMA"."FactNovedadesSico" AS fns
            WHERE {filter_sql}
              AND BTRIM(fns."Codigo"::text) = CAST(:codigo_operador AS text)
              AND fns."Id" = :id_novedad
            ON CONFLICT (codigo_operador, categoria, id_novedad)
            DO UPDATE SET visto_en = CURRENT_TIMESTAMP
            RETURNING id_novedad
        """)
        for category, filter_sql in (
            ("inasistencias", INASISTENCIAS_FILTER),
            ("danos", DANOS_FILTER),
            ("isv", ISV_FILTER),
        )
    },
}

_UNREAD_COUNT_QUERY = text(
    f"""
    SELECT (
        (SELECT COUNT(*) FROM "DW_SUMA"."FactICO" AS fi
         WHERE {ICO_FILTER}
           AND REPLACE(fi."IdSaeConductor"::text, '.0', '') = CAST(:codigo_operador AS text)
           AND NOT {_viewed_expression("ico", 'fi."IdIco"')})
        +
        (SELECT COUNT(*) FROM "DW_SUMA"."FactNovedadesSico" AS fns
         WHERE {INASISTENCIAS_FILTER}
           AND BTRIM(fns."Codigo"::text) = CAST(:codigo_operador AS text)
           AND NOT {_viewed_expression("inasistencias", 'fns."Id"')})
        +
        (SELECT COUNT(*) FROM "DW_SUMA"."FactNovedadesSico" AS fns
         WHERE {DANOS_FILTER}
           AND BTRIM(fns."Codigo"::text) = CAST(:codigo_operador AS text)
           AND NOT {_viewed_expression("danos", 'fns."Id"')})
        +
        (SELECT COUNT(*) FROM "DW_SUMA"."FactNovedadesSico" AS fns
         WHERE {ISV_FILTER}
           AND fns."Codigo" = CAST(:codigo_operador AS bigint)
           AND NOT {_viewed_expression("isv", 'fns."Id"')})
    ) AS total
    """
)


class NovedadesRepository:
    def mark_viewed(
        self, db: Session, *, codigo_operador: int, categoria: str, id_novedad: int
    ) -> bool:
        result = db.execute(
            _MARK_VIEWED_QUERIES[categoria],
            {"codigo_operador": codigo_operador, "id_novedad": id_novedad},
        ).scalar_one_or_none()
        db.commit()
        return result is not None

    def count_unread(self, db: Session, *, codigo_operador: int) -> int:
        return int(db.execute(_UNREAD_COUNT_QUERY, {"codigo_operador": codigo_operador}).scalar_one())

    def list_by_category(
        self, db: Session, *, codigo_operador: int, categoria: str
    ) -> list[Mapping[str, Any]]:
        query = {
            "ico": _ICO_BY_OPERATOR_CODE_QUERY,
            "inasistencias": _INASISTENCIAS_BY_OPERATOR_CODE_QUERY,
            "danos": _DANOS_BY_OPERATOR_CODE_QUERY,
            "isv": _ISV_BY_OPERATOR_CODE_QUERY,
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
