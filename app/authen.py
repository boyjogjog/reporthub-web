import time
from fastapi import HTTPException, Request
from jose import JWTError, jwt

# --- CONFIG ---
SECRET_KEY = "my-very-secret-key"
ALGORITHM = "HS256"
# Standardizing to seconds (1 hour = 3600 seconds)
ACCESS_TOKEN_EXPIRE_SECONDS = 24 * 60 * 60 # 24 hours


# ---------------------------
# Token Creation
# ---------------------------

def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    # time.time() returns seconds since epoch as a float
    expire = int(time.time() + ACCESS_TOKEN_EXPIRE_SECONDS)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


# ---------------------------
# Token Verification
# ---------------------------

def verify_access_token(token: str) -> dict:
    # Decodes and automatically checks 'exp' claim against current time
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
    #return True


# ---------------------------
# Renew Token (Sliding Session)
# ---------------------------

def renew_access_token(old_payload: dict) -> tuple[str, int]:
    """
    Creates a fresh token using existing payload.
    Returns: (new_token, new_exp_timestamp)
    """
    # Filter out old 'exp' to replace it
    payload = {k: v for k, v in old_payload.items() if k != "exp"}

    new_exp = int(time.time() + ACCESS_TOKEN_EXPIRE_SECONDS)
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

    # Direct subtraction with time.time() is much cleaner
    now_ts = time.time()
    remaining_seconds = exp_ts - now_ts

    return max(int(remaining_seconds * 1000), 0)