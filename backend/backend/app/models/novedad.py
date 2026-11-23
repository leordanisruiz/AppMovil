"""Typed projection of the SICO novelty fact table used by read queries.

The warehouse table is queried as a projection rather than ORM-mapped because
its physical schema is owned by the external data warehouse.
"""

from datetime import date, datetime
from typing import TypedDict


class NovedadRecord(TypedDict, total=False):
    IdNovedad: int
    FechaNovedad: date | datetime | None
    Codigo: int | None
    TipoNovedad: str | None
    Grupo: str | None
    Subgrupo: str | None
    Novedad: str | None
    Descripcion: str | None
    Estado: str | None
