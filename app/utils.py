import json
import time
import asyncio
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import desc

# Local Imports
from models import (
    ImageBucket, 
    DailyReport, 
    TwoWeeklyReport, 
    CommonReport
)
from world import SEARCH_TASKS, SSE_SESSIONS  # Ensure SSE_SESSIONS is here
from database import get_dept_resources  # Add this!

# If you haven't imported uuid for your logic elsewhere
import uuid

def _attach_images(db: Session, report_object, image_filenames: list[str]):
    """
    Links images to a report by looking up the UUID in the ImageBucket table.
    - Handles filename to UUID conversion
    - Prevents duplicates
    """
    if not image_filenames:
        report_object.images = [] # Clear if empty
        return

    # 1. Extract UUIDs from filenames (e.g., 'uuid.jpg' -> 'uuid')
    # Use a set to handle duplicates in the input list
    unique_uuids = {f.split('.')[0] for f in image_filenames}

    # 2. Bulk query for performance (Better than querying in a loop)
    image_records = db.query(ImageBucket).filter(
        ImageBucket.uuid.in_(unique_uuids)
    ).all()

    # 3. Update relationship
    report_object.images = image_records
    
    # Optional: Log missing images
    found_uuids = {img.uuid for img in image_records}
    missing = unique_uuids - found_uuids
    if missing:
        print(f"⚠️ Warning: Images {missing} not found in DB.")

def sync_all_affected_backups(db: Session, res: dict, daily_dates: list, weekly_ranges: list):
    """Refreshes JSON files for all dates/ranges provided."""
    for date_str in set(daily_dates):
        sync_json_backup(db, res, "daily", date_str)
    
    for range_str in set(weekly_ranges):
        sync_json_backup(db, res, "2-weekly", range_str)

def sync_json_backup(db: Session, res: dict, report_type: str, filename: str = None):
    """Generates a JSON backup file for the specified report type."""
    # 1. Determine Target Path and Query
    if report_type == "daily":
        target_path = Path(res["reports-daily"]) / f"{filename}.json"
        reports = db.query(DailyReport).filter(DailyReport.report_dateStr == filename).order_by(DailyReport.sort_order).all()
    elif report_type == "2-weekly":
        target_path = Path(res["reports-weekly"]) / f"{filename}.json"
        reports = db.query(TwoWeeklyReport).filter(TwoWeeklyReport.report_rangeStr == filename).order_by(TwoWeeklyReport.sort_order).all()
    else:
        pass

    # 2. Build the backup payload
    json_payload = []
    for r in reports:
        item = {
            "uuid": r.uuid,
            "text_content": r.text_content,
            "sort_order": r.sort_order,
            "images": [] 
        }
        
        # Check relationship
        if hasattr(r, 'images') and r.images:
            for img in r.images:
                # Construct path relative to bucket root
                full_path = f"{img.image_folder}/{img.uuid}.{img.image_type}"
                item["images"].append(full_path)
        
        json_payload.append(item)

    # 3. Write to Disk
    target_path.parent.mkdir(parents=True, exist_ok=True)
    with open(target_path, "w", encoding="utf-8") as f:
        json.dump(json_payload, f, indent=4)


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
        ).order_by(desc(DailyReport.report_dateStr)).all()

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