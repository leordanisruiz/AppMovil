import json
from collections.abc import Mapping
from typing import Any

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

_TASK_COLUMNS = """
    id,
    novedades_ids,
    operador_id,
    tipo_tarea,
    descripcion,
    fecha_creacion,
    usuario_creacion,
    estado,
    COALESCE(evidencias->'evidencias', '[]'::jsonb) AS evidencias
"""

_SEARCH_OPERATORS = text(
    """
    SELECT
        de."Codigo"::text AS codigo,
        de."TipoDocumento" AS tipo_documento,
        de."Identificacion"::text AS identificacion,
        BTRIM(
            COALESCE(de."NombreEmpleado", '') || ' ' ||
            COALESCE(de."ApellidosEmpleado", '')
        ) AS nombre_completo
    FROM "DW_SUMA"."DimEmpleados" AS de
    WHERE de."IndicadorActividad" = 'A'
      AND de."Codigo" IS NOT NULL
      AND (
          de."Codigo"::text ILIKE :termino
          OR de."Identificacion"::text ILIKE :termino
      )
    ORDER BY nombre_completo
    LIMIT 25
    """
)

_OPERATOR_BY_CODE = text(
    """
    SELECT
        de."Codigo"::text AS codigo,
        de."TipoDocumento" AS tipo_documento,
        de."Identificacion"::text AS identificacion,
        BTRIM(
            COALESCE(de."NombreEmpleado", '') || ' ' ||
            COALESCE(de."ApellidosEmpleado", '')
        ) AS nombre_completo
    FROM "DW_SUMA"."DimEmpleados" AS de
    WHERE de."Codigo"::text = :codigo_operador
      AND de."IndicadorActividad" = 'A'
      AND de."Codigo" IS NOT NULL
    """
)

_OPERATOR_NOVELTIES = text(
    """
    SELECT
        fns."Id" AS id_novedad,
        fns."FechaIngreso" AS fecha_novedad,
        fns."Codigo" AS codigo,
        fns."Grupo" AS tipo_novedad,
        fns."Detalle" AS descripcion,
        fns."Estado" AS estado
    FROM "DW_SUMA"."FactNovedadesSico" AS fns
    WHERE fns."Codigo" = :codigo_operador
      AND (
          UPPER(fns."Estado") IS NULL
          OR fns."Estado" IN ('PEOCESO', 'PROCESO')
      )
    ORDER BY fns."FechaIngreso" DESC NULLS LAST, fns."Id" DESC
    """
)

_NOVELTIES_BY_IDS = text(
    """
    SELECT fns."Id" AS id_novedad, fns."Codigo" AS codigo
    FROM "DW_SUMA"."FactNovedadesSico" AS fns
    WHERE fns."Id" IN :novedad_ids
      AND (
          UPPER(fns."Estado") IS NULL
          OR fns."Estado" IN ('PEOCESO', 'PROCESO')
      )
    """
).bindparams(bindparam("novedad_ids", expanding=True))

_NOVELTY_BY_ID = text(
    """
    SELECT
        fns."Id" AS id_novedad,
        fns."FechaIngreso" AS fecha_novedad,
        fns."Codigo" AS codigo,
        fns."Grupo" AS tipo_novedad,
        fns."Detalle" AS descripcion,
        fns."Estado" AS estado,
        de."TipoDocumento" AS tipo_documento,
        de."Identificacion"::text AS identificacion,
        BTRIM(
            COALESCE(de."NombreEmpleado", '') || ' ' ||
            COALESCE(de."ApellidosEmpleado", '')
        ) AS nombre_completo
    FROM "DW_SUMA"."FactNovedadesSico" AS fns
    JOIN "DW_SUMA"."DimEmpleados" AS de
      ON de."Codigo" = fns."Codigo"::text
     AND de."IndicadorActividad" = 'A'
    WHERE fns."Id" = :novedad_id
      AND (
          UPPER(fns."Estado") IS NULL
          OR fns."Estado" IN ('PEOCESO', 'PROCESO')
      )
    """
)

_TASK_TYPES = text(
    """
    SELECT id, nombre
    FROM "DW_CONFIG".tipos_tareas
    WHERE activo = TRUE
    ORDER BY nombre
    """
)

_TASK_TYPE_BY_ID = text(
    """
    SELECT nombre
    FROM "DW_CONFIG".tipos_tareas
    WHERE id = :tipo_tarea_id AND activo = TRUE
    """
)

_CREATE_TASK = text(
    f"""
    INSERT INTO "DW_OPERACIONAL".tareas_operador (
        novedades_ids,
        operador_id,
        tipo_tarea,
        descripcion,
        usuario_creacion,
        estado,
        evidencias
    )
    VALUES (
        CAST(:novedades_ids AS jsonb),
        :operador_id,
        :tipo_tarea,
        :descripcion,
        :usuario_creacion,
        'PENDIENTE',
        '{{"evidencias": []}}'::jsonb
    )
    RETURNING {_TASK_COLUMNS}
    """
)

_ENQUEUE_TASK_NOTIFICATIONS = text(
    """
    INSERT INTO "DW_CONFIG".expo_push_outbox (
        task_id,
        task_event,
        token_hash,
        estado,
        intentos,
        proximo_intento
    )
    SELECT
        :task_id,
        'asignacion',
        device.token_hash,
        'pendiente',
        0,
        CURRENT_TIMESTAMP
    FROM "DW_CONFIG".expo_push_tokens AS device
    JOIN "DW_SUMA"."DimEmpleados" AS employee
      ON employee."TipoDocumento"::text = device.tipo_documento
     AND employee."Identificacion"::text = device.identificacion
     AND employee."Codigo" = CAST(:operador_id AS text)
     AND employee."IndicadorActividad" = 'A'
    WHERE device.activo = TRUE
    ON CONFLICT (task_id, token_hash, task_event)
        WHERE task_id IS NOT NULL
    DO NOTHING
    """
)

_ENQUEUE_TASK_STATUS_NOTIFICATIONS = text(
    """
    INSERT INTO "DW_CONFIG".expo_push_outbox (
        task_id,
        task_event,
        token_hash,
        estado,
        intentos,
        proximo_intento
    )
    SELECT
        :task_id,
        :task_event,
        device.token_hash,
        'pendiente',
        0,
        CURRENT_TIMESTAMP
    FROM "DW_OPERACIONAL".tareas_operador AS task
    JOIN "DW_CONFIG".expo_push_tokens AS device
      ON device.activo = TRUE
     AND (
         (
             :task_event = 'completada'
             AND device.tipo_documento = split_part(task.usuario_creacion, '-', 1)
             AND device.identificacion = split_part(task.usuario_creacion, '-', 2)
         )
         OR (
             :task_event = 'cerrada'
             AND EXISTS (
                 SELECT 1
                 FROM "DW_SUMA"."DimEmpleados" AS employee
                 WHERE employee."TipoDocumento"::text = device.tipo_documento
                   AND employee."Identificacion"::text = device.identificacion
                   AND employee."Codigo" = CAST(task.operador_id AS text)
                   AND employee."IndicadorActividad" = 'A'
             )
         )
     )
    WHERE task.id = :task_id
      AND (
          :task_event <> 'completada'
          OR EXISTS (
              SELECT 1
              FROM "DW_CONFIG".usuarios_app AS creator
              WHERE creator.tipo_documento = split_part(task.usuario_creacion, '-', 1)
                AND creator.identificacion = split_part(task.usuario_creacion, '-', 2)
                AND creator.rol_id IN (1, 2)
          )
      )
    ON CONFLICT (task_id, token_hash, task_event)
        WHERE task_id IS NOT NULL
    DO NOTHING
    """
)

_LIST_BY_OPERATOR = text(
    f"""
    SELECT {_TASK_COLUMNS}
    FROM "DW_OPERACIONAL".tareas_operador
    WHERE operador_id = :operador_id
    ORDER BY fecha_creacion DESC, id DESC
    """
)

_LIST_BY_CREATOR = text(
    f"""
    SELECT {_TASK_COLUMNS}
    FROM "DW_OPERACIONAL".tareas_operador
    WHERE usuario_creacion = :usuario_creacion
    ORDER BY fecha_creacion DESC, id DESC
    """
)

_GET_BY_ID = text(
    f"""
    SELECT {_TASK_COLUMNS}
    FROM "DW_OPERACIONAL".tareas_operador
    WHERE id = :tarea_id AND operador_id = :operador_id
    """
)

_GET_BY_CREATOR = text(
    f"""
    SELECT {_TASK_COLUMNS}
    FROM "DW_OPERACIONAL".tareas_operador
    WHERE id = :tarea_id AND usuario_creacion = :usuario_creacion
    """
)

_APPEND_EVIDENCES = text(
    f"""
    UPDATE "DW_OPERACIONAL".tareas_operador
    SET evidencias = jsonb_set(
            COALESCE(evidencias, '{{"evidencias": []}}'::jsonb),
            '{{evidencias}}',
            COALESCE(evidencias->'evidencias', '[]'::jsonb)
                || CAST(:evidencias AS jsonb)
        ),
        estado = CASE
            WHEN estado = 'PENDIENTE' THEN 'EN_PROCESO'
            ELSE estado
        END
    WHERE id = :tarea_id
      AND operador_id = :operador_id
      AND estado NOT IN ('COMPLETADA', 'CERRADO')
    RETURNING {_TASK_COLUMNS}
    """
)

_UPDATE_STATE = text(
    f"""
    UPDATE "DW_OPERACIONAL".tareas_operador
    SET estado = :estado
    WHERE id = :tarea_id
      AND operador_id = :operador_id
    RETURNING {_TASK_COLUMNS}
    """
)

_CLOSE_CREATED_TASK = text(
    f"""
    UPDATE "DW_OPERACIONAL".tareas_operador
    SET estado = 'CERRADO'
    WHERE id = :tarea_id
      AND usuario_creacion = :usuario_creacion
      AND estado <> 'CERRADO'
    RETURNING {_TASK_COLUMNS}
    """
)


class TareasRepository:
    def search_operators(
        self,
        db: Session,
        *,
        search: str,
    ) -> list[Mapping[str, Any]]:
        result = db.execute(
            _SEARCH_OPERATORS,
            {"termino": f"%{search}%"},
        )
        return list(result.mappings().all())

    def get_operator_by_code(
        self,
        db: Session,
        *,
        codigo_operador: int,
    ) -> Mapping[str, Any] | None:
        result = db.execute(
            _OPERATOR_BY_CODE,
            {"codigo_operador": str(codigo_operador)},
        )
        return result.mappings().one_or_none()

    def list_open_novelties(
        self,
        db: Session,
        *,
        codigo_operador: int,
    ) -> list[Mapping[str, Any]]:
        result = db.execute(
            _OPERATOR_NOVELTIES,
            {"codigo_operador": codigo_operador},
        )
        return list(result.mappings().all())

    def get_novelty(
        self,
        db: Session,
        *,
        novedad_id: int,
    ) -> Mapping[str, Any] | None:
        result = db.execute(_NOVELTY_BY_ID, {"novedad_id": novedad_id})
        return result.mappings().one_or_none()

    def get_open_novelties_by_ids(
        self,
        db: Session,
        *,
        novedad_ids: list[int],
    ) -> list[Mapping[str, Any]]:
        result = db.execute(_NOVELTIES_BY_IDS, {"novedad_ids": novedad_ids})
        return list(result.mappings().all())

    def list_task_types(self, db: Session) -> list[Mapping[str, Any]]:
        return list(db.execute(_TASK_TYPES).mappings().all())

    def get_task_type_name(
        self,
        db: Session,
        *,
        tipo_tarea_id: int,
    ) -> str | None:
        return db.execute(
            _TASK_TYPE_BY_ID,
            {"tipo_tarea_id": tipo_tarea_id},
        ).scalar_one_or_none()

    def create_task(
        self,
        db: Session,
        *,
        operador_id: int,
        novedades_ids: list[int],
        tipo_tarea: str,
        descripcion: str,
        usuario_creacion: str,
    ) -> tuple[Mapping[str, Any], int]:
        result = db.execute(
            _CREATE_TASK,
            {
                "operador_id": operador_id,
                "novedades_ids": json.dumps(novedades_ids),
                "tipo_tarea": tipo_tarea,
                "descripcion": descripcion,
                "usuario_creacion": usuario_creacion,
            },
        )
        task = result.mappings().one()
        notification_result = db.execute(
            _ENQUEUE_TASK_NOTIFICATIONS,
            {"task_id": task["id"], "operador_id": operador_id},
        )
        notification_count = notification_result.rowcount or 0
        db.commit()
        return task, notification_count

    def list_by_operator(
        self,
        db: Session,
        *,
        operador_id: int,
    ) -> list[Mapping[str, Any]]:
        result = db.execute(_LIST_BY_OPERATOR, {"operador_id": operador_id})
        return list(result.mappings().all())

    def list_by_creator(
        self,
        db: Session,
        *,
        usuario_creacion: str,
    ) -> list[Mapping[str, Any]]:
        result = db.execute(
            _LIST_BY_CREATOR,
            {"usuario_creacion": usuario_creacion},
        )
        return list(result.mappings().all())

    def get_by_id(
        self,
        db: Session,
        *,
        tarea_id: int,
        operador_id: int,
    ) -> Mapping[str, Any] | None:
        result = db.execute(
            _GET_BY_ID,
            {"tarea_id": tarea_id, "operador_id": operador_id},
        )
        return result.mappings().one_or_none()

    def get_by_creator(
        self,
        db: Session,
        *,
        tarea_id: int,
        usuario_creacion: str,
    ) -> Mapping[str, Any] | None:
        result = db.execute(
            _GET_BY_CREATOR,
            {
                "tarea_id": tarea_id,
                "usuario_creacion": usuario_creacion,
            },
        )
        return result.mappings().one_or_none()

    def append_evidences(
        self,
        db: Session,
        *,
        tarea_id: int,
        operador_id: int,
        evidencias: list[dict[str, str]],
    ) -> Mapping[str, Any] | None:
        result = db.execute(
            _APPEND_EVIDENCES,
            {
                "tarea_id": tarea_id,
                "operador_id": operador_id,
                "evidencias": json.dumps(evidencias),
            },
        )
        task = result.mappings().one_or_none()
        if task is not None:
            db.commit()
        return task

    def update_state(
        self,
        db: Session,
        *,
        tarea_id: int,
        operador_id: int,
        estado: str,
    ) -> Mapping[str, Any] | None:
        result = db.execute(
            _UPDATE_STATE,
            {
                "tarea_id": tarea_id,
                "operador_id": operador_id,
                "estado": estado,
            },
        )
        task = result.mappings().one_or_none()
        if task is not None:
            if estado == "COMPLETADA":
                db.execute(
                    _ENQUEUE_TASK_STATUS_NOTIFICATIONS,
                    {
                        "task_id": task["id"],
                        "task_event": "completada",
                    },
                )
            db.commit()
        return task

    def close_created_task(
        self,
        db: Session,
        *,
        tarea_id: int,
        usuario_creacion: str,
    ) -> Mapping[str, Any] | None:
        result = db.execute(
            _CLOSE_CREATED_TASK,
            {
                "tarea_id": tarea_id,
                "usuario_creacion": usuario_creacion,
            },
        )
        task = result.mappings().one_or_none()
        if task is not None:
            db.execute(
                _ENQUEUE_TASK_STATUS_NOTIFICATIONS,
                {
                    "task_id": task["id"],
                    "task_event": "cerrada",
                },
            )
            db.commit()
        return task
