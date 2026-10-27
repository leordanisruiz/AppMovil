import logging
from typing import NoReturn

from fastapi import HTTPException, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.repositories.novedades_repository import NovedadesRepository
from app.repositories.operador_repository import OperadorRepository
from app.schemas.novedad import NovedadesResponse

logger = logging.getLogger(__name__)


class NovedadesService:
    def __init__(
        self,
        novedades_repository: NovedadesRepository,
        operador_repository: OperadorRepository,
    ) -> None:
        self._novedades_repository = novedades_repository
        self._operador_repository = operador_repository

    def consultar(
        self,
        db: Session,
        *,
        codigo_operador: int,
        tipo_documento: str,
        identificacion: str,
    ) -> NovedadesResponse:
        try:
            operador = self._operador_repository.get_by_identity(
                db,
                tipo_documento=tipo_documento,
                identificacion=identificacion,
            )
            try:
                operator_code = int(
                    str(operador["Codigo"]).strip()
                ) if operador is not None else 0
            except (KeyError, TypeError, ValueError):
                operator_code = 0
            if (
                operador is None
                or operator_code <= 0
                or str(operador["Codigo"]).strip() != codigo_operador
            ):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="El código no corresponde al usuario autenticado.",
                )
            rows = self._novedades_repository.list_by_operator_code(
                db,
                codigo_operador=operator_code,
            )
        except SQLAlchemyError as exc:
            self._raise_database_unavailable(exc)

        novedades_response = NovedadesResponse(
            total=len(rows),
            novedades=rows,
        )
        logger.info("Operator novelties consulted.")
        return novedades_response

    @staticmethod
    def _raise_database_unavailable(exc: SQLAlchemyError) -> NoReturn:
        logger.error(
            "Novelty database operation failed (%s).",
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No se pudieron consultar las novedades en este momento.",
        ) from None


novedades_service = NovedadesService(
    NovedadesRepository(),
    OperadorRepository(),
)
