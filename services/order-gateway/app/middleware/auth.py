"""
Order Gateway — JWT Authentication Middleware
Validates Bearer token on all protected routes; returns 401 on failure.
"""
import re
from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from jose import JWTError

from app.core.config import get_settings
from app.core.security import decode_token

settings = get_settings()

# Paths that do NOT require authentication
PUBLIC_PATHS = {
    "/health",
    "/metrics",
    "/",
    "/docs",
    "/openapi.json",
}


class JWTAuthMiddleware(BaseHTTPMiddleware):
    """
    Intercepts every request. Validates JWT Bearer token.
    Attaches decoded claims to request.state.user on success.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        if request.method == "OPTIONS":
            return await call_next(request)

        if request.url.path in PUBLIC_PATHS or request.url.path.startswith("/metrics"):
            return await call_next(request)

        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return JSONResponse(
                status_code=401,
                content={"detail": "Missing or invalid Authorization header. Expected: Bearer <token>"},
                headers={"WWW-Authenticate": "Bearer"},
            )

        token = auth_header.split(" ", 1)[1]
        try:
            claims = decode_token(token)
            request.state.user = claims
        except JWTError as exc:
            return JSONResponse(
                status_code=401,
                content={"detail": f"Invalid or expired JWT: {str(exc)}"},
                headers={"WWW-Authenticate": "Bearer"},
            )

        return await call_next(request)
