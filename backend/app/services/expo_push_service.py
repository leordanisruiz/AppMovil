import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.core.config import get_settings

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts"

NOVELTY_CHANNEL_ID = "novedades"
TASK_CHANNEL_ID = "tareas"


class ExpoRetryableError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class ExpoPermanentError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class ExpoInvalidPushToken(ExpoPermanentError):
    pass


class ExpoReceiptPending(ExpoRetryableError):
    pass


class ExpoPushClient:
    def send(self, token: str, novelty_id: int) -> str:
        return self._send_message(
            token,
            title="Nueva novedad",
            body="Tienes una nueva novedad abierta.",
            data={"tipo": "novedad", "id_novedad": novelty_id},
            channel_id=NOVELTY_CHANNEL_ID,
        )

    def send_task_assignment(
        self,
        token: str,
        *,
        task_id: int,
        task_type: str,
        novelty_ids: list[int] | None = None,
    ) -> str:
        return self._send_message(
            token,
            title="Nueva tarea asignada",
            body=_task_assignment_body(
                task_type=task_type,
                novelty_ids=novelty_ids or [],
            ),
            data={
                "tipo": "tarea",
                "id_tarea": task_id,
                "id_novedades": novelty_ids or [],
            },
            channel_id=TASK_CHANNEL_ID,
        )

    def send_task_status_change(
        self,
        token: str,
        *,
        task_id: int,
        status: str,
    ) -> str:
        status_label = {
            "completada": "completada",
            "cerrada": "cerrada",
        }.get(status)
        if status_label is None:
            raise ExpoPermanentError("INVALID_TASK_STATUS_EVENT")
        body = f"La tarea #{task_id} fue {status_label}."
        if status == "completada":
            body += (
                " Revisa las evidencias que dejó el operador y realiza el "
                "Cierre en SICO de la/s novedad/es."
            )
        return self._send_message(
            token,
            title="Tienes cambios en tus tareas",
            body=body,
            data={
                "tipo": "tarea",
                "evento": "cambio_estado",
                "id_tarea": task_id,
                "estado": status.upper(),
            },
            channel_id=TASK_CHANNEL_ID,
        )

    def _send_message(
        self,
        token: str,
        *,
        title: str,
        body: str,
        data: dict[str, Any],
        channel_id: str,
    ) -> str:
        payload = self._post(
            EXPO_PUSH_URL,
            {
                "to": token,
                "title": title,
                "body": body,
                "data": data,
                "sound": "default",
                "priority": "high",
                "channelId": channel_id,
            },
        )
        ticket = payload.get("data")
        if isinstance(ticket, list):
            ticket = ticket[0] if len(ticket) == 1 else None
        if not isinstance(ticket, dict):
            raise ExpoRetryableError("INVALID_EXPO_TICKET")
        if ticket.get("status") == "ok":
            ticket_id = ticket.get("id")
            if isinstance(ticket_id, str) and ticket_id:
                return ticket_id
            raise ExpoPermanentError("EXPO_TICKET_MISSING_ID")
        self._raise_provider_error(ticket)
        raise ExpoPermanentError("EXPO_REJECTED")

    def get_receipt(self, ticket_id: str) -> None:
        payload = self._post(
            EXPO_RECEIPTS_URL,
            {"ids": [ticket_id]},
        )
        receipts = payload.get("data")
        if not isinstance(receipts, dict):
            raise ExpoRetryableError("INVALID_EXPO_RECEIPT")
        receipt = receipts.get(ticket_id)
        if not isinstance(receipt, dict):
            raise ExpoReceiptPending("RECEIPT_NOT_READY")
        if receipt.get("status") == "ok":
            return
        if receipt.get("status") == "error":
            self._raise_provider_error(receipt)
        raise ExpoRetryableError("INVALID_EXPO_RECEIPT")

    @staticmethod
    def _post(url: str, body: dict[str, Any]) -> dict[str, Any]:
        settings = get_settings()
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        if settings.expo_access_token:
            headers["Authorization"] = (
                f"Bearer {settings.expo_access_token}"
            )

        request = Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers=headers,
            method="POST",
        )

        try:
            with urlopen(request, timeout=10) as response:
                payload = json.loads(response.read())
        except HTTPError as exc:
            exc.close()
            if exc.code in (408, 429) or exc.code >= 500:
                raise ExpoRetryableError(f"HTTP_{exc.code}") from None
            raise ExpoPermanentError(f"HTTP_{exc.code}") from None
        except (URLError, TimeoutError, OSError):
            raise ExpoRetryableError("NETWORK_ERROR") from None
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise ExpoRetryableError("INVALID_EXPO_RESPONSE") from None

        if not isinstance(payload, dict):
            raise ExpoRetryableError("INVALID_EXPO_RESPONSE")
        return payload

    @staticmethod
    def _raise_provider_error(result: dict[str, Any]) -> None:
        details = result.get("details")
        error_code = (
            details.get("error")
            if isinstance(details, dict)
            else None
        )
        if error_code == "DeviceNotRegistered":
            raise ExpoInvalidPushToken("DEVICE_NOT_REGISTERED")
        if error_code == "MessageRateExceeded":
            raise ExpoRetryableError("MESSAGE_RATE_EXCEEDED")
        raise ExpoPermanentError(str(error_code or "EXPO_REJECTED")[:64])


def _task_assignment_body(
    *,
    task_type: str,
    novelty_ids: list[int],
) -> str:
    novelty_label = ", ".join(str(novelty_id) for novelty_id in novelty_ids)
    return (
        f'Tienes una tarea nueva "{task_type}" '
        f"relacionada con la novedad ({novelty_label})."
    )
