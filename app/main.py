# =========================
# 🔹 Standard Library
# =========================
import json
import asyncio
import random
import string
import time
from pathlib import Path

# =========================
# 🔹 Third-Party
# =========================
from fastapi import FastAPI, Depends, HTTPException, Query, Request, Response, Form
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from jose import JWTError

# =========================
# 🔹 Local Modules
# =========================
from models import Department
from database import get_app_db, verify_password
from authen import verify_access_token, create_access_token, renew_access_token, get_token_ttl_ms

# Shared State (Neutral file to avoid circular imports)
from world import SSE_SESSIONS, SEARCH_TASKS

# Routers
from routers import reporting, imaging, seeding

from datetime import datetime


app = FastAPI()
app.include_router(reporting.router)
app.include_router(imaging.router)
app.include_router(seeding.router)

# ANSI escape codes
RED = '\033[31m'
GREEN = '\033[32m'
YELLOW = '\033[33m'
RESET = '\033[0m' # Always use this to stop the color!

#      ____
#     / . . \
#     \  ---<
#      \  \
#  ____/  /
# /  ____/
# \______\

# ████████████████████████████████████████████████████████████████████████████████████████████
# ██ PAGE SERVING ROUTES                                                                    ██
# ████████████████████████████████████████████████████████████████████████████████████████████

#        ^
#       / \
#      /   \
#     |=   =|
#     |  P  |
#     |  Y  |
#     |     |
#    /|##!##|\
#   / |##!##| \
#  /  |##!##|  \
#     |##!##|
#    /  ! !  \
#   (_________)

#=============================================================================================
@app.get("/")
@app.get("/home")
def serve_home(
    request: Request
):
#---------------------------------------------------------------------------------------------
    token = request.cookies.get("access_token")
    if token:
        try:
            verify_access_token(token)
            return FileResponse(STATIC_DIR / "index.html")
        except JWTError:
            pass  # invalid or expired token
    print(token)
    return FileResponse(STATIC_DIR / "login.html")

#      _|_
#     |   |
#  _  |---|  _
# | |_|   |_| |
# |           |
# |   _   _   |
# |  |_| |_|  |
# |           |
# |    ___    |
# |   |   |   |
# |___|___|___|

#=============================================================================================
@app.get("/rip")
async def rip(
    c: str = Query(...)
):
#---------------------------------------------------------------------------------------------
    session = SSE_SESSIONS.get(c)
    if not session:
        raise HTTPException(status_code=404, detail="Invalid code")

    exp_timestamp = session.get("exp")
    if not exp_timestamp:
        SSE_SESSIONS.pop(c, None)
        raise HTTPException(status_code=401, detail="Invalid session")

    # --- Refactored to use time.time() ---
    if time.time() >= exp_timestamp:
        SSE_SESSIONS.pop(c, None)
        raise HTTPException(status_code=401, detail="Code expired")

    return FileResponse(
        STATIC_DIR / "importal.html", 
        media_type="text/html"
    )

#      ___
#  ___/   \___
# /   '---'   \
# '---_____---'
#      / \

# ████████████████████████████████████████████████████████████████████████████████████████████
# ██ CONNECTIVITY ROUTES                                                                    ██
# ████████████████████████████████████████████████████████████████████████████████████████████

#     ,,,
#    (0,0)
#    /)  )\
#    "   "

#=============================================================================================
@app.post("/request-login")
def request_login(
    response: Response,
    username: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_app_db)
):
#---------------------------------------------------------------------------------------------
    dept_name = username.lower()

    department = db.query(Department).filter(
        Department.name == dept_name
    ).first()

    if not department or not verify_password(password, department.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token({"sub": dept_name})

    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        samesite="lax",
        secure=False  # True in production with HTTPS
    )
    response.set_cookie(
        key="user_dept",
        value=dept_name.capitalize(), # e.g., "Engine"
        httponly=False, # THIS IS KEY: allows JS to read it
        samesite="lax",
        secure=False
    )

    print("success")
    return {"status": "login successful"}

#  |\---/|
#  | o_o |
#   \_^_/

#=============================================================================================
@app.post("/request-logout")
async def request_logout(
    response: Response,
    code: str = None
):
#---------------------------------------------------------------------------------------------
    # 1. Immediate cleanup of SSE if code is provided
    if code and code in SSE_SESSIONS:
        SSE_SESSIONS.pop(code, None)
    
    # 2. Wipe the Auth Cookie
    response.delete_cookie(
        key="access_token",
        httponly=True,
        samesite="lax",
        secure=False # Set to True in production
    )
    
    return {"status": "success"}

#      .
#     ":"
#   ___:____     |"\
# /        \___/ /
# \_____________/

#=============================================================================================
@app.get("/ping")
async def ping(
    request: Request,
    response: Response,
    sse_code: str,
    check_only: bool = False
):
#---------------------------------------------------------------------------------------------

    # --- Cleanup Routine ---
    # Scans for and removes any sessions that have already expired
    now_ts = time.time()
    expired_keys = [
        code for code, data in SSE_SESSIONS.items() 
        if data.get("exp", 0) < now_ts
    ]
    for key in expired_keys:
        SSE_SESSIONS.pop(key, None)
        if key in SEARCH_TASKS:
            SEARCH_TASKS[key].cancel()
            SEARCH_TASKS.pop(key, None)
        print(f"{YELLOW}Janitor: Pruned expired session {key}{RESET}")

        
    # --- Extract Token ---
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")

    # --- Verify Token ---
    try:
        payload = verify_access_token(token)
    except JWTError:
        print("Invalid or expired token")
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    # --- Validate SSE Session ---
    session = SSE_SESSIONS.get(sse_code)
    if not session:
        print("Invalid SSE session")
        raise HTTPException(status_code=400, detail="Invalid SSE session")

    # --- Calculate Current TTL ---
    # Uses the refactored get_token_ttl_ms (which now uses time.time())
    ttl_ms = get_token_ttl_ms(payload)

    # --- CHECK ONLY MODE ---
    if check_only:
        return {"ttl_ms": ttl_ms}

    # --- Renew Token ---
    # renew_access_token now returns (new_token, new_exp_ts) as integers via time.time()
    new_token, new_exp_ts = renew_access_token(payload)

    # Set new cookie
    response.set_cookie(
        key="access_token",
        value=new_token,
        httponly=True,
        secure=True,
        samesite="lax"
    )

    # --- Sync SSE Expiration (Unix timestamp) ---
    session["exp"] = new_exp_ts

    
    readable_time = datetime.fromtimestamp(session["exp"]).strftime('%b %d, %Y @ %H:%M:%S')
    print(f"{GREEN}SSE {sse_code} extended until {readable_time}{RESET}")

    new_ttl_ms = max(int((new_exp_ts - time.time()) * 1000), 0)

    return {"ttl_ms": new_ttl_ms}

#            )___(
#     ______/__|__\_______
#     \__________________/
#   ~~~~~~~~~~~~~~~~~~~~~~~~

#=============================================================================================
@app.get("/sse_subscribe")
async def sse_subscribe(
    request: Request
):
#---------------------------------------------------------------------------------------------
    # 1. Validate Token (Assume verify_access_token is defined in your auth logic)
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")

    payload = verify_access_token(token)
    department = payload.get("sub")
    exp_timestamp = payload.get("exp")

    if not department or not exp_timestamp:
        raise HTTPException(status_code=401, detail="Invalid session")

    def generate_unique_code():
        chars = string.ascii_letters + string.digits
        while True:
            code = ''.join(random.choices(chars, k=6))
            if code not in SSE_SESSIONS:
                return code

    
    # 2. Setup Session
    code = generate_unique_code()
    queue = asyncio.Queue()
    SSE_SESSIONS[code] = {
        "department": department,
        "exp": exp_timestamp,
        "queue": queue
    }

    async def event_stream():
        try:
            yield f"event: INIT\ndata: {json.dumps({'code': code})}\n\n"
            
            while True:
                # 1. Check if client is still there
                if await request.is_disconnected():
                    break
                
                # 2. Use a wait_for with a short heartbeat 
                # to ensure the loop cycles and checks for cancellation
                try:
                    # If the server shuts down, this 'await' will be interrupted
                    message = await asyncio.wait_for(queue.get(), timeout=15)
                    
                    yield f"event: {message['event']}\n"
                    yield f"data: {json.dumps(message['data'])}\n\n"
                    
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                except asyncio.CancelledError:
                    # This is the secret sauce for StatReload
                    # It catches the shutdown signal immediately
                    raise 

        except asyncio.CancelledError:
            print(f"DEBUG: SSE {code} interrupted by Server Reload")
        finally:
            # CLEANUP: Crucial to prevent memory leaks and zombie tasks
            SSE_SESSIONS.pop(code, None)
            if code in SEARCH_TASKS:
                SEARCH_TASKS[code].cancel()
                SEARCH_TASKS.pop(code, None)
            print(f"SSE Session Cleaned: {code}")

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )




#==============================================================================================
#   STATIC MOUNTING
#==============================================================================================
BASE_DIR = Path(__file__).resolve().parent  # /app
STATIC_DIR = BASE_DIR / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")



