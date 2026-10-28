import logging
import mimetypes
from datetime import datetime
from hashlib import sha256
import os
from pathlib import Path
import tempfile
from typing import Any

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    Query,
    status,
)
from fastapi.responses import FileResponse
from PIL import Image, ImageOps
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.tarea import (
    NovedadAsignacion,
    OperadorAsignacion,
    TareaAsignacionResponse,
    TareaCreateRequest,
    TareaEstadoUpdate,
    TareaEvidenciasResponse,
    TareaResponse,
    TipoTareaResponse,
)
from app.services.tareas_service import tareas_service

logger = logging.getLogger(__name__)

router = APIRouter()

EVIDENCE_MEDIA_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
}


@router.get(
    "/asignacion/operadores",
    response_model=list[OperadorAsignacion],
    summary="Buscar operadores para asignar tareas",
)
def buscar_operadores(
    request: Request,
    buscar: str = Query(min_length=2, max_length=64),
    db: Session = Depends(get_db),
) -> list[OperadorAsignacion]:
    tipo_documento, identificacion = _authenticated_identity(request)
    return tareas_service.search_operators_for_assignment(
        db,
        search=buscar.strip(),
        tipo_documento=tipo_documento,
        identificacion=identificacion,
    )


@router.get(
    "/asignacion/operadores/{codigo_operador}/novedades",
    response_model=list[NovedadAsignacion],
    summary="Consultar novedades abiertas de un operador",
)
def listar_novedades_operador(
    codigo_operador: int,
    request: Request,
    db: Session = Depends(get_db),
) -> list[NovedadAsignacion]:
    tipo_documento, identificacion = _authenticated_identity(request)
    return tareas_service.list_operator_novelties_for_assignment(
        db,
        codigo_operador=codigo_operador,
        tipo_documento=tipo_documento,
        identificacion=identificacion,
    )


@router.get(
    "/asignacion/novedades/{novedad_id}",
    response_model=NovedadAsignacion,
    summary="Buscar una novedad abierta por su ID",
)
def buscar_novedad(
    novedad_id: int,
    request: Request,
    db: Session = Depends(get_db),
) -> NovedadAsignacion:
    tipo_documento, identificacion = _authenticated_identity(request)
    return tareas_service.get_novelty_for_assignment(
        db,
        novedad_id=novedad_id,
        tipo_documento=tipo_documento,
        identificacion=identificacion,
    )


@router.get(
    "/asignacion/tipos",
    response_model=list[TipoTareaResponse],
    summary="Listar tipos de tarea disponibles",
)
def listar_tipos_tarea(
    request: Request,
    db: Session = Depends(get_db),
) -> list[TipoTareaResponse]:
    tipo_documento, identificacion = _authenticated_identity(request)
    return tareas_service.list_assignment_task_types(
        db,
        tipo_documento=tipo_documento,
        identificacion=identificacion,
    )


@router.post(
    "/asignacion",
    response_model=TareaAsignacionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Crear y asignar una tarea",
)
def crear_asignacion(
    assignment: TareaCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> TareaAsignacionResponse:
    tipo_documento, identificacion = _authenticated_identity(request)
    return tareas_service.create_task_for_operator(
        db,
        request=assignment,
        tipo_documento=tipo_documento,
        identificacion=identificacion,
    )


@router.get(
    "",
    response_model=list[TareaResponse],
    summary="Consultar tareas del operador autenticado",
    responses={
        401: {"description": "El token no contiene una identidad válida."},
        403: {"description": "El usuario autenticado no es un operador activo."},
        503: {"description": "No se pudieron consultar las tareas."},
    },
)
def listar_tareas(
    request: Request,
    db: Session = Depends(get_db),
) -> list[TareaResponse]:
    tipo_documento, identificacion = _authenticated_identity(request)
    return tareas_service.list_for_operator(
        db,
        tipo_documento=tipo_documento,
        identificacion=identificacion,
    )


@router.get("/resumen/activas", response_model=int, summary="Contar tareas distintas de cerradas")
def contar_tareas_no_cerradas(request: Request, db: Session = Depends(get_db)) -> int:
    tipo_documento, identificacion = _authenticated_identity(request)
    return tareas_service.count_not_closed_for_operator(
        db, tipo_documento=tipo_documento, identificacion=identificacion
    )


@router.get(
    "/creadas",
    response_model=list[TareaResponse],
    summary="Consultar tareas creadas por el usuario administrativo",
)
def listar_tareas_creadas(
    request: Request,
    db: Session = Depends(get_db),
) -> list[TareaResponse]:
    tipo_documento, identificacion = _authenticated_identity(request)
    return tareas_service.list_created_by_user(
        db,
        tipo_documento=tipo_documento,
        identificacion=identificacion,
    )


@router.get(
    "/creadas/{tarea_id}",
    response_model=TareaResponse,
    summary="Consultar detalle de una tarea creada por el usuario",
)
def obtener_tarea_creada(
    tarea_id: int,
    request: Request,
    db: Session = Depends(get_db),
) -> TareaResponse:
    tipo_documento, identificacion = _authenticated_identity(request)
    return tareas_service.get_created_by_user(
        db,
        tarea_id=tarea_id,
        tipo_documento=tipo_documento,
        identificacion=identificacion,
    )


@router.patch(
    "/creadas/{tarea_id}/cerrar",
    response_model=TareaResponse,
    summary="Cerrar una tarea creada por el usuario",
)
def cerrar_tarea_creada(
    tarea_id: int,
    request: Request,
    db: Session = Depends(get_db),
) -> TareaResponse:
    tipo_documento, identificacion = _authenticated_identity(request)
    return tareas_service.close_created_by_user(
        db,
        tarea_id=tarea_id,
        tipo_documento=tipo_documento,
        identificacion=identificacion,
    )


@router.get(
    "/{tarea_id}",
    response_model=TareaResponse,
    summary="Consultar una tarea asignada",
)
def obtener_tarea(
    tarea_id: int,
    request: Request,
    db: Session = Depends(get_db),
) -> TareaResponse:
    tipo_documento, identificacion = _authenticated_identity(request)
    return tareas_service.get_for_operator(
        db,
        tarea_id=tarea_id,
        tipo_documento=tipo_documento,
        identificacion=identificacion,
    )


@router.post(
    "/{tarea_id}/evidencias",
    response_model=TareaEvidenciasResponse,
    summary="Adjuntar evidencias a una tarea",
    responses={
        404: {"description": "La tarea no está asignada al operador."},
        409: {"description": "La tarea ya está completada."},
        413: {"description": "Se excedió el tamaño o cantidad máxima de archivos."},
        415: {"description": "El formato del archivo no está permitido."},
        503: {"description": "El almacenamiento de evidencias no está disponible."},
    },
)
def subir_evidencias(
    tarea_id: int,
    request: Request,
    files: list[UploadFile] = File(...),
    captured_at: list[datetime | None] | None = Form(default=None),
    db: Session = Depends(get_db),
) -> TareaEvidenciasResponse:
    tipo_documento, identificacion = _authenticated_identity(request)
    task, uploaded_count = tareas_service.upload_evidence(
        db,
        tarea_id=tarea_id,
        tipo_documento=tipo_documento,
        identificacion=identificacion,
        files=files,
        captured_at=captured_at,
    )
    return TareaEvidenciasResponse(
        tarea=task,
        evidencias_agregadas=uploaded_count,
    )


@router.get(
    "/{tarea_id}/evidencias/{nombre}",
    summary="Ver una evidencia de una tarea asignada",
)
def ver_evidencia(
    tarea_id: int,
    nombre: str,
    request: Request,
    db: Session = Depends(get_db),
) -> FileResponse:
    tipo_documento, identificacion = _authenticated_identity(request)
    path, _ = tareas_service.get_evidence_path(
        db,
        tarea_id=tarea_id,
        nombre=nombre,
        tipo_documento=tipo_documento,
        identificacion=identificacion,
    )
    return FileResponse(
        path=path,
        media_type=_media_type_for(path.name),
        headers={"Content-Disposition": "inline"},
    )


@router.get(
    "/{tarea_id}/evidencias/{nombre}/thumbnail",
    summary="Ver una miniatura optimizada de una evidencia",
)
def ver_miniatura_evidencia(
    tarea_id: int,
    nombre: str,
    request: Request,
    db: Session = Depends(get_db),
) -> FileResponse:
    tipo_documento, identificacion = _authenticated_identity(request)
    path, _ = tareas_service.get_evidence_path(
        db,
        tarea_id=tarea_id,
        nombre=nombre,
        tipo_documento=tipo_documento,
        identificacion=identificacion,
    )
    stat = path.stat()
    cache_key = sha256(
        f"{path.resolve()}:{stat.st_size}:{stat.st_mtime_ns}".encode("utf-8")
    ).hexdigest()
    cache_dir = Path(tempfile.gettempdir()) / "appmovil-evidence-thumbnails"
    cache_dir.mkdir(parents=True, exist_ok=True)
    thumbnail_path = cache_dir / f"{cache_key}.jpg"
    if not thumbnail_path.is_file():
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f"{cache_key}.", suffix=".tmp", dir=cache_dir
        )
        os.close(descriptor)
        temporary_path = Path(temporary_name)
        try:
            with Image.open(path) as opened:
                image = ImageOps.exif_transpose(opened).convert("RGB")
            image.thumbnail((480, 480), Image.Resampling.LANCZOS)
            image.save(temporary_path, format="JPEG", quality=72, optimize=True)
            os.replace(temporary_path, thumbnail_path)
        finally:
            temporary_path.unlink(missing_ok=True)
    return FileResponse(
        path=thumbnail_path,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=86400"},
    )


@router.get(
    "/{tarea_id}/evidencias/{nombre}/download",
    summary="Descargar una evidencia de una tarea",
    responses={
        404: {"description": "La evidencia no existe o no es accesible."},
        503: {"description": "No fue posible consultar la tarea."},
    },
)
def descargar_evidencia(
    tarea_id: int,
    nombre: str,
    request: Request,
    db: Session = Depends(get_db),
) -> FileResponse:
    tipo_documento, identificacion = _authenticated_identity(request)
    path, download_name = tareas_service.get_evidence_path(
        db,
        tarea_id=tarea_id,
        nombre=nombre,
        tipo_documento=tipo_documento,
        identificacion=identificacion,
    )
    logger.info(
        "Evidence download requested: task=%s file=%s user=%s-%s.",
        tarea_id,
        path.name,
        tipo_documento,
        identificacion,
    )
    return FileResponse(
        path=path,
        media_type=_media_type_for(path.name),
        filename=download_name,
    )


@router.patch(
    "/{tarea_id}/estado",
    response_model=TareaResponse,
    summary="Actualizar el estado de una tarea",
)
def actualizar_estado(
    tarea_id: int,
    update: TareaEstadoUpdate,
    request: Request,
    db: Session = Depends(get_db),
) -> TareaResponse:
    tipo_documento, identificacion = _authenticated_identity(request)
    return tareas_service.update_state(
        db,
        tarea_id=tarea_id,
        estado=update.estado,
        tipo_documento=tipo_documento,
        identificacion=identificacion,
    )


def _authenticated_identity(request: Request) -> tuple[str, str]:
    token_payload: dict[str, Any] = request.state.token_payload
    tipo_documento = token_payload.get("TipoDocumento")
    identificacion = token_payload.get("Identificacion")
    if not isinstance(tipo_documento, str) or not isinstance(
        identificacion, str
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="El token no contiene una identidad válida.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return tipo_documento, identificacion


def _media_type_for(filename: str) -> str:
    extension = Path(filename).suffix.lower()
    return (
        EVIDENCE_MEDIA_TYPES.get(extension)
        or mimetypes.guess_type(filename)[0]
        or "application/octet-stream"
    )
