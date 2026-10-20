from fastapi import HTTPException, Request, status
from fastapi.responses import JSONResponse, Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

from app.core.config import get_settings
from app.core.security import decode_access_token


class JWTAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self,
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        api_prefix = get_settings().api_v1_prefix.rstrip("/")
        is_api_request = request.url.path.startswith(f"{api_prefix}/")
        public_auth_routes = {
            f"{api_prefix}/auth/login",
            f"{api_prefix}/auth/validate-registration",
            f"{api_prefix}/auth/register-password",
        }
        is_public_route = request.url.path in public_auth_routes

        if not is_api_request or is_public_route or request.method == "OPTIONS":
            return await call_next(request)

        authorization = request.headers.get("Authorization", "")
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token:
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": "Se requiere un token Bearer válido."},
                headers={"WWW-Authenticate": "Bearer"},
            )

        try:
            request.state.token_payload = decode_access_token(token)
        except HTTPException as exc:
            return JSONResponse(
                status_code=exc.status_code,
                content={"detail": exc.detail},
                headers=exc.headers,
            )

        return await call_next(request)
