from collections.abc import Mapping
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

_EMPLOYEE_BY_IDENTITY_QUERY = text(
    """
    SELECT
        de."Codigo" AS "Codigo",
        de."TipoDocumento" AS "TipoDocumento",
        de."Identificacion" AS "Identificacion",
        de."NombreEmpleado" || ' ' || de."ApellidosEmpleado" AS "NombreCompleto",
        de."FechaIngreso" AS "FechaIngreso",
        de."Cargo" AS "Cargo",
        de."IndicadorActividad" AS "EstadoEmpleado",
        de."Clasificacion" AS "Clasificacion"
    FROM "DW_SUMA"."DimEmpleados" AS de
    WHERE de."TipoDocumento" = :tipo_documento
      AND de."Identificacion" = :identificacion
    """
)

_EMPLOYEE_BY_IDENTIFICATION_QUERY = text(
    """
    SELECT
        de."Codigo" AS "Codigo",
        de."TipoDocumento" AS "TipoDocumento",
        de."Identificacion" AS "Identificacion",
        de."NombreEmpleado" || ' ' || de."ApellidosEmpleado" AS "NombreCompleto",
        de."FechaIngreso" AS "FechaIngreso",
        de."Cargo" AS "Cargo",
        de."IndicadorActividad" AS "EstadoEmpleado",
        de."Clasificacion" AS "Clasificacion"
    FROM "DW_SUMA"."DimEmpleados" AS de
    WHERE de."Identificacion" = :identificacion
    """
)


class OperadorRepository:
    def get_by_identification(
        self,
        db: Session,
        *,
        identificacion: str,
    ) -> Mapping[str, Any] | None:
        result = db.execute(
            _EMPLOYEE_BY_IDENTIFICATION_QUERY,
            {"identificacion": identificacion},
        )
        return result.mappings().one_or_none()

    def get_by_identity(
        self,
        db: Session,
        *,
        tipo_documento: str,
        identificacion: str,
    ) -> Mapping[str, Any] | None:
        result = db.execute(
            _EMPLOYEE_BY_IDENTITY_QUERY,
            {
                "tipo_documento": tipo_documento,
                "identificacion": identificacion,
            },
        )
        return result.mappings().one_or_none()
