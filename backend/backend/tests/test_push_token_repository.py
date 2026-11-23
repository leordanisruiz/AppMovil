import unittest
from typing import cast
from unittest.mock import Mock

from sqlalchemy.orm import Session

from app.repositories.push_token_repository import PushTokenRepository


class PushTokenRepositoryTests(unittest.TestCase):
    def test_reassigning_device_cancels_previous_owner_deliveries(self) -> None:
        lookup_result = Mock()
        lookup_result.mappings.return_value.one_or_none.return_value = {
            "tipo_documento": "CC",
            "identificacion": "111",
        }
        db = Mock()
        db.execute.return_value = lookup_result
        repository = PushTokenRepository()

        repository.register(
            cast(Session, db),
            token_hash="a" * 64,
            token_ciphertext="encrypted",
            tipo_documento="CC",
            identificacion="222",
            plataforma="android",
        )

        self.assertEqual(db.execute.call_count, 3)
        cancel_statement, cancel_params = db.execute.call_args_list[1].args
        self.assertIn("expo_push_outbox", str(cancel_statement))
        self.assertEqual(cancel_params, {"token_hash": "a" * 64})
        upsert_statement, upsert_params = db.execute.call_args_list[2].args
        self.assertIn("ON CONFLICT (token_hash) DO UPDATE", str(upsert_statement))
        self.assertEqual(upsert_params["identificacion"], "222")
        db.commit.assert_called_once()

    def test_same_owner_registration_does_not_cancel_deliveries(self) -> None:
        lookup_result = Mock()
        lookup_result.mappings.return_value.one_or_none.return_value = {
            "tipo_documento": "CC",
            "identificacion": "111",
        }
        db = Mock()
        db.execute.return_value = lookup_result

        PushTokenRepository().register(
            cast(Session, db),
            token_hash="a" * 64,
            token_ciphertext="encrypted",
            tipo_documento="CC",
            identificacion="111",
            plataforma="ios",
        )

        self.assertEqual(db.execute.call_count, 2)
        db.commit.assert_called_once()

    def test_deactivation_is_scoped_to_token_and_identity(self) -> None:
        db = Mock()
        db.execute.return_value.rowcount = 1

        deactivated = PushTokenRepository().deactivate(
            cast(Session, db),
            token_hash="a" * 64,
            tipo_documento="CC",
            identificacion="111",
        )

        self.assertTrue(deactivated)
        statement, parameters = db.execute.call_args_list[0].args
        self.assertIn("tipo_documento = :tipo_documento", str(statement))
        self.assertIn("identificacion = :identificacion", str(statement))
        self.assertEqual(
            parameters,
            {
                "token_hash": "a" * 64,
                "tipo_documento": "CC",
                "identificacion": "111",
            },
        )
        db.commit.assert_called_once()


if __name__ == "__main__":
    unittest.main()
