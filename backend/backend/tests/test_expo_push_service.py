import json
import unittest
from io import BytesIO
from unittest.mock import Mock, patch
from urllib.error import HTTPError

from app.services.expo_push_service import (
    ExpoInvalidPushToken,
    ExpoPermanentError,
    ExpoPushClient,
    ExpoRetryableError,
)


class ExpoPushServiceTests(unittest.TestCase):
    def test_sends_generic_message_and_novelty_id(self) -> None:
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = json.dumps(
            {"data": {"status": "ok", "id": "ticket-1"}}
        ).encode("utf-8")

        with patch(
            "app.services.expo_push_service.urlopen",
            return_value=response,
        ) as urlopen:
            ticket_id = ExpoPushClient().send(
                "ExpoPushToken[device-token_123456789]",
                123,
            )

        self.assertEqual(ticket_id, "ticket-1")
        request = urlopen.call_args.args[0]
        payload = json.loads(request.data.decode("utf-8"))
        self.assertEqual(payload["data"]["id_novedad"], 123)
        self.assertEqual(payload["title"], "Nueva novedad")
        self.assertNotIn("token", payload["body"].lower())

    def test_sends_task_assignment_with_task_navigation_data(self) -> None:
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = json.dumps(
            {"data": {"status": "ok", "id": "task-ticket"}}
        ).encode("utf-8")

        with patch(
            "app.services.expo_push_service.urlopen",
            return_value=response,
        ) as urlopen:
            ticket_id = ExpoPushClient().send_task_assignment(
                "ExpoPushToken[device-token_123456789]",
                task_id=55,
                task_type="Capacitación",
                novelty_ids=[123, 456],
            )

        self.assertEqual(ticket_id, "task-ticket")
        payload = json.loads(urlopen.call_args.args[0].data.decode("utf-8"))
        self.assertEqual(payload["title"], "Nueva tarea asignada")
        self.assertEqual(
            payload["body"],
            (
                'Tienes una tarea nueva "Capacitación" '
                "relacionada con la novedad (123, 456)."
            ),
        )
        self.assertEqual(
            payload["data"],
            {"tipo": "tarea", "id_tarea": 55, "id_novedades": [123, 456]},
        )

    def test_task_status_payloads_use_task_channel_and_navigation_data(self) -> None:
        client = ExpoPushClient()
        for status in ("completada", "cerrada"):
            with self.subTest(status=status), patch.object(
                client, "_post", return_value={"data": {"status": "ok", "id": "ticket"}}
            ) as post:
                client.send_task_status_change("ExpoPushToken[device]", task_id=55, status=status)
                payload = post.call_args.args[1]
                self.assertEqual(payload["channelId"], "tareas")
                self.assertEqual(payload["data"], {
                    "tipo": "tarea", "evento": "cambio_estado",
                    "id_tarea": 55, "estado": status.upper(),
                })
                self.assertIn(status, payload["body"])

    def test_sends_isv_message_with_novelty_navigation_data(self) -> None:
        client = ExpoPushClient()
        with patch.object(client, "_post", return_value={"data": {"status": "ok", "id": "ticket"}}) as post:
            self.assertEqual(client.send_isv("ExpoPushToken[device]", 123), "ticket")
        payload = post.call_args.args[1]
        self.assertEqual(payload["title"], "⚠️ Nuevo ISV detectado")
        self.assertEqual(payload["body"], "Tiene una nueva novedad ISV pendiente de revisión.")
        self.assertEqual(payload["data"], {"tipo": "novedad", "id_novedad": 123, "categoria": "isv"})
        self.assertEqual(payload["channelId"], "novedades")

    def test_category_messages_include_unread_badge(self) -> None:
        client = ExpoPushClient()
        cases = (
            (client.send_ico, "ico", "🔴 Nuevo ICO detectado"),
            (client.send_isv, "isv", "⚠️ Nuevo ISV detectado"),
            (client.send_absence, "inasistencias", "📅 Nueva Inasistencia"),
            (client.send_operational_damage, "danos", "🚌 Nuevo Daño Operativo"),
        )
        for send, category, title in cases:
            with self.subTest(category=category), patch.object(
                client, "_post", return_value={"data": {"status": "ok", "id": "ticket"}}
            ) as post:
                send("ExpoPushToken[device]", 123, badge=4)
                payload = post.call_args.args[1]
                self.assertEqual(payload["title"], title)
                self.assertEqual(payload["data"]["categoria"], category)
                self.assertEqual(payload["badge"], 4)

    def test_marks_unregistered_token_for_deactivation(self) -> None:
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = json.dumps(
            {
                "data": {
                    "status": "error",
                    "details": {"error": "DeviceNotRegistered"},
                }
            }
        ).encode("utf-8")

        with (
            patch(
                "app.services.expo_push_service.urlopen",
                return_value=response,
            ),
            self.assertRaises(ExpoInvalidPushToken),
        ):
            ExpoPushClient().send(
                "ExpoPushToken[device-token_123456789]",
                123,
            )

    def test_retries_rate_limited_expo_request(self) -> None:
        error = HTTPError(
            "https://exp.host/--/api/v2/push/send",
            429,
            "rate limited",
            {},
            BytesIO(b""),
        )
        with (
            patch(
                "app.services.expo_push_service.urlopen",
                side_effect=error,
            ),
            self.assertRaises(ExpoRetryableError),
        ):
            ExpoPushClient().send(
                "ExpoPushToken[device-token_123456789]",
                123,
            )

    def test_invalid_fcm_credentials_remain_retryable(self) -> None:
        client = ExpoPushClient()
        with patch.object(
            client, "_post",
            return_value={"data": {"status": "error", "details": {"error": "InvalidCredentials"}}},
        ), self.assertRaises(ExpoRetryableError) as context:
            client.send_isv("ExpoPushToken[device]", 123)
        self.assertEqual(context.exception.code, "INVALID_CREDENTIALS")

    def test_retrieves_receipt_by_ticket_id(self) -> None:
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = json.dumps(
            {"data": {"ticket-1": {"status": "ok"}}}
        ).encode("utf-8")

        with patch(
            "app.services.expo_push_service.urlopen",
            return_value=response,
        ) as urlopen:
            ExpoPushClient().get_receipt("ticket-1")

        request = urlopen.call_args.args[0]
        self.assertIn("/getReceipts", request.full_url)
        self.assertEqual(
            json.loads(request.data.decode("utf-8")),
            {"ids": ["ticket-1"]},
        )

    def test_does_not_mark_ticket_without_id_as_success(self) -> None:
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = json.dumps(
            {"data": {"status": "ok"}}
        ).encode("utf-8")

        with (
            patch(
                "app.services.expo_push_service.urlopen",
                return_value=response,
            ),
            self.assertRaises(ExpoPermanentError),
        ):
            ExpoPushClient().send(
                "ExpoPushToken[device-token_123456789]",
                123,
            )


if __name__ == "__main__":
    unittest.main()
