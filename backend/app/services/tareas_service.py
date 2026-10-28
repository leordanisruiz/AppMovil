import logging
import mimetypes
import os
import re
import subprocess
import tempfile
from collections.abc import Mapping
from datetime import date, datetime
from pathlib import Path
from typing import Any, NoReturn
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.repositories.operador_repository import OperadorRepository
from app.repositories.tareas_repository import TareasRepository
from app.repositories.usuario_app_repository import UsuarioAppRepository
from app.schemas.tarea import (
    Evidencia,
    NovedadAsignacion,
    OperadorAsignacion,
    TareaAsignacionResponse,
    TareaCreateRequest,
    TareaResponse,
    TipoTareaResponse,
)
from app.services.evidence_watermark import (
    resolve_ffmpeg_executable,
    watermark_image,
    watermark_video,
)
from app.services.evidence_cache import get_evidence_cache

logger = logging.getLogger(__name__)

MAX_EVIDENCE_FILES = 14
MAX_EVIDENCE_IMAGES = 12
MAX_EVIDENCE_VIDEOS = 2
MAX_EVIDENCE_SIZE_BYTES = 100 * 1024 * 1024
MAX_VIDEO_DURATION_SECONDS = 3 * 60
UPLOAD_CHUNK_SIZE = 1024 * 1024
ALLOWED_MEDIA_TYPES = {
    "image/jpeg": (".jpg", "image"),
    "image/png": (".png", "image"),
    "image/webp": (".webp", "image"),
    "image/heic": (".heic", "image"),
    "image/heif": (".heif", "image"),
    "video/mp4": (".mp4", "video"),
    "video/quicktime": (".mov", "video"),
}
ALLOWED_EVIDENCE_EXTENSIONS = frozenset(
    extension for extension, _ in ALLOWED_MEDIA_TYPES.values()
)
_EVIDENCE_FILENAME_PREFIX = re.compile(r"^[0-9a-f]{8}_")


class TareasService:
    def __init__(
        self,
        tareas_repository: TareasRepository,
        operador_repository: OperadorRepository,
        usuario_app_repository: UsuarioAppRepository | None = None,
    ) -> None:
        self._tareas_repository = tareas_repository
        self._operador_repository = operador_repository
        self._usuario_app_repository = (
            usuario_app_repository or UsuarioAppRepository()
        )

    def search_operators_for_assignment(
        self,
        db: Session,
        *,
        search: str,
        tipo_documento: str,
        identificacion: str,
    ) -> list[OperadorAsignacion]:
        self._require_assignment_role(
            db,
            tipo_documento=tipo_documento,
            identificacion=identificacion,
        )
        if len(search.strip()) < 2:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Escribe al menos dos caracteres para buscar.",
            )
        try:
            rows = self._tareas_repository.search_operators(db, search=search)
        except SQLAlchemyError as exc:
            self._raise_database_unavailable("operator search", exc)
        return [OperadorAsignacion.model_validate(dict(row)) for row in rows]

    def list_operator_novelties_for_assignment(
        self,
        db: Session,
        *,
        codigo_operador: int,
        tipo_documento: str,
        identificacion: str,
    ) -> list[NovedadAsignacion]:
        self._require_assignment_role(
            db,
            tipo_documento=tipo_documento,
            identificacion=identificacion,
        )
        try:
            operator = self._tareas_repository.get_operator_by_code(
                db,
                codigo_operador=codigo_operador,
            )
            if operator is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="No se encontró un operador activo con ese código.",
                )
            rows = self._tareas_repository.list_open_novelties(
                db,
                codigo_operador=codigo_operador,
            )
        except SQLAlchemyError as exc:
            self._raise_database_unavailable("operator novelty search", exc)
        return [
            NovedadAsignacion.model_validate(dict(row))
            for row in rows
        ]

    def get_novelty_for_assignment(
        self,
        db: Session,
        *,
        novedad_id: int,
        tipo_documento: str,
        identificacion: str,
    ) -> NovedadAsignacion:
        self._require_assignment_role(
            db,
            tipo_documento=tipo_documento,
            identificacion=identificacion,
        )
        try:
            row = self._tareas_repository.get_novelty(
                db,
                novedad_id=novedad_id,
            )
        except SQLAlchemyError as exc:
            self._raise_database_unavailable("novelty search", exc)
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No se encontró una novedad abierta con ese ID.",
            )
        return NovedadAsignacion.model_validate(dict(row))

    def list_assignment_task_types(
        self,
        db: Session,
        *,
        tipo_documento: str,
        identificacion: str,
    ) -> list[TipoTareaResponse]:
        self._require_assignment_role(
            db,
            tipo_documento=tipo_documento,
            identificacion=identificacion,
        )
        try:
            rows = self._tareas_repository.list_task_types(db)
        except SQLAlchemyError as exc:
            self._raise_database_unavailable("task type lookup", exc)
        return [TipoTareaResponse.model_validate(dict(row)) for row in rows]

    def create_task_for_operator(
        self,
        db: Session,
        *,
        request: TareaCreateRequest,
        tipo_documento: str,
        identificacion: str,
    ) -> TareaAsignacionResponse:
        self._require_assignment_role(
            db,
            tipo_documento=tipo_documento,
            identificacion=identificacion,
        )
        try:
            operator = self._tareas_repository.get_operator_by_code(
                db,
                codigo_operador=request.operador_id,
            )
            if operator is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="No se encontró un operador activo con ese código.",
                )

            novelty_rows = self._tareas_repository.get_open_novelties_by_ids(
                db,
                novedad_ids=request.novedades_ids,
            )
            selected_novelties = {
                int(row["id_novedad"]): int(row["codigo"])
                for row in novelty_rows
            }
            if (
                set(selected_novelties) != set(request.novedades_ids)
                or any(
                    code != request.operador_id
                    for code in selected_novelties.values()
                )
            ):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail=(
                        "Todas las novedades deben estar abiertas y "
                        "pertenecer al operador seleccionado."
                    ),
                )

            task_type = self._tareas_repository.get_task_type_name(
                db,
                tipo_tarea_id=request.tipo_tarea_id,
            )
            if task_type is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Selecciona un tipo de tarea válido.",
                )

            task, notification_count = self._tareas_repository.create_task(
                db,
                operador_id=request.operador_id,
                novedades_ids=request.novedades_ids,
                tipo_tarea=task_type,
                descripcion=request.descripcion,
                usuario_creacion=f"{tipo_documento}-{identificacion}",
            )
        except HTTPException:
            raise
        except SQLAlchemyError as exc:
            db.rollback()
            self._raise_database_unavailable("task assignment", exc)

        logger.info(
            "Task %s assigned to operator %s; %s push notifications queued.",
            task["id"],
            request.operador_id,
            notification_count,
        )
        return TareaAsignacionResponse(
            tarea=_to_task_response(task),
            notificaciones_programadas=notification_count,
        )

    def _require_assignment_role(
        self,
        db: Session,
        *,
        tipo_documento: str,
        identificacion: str,
    ) -> int:
        try:
            user = self._usuario_app_repository.get_by_identity(
                db,
                tipo_documento=tipo_documento,
                identificacion=identificacion,
            )
            employee = self._operador_repository.get_by_identity(
                db,
                tipo_documento=tipo_documento,
                identificacion=identificacion,
            )
        except SQLAlchemyError as exc:
            self._raise_database_unavailable("assignment role lookup", exc)

        role_id = user.rol_id if user is not None else None
        if (
            employee is None
            or employee.get("EstadoEmpleado") != "A"
            or role_id not in (1, 2)
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tienes permisos para asignar tareas.",
            )
        return role_id

    def list_for_operator(
        self,
        db: Session,
        *,
        tipo_documento: str,
        identificacion: str,
    ) -> list[TareaResponse]:
        operador_id = self._get_authenticated_operator_id(
            db,
            tipo_documento=tipo_documento,
            identificacion=identificacion,
        )
        try:
            rows = self._tareas_repository.list_by_operator(
                db,
                operador_id=operador_id,
            )
        except SQLAlchemyError as exc:
            self._raise_database_unavailable("list", exc)

        return [_to_task_response(row) for row in rows]

    def count_not_closed_for_operator(
        self, db: Session, *, tipo_documento: str, identificacion: str
    ) -> int:
        operador_id = self._get_authenticated_operator_id(
            db, tipo_documento=tipo_documento, identificacion=identificacion
        )
        try:
            return self._tareas_repository.count_not_closed_by_operator(
                db, operador_id=operador_id
            )
        except SQLAlchemyError as exc:
            self._raise_database_unavailable("count not closed tasks", exc)

    def list_created_by_user(
        self,
        db: Session,
        *,
        tipo_documento: str,
        identificacion: str,
    ) -> list[TareaResponse]:
        self._require_assignment_role(
            db,
            tipo_documento=tipo_documento,
            identificacion=identificacion,
        )
        creator = f"{tipo_documento}-{identificacion}"
        try:
            rows = self._tareas_repository.list_by_creator(
                db,
                usuario_creacion=creator,
            )
        except SQLAlchemyError as exc:
            self._raise_database_unavailable("created task list", exc)
        return [_to_task_response(row) for row in rows]

    def get_created_by_user(
        self,
        db: Session,
        *,
        tarea_id: int,
        tipo_documento: str,
        identificacion: str,
    ) -> TareaResponse:
        self._require_assignment_role(
            db,
            tipo_documento=tipo_documento,
            identificacion=identificacion,
        )
        creator = f"{tipo_documento}-{identificacion}"
        try:
            row = self._tareas_repository.get_by_creator(
                db,
                tarea_id=tarea_id,
                usuario_creacion=creator,
            )
        except SQLAlchemyError as exc:
            self._raise_database_unavailable("created task read", exc)
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="La tarea no existe o no fue creada por este usuario.",
            )
        return _to_task_response(row)

    def close_created_by_user(
        self,
        db: Session,
        *,
        tarea_id: int,
        tipo_documento: str,
        identificacion: str,
    ) -> TareaResponse:
        self._require_assignment_role(
            db,
            tipo_documento=tipo_documento,
            identificacion=identificacion,
        )
        creator = f"{tipo_documento}-{identificacion}"
        try:
            current = self._tareas_repository.get_by_creator(
                db,
                tarea_id=tarea_id,
                usuario_creacion=creator,
            )
            if current is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="La tarea no existe o no fue creada por este usuario.",
                )
            if current["estado"] == "CERRADO":
                return _to_task_response(current)
            if current["estado"] != "COMPLETADA":
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "No es posible cerrar la tarea. El operador no ha "
                        "gestionado la tarea."
                    ),
                )
            updated = self._tareas_repository.close_created_task(
                db,
                tarea_id=tarea_id,
                usuario_creacion=creator,
            )
        except HTTPException:
            raise
        except SQLAlchemyError as exc:
            db.rollback()
            self._raise_database_unavailable("created task close", exc)

        if updated is None:
            try:
                latest = self._tareas_repository.get_by_creator(
                    db,
                    tarea_id=tarea_id,
                    usuario_creacion=creator,
                )
            except SQLAlchemyError as exc:
                self._raise_database_unavailable("created task close verification", exc)
            if latest is not None and latest["estado"] == "CERRADO":
                return _to_task_response(latest)
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="La tarea no existe o no fue creada por este usuario.",
            )
        logger.info(
            "Task %s closed by creator %s.",
            tarea_id,
            creator,
        )
        return _to_task_response(updated)

    def get_for_operator(
        self,
        db: Session,
        *,
        tarea_id: int,
        tipo_documento: str,
        identificacion: str,
    ) -> TareaResponse:
        operador_id = self._get_authenticated_operator_id(
            db,
            tipo_documento=tipo_documento,
            identificacion=identificacion,
        )
        row = self._get_task_row(
            db,
            tarea_id=tarea_id,
            operador_id=operador_id,
        )
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="La tarea no existe o no está asignada a este operador.",
            )
        return _to_task_response(row)

    def upload_evidence(
        self,
        db: Session,
        *,
        tarea_id: int,
        tipo_documento: str,
        identificacion: str,
        files: list[UploadFile],
        captured_at: list[datetime | None] | None = None,
    ) -> tuple[TareaResponse, int]:
        operador_id = self._get_authenticated_operator_id(
            db,
            tipo_documento=tipo_documento,
            identificacion=identificacion,
        )
        current_task = self._get_task_row(
            db,
            tarea_id=tarea_id,
            operador_id=operador_id,
        )
        if current_task is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="La tarea no existe o no está asignada a este operador.",
            )
        if current_task["estado"] in {"COMPLETADA", "CERRADO"}:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="No se pueden agregar evidencias a una tarea cerrada o completada.",
            )
        if not files:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Debe adjuntar al menos una evidencia.",
            )
        if len(files) > MAX_EVIDENCE_FILES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Puede adjuntar máximo {MAX_EVIDENCE_FILES} archivos por envío.",
            )
        existing = current_task.get("evidencias") or []
        existing_images = sum(item.get("tipo") == "image" for item in existing)
        existing_videos = sum(item.get("tipo") == "video" for item in existing)
        incoming_images = sum((file.content_type or "").startswith("image/") for file in files)
        incoming_videos = sum((file.content_type or "").startswith("video/") for file in files)
        if existing_images + incoming_images > MAX_EVIDENCE_IMAGES:
            raise HTTPException(status_code=422, detail="Solo se permiten máximo 12 fotografías por tarea.")
        if existing_videos + incoming_videos > MAX_EVIDENCE_VIDEOS:
            raise HTTPException(status_code=422, detail="Solo se permiten máximo 2 videos por tarea.")

        evidence_directory = _get_task_evidence_directory(
            identificacion,
            tarea_id=tarea_id,
            novedades_ids=current_task.get("novedades_ids", []),
        )
        staged_paths: list[Path] = []
        final_paths: list[Path] = []
        evidence_records: list[dict[str, Any]] = []
        total_bytes = 0

        try:
            evidence_directory.mkdir(parents=True, exist_ok=True)
            for index, upload in enumerate(files):
                suffix, content_type, media_type = _validate_upload(upload)
                original_name = Path(upload.filename or f"evidencia{suffix}").name
                safe_name = re.sub(r"[^\w.-]", "_", original_name)[:80]
                filename = f"{uuid4().hex[:8]}_{safe_name or f'evidencia{suffix}'}"
                temporary_path = _new_upload_staging_path()
                staged_paths.append(temporary_path)
                file_size = _write_upload(upload, temporary_path)
                _verify_file_signature(temporary_path, content_type)
                if media_type == "video":
                    _verify_video_duration(temporary_path)
                total_bytes += file_size
                if total_bytes > MAX_EVIDENCE_SIZE_BYTES:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail="El tamaño total de las evidencias supera 100 MB.",
                    )

                supplied_time = captured_at[index] if captured_at and index < len(captured_at) else None
                watermark_time = supplied_time or datetime.now(ZoneInfo("America/Bogota"))
                if watermark_time.tzinfo is None:
                    watermark_time = watermark_time.replace(tzinfo=ZoneInfo("America/Bogota"))
                else:
                    watermark_time = watermark_time.astimezone(ZoneInfo("America/Bogota"))
                output_suffix = ".jpg" if media_type == "image" else ".mp4"
                final_filename = f"{Path(filename).stem}{output_suffix}"
                final_path = evidence_directory / final_filename
                final_paths.append(final_path)
                try:
                    if media_type == "image":
                        def cache_thumbnail(image: Any) -> None:
                            try:
                                get_evidence_cache().store_thumbnail_from_image(
                                    final_path, image
                                )
                            except (OSError, ValueError):
                                logger.warning(
                                    "Could not pre-generate evidence thumbnail: task=%s file=%s.",
                                    tarea_id,
                                    final_filename,
                                    exc_info=True,
                                )

                        watermark_image(
                            temporary_path,
                            final_path,
                            watermark_time,
                            on_processed=cache_thumbnail,
                        )
                    else:
                        watermark_video(temporary_path, final_path, watermark_time)
                except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as exc:
                    diagnostic = getattr(exc, "stderr", None)
                    if isinstance(diagnostic, bytes):
                        diagnostic = diagnostic.decode("utf-8", errors="replace")
                    logger.error(
                        "Evidence watermark processing failed (%s): %s",
                        type(exc).__name__,
                        str(diagnostic or exc)[:1000],
                    )
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                        detail="No fue posible procesar la evidencia para aplicar la marca de fecha y hora.",
                    ) from exc
                temporary_path.unlink(missing_ok=True)
                staged_paths.remove(temporary_path)
                evidence_records.append(
                    {
                        "nombre": final_filename,
                        "ruta": _evidence_relative_path(
                            identificacion,
                            tarea_id=tarea_id,
                            novedades_ids=current_task.get("novedades_ids", []),
                            filename=final_filename,
                        ),
                        "fecha": date.today().isoformat(),
                        "fecha_captura": watermark_time.isoformat(),
                        "tipo": media_type,
                    }
                )

            try:
                row = self._tareas_repository.append_evidences(
                    db,
                    tarea_id=tarea_id,
                    operador_id=operador_id,
                    evidencias=evidence_records,
                )
            except SQLAlchemyError as exc:
                db.rollback()
                self._raise_database_unavailable("upload", exc)

            if row is None:
                latest_task = self._get_task_row(
                    db, tarea_id=tarea_id, operador_id=operador_id
                )
                latest_evidence = latest_task.get("evidencias", []) if latest_task else []
                latest_images = sum(item.get("tipo") == "image" for item in latest_evidence)
                latest_videos = sum(item.get("tipo") == "video" for item in latest_evidence)
                if latest_images + incoming_images > MAX_EVIDENCE_IMAGES:
                    raise HTTPException(
                        status_code=422,
                        detail="Solo se permiten máximo 12 fotografías por tarea.",
                    )
                if latest_videos + incoming_videos > MAX_EVIDENCE_VIDEOS:
                    raise HTTPException(
                        status_code=422,
                        detail="Solo se permiten máximo 2 videos por tarea.",
                    )
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "La tarea cambió de estado o excede el límite de 12 fotografías "
                        "o 2 videos. Actualice la información e intente de nuevo."
                    ),
                )

        except HTTPException:
            _remove_files(staged_paths + final_paths)
            raise
        except OSError as exc:
            _remove_files(staged_paths + final_paths)
            logger.error(
                "Evidence storage operation failed (%s).",
                type(exc).__name__,
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No fue posible guardar las evidencias en el servidor.",
            ) from None

        logger.info(
            "Evidence uploaded for task %s (%s files).",
            tarea_id,
            len(evidence_records),
        )
        return _to_task_response(row), len(evidence_records)

    def update_state(
        self,
        db: Session,
        *,
        tarea_id: int,
        estado: str,
        tipo_documento: str,
        identificacion: str,
    ) -> TareaResponse:
        operador_id = self._get_authenticated_operator_id(
            db,
            tipo_documento=tipo_documento,
            identificacion=identificacion,
        )
        task = self._get_task_row(
            db,
            tarea_id=tarea_id,
            operador_id=operador_id,
        )
        if task is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="La tarea no existe o no está asignada a este operador.",
            )

        current_state = str(task["estado"])
        if current_state == estado:
            return _to_task_response(task)
        if current_state in {"COMPLETADA", "CERRADO"}:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Una tarea cerrada o completada no puede cambiar de estado.",
            )
        try:
            app_user = self._usuario_app_repository.get_by_identity(
                db,
                tipo_documento=tipo_documento,
                identificacion=identificacion,
            )
        except SQLAlchemyError as exc:
            self._raise_database_unavailable("task completion role lookup", exc)
        if app_user is not None and app_user.rol_id in (1, 2):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Solo el operador asignado puede actualizar el estado de esta tarea.",
            )
        if estado == "COMPLETADA":
            evidences = task["evidencias"] or []
            if not evidences:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Adjunte al menos una evidencia antes de completar la tarea.",
                )
            if current_state != "EN_PROCESO":
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="La tarea debe estar en proceso antes de completarse.",
                )
        elif estado != "EN_PROCESO":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="El cambio de estado solicitado no está permitido.",
            )

        try:
            updated = self._tareas_repository.update_state(
                db,
                tarea_id=tarea_id,
                operador_id=operador_id,
                estado=estado,
            )
        except SQLAlchemyError as exc:
            db.rollback()
            self._raise_database_unavailable("update state", exc)

        if updated is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="La tarea no existe o no está asignada a este operador.",
            )
        logger.info("Task %s state updated to %s.", tarea_id, estado)
        return _to_task_response(updated)

    def get_evidence_path(
        self,
        db: Session,
        *,
        tarea_id: int,
        nombre: str,
        tipo_documento: str,
        identificacion: str,
    ) -> tuple[Path, str]:
        """Autoriza y resuelve la ruta física de una evidencia.

        Devuelve la ruta y el nombre sugerido de descarga. El operador asignado
        y los usuarios administrativos (ADMIN u OPERACION) que crearon la tarea
        pueden consultar la misma evidencia.
        """
        if Path(nombre).name != nombre:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="La evidencia no existe.",
            )
        if Path(nombre).suffix.lower() not in ALLOWED_EVIDENCE_EXTENSIONS:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="La evidencia no existe.",
            )

        try:
            app_user = self._usuario_app_repository.get_by_identity(
                db,
                tipo_documento=tipo_documento,
                identificacion=identificacion,
            )
        except SQLAlchemyError as exc:
            self._raise_database_unavailable("evidence role lookup", exc)

        if app_user is not None and app_user.rol_id in (1, 2):
            self._require_assignment_role(
                db,
                tipo_documento=tipo_documento,
                identificacion=identificacion,
            )
            try:
                task = self._tareas_repository.get_by_creator(
                    db,
                    tarea_id=tarea_id,
                    usuario_creacion=f"{tipo_documento}-{identificacion}",
                )
            except SQLAlchemyError as exc:
                self._raise_database_unavailable("evidence task read", exc)
            if task is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="La evidencia no existe.",
                )
            operator_identificacion = self._get_operator_identificacion(
                db,
                codigo_operador=task["operador_id"],
            )
        else:
            operador_id = self._get_authenticated_operator_id(
                db,
                tipo_documento=tipo_documento,
                identificacion=identificacion,
            )
            task = self._get_task_row(
                db,
                tarea_id=tarea_id,
                operador_id=operador_id,
            )
            operator_identificacion = identificacion

        if task is None or operator_identificacion is None:
            logger.warning(
                "Evidence request references an unavailable task: task=%s.",
                tarea_id,
            )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="La evidencia no existe.",
            )
        evidence_record = next(
            (
                evidence
                for evidence in task["evidencias"] or []
                if evidence.get("nombre") == nombre
            ),
            None,
        )
        if evidence_record is None:
            logger.warning(
                "Evidence metadata is missing: task=%s file=%s.",
                tarea_id,
                nombre,
            )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="La evidencia no existe.",
            )

        operator_directory = _get_operator_evidence_directory(
            operator_identificacion
        ).resolve()
        evidence_directory = _get_task_evidence_directory(
            operator_identificacion,
            tarea_id=tarea_id,
            novedades_ids=task.get("novedades_ids", []),
        )
        saved_route = str(evidence_record.get("ruta") or "").strip()
        path: Path | None = None
        saved_route_resolves = False
        saved_route_file_exists = False
        if saved_route:
            route_path = _resolve_saved_evidence_path(
                saved_route,
                operator_directory=operator_directory,
            )
            saved_route_resolves = route_path is not None
            saved_route_file_exists = bool(route_path and route_path.is_file())
            if saved_route_file_exists and route_path is not None:
                path = route_path

        legacy_path = (operator_directory / nombre).resolve()
        task_path = (evidence_directory / nombre).resolve()
        if path is None and task_path.is_relative_to(evidence_directory.resolve()):
            if task_path.is_file():
                path = task_path
        if path is None and legacy_path.is_relative_to(operator_directory):
            # Mantiene accesibles las evidencias guardadas antes de organizarlas
            # en carpetas por tarea.
            if legacy_path.is_file():
                path = legacy_path
        if path is None:
            logger.warning(
                "Evidence file is missing from configured storage: task=%s "
                "file=%s saved_route=%s route_resolves=%s route_file_exists=%s "
                "task_path_exists=%s legacy_path_exists=%s "
                "storage_root_exists=%s.",
                tarea_id,
                nombre,
                bool(saved_route),
                saved_route_resolves,
                saved_route_file_exists,
                task_path.is_file(),
                legacy_path.is_file(),
                operator_directory.parent.is_dir(),
            )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="La evidencia no existe.",
            )
        return path, _evidence_download_name(nombre)

    def _get_task_row(
        self,
        db: Session,
        *,
        tarea_id: int,
        operador_id: int,
    ) -> Mapping[str, Any] | None:
        try:
            return self._tareas_repository.get_by_id(
                db,
                tarea_id=tarea_id,
                operador_id=operador_id,
            )
        except SQLAlchemyError as exc:
            self._raise_database_unavailable("read", exc)

    def _get_operator_identificacion(
        self,
        db: Session,
        *,
        codigo_operador: Any,
    ) -> str | None:
        """Resuelve la identificación del operador dueño de las evidencias."""
        try:
            codigo = int(codigo_operador)
        except (TypeError, ValueError):
            return None
        try:
            operator = self._tareas_repository.get_operator_by_code(
                db,
                codigo_operador=codigo,
            )
        except SQLAlchemyError as exc:
            self._raise_database_unavailable("evidence operator lookup", exc)
        if operator is None:
            return None
        operator_identificacion = operator.get("identificacion")
        if operator_identificacion is None:
            return None
        return str(operator_identificacion)

    def _get_authenticated_operator_id(
        self,
        db: Session,
        *,
        tipo_documento: str,
        identificacion: str,
    ) -> int:
        try:
            operator = self._operador_repository.get_by_identity(
                db,
                tipo_documento=tipo_documento,
                identificacion=identificacion,
            )
        except SQLAlchemyError as exc:
            self._raise_database_unavailable("operator lookup", exc)

        if not operator or operator.get("EstadoEmpleado") != "A":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Solo los operadores activos pueden consultar tareas.",
            )
        operator_code = operator.get("Codigo")
        code_text = str(operator_code).strip() if operator_code is not None else ""
        if not code_text.isascii() or not code_text.isdecimal():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="El usuario autenticado no tiene un código de operador válido.",
            )
        operator_id = int(code_text)
        if operator_id <= 0:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="El usuario autenticado no tiene un código de operador válido.",
            )
        return operator_id

    @staticmethod
    def _raise_database_unavailable(operation: str, exc: SQLAlchemyError) -> NoReturn:
        logger.error(
            "Task database operation %s failed (%s): %s",
            operation,
            type(exc).__name__,
            str(getattr(exc, "orig", exc))[:1000],
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No fue posible consultar o actualizar las tareas en este momento.",
        ) from None


def _to_task_response(row: Mapping[str, Any]) -> TareaResponse:
    return TareaResponse.model_validate(dict(row))


def _evidence_download_name(nombre: str) -> str:
    """Quita el prefijo aleatorio que se agrega al almacenar la evidencia."""
    return _EVIDENCE_FILENAME_PREFIX.sub("", nombre) or nombre


def _get_operator_evidence_directory(identificacion: str) -> Path:
    if not re.fullmatch(r"[0-9]{1,64}", identificacion):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="La identificación del usuario autenticado no es válida.",
        )

    configured_root = get_settings().evidencias_path.strip()
    if not configured_root:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="El almacenamiento de evidencias no está configurado.",
        )
    if os.name != "nt" and configured_root.startswith("\\\\"):
        logger.error(
            "Evidence storage uses a Windows UNC path on a non-Windows host."
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Configure EVIDENCIAS_PATH con la ruta montada del recurso "
                "compartido para este servidor."
            ),
        )

    storage_root = Path(configured_root)
    normalized_root_name = re.sub(r"[^a-z0-9]", "", storage_root.name.casefold())
    evidence_root = (
        storage_root
        if normalized_root_name == "evidenciasappmovil"
        else storage_root / "EvidenciasAppMovil"
    )
    return evidence_root / identificacion


def _resolve_saved_evidence_path(
    saved_route: str,
    *,
    operator_directory: Path,
) -> Path | None:
    """Resolve relative, POSIX, and legacy Windows evidence routes safely."""
    normalized = saved_route.replace("\\", "/")
    parts = [part for part in normalized.split("/") if part]
    for index, part in enumerate(parts):
        if part.casefold() != "evidenciasappmovil":
            continue
        route_parts = parts[index + 1 :]
        if not route_parts or route_parts[0] != operator_directory.name:
            return None
        candidate = (operator_directory / Path(*route_parts[1:])).resolve()
        return candidate if candidate.is_relative_to(operator_directory) else None

    candidate = Path(saved_route).resolve()
    return candidate if candidate.is_relative_to(operator_directory) else None


def _task_evidence_folder_name(tarea_id: int, novedades_ids: Any) -> str:
    """Construye un nombre seguro y reconocible para la carpeta de la tarea."""
    novelty_ids = sorted(
        {
            int(value)
            for value in (novedades_ids or [])
            if str(value).isascii() and str(value).isdecimal()
        }
    )
    novelty_suffix = ".".join(str(value) for value in novelty_ids) or "Sin-novedad"
    return f"Tarea-{tarea_id}-Novedad.{novelty_suffix}"


def _get_task_evidence_directory(
    identificacion: str,
    *,
    tarea_id: int,
    novedades_ids: Any,
) -> Path:
    return _get_operator_evidence_directory(identificacion) / _task_evidence_folder_name(
        tarea_id,
        novedades_ids,
    )


def _evidence_relative_path(
    identificacion: str,
    *,
    tarea_id: int,
    novedades_ids: Any,
    filename: str,
) -> str:
    folder = _task_evidence_folder_name(tarea_id, novedades_ids)
    return f"/EvidenciasAppMovil/{identificacion}/{folder}/{filename}"


def _validate_upload(upload: UploadFile) -> tuple[str, str, str]:
    media_type = (upload.content_type or "").lower()
    expected = ALLOWED_MEDIA_TYPES.get(media_type)
    extension = Path(upload.filename or "").suffix.lower()
    if expected is None or expected[0] != extension:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=(
                "Formato no permitido. Use imágenes JPG, PNG, WebP o HEIC y "
                "videos MP4 o MOV."
            ),
        )
    return expected[0], media_type, expected[1]


def _new_temp_path(directory: Path) -> Path:
    descriptor, name = tempfile.mkstemp(
        prefix=".upload-",
        suffix=".tmp",
        dir=directory,
    )
    os.close(descriptor)
    path = Path(name)
    path.unlink()
    return path


def _new_upload_staging_path() -> Path:
    """Stage uploaded bytes on the container disk, never on the SSHFS mount."""
    staging_directory = Path(tempfile.gettempdir()) / "appmovil-evidence-staging"
    staging_directory.mkdir(parents=True, exist_ok=True)
    return _new_temp_path(staging_directory)


def _write_upload(upload: UploadFile, destination: Path) -> int:
    size = 0
    with destination.open("xb") as target:
        while chunk := upload.file.read(UPLOAD_CHUNK_SIZE):
            size += len(chunk)
            if size > MAX_EVIDENCE_SIZE_BYTES:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail="Cada evidencia debe pesar máximo 100 MB.",
                )
            target.write(chunk)
    if size == 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No se pueden subir archivos vacíos.",
        )
    return size


def _verify_file_signature(path: Path, media_type: str) -> None:
    with path.open("rb") as uploaded_file:
        signature = uploaded_file.read(16)

    is_valid = False
    if media_type == "image/jpeg":
        is_valid = signature.startswith(b"\xff\xd8\xff")
    elif media_type == "image/png":
        is_valid = signature.startswith(b"\x89PNG\r\n\x1a\n")
    elif media_type == "image/webp":
        is_valid = signature.startswith(b"RIFF") and signature[8:12] == b"WEBP"
    elif media_type in {"video/mp4", "video/quicktime"}:
        is_valid = len(signature) >= 12 and signature[4:8] == b"ftyp"
    elif media_type in {"image/heic", "image/heif"}:
        is_valid = (
            len(signature) >= 12
            and signature[4:8] == b"ftyp"
            and signature[8:12] in {b"heic", b"heix", b"mif1", b"msf1"}
        )

    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="El contenido del archivo no coincide con su formato declarado.",
        )


def _verify_video_duration(path: Path) -> None:
    duration_seconds: float | None = None
    try:
        probe = subprocess.run(
            [
                resolve_ffmpeg_executable("ffprobe"),
                "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1", str(path),
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        )
        duration_seconds = float(probe.stdout.strip())
    except (subprocess.SubprocessError, OSError, ValueError):
        duration_seconds = _read_iso_bmff_duration_seconds(path)
    if duration_seconds is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="No fue posible validar la duración del video.",
        )
    if duration_seconds > MAX_VIDEO_DURATION_SECONDS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Los videos deben durar máximo 3 minutos.",
        )


def _read_iso_bmff_duration_seconds(path: Path) -> float | None:
    with path.open("rb") as stream:
        stream.seek(0, os.SEEK_END)
        file_end = stream.tell()
        moov_box = _find_box(stream, start=0, end=file_end, target=b"moov")
        if moov_box is None:
            return None
        mvhd_box = _find_box(
            stream,
            start=moov_box[0],
            end=moov_box[1],
            target=b"mvhd",
        )
        if mvhd_box is None:
            return None
        return _parse_mvhd_duration(
            stream,
            payload_start=mvhd_box[0],
            payload_end=mvhd_box[1],
        )


def _find_box(
    stream: Any,
    *,
    start: int,
    end: int,
    target: bytes,
) -> tuple[int, int] | None:
    cursor = start
    while cursor + 8 <= end:
        stream.seek(cursor)
        header = stream.read(8)
        if len(header) < 8:
            return None
        size = int.from_bytes(header[:4], "big")
        box_type = header[4:8]
        header_size = 8
        if size == 1:
            extended_size = stream.read(8)
            if len(extended_size) < 8:
                return None
            size = int.from_bytes(extended_size, "big")
            header_size = 16
        elif size == 0:
            size = end - cursor

        if size < header_size:
            return None
        payload_start = cursor + header_size
        payload_end = cursor + size
        if payload_end > end:
            return None
        if box_type == target:
            return payload_start, payload_end
        cursor = payload_end
    return None


def _parse_mvhd_duration(
    stream: Any,
    *,
    payload_start: int,
    payload_end: int,
) -> float | None:
    stream.seek(payload_start)
    payload = stream.read(payload_end - payload_start)
    if len(payload) < 20:
        return None

    version = payload[0]
    if version == 0:
        if len(payload) < 20:
            return None
        timescale = int.from_bytes(payload[12:16], "big")
        duration = int.from_bytes(payload[16:20], "big")
    elif version == 1:
        if len(payload) < 32:
            return None
        timescale = int.from_bytes(payload[20:24], "big")
        duration = int.from_bytes(payload[24:32], "big")
    else:
        return None

    if timescale <= 0:
        return None
    return duration / timescale


def _remove_files(paths: list[Path]) -> None:
    for path in paths:
        try:
            path.unlink(missing_ok=True)
        except OSError as exc:
            logger.error(
                "Could not clean up a temporary evidence file (%s).",
                type(exc).__name__,
            )


tareas_service = TareasService(
    TareasRepository(),
    OperadorRepository(),
)
