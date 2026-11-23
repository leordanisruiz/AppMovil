from collections.abc import Mapping
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.repositories.novedades_repository import (
    DANOS_FILTER,
    ICO_FILTER,
    INASISTENCIAS_FILTER,
    ISV_FILTER,
    NovedadesRepository,
)

_SICO_CATEGORY = f"""CASE
    WHEN {ISV_FILTER} THEN 'isv'
    WHEN {DANOS_FILTER} THEN 'danos'
    WHEN {INASISTENCIAS_FILTER} THEN 'inasistencias'
    ELSE 'otras'
END"""

_CURRENT_NOVELTIES = f"""
    SELECT 'sico' AS fuente, fns."Id" AS id_novedad,
           NULLIF(BTRIM(fns."Codigo"::text), '') AS codigo_operador,
           {_SICO_CATEGORY} AS categoria
    FROM "DW_SUMA"."FactNovedadesSico" AS fns
    WHERE fns."Estado" IS NULL
       OR UPPER(BTRIM(fns."Estado")) IN ('PEOCESO', 'PROCESO')
    UNION ALL
    SELECT 'ico' AS fuente, fi."IdIco" AS id_novedad,
           NULLIF(BTRIM(REPLACE(fi."IdSaeConductor"::text, '.0', '')), '') AS codigo_operador,
           'ico' AS categoria
    FROM "DW_SUMA"."FactICO" AS fi
    WHERE {ICO_FILTER}
"""

_POLL_OPEN_NOVELTIES = text(
    """
    SELECT pg_try_advisory_xact_lock(735190042, 1)
    """
)

_POLL_INITIAL_SNAPSHOT = text(
    """
    INSERT INTO "DW_CONFIG".expo_push_seen_novelties (
        id_novedad,
        codigo_operador,
        primera_vez_vista,
        historica
    )
    SELECT DISTINCT
        fns."Id",
        fns."Codigo",
        CURRENT_TIMESTAMP,
        TRUE
    FROM "DW_SUMA"."FactNovedadesSico" AS fns
    WHERE (
        fns."Estado" IS NULL
        OR UPPER(BTRIM(fns."Estado")) IN ('PEOCESO', 'PROCESO')
    )
    ON CONFLICT (id_novedad) DO NOTHING
    """
)

_MARK_INITIAL_SNAPSHOT_COMPLETE = text(
    """
    UPDATE "DW_CONFIG".expo_push_poll_state
    SET inicializado = TRUE,
        ultimo_sondeo = CURRENT_TIMESTAMP
    WHERE id = 1
    """
)

_IS_CATEGORIES_INITIALIZED = text(
    'SELECT categorias_inicializadas FROM "DW_CONFIG".expo_push_poll_state WHERE id = 1'
)

_SNAPSHOT_CATEGORIES = text(
    f"""
    INSERT INTO "DW_CONFIG".expo_push_novelty_state
        (fuente, id_novedad, codigo_operador, categoria, revision)
    SELECT 'sico', seen.id_novedad, NULLIF(BTRIM(seen.codigo_operador::text), ''),
           {_SICO_CATEGORY}, 0
    FROM "DW_CONFIG".expo_push_seen_novelties AS seen
    JOIN "DW_SUMA"."FactNovedadesSico" AS fns ON fns."Id" = seen.id_novedad
    UNION ALL
    SELECT 'ico', fi."IdIco",
           NULLIF(BTRIM(REPLACE(fi."IdSaeConductor"::text, '.0', '')), ''),
           'ico', 0
    FROM "DW_SUMA"."FactICO" AS fi
    WHERE {ICO_FILTER}
    ON CONFLICT (fuente, id_novedad) DO NOTHING
    """
)

_MARK_CATEGORIES_INITIALIZED = text(
    'UPDATE "DW_CONFIG".expo_push_poll_state SET categorias_inicializadas = TRUE WHERE id = 1'
)

_POLL_NEW_NOVELTIES = text(
    f"""
    WITH current_novelties AS (
        {_CURRENT_NOVELTIES}
    ), changed AS (
        INSERT INTO "DW_CONFIG".expo_push_novelty_state AS previous
            (fuente, id_novedad, codigo_operador, categoria, revision)
        SELECT DISTINCT fuente, id_novedad, codigo_operador, categoria, 1
        FROM current_novelties
        WHERE id_novedad IS NOT NULL
        ON CONFLICT (fuente, id_novedad) DO UPDATE
        SET codigo_operador = EXCLUDED.codigo_operador,
            categoria = EXCLUDED.categoria,
            revision = previous.revision + 1
        WHERE previous.codigo_operador IS DISTINCT FROM EXCLUDED.codigo_operador
           OR previous.categoria IS DISTINCT FROM EXCLUDED.categoria
        RETURNING fuente, id_novedad, codigo_operador, categoria, revision
    ), reset_reads AS (
        DELETE FROM "DW_CONFIG".novedades_vistas AS viewed
        USING changed, "DW_CONFIG".expo_push_novelty_state AS previous
        WHERE viewed.codigo_operador = changed.codigo_operador
          AND viewed.id_novedad = changed.id_novedad
          AND previous.fuente = changed.fuente
          AND previous.id_novedad = changed.id_novedad
          AND (previous.codigo_operador IS DISTINCT FROM changed.codigo_operador
               OR previous.categoria IS DISTINCT FROM changed.categoria)
          AND ((changed.fuente = 'ico' AND viewed.categoria = 'ico')
               OR (changed.fuente = 'sico' AND viewed.categoria <> 'ico'))
        RETURNING viewed.id_novedad
    ), cancel_stale AS (
        UPDATE "DW_CONFIG".expo_push_outbox AS delivery
        SET estado = 'cancelado', lease_until = NULL, claim_id = NULL
        FROM "DW_CONFIG".expo_push_novelty_events AS event
        WHERE delivery.novelty_event_id = event.id
          AND delivery.estado = 'pendiente'
          AND (
              EXISTS (
                  SELECT 1 FROM changed
                  WHERE changed.fuente = event.fuente
                    AND changed.id_novedad = event.id_novedad
                    AND changed.revision <> event.revision
              )
              OR NOT EXISTS (
                  SELECT 1 FROM current_novelties AS current_novelty
                  WHERE current_novelty.fuente = event.fuente
                    AND current_novelty.id_novedad = event.id_novedad
                    AND current_novelty.codigo_operador = event.codigo_operador
                    AND current_novelty.categoria = event.categoria
              )
          )
        RETURNING delivery.id
    ), new_events AS (
        INSERT INTO "DW_CONFIG".expo_push_novelty_events
            (fuente, id_novedad, codigo_operador, categoria, revision)
        SELECT fuente, id_novedad, codigo_operador, categoria, revision
        FROM changed
        WHERE codigo_operador IS NOT NULL
        RETURNING id, fuente, id_novedad, codigo_operador, revision
    ), eligible_novelties AS (
        SELECT id, fuente, id_novedad, codigo_operador, revision FROM new_events
        UNION ALL
        SELECT event.id, event.fuente, event.id_novedad, event.codigo_operador, event.revision
        FROM "DW_CONFIG".expo_push_novelty_events AS event
        JOIN "DW_CONFIG".expo_push_novelty_state AS current_state
          ON current_state.fuente = event.fuente
         AND current_state.id_novedad = event.id_novedad
         AND current_state.revision = event.revision
        WHERE NOT EXISTS (
            SELECT 1 FROM changed
            WHERE changed.fuente = event.fuente
              AND changed.id_novedad = event.id_novedad
        )
    )
    INSERT INTO "DW_CONFIG".expo_push_outbox (
        id_novedad,
        novelty_event_id,
        token_hash,
        estado,
        intentos,
        proximo_intento
    )
    SELECT
        eligible_novelties.id_novedad,
        eligible_novelties.id,
        device.token_hash,
        'pendiente',
        0,
        CURRENT_TIMESTAMP
    FROM eligible_novelties
    JOIN "DW_SUMA"."DimEmpleados" AS employee
      ON BTRIM(employee."Codigo"::text) =
         BTRIM(eligible_novelties.codigo_operador::text)
     AND UPPER(BTRIM(employee."IndicadorActividad")) = 'A'
    JOIN "DW_CONFIG".expo_push_tokens AS device
      ON BTRIM(device.tipo_documento) = BTRIM(employee."TipoDocumento"::text)
     AND BTRIM(device.identificacion) = BTRIM(employee."Identificacion"::text)
     AND device.activo = TRUE
    JOIN current_novelties AS current_novelty
      ON current_novelty.fuente = eligible_novelties.fuente
     AND current_novelty.id_novedad = eligible_novelties.id_novedad
     AND current_novelty.codigo_operador = eligible_novelties.codigo_operador
    ON CONFLICT (novelty_event_id, token_hash)
        WHERE novelty_event_id IS NOT NULL
    DO NOTHING
    """
)

_UPDATE_LAST_POLL = text(
    """
    UPDATE "DW_CONFIG".expo_push_poll_state
    SET ultimo_sondeo = CURRENT_TIMESTAMP
    WHERE id = 1
    """
)

_IS_INITIALIZED = text(
    """
    SELECT inicializado
    FROM "DW_CONFIG".expo_push_poll_state
    WHERE id = 1
    FOR UPDATE
    """
)

_CLAIM_OUTBOX = text(
    f"""
    WITH candidates AS (
        SELECT
            delivery.id,
            delivery.id_novedad,
            delivery.novelty_event_id,
            delivery.task_id,
            delivery.task_event,
            delivery.token_hash
        FROM "DW_CONFIG".expo_push_outbox AS delivery
        JOIN "DW_CONFIG".expo_push_tokens AS device
          ON device.token_hash = delivery.token_hash
         AND device.activo = TRUE
        WHERE (
            delivery.estado = 'pendiente'
            AND delivery.proximo_intento <= CURRENT_TIMESTAMP
        ) OR (
            delivery.estado = 'procesando'
            AND delivery.lease_until < CURRENT_TIMESTAMP
            AND delivery.expo_ticket_id IS NULL
        )
        ORDER BY delivery.proximo_intento, delivery.id
        FOR UPDATE OF delivery SKIP LOCKED
        LIMIT :batch_size
    )
    UPDATE "DW_CONFIG".expo_push_outbox AS delivery
    SET estado = 'procesando',
        intentos = delivery.intentos + 1,
        lease_until = CURRENT_TIMESTAMP + INTERVAL '30 minutes',
        claim_id = :claim_id
    FROM candidates
    JOIN "DW_CONFIG".expo_push_tokens AS device
      ON device.token_hash = candidates.token_hash
     AND device.activo = TRUE
    LEFT JOIN "DW_OPERACIONAL".tareas_operador AS task
      ON task.id = candidates.task_id
    LEFT JOIN "DW_CONFIG".expo_push_novelty_events AS novelty_event
      ON novelty_event.id = candidates.novelty_event_id
    LEFT JOIN "DW_SUMA"."FactNovedadesSico" AS fns
      ON fns."Id" = candidates.id_novedad
     AND (novelty_event.fuente = 'sico' OR novelty_event.id IS NULL)
    WHERE delivery.id = candidates.id
      AND delivery.expo_ticket_id IS NULL
    RETURNING
        delivery.id,
        delivery.id_novedad,
        delivery.task_id,
        delivery.task_event,
        delivery.token_hash,
        delivery.intentos,
        device.token_ciphertext,
        task.tipo_tarea,
        task.novedades_ids,
        novelty_event.categoria AS novelty_category,
        novelty_event.codigo_operador AS novelty_operator_code,
        fns."Grupo" AS novelty_group,
        CASE WHEN {ISV_FILTER} THEN TRUE ELSE FALSE END AS is_isv
    """
)

_MARK_SENT = text(
    """
    UPDATE "DW_CONFIG".expo_push_outbox
    SET estado = CASE
            WHEN :expo_ticket_id = '' THEN 'enviado'
            ELSE 'recibo_pendiente'
        END,
        expo_ticket_id = :expo_ticket_id,
        proximo_intento = CURRENT_TIMESTAMP + INTERVAL '15 minutes',
        lease_until = NULL,
        claim_id = NULL,
        ultimo_error = NULL
    WHERE id = :id
      AND claim_id = :claim_id
      AND estado = 'procesando'
    """
)

_CLAIM_RECEIPTS = text(
    """
    WITH candidates AS (
        SELECT delivery.id
        FROM "DW_CONFIG".expo_push_outbox AS delivery
        WHERE (
            delivery.estado = 'recibo_pendiente'
            AND delivery.proximo_intento <= CURRENT_TIMESTAMP
        ) OR (
            delivery.estado = 'procesando'
            AND delivery.lease_until < CURRENT_TIMESTAMP
            AND delivery.expo_ticket_id IS NOT NULL
        )
        ORDER BY delivery.proximo_intento, delivery.id
        FOR UPDATE OF delivery SKIP LOCKED
        LIMIT :batch_size
    )
    UPDATE "DW_CONFIG".expo_push_outbox AS delivery
    SET estado = 'procesando',
        receipt_intentos = delivery.receipt_intentos + 1,
        lease_until = CURRENT_TIMESTAMP + INTERVAL '30 minutes',
        claim_id = :claim_id
    FROM candidates
    WHERE delivery.id = candidates.id
      AND delivery.expo_ticket_id IS NOT NULL
    RETURNING
        delivery.id,
        delivery.expo_ticket_id,
        delivery.token_hash,
        delivery.receipt_intentos
    """
)

_MARK_RECEIPT_SENT = text(
    """
    UPDATE "DW_CONFIG".expo_push_outbox
    SET estado = 'enviado',
        lease_until = NULL,
        claim_id = NULL,
        ultimo_error = NULL
    WHERE id = :id
      AND claim_id = :claim_id
      AND estado = 'procesando'
    """
)

_RETRY_RECEIPT = text(
    """
    UPDATE "DW_CONFIG".expo_push_outbox
    SET estado = 'recibo_pendiente',
        proximo_intento = CURRENT_TIMESTAMP
            + (:delay_seconds * INTERVAL '1 second'),
        lease_until = NULL,
        claim_id = NULL,
        ultimo_error = :error_code
    WHERE id = :id
      AND claim_id = :claim_id
      AND estado = 'procesando'
    """
)

_RETRY_DELIVERY = text(
    """
    UPDATE "DW_CONFIG".expo_push_outbox
    SET estado = 'pendiente',
        proximo_intento = CURRENT_TIMESTAMP
            + (:delay_seconds * INTERVAL '1 second'),
        lease_until = NULL,
        claim_id = NULL,
        ultimo_error = :error_code
    WHERE id = :id
      AND claim_id = :claim_id
      AND estado = 'procesando'
    """
)

_FAIL_DELIVERY = text(
    """
    UPDATE "DW_CONFIG".expo_push_outbox
    SET estado = 'fallido',
        lease_until = NULL,
        claim_id = NULL,
        ultimo_error = :error_code
    WHERE id = :id
      AND claim_id = :claim_id
      AND estado = 'procesando'
    """
)

_DEACTIVATE_INVALID_TOKEN = text(
    """
    UPDATE "DW_CONFIG".expo_push_tokens
    SET activo = FALSE,
        actualizado_en = CURRENT_TIMESTAMP
    WHERE token_hash = :token_hash
    """
)

_CANCEL_TOKEN_DELIVERIES = text(
    """
    UPDATE "DW_CONFIG".expo_push_outbox
    SET estado = 'cancelado',
        lease_until = NULL,
        claim_id = NULL
    WHERE token_hash = :token_hash
      AND estado IN ('pendiente', 'procesando', 'recibo_pendiente')
    """
)


class PushNotificationRepository:
    def count_unread(self, db: Session, *, codigo_operador: int) -> int:
        return NovedadesRepository().count_unread(db, codigo_operador=codigo_operador)

    def try_acquire_poll_lock(self, db: Session) -> bool:
        return bool(db.execute(_POLL_OPEN_NOVELTIES).scalar_one())

    def initialize_or_detect(self, db: Session) -> bool:
        initialized = db.execute(_IS_INITIALIZED).scalar_one()
        if not initialized:
            db.execute(_POLL_INITIAL_SNAPSHOT)
            db.execute(_MARK_INITIAL_SNAPSHOT_COMPLETE)
        if not db.execute(_IS_CATEGORIES_INITIALIZED).scalar_one():
            db.execute(_SNAPSHOT_CATEGORIES)
            db.execute(_MARK_CATEGORIES_INITIALIZED)
        if not initialized:
            return False

        db.execute(_POLL_NEW_NOVELTIES)
        db.execute(_UPDATE_LAST_POLL)
        return True

    def claim_pending(
        self,
        db: Session,
        *,
        batch_size: int,
        claim_id: str,
    ) -> list[Mapping[str, Any]]:
        return list(
            db.execute(
                _CLAIM_OUTBOX,
                {"batch_size": batch_size, "claim_id": claim_id},
            )
            .mappings()
            .all()
        )

    def claim_receipts(
        self,
        db: Session,
        *,
        batch_size: int,
        claim_id: str,
    ) -> list[Mapping[str, Any]]:
        return list(
            db.execute(
                _CLAIM_RECEIPTS,
                {"batch_size": batch_size, "claim_id": claim_id},
            )
            .mappings()
            .all()
        )

    def mark_sent(
        self,
        db: Session,
        *,
        delivery_id: int,
        claim_id: str,
        expo_ticket_id: str,
    ) -> None:
        db.execute(
            _MARK_SENT,
            {
                "id": delivery_id,
                "claim_id": claim_id,
                "expo_ticket_id": expo_ticket_id,
            },
        )

    def mark_receipt_sent(
        self,
        db: Session,
        *,
        delivery_id: int,
        claim_id: str,
    ) -> None:
        db.execute(
            _MARK_RECEIPT_SENT,
            {"id": delivery_id, "claim_id": claim_id},
        )

    def retry_receipt(
        self,
        db: Session,
        *,
        delivery_id: int,
        claim_id: str,
        delay_seconds: int,
        error_code: str,
    ) -> None:
        db.execute(
            _RETRY_RECEIPT,
            {
                "id": delivery_id,
                "claim_id": claim_id,
                "delay_seconds": delay_seconds,
                "error_code": error_code[:64],
            },
        )

    def retry(
        self,
        db: Session,
        *,
        delivery_id: int,
        claim_id: str,
        delay_seconds: int,
        error_code: str,
    ) -> None:
        db.execute(
            _RETRY_DELIVERY,
            {
                "id": delivery_id,
                "claim_id": claim_id,
                "delay_seconds": delay_seconds,
                "error_code": error_code[:64],
            },
        )

    def fail(
        self,
        db: Session,
        *,
        delivery_id: int,
        claim_id: str,
        error_code: str,
        token_hash: str | None = None,
    ) -> None:
        db.execute(
            _FAIL_DELIVERY,
            {
                "id": delivery_id,
                "claim_id": claim_id,
                "error_code": error_code[:64],
            },
        )
        if token_hash is not None:
            db.execute(
                _DEACTIVATE_INVALID_TOKEN,
                {"token_hash": token_hash},
            )
            db.execute(
                _CANCEL_TOKEN_DELIVERIES,
                {"token_hash": token_hash},
            )
