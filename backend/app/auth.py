from __future__ import annotations

import time
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import settings
from app.db import get_db
from app.schemas import UserPublic

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# tokenUrl is only used by the OpenAPI docs UI ("Authorize" button) - the
# actual login endpoint is POST /auth/login.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login", auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def create_access_token(user_id: str, role: str) -> str:
    expire = time.time() + settings.JWT_EXPIRE_MINUTES * 60
    payload = {"sub": user_id, "role": role, "exp": expire}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def _decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session invalide ou expirée, veuillez vous reconnecter.",
        )


def doc_to_public(doc: dict) -> UserPublic:
    return UserPublic(
        id=doc["_id"],
        username=doc["username"],
        nom=doc["nom"],
        prenom=doc["prenom"],
        role=doc["role"],
        ip_poste=doc.get("ip_poste"),
        date_creation=doc["date_creation"],
        statut=doc["statut"],
    )


async def get_current_user(token: Optional[str] = Depends(oauth2_scheme)) -> UserPublic:
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentification requise."
        )
    payload = _decode_token(token)
    user_id = payload.get("sub")
    db = get_db()
    doc = await db.users.find_one({"_id": user_id})
    if not doc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Utilisateur introuvable.")
    if doc.get("statut") != "actif":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Compte désactivé.")
    return doc_to_public(doc)


async def require_admin(user: UserPublic = Depends(get_current_user)) -> UserPublic:
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Accès réservé aux administrateurs.",
        )
    return user
