"""
Order Gateway — Security helper (JWT decode only, shared secret)
"""
from jose import jwt, JWTError
from typing import Any
from app.core.config import get_settings

settings = get_settings()


def decode_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
