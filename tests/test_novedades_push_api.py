import asyncio
import unittest
from typing import cast
from unittest.mock import Mock, patch

from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import Response

from app.api.v1.novedades import registrar_push_token
from app.middleware.auth_middleware import JWTAuthMiddleware
from app.schemas.novedad import PushTokenRequest
from sqlalchemy.orm import Session


class NovedadesPushApiTests(unittest.TestCase):
    def test_registration_uses_jwt_identity_not_client_identity(self) -> None:
        request = Request(
            {
                "type": "http",
                "method": "POST",
                "path": "/api/v1/novedades/push-tokens",
                "headers": [],
                "query_string": b"",
                "server": ("testserver", 80),
                "client": ("testclient", 12345),
                "scheme": "http",
                "http_version": "1.1",
            }
        )
        request.state.token_payload = {
            "TipoDocumento": "CC",
            "Identificacion": "123456",
        }
        database = cast(Session, Mock())
        push_request = PushTokenRequest(
            expo_push_token="ExpoPushToken[device-token_123456789]",
            plataforma="android",
        )

        with patch(
            "app.api.v1.novedades.push_token_service"
        ) as push_token_service:
            response = registrar_push_token(
                request,
                push_request,
                database,
            )

        self.assertTrue(response.registrado)
        push_token_service.register.assert_called_once_with(
            database,
            expo_push_token="ExpoPushToken[device-token_123456789]",
            plataforma="android",
            tipo_documento="CC",
            identificacion="123456",
        )

    def test_registration_schema_rejects_client_chosen_operator_identity(
        self,
    ) -> None:
        with self.assertRaises(ValueError):
            PushTokenRequest.model_validate(
                {
                    "expo_push_token": "ExpoPushToken[device-token_123456789]",
                    "plataforma": "ios",
                    "identificacion": "somebody-else",
                }
            )

    def test_registration_requires_authenticated_identity_in_request_state(
        self,
    ) -> None:
        request = Request(
            {
                "type": "http",
                "method": "POST",
                "path": "/api/v1/novedades/push-tokens",
                "headers": [],
                "query_string": b"",
                "server": ("testserver", 80),
                "client": ("testclient", 12345),
                "scheme": "http",
                "http_version": "1.1",
            }
        )
        request.state.token_payload = {}
        with self.assertRaises(HTTPException) as context:
            registrar_push_token(
                request,
                PushTokenRequest(
                    expo_push_token="ExpoPushToken[device-token_123456789]",
                    plataforma="ios",
                ),
                cast(Session, Mock()),
            )
        self.assertEqual(context.exception.status_code, 401)

    def test_push_token_route_requires_bearer_authentication(self) -> None:
        request = Request(
            {
                "type": "http",
                "method": "POST",
                "path": "/api/v1/novedades/push-tokens",
                "headers": [],
                "query_string": b"",
                "server": ("testserver", 80),
                "client": ("testclient", 12345),
                "scheme": "http",
                "http_version": "1.1",
            }
        )
        middleware = JWTAuthMiddleware(Mock())

        async def next_response(_: Request) -> Response:
            return Response("ok")

        response = asyncio.run(
            middleware.dispatch(request, next_response)
        )

        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
