# =========================
# 🔹 Standard Library
# =========================
import os
import uuid
import time
import calendar
import random
from pathlib import Path

# =========================
# 🔹 Third-Party
# =========================
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, Header
from fastapi.responses import FileResponse
from sqlalchemy import func
from PIL import Image as PILImage

# =========================
# 🔹 Local Modules
# =========================
from models import (
    DailyReport, 
    TwoWeeklyReport, 
    ImageBucket, 
    daily_image_links, 
    two_weekly_image_links
)
from database import get_dept_resources, get_dept_context

from world import SSE_SESSIONS, SEARCH_TASKS
from utils import sync_all_affected_backups, _attach_images


router = APIRouter(
    prefix="/image-bucket",
    tags=["Image Bucket"]
)



#==================================================================================================
@router.post("/upload-image")
async def upload_image(
    file: UploadFile = File(...),
    code: str = Query(...),
    attach: bool = Query(False),
):
#--------------------------------------------------------------------------------------------------
    # ---- 1️⃣ Validate SSE Session ----
    session = SSE_SESSIONS.get(code)
    if not session:
        print(session)
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



#==================================================================================================
@router.get("/get-folders")
def get_folders(
    ctx = Depends(get_dept_context)
):
#--------------------------------------------------------------------------------------------------
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



#=================================================================================================
@router.get("/get-list/{folderPath:path}")
def get_list(
    folderPath: str,
    ctx = Depends(get_dept_context)
):
#-------------------------------------------------------------------------------------------------
    db, _ = ctx

    images = (
        db.query(ImageBucket.uuid)
        .filter(ImageBucket.image_folder == folderPath)
        .order_by(ImageBucket.uploaded_at.desc())
        .all()
    )

    return [img[0] for img in images]



#=================================================================================================
@router.get("/get-image/{uuid}")
def get_image(
    uuid: str,
    thumb: bool = Query(False),
    ctx = Depends(get_dept_context)
):
#-------------------------------------------------------------------------------------------------
    db, res = ctx # Get the dict
    bucket_path = res["image-bucket"] # Get the path from the dict

    image = db.query(ImageBucket).filter(ImageBucket.uuid == uuid).first()

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



#=================================================================================================
@router.get("/get-image-py/{uuid}")
def get_image_internal(
    uuid: str,
    dept_name: str = Query(None),
    thumb: bool = Query(False),
    # Instead of Auth Context, we look for a secret key in headers
    x_internal_key: str = Header(None) 
):
#-------------------------------------------------------------------------------------------------
    # 1. Security Check
    # Keep this key identical in both your backend and your local python helper
    INTERNAL_SECRET = "Reporthub_Alpha_2026_Secure_Access"
    
    if x_internal_key != INTERNAL_SECRET:
        raise HTTPException(status_code=403, detail="Invalid internal key")

    # 2. Manual Context setup (since we aren't using the auth dependency)
    # You might need to manually define your bucket_path here if it's usually dynamic
    # Or fetch it from your config/settings
    resources = get_dept_resources(dept_name)
    SessionLocal = resources["sessionmaker"]
    bucket_path: Path = resources["image-bucket"]

    db = SessionLocal()

    try:
        image = db.query(ImageBucket).filter(ImageBucket.uuid == uuid).first()

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
    finally:
        db.close()



#=================================================================================================
@router.get("/next-image")
async def get_random_image(
    ctx = Depends(get_dept_context)
):
#-------------------------------------------------------------------------------------------------
    db, res = ctx
    bucket_path = res["image-bucket"]

    # 1. Query the latest 100 images from the ImageBucket table
    latest_images = (
        db.query(ImageBucket)
        .order_by(ImageBucket.uploaded_at.desc())
        .limit(100)
        .all()
    )

    if not latest_images:
        raise HTTPException(status_code=404, detail="No images found in bucket")

    # 2. Pick a random one from that list of 100
    chosen_image = random.choice(latest_images)
    
    # 3. Construct the path (consistent with your get_image logic)
    folder_path = bucket_path / chosen_image.image_folder
    file_path = folder_path / f"{chosen_image.uuid}.{chosen_image.image_type}"

    if not file_path.exists():
        # Fallback: if the file is missing, we could recursively try another, 
        # but for now, we'll just return a 404.
        raise HTTPException(status_code=404, detail="Randomly selected file is missing on disk")

    # 4. Return the file with No-Cache headers
    return FileResponse(
        path=file_path,
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0"
        }
    )



#=================================================================================================
@router.delete("/delete-image/{uuid}")
def delete_image(
    uuid: str,
    force:bool = Query(False),
    ctx = Depends(get_dept_context)
):
#-------------------------------------------------------------------------------------------------
    db, res = ctx
    bucket_path = res["image-bucket"]

    image = db.query(ImageBucket).filter(ImageBucket.uuid == uuid).first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    # Get affected reports BEFORE deleting references
    daily_refs = db.query(DailyReport).join(daily_image_links).filter(daily_image_links.c.image_uuid == uuid).all()
    weekly_refs = db.query(TwoWeeklyReport).join(two_weekly_image_links).filter(two_weekly_image_links.c.image_uuid == uuid).all()
    
    affected_daily_dates = [r.report_dateStr for r in daily_refs]
    affected_weekly_ranges = [r.report_rangeStr for r in weekly_refs]
    total_refs = len(affected_daily_dates) + len(affected_weekly_ranges)

    if total_refs > 0 and not force:
        raise HTTPException(status_code=400, detail=f"In use in {total_refs} reports.")

    try:
        # Clean Junctions
        db.execute(daily_image_links.delete().where(daily_image_links.c.image_uuid == uuid))
        db.execute(two_weekly_image_links.delete().where(two_weekly_image_links.c.image_uuid == uuid))

        # Physical Delete
        folder_path = bucket_path / image.image_folder
        for f in [folder_path / f"{uuid}.{image.image_type}", folder_path / f"{uuid}_thumb.webp"]:
            if f.exists(): os.remove(f)

        db.delete(image)
        db.commit() # Commit first so the sync reads updated DB state

        # Refresh affected JSON backups
        sync_all_affected_backups(db, res, affected_daily_dates, affected_weekly_ranges)

        return {"status": "deleted", "affected_files": total_refs}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))