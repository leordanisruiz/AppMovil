import asyncio
import logging
from collections.abc import Mapping
from typing import Any
from uuid import uuid4

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.repositories.push_notification_repository import (
    PushNotificationRepository,
)
from app.services.expo_push_service import (
    ExpoInvalidPushToken,
    ExpoPermanentError,
    ExpoPushClient,
    ExpoRetryableError,
)

logger = logging.getLogger(__name__)


class PushNotificationWorker:
    def __init__(
        self,
        repository: PushNotificationRepository,
        push_client: ExpoPushClient,
        session_factory: sessionmaker[Session] | None,
        encryption_key: str | None,
        *,
        interval_seconds: int,
        batch_size: int,
    ) -> None:
        if interval_seconds < 1:
            raise ValueError("Expo polling interval must be positive.")
        if batch_size < 1 or batch_size > 100:
            raise ValueError("Expo batch size must be between 1 and 100.")
        self._repository = repository
        self._push_client = push_client
        self._session_factory = session_factory
        self._fernet = (
            Fernet(encryption_key.encode("ascii"))
            if encryption_key is not None
            else None
        )
        self._interval_seconds = interval_seconds
        self._batch_size = batch_size

    async def run(self) -> None:
        while True:
            try:
                await asyncio.to_thread(self.run_once)
            except SQLAlchemyError as exc:
                logger.error(
                    "Expo notification worker database operation failed (%s): %s",
                    type(exc).__name__,
                    getattr(exc, "orig", exc),
                )
            except (ExpoRetryableError, OSError, ValueError) as exc:
                logger.error(
                    "Expo notification worker cycle failed (%s): %s",
                    type(exc).__name__,
                    exc,
                )
            await asyncio.sleep(self._interval_seconds)

    def run_once(self) -> None:
        session_factory = self._session_factory
        fernet = self._fernet
        if session_factory is None or fernet is None:
            logger.error(
                "Expo notification worker is enabled without database "
                "or encryption configuration."
            )
            return

        claim_id = str(uuid4())
        with session_factory.begin() as db:
            if self._repository.try_acquire_poll_lock(db):
                self._repository.initialize_or_detect(db)

        with session_factory.begin() as db:
            deliveries = self._repository.claim_pending(
                db,
                batch_size=self._batch_size,
                claim_id=claim_id,
            )

        with session_factory.begin() as db:
            receipts = self._repository.claim_receipts(
                db,
                batch_size=self._batch_size,
                claim_id=claim_id,
            )

        for delivery in deliveries:
            self._deliver(
                delivery=delivery,
                claim_id=claim_id,
                fernet=fernet,
                session_factory=session_factory,
            )
        for receipt in receipts:
            self._deliver_receipt(
                receipt=receipt,
                claim_id=claim_id,
                session_factory=session_factory,
            )

    def _deliver(
        self,
        *,
        delivery: Mapping[str, Any],
        claim_id: str,
        fernet: Fernet,
        session_factory: sessionmaker[Session],
    ) -> None:
        delivery_id = delivery["id"]
        novelty_id = delivery.get("id_novedad")
        task_id = delivery.get("task_id")
        token_hash = delivery["token_hash"]
        attempt = delivery["intentos"]
        encrypted_token = delivery["token_ciphertext"]

        try:
            token = fernet.decrypt(encrypted_token.encode("ascii")).decode(
                "utf-8"
            )
        except (InvalidToken, UnicodeEncodeError, UnicodeDecodeError):
            logger.error(
                "Could not decrypt a stored Expo token; re-register the device."
            )
            with session_factory.begin() as db:
                self._repository.fail(
                    db,
                    delivery_id=delivery_id,
                    claim_id=claim_id,
                    error_code="TOKEN_DECRYPTION_FAILED",
                )
            return

        try:
            if task_id is not None:
                ticket_id = self._push_client.send_task_assignment(
                    token,
                    task_id=task_id,
                    task_type=delivery.get("tipo_tarea", "actividad asignada"),
                )
            else:
                ticket_id = self._push_client.send(token, novelty_id)
        except ExpoInvalidPushToken as exc:
            self._finish_failed(
                delivery_id,
                claim_id,
                exc.code,
                token_hash=token_hash,
                session_factory=session_factory,
            )
        except ExpoPermanentError as exc:
            self._finish_failed(
                delivery_id,
                claim_id,
                exc.code,
                session_factory=session_factory,
            )
        except ExpoRetryableError as exc:
            delay_seconds = min(60 * 2 ** min(attempt, 10), 21_600)
            with session_factory.begin() as db:
                self._repository.retry(
                    db,
                    delivery_id=delivery_id,
                    claim_id=claim_id,
                    delay_seconds=delay_seconds,
                    error_code=exc.code,
                )
            logger.warning(
                "Expo push delivery will be retried (%s).",
                exc.code,
            )
        else:
            with session_factory.begin() as db:
                self._repository.mark_sent(
                    db,
                    delivery_id=delivery_id,
                    claim_id=claim_id,
                    expo_ticket_id=ticket_id,
                )
            logger.info("Expo push ticket accepted.")

    def _finish_failed(
        self,
        delivery_id: int,
        claim_id: str,
        error_code: str,
        *,
        token_hash: str | None = None,
        session_factory: sessionmaker[Session],
    ) -> None:
        with session_factory.begin() as db:
            self._repository.fail(
                db,
                delivery_id=delivery_id,
                claim_id=claim_id,
                error_code=error_code,
                token_hash=token_hash,
            )
        if token_hash is not None:
            logger.info("Expo deactivated an unregistered push token.")
        else:
            logger.warning(
                "Expo permanently rejected a push message (%s).",
                error_code,
            )

    def _deliver_receipt(
        self,
        *,
        receipt: Mapping[str, Any],
        claim_id: str,
        session_factory: sessionmaker[Session],
    ) -> None:
        delivery_id = receipt["id"]
        ticket_id = receipt["expo_ticket_id"]
        token_hash = receipt["token_hash"]
        attempt = receipt["receipt_intentos"]

        try:
            self._push_client.get_receipt(ticket_id)
        except ExpoInvalidPushToken as exc:
            self._finish_failed(
                delivery_id,
                claim_id,
                exc.code,
                token_hash=token_hash,
                session_factory=session_factory,
            )
        except ExpoPermanentError as exc:
            self._finish_failed(
                delivery_id,
                claim_id,
                exc.code,
                session_factory=session_factory,
            )
        except ExpoRetryableError as exc:
            if attempt >= 10:
                self._finish_failed(
                    delivery_id,
                    claim_id,
                    "RECEIPT_RETRIES_EXHAUSTED",
                    session_factory=session_factory,
                )
                logger.error(
                    "Expo receipt retries were exhausted (%s).",
                    exc.code,
                )
                return
            delay_seconds = min(60 * 2 ** min(attempt, 10), 21_600)
            with session_factory.begin() as db:
                self._repository.retry_receipt(
                    db,
                    delivery_id=delivery_id,
                    claim_id=claim_id,
                    delay_seconds=delay_seconds,
                    error_code=exc.code,
                )
            logger.warning(
                "Expo receipt will be retried (%s).",
                exc.code,
            )
        else:
            with session_factory.begin() as db:
                self._repository.mark_receipt_sent(
                    db,
                    delivery_id=delivery_id,
                    claim_id=claim_id,
                )
            logger.info("Expo confirmed a push receipt.")


def create_push_notification_worker() -> PushNotificationWorker:
    settings = get_settings()
    return PushNotificationWorker(
        PushNotificationRepository(),
        ExpoPushClient(),
        SessionLocal,
        settings.expo_push_token_encryption_key,
        interval_seconds=settings.expo_poll_interval_seconds,
        batch_size=settings.expo_poll_batch_size,
    )
