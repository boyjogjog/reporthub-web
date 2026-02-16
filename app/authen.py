import time
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException, Request
from jose import JWTError, jwt

# --- CONFIG ---
SECRET_KEY = "my-very-secret-key"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60


# ---------------------------
# Token Creation
# ---------------------------

def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": int(expire.timestamp())})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


# ---------------------------
# Token Verification
# ---------------------------

def verify_access_token(token: str) -> dict:
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])


# ---------------------------
# Extract From Request
# ---------------------------

async def get_auth_data(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        return verify_access_token(token)
    except JWTError:
        raise HTTPException(status_code=401, detail="Session expired")


# ---------------------------
# Renew Token (Sliding Session)
# ---------------------------

def renew_access_token(old_payload: dict) -> tuple[str, int]:
    """
    Creates a fresh token using existing payload.
    Returns:
        (new_token, new_exp_timestamp)
    """

    # Remove old exp if present
    payload = {k: v for k, v in old_payload.items() if k != "exp"}

    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    new_exp = int(expire.timestamp())

    payload.update({"exp": new_exp})

    new_token = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

    return new_token, new_exp


# ---------------------------
# Helper: Remaining TTL
# ---------------------------

def get_token_ttl_ms(payload: dict) -> int:
    exp_ts = payload.get("exp")
    if not exp_ts:
        return 0

    now_ts = int(datetime.now(timezone.utc).timestamp())

    return max((exp_ts - now_ts) * 1000, 0)

