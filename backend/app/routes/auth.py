from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import (
    create_access_token,
    get_current_user,
    verify_password,
    doc_to_public,
    oauth2_scheme,
)
from app.db import get_db
from app.schemas import LoginRequest, MeResponse, TokenResponse, UserPublic

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest) -> TokenResponse:
    db = get_db()
    doc = await db.users.find_one({"username": payload.username})
    if not doc or not verify_password(payload.password, doc["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Nom d'utilisateur ou mot de passe incorrect !",
        )
    if doc.get("statut") != "actif":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Compte désactivé.")

    token, expires_at = create_access_token(user_id=doc["_id"], role=doc["role"])
    return TokenResponse(access_token=token, expires_at=expires_at, user=doc_to_public(doc))


@router.get("/me", response_model=MeResponse)
async def me(
    token: str | None = Depends(oauth2_scheme), user: UserPublic = Depends(get_current_user)
) -> MeResponse:
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentification requise."
        )
    from app.auth import _decode_token

    payload = _decode_token(token)
    return MeResponse(expires_at=float(payload["exp"]), user=user)
