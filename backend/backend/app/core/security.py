from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
from fastapi import HTTPException, status
from jose import JWTError, jwt

from app.core.config import get_settings

_JWT_ALGORITHM = "HS256"
_MIN_SECRET_LENGTH_BYTES = 32
_BCRYPT_ROUNDS = 12


def hash_password(password: str) -> str:
    if len(password) != 8 or not password.isascii() or not password.isdigit():
        raise ValueError("Password must contain exactly eight ASCII digits.")
    return bcrypt.hashpw(
        password.encode("utf-8"),
        bcrypt.gensalt(rounds=_BCRYPT_ROUNDS),
    ).decode("ascii")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(
            password.encode("utf-8"),
            password_hash.encode("ascii"),
        )
    except (UnicodeEncodeError, ValueError):
        return False


def _get_signing_key() -> str:
    settings = get_settings()
    secret_key = settings.jwt_secret_key
    if (
        not secret_key
        or len(secret_key.encode("utf-8")) < _MIN_SECRET_LENGTH_BYTES
        or settings.jwt_algorithm != _JWT_ALGORITHM
        or settings.access_token_expire_minutes <= 0
    ):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "La configuración JWT no es válida. Configure una clave "
                "de al menos 32 bytes, HS256 y una expiración positiva."
            ),
        )
    return secret_key


def create_access_token(
    subject: str,
    document_type: str,
    identification: str,
    expires_delta: timedelta | None = None,
) -> str:
    settings = get_settings()
    secret_key = _get_signing_key()

    issued_at = datetime.now(timezone.utc)
    expires_at = issued_at + (
        expires_delta
        if expires_delta is not None
        else timedelta(minutes=settings.access_token_expire_minutes)
    )
    return jwt.encode(
        {
            "sub": subject,
            "TipoDocumento": document_type,
            "Identificacion": identification,
            "iat": issued_at,
            "exp": expires_at,
        },
        secret_key,
        algorithm=_JWT_ALGORITHM,
    )


def decode_access_token(token: str) -> dict[str, Any]:
    secret_key = _get_signing_key()

    try:
        return jwt.decode(
            token,
            secret_key,
            algorithms=[_JWT_ALGORITHM],
        )
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido o expirado.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
