import unittest
from typing import cast
from unittest.mock import MagicMock, Mock

from cryptography.fernet import Fernet
from sqlalchemy.orm import Session, sessionmaker

from app.repositories.push_notification_repository import (
    PushNotificationRepository,
)
from app.services.expo_push_service import (
    ExpoInvalidPushToken,
    ExpoPushClient,
    ExpoRetryableError,
)
from app.services.push_notification_worker import PushNotificationWorker


class PushNotificationWorkerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repository = Mock(spec=PushNotificationRepository)
        self.push_client = Mock(spec=ExpoPushClient)
        self.session_factory = MagicMock()
        self.session_factory.begin.return_value.__enter__.return_value = Mock()
        self.repository.claim_pending.return_value = []
        self.repository.claim_receipts.return_value = []
        self.encryption_key = Fernet.generate_key().decode("ascii")
        self.worker = PushNotificationWorker(
            self.repository,
            self.push_client,
            cast(sessionmaker[Session], self.session_factory),
            self.encryption_key,
            interval_seconds=60,
            batch_size=50,
        )

    def test_polling_is_skipped_when_another_worker_holds_lock(self) -> None:
        self.repository.try_acquire_poll_lock.return_value = False
        self.repository.claim_pending.return_value = []

        self.worker.run_once()

        self.repository.initialize_or_detect.assert_not_called()
        self.repository.claim_pending.assert_called_once()

    def test_repeated_worker_runs_use_lock_and_persisted_outbox(self) -> None:
        self.repository.try_acquire_poll_lock.side_effect = [True, False]
        self.repository.claim_pending.return_value = []

        self.worker.run_once()
        self.worker.run_once()

        self.repository.initialize_or_detect.assert_called_once()
        self.assertEqual(self.repository.claim_pending.call_count, 2)

    def test_accepted_expo_ticket_is_persisted(self) -> None:
        token = "ExpoPushToken[device-token_123456789]"
        encrypted_token = Fernet(self.encryption_key.encode("ascii")).encrypt(
            token.encode("utf-8")
        ).decode("ascii")
        self.repository.try_acquire_poll_lock.return_value = False
        self.repository.claim_pending.return_value = [
            {
                "id": 17,
                "id_novedad": 123,
                "token_hash": "a" * 64,
                "intentos": 1,
                "token_ciphertext": encrypted_token,
            }
        ]
        self.push_client.send.return_value = "ticket-1"

        self.worker.run_once()

        self.push_client.send.assert_called_once_with(token, 123)
        self.repository.mark_sent.assert_called_once()
        self.assertEqual(
            self.repository.mark_sent.call_args.kwargs["expo_ticket_id"],
            "ticket-1",
        )

    def test_transient_send_failure_is_persisted_for_retry(self) -> None:
        token = "ExpoPushToken[device-token_123456789]"
        encrypted_token = Fernet(self.encryption_key.encode("ascii")).encrypt(
            token.encode("utf-8")
        ).decode("ascii")
        self.repository.try_acquire_poll_lock.return_value = False
        self.repository.claim_pending.return_value = [
            {
                "id": 17,
                "id_novedad": 123,
                "token_hash": "a" * 64,
                "intentos": 1,
                "token_ciphertext": encrypted_token,
            }
        ]
        self.push_client.send.side_effect = ExpoRetryableError("HTTP_429")

        self.worker.run_once()

        self.repository.retry.assert_called_once()
        self.assertEqual(
            self.repository.retry.call_args.kwargs["delay_seconds"],
            120,
        )
        self.assertEqual(
            self.repository.retry.call_args.kwargs["error_code"],
            "HTTP_429",
        )

    def test_task_assignment_notification_uses_task_payload(self) -> None:
        token = "ExpoPushToken[device-token_123456789]"
        encrypted_token = Fernet(self.encryption_key.encode("ascii")).encrypt(
            token.encode("utf-8")
        ).decode("ascii")
        self.repository.try_acquire_poll_lock.return_value = False
        self.repository.claim_pending.return_value = [
            {
                "id": 20,
                "id_novedad": None,
                "task_id": 55,
                "tipo_tarea": "Capacitación",
                "token_hash": "b" * 64,
                "intentos": 1,
                "token_ciphertext": encrypted_token,
            }
        ]
        self.push_client.send_task_assignment.return_value = "ticket-task"

        self.worker.run_once()

        self.push_client.send_task_assignment.assert_called_once_with(
            token,
            task_id=55,
            task_type="Capacitación",
        )
        self.repository.mark_sent.assert_called_once()

    def test_device_not_registered_receipt_deactivates_token(self) -> None:
        self.repository.try_acquire_poll_lock.return_value = False
        self.repository.claim_receipts.return_value = [
            {
                "id": 17,
                "expo_ticket_id": "ticket-1",
                "token_hash": "a" * 64,
                "receipt_intentos": 1,
            }
        ]
        self.push_client.get_receipt.side_effect = ExpoInvalidPushToken(
            "DEVICE_NOT_REGISTERED"
        )

        self.worker.run_once()

        self.repository.fail.assert_called_once()
        self.assertEqual(
            self.repository.fail.call_args.kwargs["token_hash"],
            "a" * 64,
        )

    def test_receipt_retry_limit_moves_delivery_to_failed(self) -> None:
        self.repository.claim_receipts.return_value = [
            {
                "id": 17,
                "expo_ticket_id": "ticket-1",
                "token_hash": "a" * 64,
                "receipt_intentos": 10,
            }
        ]
        self.push_client.get_receipt.side_effect = ExpoRetryableError(
            "RECEIPT_NOT_READY"
        )

        self.worker.run_once()

        self.repository.fail.assert_called_once()
        self.assertEqual(
            self.repository.fail.call_args.kwargs["error_code"],
            "RECEIPT_RETRIES_EXHAUSTED",
        )
        self.repository.retry_receipt.assert_not_called()


if __name__ == "__main__":
    unittest.main()
