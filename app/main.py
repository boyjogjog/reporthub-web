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
import time
import calendar
import re
from datetime import datetime

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

import os
from io import BytesIO
from docx import Document
from docx.shared import Inches, Pt
from docx.enum.text import WD_PARAGRAPH_ALIGNMENT
from PIL import Image

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
from calendar import monthrange
import time
from fastapi import HTTPException, Request, Response
from fastapi.responses import HTMLResponse

app = FastAPI()

# Global in-memory store
SSE_SESSIONS = {}
SEARCH_TASKS = {}

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

    print("success")
    return {"status": "login successful"}



@app.post("/request-logout")
async def request_logout(response: Response, code: str = None):
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

    new_ttl_ms = max(int((new_exp_ts - time.time()) * 1000), 0)

    return {"ttl_ms": new_ttl_ms}

def generate_unique_code():
    chars = string.ascii_uppercase + string.digits
    while True:
        code = ''.join(random.choices(chars, k=6))
        if code not in SSE_SESSIONS:
            return code

@app.get("/sse_subscribe")
async def sse_subscribe(request: Request):
    # 1. Validate Token (Assume verify_access_token is defined in your auth logic)
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")

    payload = verify_access_token(token)
    department = payload.get("sub")
    exp_timestamp = payload.get("exp")

    if not department or not exp_timestamp:
        raise HTTPException(status_code=401, detail="Invalid session")

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
    print(token)
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

    # --- Refactored to use time.time() ---
    if time.time() >= exp_timestamp:
        SSE_SESSIONS.pop(c, None)
        raise HTTPException(status_code=401, detail="Code expired")

    return FileResponse(
        STATIC_DIR / "importal.html", 
        media_type="text/html"
    )

def _attach_images(db, report, image_ids):
    """
    Safely attach images to a report.
    - Removes duplicates
    - Clears old relationships
    - Prevents UNIQUE constraint violations
    """
    if not image_ids:
        report.images = []
        return

    unique_ids = list(set(image_ids))

    images = db.query(ImageBucket).filter(
        ImageBucket.uuid.in_(unique_ids)
    ).all()

    report.images = images

def _attach_images(db, report_object, image_filenames: list[str]):
        """
        Links images to a report by looking up the UUID in the ImageBucket table.
        """
        if not image_filenames:
            return

        for filename in image_filenames:
            # 1. Get the UUID from the filename 
            # (e.g., '9edc149d...jpg' -> '9edc149d...')
            img_uuid = filename.split('.')[0]

            # 2. Find the existing image record in the ImageBucket table
            image_record = db.query(ImageBucket).filter(ImageBucket.uuid == img_uuid).first()

            if image_record:
                # 3. Add to the relationship list. 
                # SQLAlchemy will automatically insert a row into the junction table.
                if image_record not in report_object.images:
                    report_object.images.append(image_record)
            else:
                # This happens if you haven't seeded the images first!
                print(f"⚠️ Warning: Image {img_uuid} not found in database. Seed images first.")
                

@app.post("/save-daily-report/{dateStr}")
def save_daily_report(
    dateStr: str,
    payload: list[dict],
    ctx = Depends(get_dept_context)
):
    db, _ = ctx

    # --- 1️⃣ ORM-safe delete existing reports ---
    existing_reports = db.query(DailyReport).filter(
        DailyReport.report_dateStr == dateStr
    ).all()

    for report in existing_reports:
        db.delete(report)

    db.flush()  # ensure association rows are cleared before reuse

    # --- 2️⃣ Recreate reports ---
    for index, item in enumerate(payload):
        report = DailyReport(
            uuid=item.get("uuid"),
            report_dateStr=dateStr,
            text_content=item.get("text_content"),
            sort_order=index
        )

        db.add(report)

        # Attach images safely
        _attach_images(
            db,
            report,
            item.get("image_uuids", [])
        )

    db.commit()

    return {"status": "daily report saved"}


@app.post("/save-2weekly-report/{rangeStr}")
def save_2weekly_report(
    rangeStr: str,
    payload: list[dict],
    ctx = Depends(get_dept_context)
):
    db, _ = ctx

    # --- 1️⃣ ORM-safe delete ---
    existing_reports = db.query(TwoWeeklyReport).filter(
        TwoWeeklyReport.report_rangeStr == rangeStr
    ).all()

    for report in existing_reports:
        db.delete(report)

    db.flush()

    # --- 2️⃣ Recreate ---
    for index, item in enumerate(payload):
        report = TwoWeeklyReport(
            uuid=item.get("uuid"),
            report_rangeStr=rangeStr,
            text_content=item.get("text_content"),
            sort_order=index
        )

        db.add(report)

        _attach_images(
            db,
            report,
            item.get("image_uuids", [])
        )

    db.commit()

    return {"status": "2-weekly report saved"}

@app.post("/save-common-report")
def save_common_report(
    payload: list[dict],
    ctx = Depends(get_dept_context)
):
    db, _ = ctx

    # ORM-safe delete all
    existing_reports = db.query(CommonReport).all()

    for report in existing_reports:
        db.delete(report)

    db.flush()

    # Recreate
    for index, item in enumerate(payload):
        report = CommonReport(
            uuid=item.get("uuid"),
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
    # ---- 1️⃣ Validate SSE Session ----
    session = SSE_SESSIONS.get(code)
    if not session:
        raise HTTPException(status_code=404, detail="Invalid code")

    exp_timestamp = session.get("exp")
    department = session.get("department")

    if not exp_timestamp or not department:
        SSE_SESSIONS.pop(code, None)
        raise HTTPException(status_code=401, detail="Invalid session")

    # time.time() is naturally a float, direct comparison works
    now_ts = time.time()
    if now_ts >= exp_timestamp:
        SSE_SESSIONS.pop(code, None)
        raise HTTPException(status_code=401, detail="Code expired")

    # ---- 2️⃣ Get Department Resources ----
    resources = get_dept_resources(department)
    SessionLocal = resources["sessionmaker"]
    bucket_path: Path = resources["image-bucket"]

    db = SessionLocal()

    try:
        # Get UTC time structure using time.gmtime()
        now_struct = time.gmtime(now_ts)
        
        year = str(now_struct.tm_year)
        month = f"{now_struct.tm_mon:02d}"
        day = now_struct.tm_mday

        # Get actual last day of the month
        last_day = calendar.monthrange(now_struct.tm_year, now_struct.tm_mon)[1]

        # Determine split logic
        if last_day in (28, 29):
            first_half_end = 14
        else:
            first_half_end = 15

        range_folder = f"01-{first_half_end:02d}" if day <= first_half_end else f"{first_half_end + 1:02d}-{last_day:02d}"

        folder_path = bucket_path / year / month / range_folder
        folder_path.mkdir(parents=True, exist_ok=True)

        image_uuid = str(uuid.uuid4())
        ext = Path(file.filename).suffix.lower()
        original_path = folder_path / f"{image_uuid}{ext}"

        # Save Original
        contents = await file.read()
        with open(original_path, "wb") as f:
            f.write(contents)

        # Generate Thumbnail
        thumb_path = folder_path / f"{image_uuid}_thumb.webp"
        with PILImage.open(original_path) as img:
            img.thumbnail((300, 300))
            img.convert("RGB").save(thumb_path, "WEBP", quality=80)

        # Database Record
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

import time
from fastapi import HTTPException, Depends

@app.get("/extract-imaged-reports/{rangeStr}")
def extract_imaged_reports(rangeStr: str, ctx = Depends(get_dept_context)):
    db, _ = ctx

    try:
        # Parse rangeStr: "2026-02-01-15"
        parts = rangeStr.split("-")
        if len(parts) != 4:
            raise ValueError()

        year, month, start_day, end_day = parts

        start_date = f"{year}-{month}-{start_day}"
        end_date = f"{year}-{month}-{end_day}"

        # --- Refactored Validation using time.strptime ---
        # If the format is invalid, it raises ValueError automatically
        time.strptime(start_date, "%Y-%m-%d")
        time.strptime(end_date, "%Y-%m-%d")

    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid range format or date values")

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


@app.post("/history-search")
async def start_history_search(query: str, code: str):
    # 1. Validate session
    session = SSE_SESSIONS.get(code)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # 2. Cancel any existing search task for this code
    if code in SEARCH_TASKS:
        SEARCH_TASKS[code].cancel()
        try:
            await SEARCH_TASKS[code]
        except asyncio.CancelledError:
            pass

    # 3. Create and store the new search task
    task = asyncio.create_task(background_search_logic(query, code, session["queue"]))
    SEARCH_TASKS[code] = task
    
    return {"status": "searching"}

async def background_search_logic(query, code, queue):
    db = None  # Initialize to None so the 'finally' block doesn't crash
    try:
        # ---- 1️⃣ Validate SSE Session ----
        session = SSE_SESSIONS.get(code)
        if not session:
            raise HTTPException(status_code=404, detail="Invalid code")

        exp_timestamp = session.get("exp")
        department = session.get("department")

        if not exp_timestamp or not department:
            SSE_SESSIONS.pop(code, None)
            raise HTTPException(status_code=401, detail="Invalid session")

        # time.time() is naturally a float, direct comparison works
        now_ts = time.time()
        if now_ts >= exp_timestamp:
            SSE_SESSIONS.pop(code, None)
            raise HTTPException(status_code=401, detail="Code expired")

        # ---- 2️⃣ Get Department Resources ----
        resources = get_dept_resources(department)
        SessionLocal = resources["sessionmaker"]
        bucket_path: Path = resources["image-bucket"]

        # NOTE: Ensure SessionLocal is imported from your database config file
        # from .database import SessionLocal 
        db = SessionLocal() 
        
        # Use .ilike for case-insensitive search
        results = db.query(DailyReport).filter(
            DailyReport.text_content.ilike(f"%{query}%")
        ).all()

        for report in results:
            # Check if task was cancelled (user typed a new query)
            # This allows the loop to exit cleanly and quickly
            await asyncio.sleep(0.01) 
            
            await queue.put({
                "event": "SEARCH_MATCH",
                "data": {
                    "uuid": report.uuid,
                    "date": report.report_dateStr,
                    "text_content": report.text_content,
                    "image_uuids": [img.uuid for img in report.images]
                }
            })

        await queue.put({"event": "SEARCH_COMPLETE", "data": {}})

    except asyncio.CancelledError:
        print(f"Search for '{query}' was cancelled by a newer request.")
    except Exception as e:
        print(f"Search Error: {e}")
    finally:
        # Only close if db was successfully initialized
        if db is not None:
            db.close()
        
        # Clean up the global task tracker
        if SEARCH_TASKS.get(code) == asyncio.current_task():
            SEARCH_TASKS.pop(code, None)



BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"   # where index.html & login.html are
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")




import re
import calendar
from datetime import datetime
from pathlib import Path

@app.post("/image-bucket/seed-images")
async def seed_image(
    file: UploadFile = File(...),
    dept_name: str = Query(None)
):
    # ---- 2️⃣ Get Department Resources ----
    resources = get_dept_resources(dept_name)
    SessionLocal = resources["sessionmaker"]
    bucket_path: Path = resources["image-bucket"]

    db = SessionLocal()

    try:
        # 1. New Regex: Extracts UUID (1), Year (2), Month (3), and Day (4)
        # Expects: 00af659c-d56e-4cd9-9709-b45507554440__2026-02-17.jpg
        pattern = r'^([a-f0-9\-]{36})__(\d{4})-(\d{2})-(\d{2})'
        match = re.search(pattern, file.filename)
        
        if not match:
            return {"error": f"Filename '{file.filename}' does not match expected uuid__YYYY-MM-DD format"}
        
        image_uuid = match.group(1)
        year = match.group(2)
        month_int = int(match.group(3))
        day_int = int(match.group(4))
        ext = Path(file.filename).suffix.lower()

        # 2. Convert Month Number to Short Name (e.g., 2 -> 'Feb')
        month_name = calendar.month_name[month_int][:3]

        # 3. Determine split logic (01-15 or 16-31)
        last_day = calendar.monthrange(int(year), month_int)[1]
        first_half_end = 14 if last_day in (28, 29) else 15
        range_folder = f"01-{first_half_end:02d}" if day_int <= first_half_end else f"{first_half_end + 1:02d}-{last_day:02d}"

        # 4. Create the nested folder path
        # Result: .../image_bucket/2026/Feb/01-15/
        folder_path = bucket_path / year / month_name / range_folder
        folder_path.mkdir(parents=True, exist_ok=True)

        # 5. Clean filename for storage (Remove the date suffix for the actual file)
        original_path = folder_path / f"{image_uuid}{ext}"

        # Save Original
        contents = await file.read()
        with open(original_path, "wb") as f:
            f.write(contents)

        # 6. Generate Thumbnail
        thumb_path = folder_path / f"{image_uuid}_thumb.webp"
        with PILImage.open(original_path) as img:
            img.thumbnail((300, 300))
            img.convert("RGB").save(thumb_path, "WEBP", quality=80)

        # 7. Database Record
        image = ImageBucket(
            uuid=image_uuid,
            image_folder=str(folder_path.relative_to(bucket_path)),
            image_type=ext.replace(".", "")
        )

        db.add(image)
        db.commit()

        return {
            "uuid": image_uuid,
            "folder": image.image_folder
        }

    except Exception as e:
        db.rollback()
        raise e
    finally:
        db.close()




from fastapi import APIRouter, Depends, Query, HTTPException

router = APIRouter()

@app.post("/seed-daily-report/{dateStr}")
def seed_daily_report(
    dateStr: str,
    payload: list[dict],
    dept_name: str = Query(...) # dept_name provided by frontend
):

    # --- 1️⃣ Get Department Resources ---
    resources = get_dept_resources(dept_name)
    SessionLocal = resources["sessionmaker"]
    db = SessionLocal()

    def _attach_images(db, report_object, image_filenames: list[str]):
        """
        Links images to a report by looking up the UUID in the ImageBucket table.
        """
        if not image_filenames:
            return

        for filename in image_filenames:
            # 1. Get the UUID from the filename 
            # (e.g., '9edc149d...jpg' -> '9edc149d...')
            img_uuid = filename.split('.')[0]

            # 2. Find the existing image record in the ImageBucket table
            image_record = db.query(ImageBucket).filter(ImageBucket.uuid == img_uuid).first()

            if image_record:
                # 3. Add to the relationship list. 
                # SQLAlchemy will automatically insert a row into the junction table.
                if image_record not in report_object.images:
                    report_object.images.append(image_record)
            else:
                # This happens if you haven't seeded the images first!
                print(f"⚠️ Warning: Image {img_uuid} not found in database. Seed images first.")

    try:
        # --- 2️⃣ ORM-safe delete existing reports ---
        existing_reports = db.query(DailyReport).filter(
            DailyReport.report_dateStr == dateStr
        ).all()

        for report in existing_reports:
            db.delete(report)

        db.flush()  # ensure association rows are cleared before reuse

        # --- 3️⃣ Recreate reports ---
        for index, item in enumerate(payload):
            report = DailyReport(
                uuid=item.get("uuid"),           # Matches transformed key
                report_dateStr=dateStr,
                text_content=item.get("text_content"), # Matches transformed key
                sort_order=index
            )
            db.add(report)

            _attach_images(
                db,
                report,
                item.get("image_uuids", [])       # Matches transformed key
            )

        db.commit()
        return {"status": f"daily report for {dept_name} saved"}

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@app.post("/seed-2weekly-report/{rangeStr}")
def seed_2weekly_report(
    rangeStr: str,
    payload: list[dict],
    dept_name: str = Query(...)
):
    # --- 1️⃣ Get Department Resources ---
    resources = get_dept_resources(dept_name)
    SessionLocal = resources["sessionmaker"]
    db = SessionLocal()

    def _attach_images(db, report_object, image_filenames: list[str]):
        """
        Links images to a report by looking up the UUID in the ImageBucket table.
        """
        if not image_filenames:
            return

        for filename in image_filenames:
            # 1. Get the UUID from the filename 
            # (e.g., '9edc149d...jpg' -> '9edc149d...')
            img_uuid = filename.split('.')[0]

            # 2. Find the existing image record in the ImageBucket table
            image_record = db.query(ImageBucket).filter(ImageBucket.uuid == img_uuid).first()

            if image_record:
                # 3. Add to the relationship list. 
                # SQLAlchemy will automatically insert a row into the junction table.
                if image_record not in report_object.images:
                    report_object.images.append(image_record)
            else:
                # This happens if you haven't seeded the images first!
                print(f"⚠️ Warning: Image {img_uuid} not found in database. Seed images first.")

    try:
        # --- 2️⃣ ORM-safe delete ---
        existing_reports = db.query(TwoWeeklyReport).filter(
            TwoWeeklyReport.report_rangeStr == rangeStr
        ).all()

        for report in existing_reports:
            db.delete(report)

        db.flush()

        # --- 3️⃣ Recreate ---
        for index, item in enumerate(payload):
            report = TwoWeeklyReport(
                uuid=item.get("uuid"),               # Fix: was "id"
                report_rangeStr=rangeStr,
                text_content=item.get("text_content"), 
                sort_order=index
            )

            db.add(report)

            _attach_images(
                db,
                report,
                item.get("image_uuids", [])           # Fix: was "images"
            )

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.commit() # Commit moved inside try for safety
        db.close()

    return {"status": f"2-weekly report for {dept_name} saved"}

