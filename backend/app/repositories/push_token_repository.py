from sqlalchemy import text
from sqlalchemy.orm import Session

_LOCK_PUSH_TOKEN = text(
    """
    SELECT tipo_documento, identificacion
    FROM "DW_CONFIG".expo_push_tokens
    WHERE token_hash = :token_hash
    FOR UPDATE
    """
)

_UPSERT_PUSH_TOKEN = text(
    """
    INSERT INTO "DW_CONFIG".expo_push_tokens (
        token_hash,
        token_ciphertext,
        tipo_documento,
        identificacion,
        plataforma,
        activo
    )
    VALUES (
        :token_hash,
        :token_ciphertext,
        :tipo_documento,
        :identificacion,
        :plataforma,
        TRUE
    )
    ON CONFLICT (token_hash) DO UPDATE
    SET token_ciphertext = EXCLUDED.token_ciphertext,
        tipo_documento = EXCLUDED.tipo_documento,
        identificacion = EXCLUDED.identificacion,
        plataforma = EXCLUDED.plataforma,
        activo = TRUE,
        actualizado_en = CURRENT_TIMESTAMP
    """
)

_DEACTIVATE_PUSH_TOKEN = text(
    """
    UPDATE "DW_CONFIG".expo_push_tokens
    SET activo = FALSE,
        actualizado_en = CURRENT_TIMESTAMP
    WHERE token_hash = :token_hash
      AND tipo_documento = :tipo_documento
      AND identificacion = :identificacion
      AND activo = TRUE
    """
)

_CANCEL_PENDING_DELIVERIES = text(
    """
    UPDATE "DW_CONFIG".expo_push_outbox
    SET estado = 'cancelado',
        lease_until = NULL,
        claim_id = NULL
    WHERE token_hash = :token_hash
      AND estado IN ('pendiente', 'procesando', 'recibo_pendiente')
    """
)


class PushTokenRepository:
    def register(
        self,
        db: Session,
        *,
        token_hash: str,
        token_ciphertext: str,
        tipo_documento: str,
        identificacion: str,
        plataforma: str,
    ) -> None:
        previous_owner = (
            db.execute(_LOCK_PUSH_TOKEN, {"token_hash": token_hash})
            .mappings()
            .one_or_none()
        )
        if previous_owner is not None and (
            previous_owner["tipo_documento"] != tipo_documento
            or previous_owner["identificacion"] != identificacion
        ):
            db.execute(
                _CANCEL_PENDING_DELIVERIES,
                {"token_hash": token_hash},
            )
        db.execute(
            _UPSERT_PUSH_TOKEN,
            {
                "token_hash": token_hash,
                "token_ciphertext": token_ciphertext,
                "tipo_documento": tipo_documento,
                "identificacion": identificacion,
                "plataforma": plataforma,
            },
        )
        db.commit()

    def deactivate(
        self,
        db: Session,
        *,
        token_hash: str,
        tipo_documento: str,
        identificacion: str,
    ) -> bool:
        result = db.execute(
            _DEACTIVATE_PUSH_TOKEN,
            {
                "token_hash": token_hash,
                "tipo_documento": tipo_documento,
                "identificacion": identificacion,
            },
        )
        deactivated = bool(result.rowcount and result.rowcount > 0)
        if deactivated:
            db.execute(
                _CANCEL_PENDING_DELIVERIES,
                {"token_hash": token_hash},
            )
        db.commit()
        return deactivated
