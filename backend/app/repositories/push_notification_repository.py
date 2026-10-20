from collections.abc import Mapping
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

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
        UPPER(fns."Estado") IS NULL
        OR fns."Estado" IN ('PEOCESO', 'PROCESO')
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

_POLL_NEW_NOVELTIES = text(
    """
    WITH newly_seen AS (
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
            FALSE
        FROM "DW_SUMA"."FactNovedadesSico" AS fns
        WHERE (
            UPPER(fns."Estado") IS NULL
            OR fns."Estado" IN ('PEOCESO', 'PROCESO')
        )
          AND NOT EXISTS (
              SELECT 1
              FROM "DW_CONFIG".expo_push_seen_novelties AS seen
              WHERE seen.id_novedad = fns."Id"
          )
        ON CONFLICT (id_novedad) DO NOTHING
        RETURNING id_novedad, codigo_operador
    )
    INSERT INTO "DW_CONFIG".expo_push_outbox (
        id_novedad,
        token_hash,
        estado,
        intentos,
        proximo_intento
    )
    SELECT
        newly_seen.id_novedad,
        device.token_hash,
        'pendiente',
        0,
        CURRENT_TIMESTAMP
    FROM newly_seen
    JOIN "DW_SUMA"."DimEmpleados" AS employee
      ON employee."Codigo" = newly_seen.codigo_operador
     AND employee."IndicadorActividad" = 'A'
    JOIN "DW_CONFIG".expo_push_tokens AS device
      ON device.tipo_documento = employee."TipoDocumento"
     AND device.identificacion = employee."Identificacion"
     AND device.activo = TRUE
    ON CONFLICT (id_novedad, token_hash) DO NOTHING
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
    """
    WITH candidates AS (
        SELECT delivery.id
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
    FROM candidates, "DW_CONFIG".expo_push_tokens AS device
    WHERE delivery.id = candidates.id
      AND device.token_hash = delivery.token_hash
      AND delivery.expo_ticket_id IS NULL
    RETURNING
        delivery.id,
        delivery.id_novedad,
        delivery.token_hash,
        delivery.intentos,
        device.token_ciphertext
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
    def try_acquire_poll_lock(self, db: Session) -> bool:
        return bool(db.execute(_POLL_OPEN_NOVELTIES).scalar_one())

    def initialize_or_detect(self, db: Session) -> bool:
        initialized = db.execute(_IS_INITIALIZED).scalar_one()
        if not initialized:
            db.execute(_POLL_INITIAL_SNAPSHOT)
            db.execute(_MARK_INITIAL_SNAPSHOT_COMPLETE)
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
