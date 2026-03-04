import re
import calendar
import random
from datetime import datetime, time
from pathlib import Path

from fastapi import APIRouter, Depends, Query, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from PIL import Image as PILImage

# Local Imports
from models import DailyReport, ImageBucket
from database import get_dept_resources
from utils import _attach_images, sync_json_backup

router = APIRouter(
    prefix="/seed",
    tags=["Seeding"]
)

@router.post("/image")
async def seed_image(
    file: UploadFile = File(...),
    dept_name: str = Query(None)
):
    """
    Seeds an image into the bucket using a specific filename format:
    uuid__YYYY-MM-DD.ext
    """
    resources = get_dept_resources(dept_name)
    SessionLocal = resources["sessionmaker"]
    bucket_path: Path = resources["image-bucket"]

    db = SessionLocal()

    try:
        # 1. Regex: Extracts UUID (1), Year (2), Month (3), and Day (4)
        pattern = r'^([a-f0-9\-]{36})__(\d{4})-(\d{2})-(\d{2})'
        match = re.search(pattern, file.filename)
        
        if not match:
            raise HTTPException(
                status_code=400, 
                detail=f"Filename '{file.filename}' must match uuid__YYYY-MM-DD.ext"
            )
        
        image_uuid = match.group(1)
        year = match.group(2)
        month_str = match.group(3)
        day_int = int(match.group(4))
        ext = Path(file.filename).suffix.lower()

        # 2. Determine folder structure (01-15 or 16-31)
        last_day = calendar.monthrange(int(year), int(month_str))[1]
        first_half_end = 14 if last_day in (28, 29) else 15
        range_folder = f"01-{first_half_end:02d}" if day_int <= first_half_end else f"{first_half_end + 1:02d}-{last_day:02d}"

        folder_path = bucket_path / year / month_str / range_folder
        folder_path.mkdir(parents=True, exist_ok=True)

        original_path = folder_path / f"{image_uuid}{ext}"

        # 3. Save Original File
        contents = await file.read()
        with open(original_path, "wb") as f:
            f.write(contents)

        # 4. Generate Thumbnail
        thumb_path = folder_path / f"{image_uuid}_thumb.webp"
        with PILImage.open(original_path) as img:
            img.thumbnail((300, 300))
            img.convert("RGB").save(thumb_path, "WEBP", quality=80)

        # 5. Create specific upload time with random H:M:S
        base_date = datetime(int(year), int(month_str), day_int)
        random_time = time(random.randint(0, 23), random.randint(0, 59), random.randint(0, 59))
        seeded_upload_time = datetime.combine(base_date, random_time)

        # 6. Database Record
        image = ImageBucket(
            uuid=image_uuid,
            image_folder=str(folder_path.relative_to(bucket_path)),
            image_type=ext.replace(".", ""),
            uploaded_at=seeded_upload_time
        )

        db.add(image)
        db.commit()

        return {"uuid": image_uuid, "folder": image.image_folder}

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@router.post("/daily-report/{dateStr}")
def seed_daily_report(
    dateStr: str,
    payload: list[dict],
    dept_name: str = Query(...)
):
    """
    Seeds report data for a specific date, overwriting existing reports.
    """
    resources = get_dept_resources(dept_name)
    db = resources["sessionmaker"]()

    try:
        # 1. Clear existing reports for this date
        existing_reports = db.query(DailyReport).filter(DailyReport.report_dateStr == dateStr).all()
        for report in existing_reports:
            db.delete(report)

        db.flush() 

        # 2. Recreate reports from payload
        for index, item in enumerate(payload):
            report = DailyReport(
                uuid=item.get("uuid"),
                report_dateStr=dateStr,
                text_content=item.get("text_content"),
                sort_order=index
            )
            db.add(report)

            # Link images using the central utility
            _attach_images(db, report, item.get("image_uuids", []))

        db.commit()
        
        # 3. Update JSON backup
        sync_json_backup(db, resources, "daily", dateStr)
        
        return {"status": f"Daily reports for {dept_name} seeded successfully"}

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()