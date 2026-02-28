"""
Identity Provider — Auth API routes
"""
import asyncio
from datetime import timezone
from jose import JWTError

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import get_settings
from app.core.security import (
    verify_password,
    hash_password,
    create_access_token,
    create_refresh_token,
    decode_token,
)
from app.db.database import get_db
from app.models.user import User
from app.schemas.auth import (
    LoginRequest,
    TokenResponse,
    RefreshRequest,
    UserCreateRequest,
    UserResponse,
    ChangePasswordRequest,
)

settings = get_settings()
router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    """Validate student credentials and issue JWT tokens."""
    result = await db.execute(select(User).where(User.student_id == payload.student_id))
    user: User | None = result.scalar_one_or_none()

    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid student ID or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled.")

    token_data = {"sub": user.id, "student_id": user.student_id, "is_admin": user.is_admin}
    access_token = create_access_token(token_data)
    refresh_token = create_refresh_token({"sub": user.id})

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(payload: RefreshRequest, db: AsyncSession = Depends(get_db)):
    """Issue new access token from valid refresh token."""
    try:
        claims = decode_token(payload.refresh_token)
        if claims.get("type") != "refresh":
            raise ValueError("Wrong token type")
    except (JWTError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token."
        )

    result = await db.execute(select(User).where(User.id == claims["sub"]))
    user: User | None = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found.")

    token_data = {"sub": user.id, "student_id": user.student_id, "is_admin": user.is_admin}
    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token({"sub": user.id}),
        expires_in=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: UserCreateRequest, db: AsyncSession = Depends(get_db)):
    """Register a new student account. [CONFIG DATA]"""
    # Check uniqueness
    existing = await db.execute(
        select(User).where(
            (User.student_id == payload.student_id) | (User.email == payload.email)
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Student ID or email already registered.")

    user = User(
        student_id=payload.student_id,
        email=payload.email,
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
        is_admin=payload.is_admin,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(payload: ChangePasswordRequest, db: AsyncSession = Depends(get_db)):
    """Change a user's password after verifying their current password."""
    result = await db.execute(select(User).where(User.student_id == payload.student_id))
    user: User | None = result.scalar_one_or_none()

    if not user or not verify_password(payload.current_password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid ID or current password.",
        )

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled.")

    user.hashed_password = hash_password(payload.new_password)
    await db.commit()
