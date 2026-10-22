"""Administrator sign-in for the System view.

"""

from __future__ import annotations

import hmac
import secrets
import threading
import time

from fastapi import APIRouter, Header, HTTPException, Response, status
from pydantic import BaseModel, Field

ADMIN_USERNAME = "admin01"
ADMIN_PASSWORD = "INF2003Admin"

# A session ends after a period without a System request, and after eight hours
# in any case; the administrator then signs in again. The frontend locks the
# screen after 30 idle minutes and refreshes this timer at most every 5 minutes
# (frontend/src/authContext.tsx), so the backend allows 30 + 5 minutes and the
# screen lock always comes first.
IDLE_SECONDS = (30 + 5) * 60
SESSION_SECONDS = 8 * 60 * 60

# token -> (absolute expiry, idle expiry)
_sessions: dict[str, tuple[float, float]] = {}
_lock = threading.Lock()

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str = Field(max_length=100)
    password: str = Field(max_length=200)


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"code": "not_authenticated", "message": "Sign in as an administrator to use the System view."},
        headers={"WWW-Authenticate": "Bearer"},
    )


def _bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    return token.strip() if scheme.lower() == "bearer" and token.strip() else None


def require_admin(authorization: str | None = Header(default=None)) -> None:
    """Reject the request with HTTP 401 unless it carries a live session token.

    Each accepted request pushes the idle expiry forward, never past the
    absolute expiry.
    """

    token = _bearer_token(authorization)
    now = time.time()
    with _lock:
        session = _sessions.get(token) if token else None
        if session is None or min(session) < now:
            if token:
                _sessions.pop(token, None)
            raise _unauthorized()
        expires = session[0]
        _sessions[token] = (expires, min(expires, now + IDLE_SECONDS))


@router.post("/login")
def login(body: LoginRequest) -> dict:
    # compare_digest on both fields so a wrong username takes as long as a wrong password.
    username_ok = hmac.compare_digest(body.username.encode(), ADMIN_USERNAME.encode())
    password_ok = hmac.compare_digest(body.password.encode(), ADMIN_PASSWORD.encode())
    if not (username_ok and password_ok):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "invalid_credentials", "message": "Incorrect username or password."},
        )

    token = secrets.token_urlsafe(32)
    now = time.time()
    with _lock:
        # Drop expired sessions so the table cannot grow without bound.
        for stale in [key for key, session in _sessions.items() if min(session) < now]:
            del _sessions[stale]
        _sessions[token] = (now + SESSION_SECONDS, now + IDLE_SECONDS)
    return {"data": {"token": token, "username": ADMIN_USERNAME, "expires_in": SESSION_SECONDS,
                     "idle_timeout": IDLE_SECONDS}}


@router.get("/me")
def me(authorization: str | None = Header(default=None)) -> dict:
    require_admin(authorization)
    return {"data": {"username": ADMIN_USERNAME}}


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(authorization: str | None = Header(default=None)) -> Response:
    token = _bearer_token(authorization)
    if token:
        with _lock:
            _sessions.pop(token, None)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
