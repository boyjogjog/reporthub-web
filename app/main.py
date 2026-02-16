# =========================
# 🔹 Standard Library
# =========================
import os
import uuid
import json
import asyncio
import random
import string
from pathlib import Path
from datetime import datetime, timezone
import time

# =========================
# 🔹 Third-Party
# =========================
from fastapi import (
    FastAPI,
    Depends,
    HTTPException,
    UploadFile,
    File,
    Query,
    Request,
    Response,
    Form
)
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.security import OAuth2PasswordRequestForm

from sqlalchemy.orm import Session
from sqlalchemy import asc, func

from jose import JWTError
from PIL import Image as PILImage

# =========================
# 🔹 Local Modules
# =========================
from models import (
    Department,
    DailyReport,
    TwoWeeklyReport,
    CommonReport,
    ImageBucket
)

from database import (
    get_app_db,
    verify_password,
    get_dept_resources,
    get_dept_context
)

from authen import (
    verify_access_token,
    create_access_token,
    renew_access_token,
    get_token_ttl_ms
)

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime

app = FastAPI()

@app.post("/request-login")
def request_login(
    response: Response,
    username: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_app_db)
):
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

    return {"status": "login successful"}

# Global in-memory store
SSE_SESSIONS = {}

@app.get("/ping")
async def ping(
    request: Request,
    response: Response,
    sse_code: str,
    check_only: bool = False
):
    # --- Extract Token ---
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")

    # --- Verify Token ---
    try:
        payload = verify_access_token(token)
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    # --- Validate SSE Session ---
    session = SSE_SESSIONS.get(sse_code)
    if not session:
        raise HTTPException(status_code=400, detail="Invalid SSE session")

    # --- Calculate Current TTL ---
    ttl_ms = get_token_ttl_ms(payload)

    # --- CHECK ONLY MODE ---
    if check_only:
        return {"ttl_ms": ttl_ms}

    # --- Renew Token ---
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

    # --- Return Fresh TTL ---
    now_ts = int(datetime.now(timezone.utc).timestamp())
    new_ttl_ms = max((new_exp_ts - now_ts) * 1000, 0)

    return {"ttl_ms": new_ttl_ms}

@app.get("/sse_subscribe")
async def sse_subscribe(request: Request):

    import asyncio, json, random, string, time
    from fastapi import HTTPException
    from fastapi.responses import StreamingResponse

    # ---- 1️⃣ Validate Token ----
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")

    payload = verify_access_token(token)
    department = payload.get("sub")
    exp_timestamp = payload.get("exp")  # unix seconds

    if not department or not exp_timestamp:
        raise HTTPException(status_code=401, detail="Invalid token")

    # Immediate expiration check (no datetime objects needed)
    if time.time() >= exp_timestamp:
        raise HTTPException(status_code=401, detail="Token expired")

    # ---- 2️⃣ Generate Unique 6-char Code ----
    chars = string.ascii_uppercase + string.digits
    while True:
        code = ''.join(random.choices(chars, k=6))
        if code not in SSE_SESSIONS:
            break

    # ---- 3️⃣ Create Session ----
    queue = asyncio.Queue()

    SSE_SESSIONS[code] = {
        "department": department,
        "exp": exp_timestamp,
        "queue": queue
    }

    # ---- 4️⃣ SSE Stream ----
    async def event_stream():
        try:
            # Send INIT immediately
            yield f"event: INIT\ndata: {json.dumps({'code': code})}\n\n"

            # Tell browser to retry automatically after disconnect
            yield "retry: 3000\n\n"

            while True:

                # Client disconnected?
                if await request.is_disconnected():
                    break

                # Expired?
                if time.time() >= exp_timestamp:
                    break

                try:
                    # Wait for message or heartbeat timeout
                    message = await asyncio.wait_for(queue.get(), timeout=20)

                    yield f"event: {message['event']}\n"
                    yield f"data: {json.dumps(message['data'])}\n\n"

                except asyncio.TimeoutError:
                    # Heartbeat to keep connection alive
                    yield ": keepalive\n\n"

        except Exception as e:
            print("SSE stream error:", e)

        finally:
            SSE_SESSIONS.pop(code, None)
            print("SSE closed:", code)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"  # critical for nginx
        }
    )

@app.get("/")
@app.get("/home")
def serve_home(request: Request):
    token = request.cookies.get("access_token")
    if token:
        try:
            verify_access_token(token)
            return FileResponse(STATIC_DIR / "index.html")
        except JWTError:
            pass  # invalid or expired token

    return FileResponse(STATIC_DIR / "login.html")

@app.get("/login")
def serve_login(request: Request):
    return FileResponse(STATIC_DIR / "login.html")

@app.get("/rip")
async def rip(c: str = Query(...)):
    session = SSE_SESSIONS.get(c)
    if not session:
        raise HTTPException(status_code=404, detail="Invalid code")

    exp_timestamp = session.get("exp")
    if not exp_timestamp:
        SSE_SESSIONS.pop(c, None)
        raise HTTPException(status_code=401, detail="Invalid session")

    now_ts = int(datetime.now(timezone.utc).timestamp())

    if now_ts >= exp_timestamp:
        SSE_SESSIONS.pop(c, None)
        raise HTTPException(status_code=401, detail="Code expired")

    return FileResponse(
        STATIC_DIR / "importal.html",
        media_type="text/html"
    )


@app.post("/save-daily-report/{dateStr}")
def save_daily_report(
    dateStr: str,
    payload: list[dict],
    ctx = Depends(get_dept_context)
):
    db, _ = ctx

    # Remove existing reports for that date
    db.query(DailyReport).filter(
        DailyReport.report_dateStr == dateStr
    ).delete()

    db.commit()

    for index, item in enumerate(payload):
        report = DailyReport(
            report_dateStr=dateStr,
            text_content=item.get("text_content"),
            sort_order=index
        )

        # Attach images if provided
        image_ids = item.get("image_uuids", [])
        if image_ids:
            images = db.query(ImageBucket).filter(
                ImageBucket.uuid.in_(image_ids)
            ).all()
            report.images = images

        db.add(report)

    db.commit()

    return {"status": "daily report saved"}

@app.post("/save-2weekly-report/{rangeStr}")
def save_2weekly_report(
    rangeStr: str,
    payload: list[dict],
    ctx = Depends(get_dept_context)
):
    db, _ = ctx

    db.query(TwoWeeklyReport).filter(
        TwoWeeklyReport.report_rangeStr == rangeStr
    ).delete()

    db.commit()

    for index, item in enumerate(payload):
        report = TwoWeeklyReport(
            report_rangeStr=rangeStr,
            text_content=item.get("text_content"),
            sort_order=index
        )

        image_ids = item.get("image_uuids", [])
        if image_ids:
            images = db.query(ImageBucket).filter(
                ImageBucket.uuid.in_(image_ids)
            ).all()
            report.images = images

        db.add(report)

    db.commit()

    return {"status": "2-weekly report saved"}

@app.post("/save-common-report")
def save_common_report(
    payload: list[dict],
    ctx = Depends(get_dept_context)
):
    db, _ = ctx

    db.query(CommonReport).delete()
    db.commit()

    for index, item in enumerate(payload):
        report = CommonReport(
            text_content=item.get("text_content"),
            sort_order=index
        )
        db.add(report)

    db.commit()

    return {"status": "common report saved"}

@app.get("/load-daily-report/{dateStr}")
def load_daily_report(
    dateStr: str,
    ctx = Depends(get_dept_context)
):
    db, _ = ctx

    reports = db.query(DailyReport).filter(
        DailyReport.report_dateStr == dateStr
    ).order_by(asc(DailyReport.sort_order)).all()

    print(len(reports))
    return [
        {
            "uuid": r.uuid,
            "text_content": r.text_content,
            "image_uuids": [img.uuid for img in r.images]
        }
        for r in reports
    ]

@app.get("/load-2weekly-report/{rangeStr}")
def load_2weekly_report(
    rangeStr: str,
    ctx = Depends(get_dept_context)
):
    db, _ = ctx

    reports = db.query(TwoWeeklyReport).filter(
        TwoWeeklyReport.report_rangeStr == rangeStr
    ).order_by(asc(TwoWeeklyReport.sort_order)).all()

    return [
        {
            "uuid": r.uuid,
            "text_content": r.text_content,
            "image_uuids": [img.uuid for img in r.images]
        }
        for r in reports
    ]

@app.get("/load-common-report")
def load_common_report(
    ctx = Depends(get_dept_context)
):
    db, _ = ctx

    reports = db.query(CommonReport).order_by(
        asc(CommonReport.sort_order)
    ).all()

    return [
        {
            "uuid": r.uuid,
            "text_content": r.text_content
        }
        for r in reports
    ]

@app.post("/image-bucket/upload-image")
async def upload_image(
    file: UploadFile = File(...),
    code: str = Query(...),
    attach: bool = Query(False),
):
    import time

    # ---- 1️⃣ Validate SSE Session ----
    session = SSE_SESSIONS.get(code)
    if not session:
        raise HTTPException(status_code=404, detail="Invalid code")

    exp_timestamp = session.get("exp")
    department = session.get("department")

    if not exp_timestamp or not department:
        SSE_SESSIONS.pop(code, None)
        raise HTTPException(status_code=401, detail="Invalid session")

    if int(time.time()) >= exp_timestamp:
        SSE_SESSIONS.pop(code, None)
        raise HTTPException(status_code=401, detail="Code expired")

    # ---- 2️⃣ Get Department Resources ----
    resources = get_dept_resources(department)
    SessionLocal = resources["sessionmaker"]
    bucket_path: Path = resources["image-bucket"]

    db = SessionLocal()

    try:
        now = datetime.now()
        year = now.strftime("%Y")
        month = now.strftime("%b")
        day = now.day

        range_folder = "01-15" if day <= 15 else "16-31"

        folder_path = bucket_path / year / month / range_folder
        folder_path.mkdir(parents=True, exist_ok=True)

        image_uuid = str(uuid.uuid4())
        ext = Path(file.filename).suffix.lower()

        original_path = folder_path / f"{image_uuid}{ext}"

        contents = await file.read()
        with open(original_path, "wb") as f:
            f.write(contents)

        thumb_path = folder_path / f"{image_uuid}_thumb.webp"

        with PILImage.open(original_path) as img:
            img.thumbnail((300, 300))
            img.convert("RGB").save(thumb_path, "WEBP", quality=80)

        image = ImageBucket(
            uuid=image_uuid,
            image_folder=str(folder_path.relative_to(bucket_path)),
            image_type=ext.replace(".", "")
        )

        db.add(image)
        db.commit()

        if attach:
            await session["queue"].put({
                "event": "NEW_IMAGE",
                "data": {
                    "image-uuid": image_uuid,
                    "folder": image.image_folder
                }
            })

        return {
            "uuid": image_uuid,
            "folder": image.image_folder
        }

    finally:
        db.close()





@app.get("/image-bucket/get-folders")
def get_folders(ctx = Depends(get_dept_context)):
    db, _ = ctx

    folders = (
        db.query(
            ImageBucket.image_folder,
            func.max(ImageBucket.uploaded_at).label("latest")
        )
        .group_by(ImageBucket.image_folder)
        .order_by(func.max(ImageBucket.uploaded_at).desc())
        .all()
    )

    return [f[0] for f in folders]



@app.get("/image-bucket/get-list/{folderPath:path}")
def get_list(folderPath: str, ctx = Depends(get_dept_context)):
    db, _ = ctx

    images = (
        db.query(ImageBucket.uuid)
        .filter(ImageBucket.image_folder == folderPath)
        .order_by(ImageBucket.uploaded_at.desc())
        .all()
    )

    return [img[0] for img in images]




from fastapi.responses import FileResponse

@app.get("/image-bucket/get-image/{uuid}")
def get_image(
    uuid: str,
    thumb: bool = Query(False),
    ctx = Depends(get_dept_context)
):
    db, bucket_path = ctx

    image = (
        db.query(ImageBucket)
        .filter(ImageBucket.uuid == uuid)
        .first()
    )

    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    folder_path = bucket_path / image.image_folder

    if thumb:
        file_path = folder_path / f"{uuid}_thumb.webp"
    else:
        file_path = folder_path / f"{uuid}.{image.image_type}"

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File missing")

    return FileResponse(file_path)

@app.get("/extract-imaged-reports/{rangeStr}")
def extract_imaged_reports(rangeStr: str, ctx = Depends(get_dept_context)):
    db, _ = ctx

    try:
        # Parse rangeStr: "2026-02-01-15"
        parts = rangeStr.split("-")
        if len(parts) != 4:
            raise ValueError()

        year = parts[0]
        month = parts[1]
        start_day = parts[2]
        end_day = parts[3]

        start_date = f"{year}-{month}-{start_day}"
        end_date = f"{year}-{month}-{end_day}"

        # Validate dates
        datetime.strptime(start_date, "%Y-%m-%d")
        datetime.strptime(end_date, "%Y-%m-%d")

    except Exception:
        raise HTTPException(status_code=400, detail="Invalid range format")

    reports = (
        db.query(DailyReport)
        .filter(
            DailyReport.report_dateStr >= start_date,
            DailyReport.report_dateStr <= end_date,
            DailyReport.images.any()  # ensures at least 1 image
        )
        .order_by(DailyReport.report_dateStr.asc())
        .all()
    )

    return [
        {
            "uuid": r.uuid,
            "date": r.report_dateStr,
            "text_content": r.text_content,
            "image_uuids": [img.uuid for img in r.images]
        }
        for r in reports
    ]

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"   # where index.html & login.html are
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
