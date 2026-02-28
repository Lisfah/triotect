"""
Identity Provider — Pydantic schemas
"""
from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    student_id: str = Field(..., min_length=1, max_length=64, examples=["STU-2021-001"])
    password: str = Field(..., min_length=6, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds


class RefreshRequest(BaseModel):
    refresh_token: str


class UserCreateRequest(BaseModel):
    student_id: str = Field(..., min_length=1, max_length=64)
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=128)
    full_name: str = Field(..., min_length=1, max_length=255)
    is_admin: bool = False


class UserResponse(BaseModel):
    id: str
    student_id: str
    email: str
    full_name: str
    is_admin: bool
    is_active: bool

    model_config = {"from_attributes": True}


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    dependencies: dict[str, str]
