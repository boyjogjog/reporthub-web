import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, DateTime, Date, ForeignKey, Table
from sqlalchemy.orm import relationship, declarative_base

AppBase = declarative_base()
DeptBase = declarative_base()

# --- JUNCTION TABLES ---

# Table for Daily Reports
daily_image_links = Table(
    "daily_image_links",
    DeptBase.metadata,
    Column("report_uuid", String, ForeignKey("daily_reports.uuid", ondelete="CASCADE"), primary_key=True),
    Column("image_uuid", String, ForeignKey("image_bucket.uuid", ondelete="CASCADE"), primary_key=True),
)

# Table for 2-Weekly Reports
two_weekly_image_links = Table(
    "two_weekly_image_links",
    DeptBase.metadata,
    Column("report_uuid", String, ForeignKey("two_weekly_reports.uuid", ondelete="CASCADE"), primary_key=True),
    Column("image_uuid", String, ForeignKey("image_bucket.uuid", ondelete="CASCADE"), primary_key=True),
)

# --- MODELS ---

class Department(AppBase):
    __tablename__ = "departments"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False, unique=True)
    password_hash = Column(String(255), nullable=True)

class DailyReport(DeptBase):
    __tablename__ = "daily_reports"
    uuid = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    report_dateStr = Column(String, nullable=False, index=True)
    text_content = Column(String, nullable=True)
    sort_order = Column(Integer, nullable=False)
    
    # Linked to daily_image_links
    images = relationship("ImageBucket", secondary=daily_image_links)

class TwoWeeklyReport(DeptBase):
    __tablename__ = "two_weekly_reports"
    uuid = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    report_rangeStr = Column(String, nullable=False, index=True)
    text_content = Column(String, nullable=True)
    sort_order = Column(Integer, nullable=False)
    
    # Linked to weekly_image_links
    images = relationship("ImageBucket", secondary=two_weekly_image_links)

class CommonReport(DeptBase):
    __tablename__ = "common_reports"
    uuid = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    text_content = Column(String, nullable=True) 
    sort_order = Column(Integer, nullable=False)

class ImageBucket(DeptBase):
    __tablename__ = "image_bucket"
    uuid = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    image_folder = Column(String, nullable=False)
    image_type = Column(String, nullable=False)
    uploaded_at = Column(DateTime, default=datetime.utcnow)