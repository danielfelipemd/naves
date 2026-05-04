from fastapi import Header, HTTPException, status
from .config import settings


def require_internal_token(x_internal_token: str = Header(default="")) -> None:
    """Backend Node calls Python with this shared secret in X-Internal-Token header."""
    if not settings.internal_api_token:
        # In dev allow without token for debugging; tighten in prod
        return
    if x_internal_token != settings.internal_api_token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid internal token")
