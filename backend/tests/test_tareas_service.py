import tempfile
import unittest
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import cast
from unittest.mock import Mock, patch

from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers
from sqlalchemy.orm import Session

from app.services.tareas_service import TareasService
from app.schemas.tarea import TareaCreateRequest


class TareasServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.task_repository = Mock()
        self.operator_repository = Mock()
        self.service = TareasService(
            self.task_repository,
            self.operator_repository,
        )
        self.db = cast(Session, Mock())
        self.operator_repository.get_by_identity.return_value = {
            "Codigo": "809772",
            "EstadoEmpleado": "A",
        }

    def test_task_assignment_requires_a_database_role(self) -> None:
        user_repository = Mock()
        user_repository.get_by_identity.return_value = Mock(rol_id=None)
        service = TareasService(
            self.task_repository,
            self.operator_repository,
            user_repository,
        )

        with self.assertRaises(HTTPException) as context:
            service.search_operators_for_assignment(
                self.db,
                search="807",
                tipo_documento="CC",
                identificacion="1080017116",
            )

        self.assertEqual(context.exception.status_code, 403)
        self.task_repository.search_operators.assert_not_called()

    def test_assignment_checks_selected_open_novelties_and_queues_notice(self) -> None:
        user_repository = Mock()
        user_repository.get_by_identity.return_value = Mock(rol_id=2)
        service = TareasService(
            self.task_repository,
            self.operator_repository,
            user_repository,
        )
        self.task_repository.get_operator_by_code.return_value = {
            "codigo": "809772",
        }
        self.task_repository.get_open_novelties_by_ids.return_value = [
            {"id_novedad": 17, "codigo": 809772},
            {"id_novedad": 18, "codigo": 809772},
        ]
        self.task_repository.get_task_type_name.return_value = "Capacitación"
        self.task_repository.create_task.return_value = (
            _task_record(novedades_ids=[17, 18]),
            1,
        )

        result = service.create_task_for_operator(
            self.db,
            request=TareaCreateRequest(
                operador_id=809772,
                novedades_ids=[17, 18],
                tipo_tarea_id=1,
                descripcion="Realizar la actividad asignada.",
            ),
            tipo_documento="CC",
            identificacion="5843452",
        )

        self.assertEqual(result.tarea.estado, "PENDIENTE")
        self.assertEqual(result.tarea.novedades_ids, [17, 18])
        self.assertEqual(result.notificaciones_programadas, 1)
        self.task_repository.create_task.assert_called_once_with(
            self.db,
            operador_id=809772,
            novedades_ids=[17, 18],
            tipo_tarea="Capacitación",
            descripcion="Realizar la actividad asignada.",
            usuario_creacion="CC-5843452",
        )

    def test_assignment_rejects_novelty_not_owned_by_selected_operator(self) -> None:
        user_repository = Mock()
        user_repository.get_by_identity.return_value = Mock(rol_id=1)
        service = TareasService(
            self.task_repository,
            self.operator_repository,
            user_repository,
        )
        self.task_repository.get_operator_by_code.return_value = {"codigo": "809772"}
        self.task_repository.get_open_novelties_by_ids.return_value = [
            {"id_novedad": 17, "codigo": 123456},
        ]

        with self.assertRaises(HTTPException) as context:
            service.create_task_for_operator(
                self.db,
                request=TareaCreateRequest(
                    operador_id=809772,
                    novedades_ids=[17],
                    tipo_tarea_id=1,
                    descripcion="Revisar la novedad.",
                ),
                tipo_documento="CC",
                identificacion="5843452",
            )

        self.assertEqual(context.exception.status_code, 422)
        self.task_repository.create_task.assert_not_called()

    def test_lists_only_tasks_for_authenticated_operator_code(self) -> None:
        self.task_repository.list_by_operator.return_value = [
            _task_record(operador_id=809772),
        ]

        tasks = self.service.list_for_operator(
            self.db,
            tipo_documento="CC",
            identificacion="1080017116",
        )

        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0].operador_id, 809772)
        self.task_repository.list_by_operator.assert_called_once_with(
            self.db,
            operador_id=809772,
        )

    def test_rejects_administrative_user_without_operator_code(self) -> None:
        self.operator_repository.get_by_identity.return_value = {
            "Codigo": None,
            "EstadoEmpleado": "A",
        }

        with self.assertRaises(HTTPException) as context:
            self.service.list_for_operator(
                self.db,
                tipo_documento="CC",
                identificacion="1080017116",
            )

        self.assertEqual(context.exception.status_code, 403)
        self.task_repository.list_by_operator.assert_not_called()

    def test_lists_only_tasks_created_by_the_authenticated_role_user(self) -> None:
        user_repository = Mock()
        user_repository.get_by_identity.return_value = Mock(rol_id=1)
        service = TareasService(
            self.task_repository,
            self.operator_repository,
            user_repository,
        )
        self.task_repository.list_by_creator.return_value = [
            _task_record(usuario_creacion="CC-5843452"),
        ]

        tasks = service.list_created_by_user(
            self.db,
            tipo_documento="CC",
            identificacion="5843452",
        )

        self.assertEqual(len(tasks), 1)
        self.task_repository.list_by_creator.assert_called_once_with(
            self.db,
            usuario_creacion="CC-5843452",
        )

    def test_role_user_can_close_only_their_created_task(self) -> None:
        user_repository = Mock()
        user_repository.get_by_identity.return_value = Mock(rol_id=2)
        service = TareasService(
            self.task_repository,
            self.operator_repository,
            user_repository,
        )
        self.task_repository.get_by_creator.return_value = _task_record(
            estado="COMPLETADA",
            usuario_creacion="CC-5843452",
        )
        self.task_repository.close_created_task.return_value = _task_record(
            estado="CERRADO",
            usuario_creacion="CC-5843452",
        )

        task = service.close_created_by_user(
            self.db,
            tarea_id=1,
            tipo_documento="CC",
            identificacion="5843452",
        )

        self.assertEqual(task.estado, "CERRADO")
        self.task_repository.close_created_task.assert_called_once_with(
            self.db,
            tarea_id=1,
            usuario_creacion="CC-5843452",
        )

    def test_cannot_close_task_created_by_another_user(self) -> None:
        user_repository = Mock()
        user_repository.get_by_identity.return_value = Mock(rol_id=1)
        service = TareasService(
            self.task_repository,
            self.operator_repository,
            user_repository,
        )
        self.task_repository.get_by_creator.return_value = None

        with self.assertRaises(HTTPException) as context:
            service.close_created_by_user(
                self.db,
                tarea_id=1,
                tipo_documento="CC",
                identificacion="5843452",
            )

        self.assertEqual(context.exception.status_code, 404)
        self.task_repository.close_created_task.assert_not_called()

    def test_admin_or_operation_role_cannot_complete_operator_task(self) -> None:
        user_repository = Mock()
        user_repository.get_by_identity.return_value = Mock(rol_id=1)
        service = TareasService(
            self.task_repository,
            self.operator_repository,
            user_repository,
        )
        self.task_repository.get_by_id.return_value = _task_record(
            estado="EN_PROCESO",
            evidencias=[
                {
                    "nombre": "foto.jpg",
                    "ruta": "/EvidenciasAppMovil/1080017116/foto.jpg",
                    "fecha": "2026-10-20",
                    "tipo": "image",
                }
            ],
        )

        with self.assertRaises(HTTPException) as context:
            service.update_state(
                self.db,
                tarea_id=1,
                estado="COMPLETADA",
                tipo_documento="CC",
                identificacion="1080017116",
            )

        self.assertEqual(context.exception.status_code, 403)
        self.task_repository.update_state.assert_not_called()

    def test_operator_can_complete_task_with_evidence(self) -> None:
        user_repository = Mock()
        user_repository.get_by_identity.return_value = None
        service = TareasService(
            self.task_repository,
            self.operator_repository,
            user_repository,
        )
        self.task_repository.get_by_id.return_value = _task_record(
            estado="EN_PROCESO",
            evidencias=[
                {
                    "nombre": "foto.jpg",
                    "ruta": "/EvidenciasAppMovil/1080017116/foto.jpg",
                    "fecha": "2026-10-20",
                    "tipo": "image",
                }
            ],
        )
        self.task_repository.update_state.return_value = _task_record(
            estado="COMPLETADA",
            evidencias=[
                {
                    "nombre": "foto.jpg",
                    "ruta": "/EvidenciasAppMovil/1080017116/foto.jpg",
                    "fecha": "2026-10-20",
                    "tipo": "image",
                }
            ],
        )

        task = service.update_state(
            self.db,
            tarea_id=1,
            estado="COMPLETADA",
            tipo_documento="CC",
            identificacion="1080017116",
        )

        self.assertEqual(task.estado, "COMPLETADA")
        self.task_repository.update_state.assert_called_once_with(
            self.db,
            tarea_id=1,
            operador_id=809772,
            estado="COMPLETADA",
        )

    def test_upload_stores_file_and_moves_pending_task_to_in_progress(self) -> None:
        pending_task = _task_record(estado="PENDIENTE")
        uploaded_task = _task_record(
            estado="EN_PROCESO",
            evidencias=[
                {
                    "nombre": "evidence.png",
                    "ruta": "/EvidenciasAppMovil/1080017116/evidence.png",
                    "fecha": "2026-10-20",
                    "tipo": "image",
                }
            ],
        )
        self.task_repository.get_by_id.return_value = pending_task
        self.task_repository.append_evidences.return_value = uploaded_task
        upload = UploadFile(
            file=BytesIO(_build_png_bytes()),
            filename="evidence.png",
            headers=Headers({"content-type": "image/png"}),
        )

        with tempfile.TemporaryDirectory() as directory:
            with patch(
                "app.services.tareas_service.get_settings",
                return_value=Mock(evidencias_path=directory),
            ):
                task, uploaded_count = self.service.upload_evidence(
                    self.db,
                    tarea_id=1,
                    tipo_documento="CC",
                    identificacion="1080017116",
                    files=[upload],
                )

            self.assertEqual(task.estado, "EN_PROCESO")
            self.assertEqual(uploaded_count, 1)
            persisted = self.task_repository.append_evidences.call_args.kwargs
            self.assertEqual(persisted["operador_id"], 809772)
            self.assertEqual(len(persisted["evidencias"]), 1)
            stored_path = Path(directory) / persisted["evidencias"][0]["ruta"].lstrip("/")
            self.assertTrue(stored_path.is_file())

    def test_rejects_marking_task_complete_without_evidence(self) -> None:
        self.task_repository.get_by_id.return_value = _task_record(
            estado="EN_PROCESO",
            evidencias=[],
        )

        with self.assertRaises(HTTPException) as context:
            self.service.update_state(
                self.db,
                tarea_id=1,
                estado="COMPLETADA",
                tipo_documento="CC",
                identificacion="1080017116",
            )

        self.assertEqual(context.exception.status_code, 409)
        self.task_repository.update_state.assert_not_called()

    def test_rejects_uploading_videos_longer_than_three_minutes(self) -> None:
        pending_task = _task_record(estado="PENDIENTE")
        self.task_repository.get_by_id.return_value = pending_task
        upload = UploadFile(
            file=BytesIO(_build_mp4_with_duration_seconds(181)),
            filename="evidence.mp4",
            headers=Headers({"content-type": "video/mp4"}),
        )

        with tempfile.TemporaryDirectory() as directory:
            with (
                patch(
                    "app.services.tareas_service.get_settings",
                    return_value=Mock(evidencias_path=directory),
                ),
                self.assertRaises(HTTPException) as context,
            ):
                self.service.upload_evidence(
                    self.db,
                    tarea_id=1,
                    tipo_documento="CC",
                    identificacion="1080017116",
                    files=[upload],
                )

        self.assertEqual(context.exception.status_code, 422)
        self.assertEqual(
            context.exception.detail,
            "Los videos deben durar máximo 3 minutos.",
        )
        self.task_repository.append_evidences.assert_not_called()

    def test_operator_can_resolve_own_evidence_file(self) -> None:
        user_repository = Mock()
        user_repository.get_by_identity.return_value = None
        service = TareasService(
            self.task_repository,
            self.operator_repository,
            user_repository,
        )
        stored_name = "abcd1234_foto_licencia.jpg"
        self.task_repository.get_by_id.return_value = _task_record(
            evidencias=[_evidence_record(stored_name)],
        )

        with tempfile.TemporaryDirectory() as directory:
            evidence_file = (
                Path(directory)
                / "EvidenciasAppMovil"
                / "1080017116"
                / stored_name
            )
            evidence_file.parent.mkdir(parents=True)
            evidence_file.write_bytes(b"image-data")
            with patch(
                "app.services.tareas_service.get_settings",
                return_value=Mock(evidencias_path=directory),
            ):
                path, download_name = service.get_evidence_path(
                    self.db,
                    tarea_id=1,
                    nombre=stored_name,
                    tipo_documento="CC",
                    identificacion="1080017116",
                )
            self.assertTrue(path.is_file())

        self.assertEqual(download_name, "foto_licencia.jpg")
        self.task_repository.get_by_id.assert_called_once_with(
            self.db,
            tarea_id=1,
            operador_id=809772,
        )
        self.task_repository.get_by_creator.assert_not_called()

    def test_creator_role_can_resolve_evidence_of_created_task(self) -> None:
        user_repository = Mock()
        user_repository.get_by_identity.return_value = Mock(rol_id=2)
        service = TareasService(
            self.task_repository,
            self.operator_repository,
            user_repository,
        )
        stored_name = "ffff0000_video_inspeccion.mp4"
        self.task_repository.get_by_creator.return_value = _task_record(
            usuario_creacion="CC-5843452",
            evidencias=[_evidence_record(stored_name, tipo="video")],
        )
        self.task_repository.get_operator_by_code.return_value = {
            "codigo": "809772",
            "identificacion": "1080017116",
        }

        with tempfile.TemporaryDirectory() as directory:
            evidence_file = (
                Path(directory)
                / "EvidenciasAppMovil"
                / "1080017116"
                / stored_name
            )
            evidence_file.parent.mkdir(parents=True)
            evidence_file.write_bytes(b"video-data")
            with patch(
                "app.services.tareas_service.get_settings",
                return_value=Mock(evidencias_path=directory),
            ):
                path, download_name = service.get_evidence_path(
                    self.db,
                    tarea_id=1,
                    nombre=stored_name,
                    tipo_documento="CC",
                    identificacion="5843452",
                )
            self.assertTrue(path.is_file())

        self.assertEqual(download_name, "video_inspeccion.mp4")
        self.task_repository.get_by_creator.assert_called_once_with(
            self.db,
            tarea_id=1,
            usuario_creacion="CC-5843452",
        )
        self.task_repository.get_by_id.assert_not_called()

    def test_rejects_evidence_with_unsupported_extension(self) -> None:
        user_repository = Mock()
        user_repository.get_by_identity.return_value = None
        service = TareasService(
            self.task_repository,
            self.operator_repository,
            user_repository,
        )

        with self.assertRaises(HTTPException) as context:
            service.get_evidence_path(
                self.db,
                tarea_id=1,
                nombre="nota.txt",
                tipo_documento="CC",
                identificacion="1080017116",
            )

        self.assertEqual(context.exception.status_code, 404)
        self.task_repository.get_by_id.assert_not_called()

    def test_rejects_evidence_of_another_operator(self) -> None:
        user_repository = Mock()
        user_repository.get_by_identity.return_value = None
        service = TareasService(
            self.task_repository,
            self.operator_repository,
            user_repository,
        )
        self.task_repository.get_by_id.return_value = None

        with self.assertRaises(HTTPException) as context:
            service.get_evidence_path(
                self.db,
                tarea_id=1,
                nombre="foto_licencia.jpg",
                tipo_documento="CC",
                identificacion="1080017116",
            )

        self.assertEqual(context.exception.status_code, 404)

    def test_rejects_evidence_not_registered_in_the_task(self) -> None:
        user_repository = Mock()
        user_repository.get_by_identity.return_value = None
        service = TareasService(
            self.task_repository,
            self.operator_repository,
            user_repository,
        )
        self.task_repository.get_by_id.return_value = _task_record(evidencias=[])

        with self.assertRaises(HTTPException) as context:
            service.get_evidence_path(
                self.db,
                tarea_id=1,
                nombre="foto_licencia.jpg",
                tipo_documento="CC",
                identificacion="1080017116",
            )

        self.assertEqual(context.exception.status_code, 404)


def _evidence_record(
    nombre: str,
    *,
    tipo: str = "image",
) -> dict[str, str]:
    return {
        "nombre": nombre,
        "ruta": f"/EvidenciasAppMovil/1080017116/{nombre}",
        "fecha": "2026-10-20",
        "tipo": tipo,
    }


def _build_png_bytes() -> bytes:
    """Genera un PNG real porque la evidencia pasa por la marca de agua."""
    from PIL import Image

    buffer = BytesIO()
    Image.new("RGB", (32, 32), (200, 30, 30)).save(buffer, format="PNG")
    return buffer.getvalue()


def _build_mp4_with_duration_seconds(duration_seconds: int) -> bytes:
    timescale = 1
    mvhd_payload = (
        b"\x00\x00\x00\x00"
        + b"\x00\x00\x00\x00"
        + b"\x00\x00\x00\x00"
        + timescale.to_bytes(4, "big")
        + duration_seconds.to_bytes(4, "big")
    )
    mvhd_box = (
        (8 + len(mvhd_payload)).to_bytes(4, "big")
        + b"mvhd"
        + mvhd_payload
    )
    moov_box = (
        (8 + len(mvhd_box)).to_bytes(4, "big")
        + b"moov"
        + mvhd_box
    )
    ftyp_box = (
        b"\x00\x00\x00\x18"
        + b"ftyp"
        + b"isom"
        + b"\x00\x00\x02\x00"
        + b"isomiso2"
    )
    return ftyp_box + moov_box


def _task_record(
    *,
    operador_id: int = 809772,
    usuario_creacion: str = "administrativo",
    novedades_ids: list[int] | None = None,
    estado: str = "PENDIENTE",
    evidencias: list[dict[str, str]] | None = None,
) -> dict[str, object]:
    return {
        "id": 1,
        "novedades_ids": novedades_ids or [15],
        "operador_id": operador_id,
        "tipo_tarea": "Inspección",
        "descripcion": "Revisar la unidad y adjuntar fotos.",
        "fecha_creacion": datetime(2026, 10, 20, tzinfo=timezone.utc),
        "usuario_creacion": usuario_creacion,
        "estado": estado,
        "evidencias": evidencias or [],
    }


if __name__ == "__main__":
    unittest.main()
