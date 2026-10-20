import unittest
from typing import cast
from unittest.mock import Mock

from app.repositories import push_notification_repository
from sqlalchemy.orm import Session


class PushNotificationRepositoryTests(unittest.TestCase):
    def test_first_poll_only_persists_baseline_snapshot(self) -> None:
        repository = push_notification_repository.PushNotificationRepository()
        db = Mock()
        state_result = Mock()
        state_result.scalar_one.return_value = False
        db.execute.return_value = state_result

        discovered_new_items = repository.initialize_or_detect(
            cast(Session, db)
        )

        self.assertFalse(discovered_new_items)
        self.assertEqual(db.execute.call_count, 3)
        self.assertIs(
            db.execute.call_args_list[1].args[0],
            push_notification_repository._POLL_INITIAL_SNAPSHOT,
        )
        self.assertIs(
            db.execute.call_args_list[2].args[0],
            push_notification_repository._MARK_INITIAL_SNAPSHOT_COMPLETE,
        )

    def test_later_poll_persists_new_rows_and_deduplicates_outbox(self) -> None:
        repository = push_notification_repository.PushNotificationRepository()
        db = Mock()
        state_result = Mock()
        state_result.scalar_one.return_value = True
        db.execute.return_value = state_result

        discovered_new_items = repository.initialize_or_detect(
            cast(Session, db)
        )

        self.assertTrue(discovered_new_items)
        self.assertEqual(db.execute.call_count, 3)
        self.assertIs(
            db.execute.call_args_list[1].args[0],
            push_notification_repository._POLL_NEW_NOVELTIES,
        )
        self.assertIn(
            "ON CONFLICT (id_novedad, token_hash) DO NOTHING",
            str(push_notification_repository._POLL_NEW_NOVELTIES),
        )

    def test_polling_uses_database_lock_and_initial_snapshot(self) -> None:
        self.assertIn(
            "pg_try_advisory_xact_lock",
            str(push_notification_repository._POLL_OPEN_NOVELTIES),
        )
        snapshot_sql = str(
            push_notification_repository._POLL_INITIAL_SNAPSHOT
        )
        self.assertIn("historica", snapshot_sql)
        self.assertIn("ON CONFLICT (id_novedad) DO NOTHING", snapshot_sql)
        self.assertIn(
            "expo_push_seen_novelties",
            snapshot_sql,
        )

    def test_new_open_rows_create_unique_persisted_outbox_deliveries(self) -> None:
        discovery_sql = str(push_notification_repository._POLL_NEW_NOVELTIES)
        self.assertIn('"DW_SUMA"."FactNovedadesSico"', discovery_sql)
        self.assertIn('"DW_SUMA"."DimEmpleados"', discovery_sql)
        self.assertIn("employee.\"IndicadorActividad\" = 'A'", discovery_sql)
        self.assertIn("device.activo = TRUE", discovery_sql)
        self.assertIn("ON CONFLICT (id_novedad, token_hash) DO NOTHING", discovery_sql)

    def test_claims_outbox_rows_without_locking_other_workers(self) -> None:
        claim_sql = str(push_notification_repository._CLAIM_OUTBOX)
        self.assertIn("FOR UPDATE OF delivery SKIP LOCKED", claim_sql)
        self.assertIn("delivery.lease_until < CURRENT_TIMESTAMP", claim_sql)
        self.assertIn("delivery.expo_ticket_id IS NULL", claim_sql)
        self.assertIn("delivery.intentos + 1", claim_sql)

    def test_claims_expo_receipts_and_retries_late_results(self) -> None:
        receipt_sql = str(push_notification_repository._CLAIM_RECEIPTS)
        self.assertIn("FOR UPDATE OF delivery SKIP LOCKED", receipt_sql)
        self.assertIn("delivery.estado = 'recibo_pendiente'", receipt_sql)
        self.assertIn(
            "delivery.receipt_intentos + 1",
            receipt_sql,
        )


if __name__ == "__main__":
    unittest.main()
