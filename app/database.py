from pathlib import Path
from typing import Generator
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from fastapi import Depends
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

# Import your defined bases and models
from models import AppBase, DeptBase, Department
from authen import get_auth_data

# --- HASHING CONFIG (Argon2) ---
ph = PasswordHasher()

# --- PATHS ---
DATA_BASE = Path(__file__).resolve().parent.parent / "data"
DEPT_DIR = DATA_BASE / "departments"
DATA_BASE.mkdir(exist_ok=True)
DEPT_DIR.mkdir(exist_ok=True)

# --- SHARED GLOBAL DB ---
SHARED_ENGINE = create_engine(
    f"sqlite:///{DATA_BASE / 'data-app.db'}", 
    connect_args={"check_same_thread": False}
)
SharedSession = sessionmaker(bind=SHARED_ENGINE)
AppBase.metadata.create_all(bind=SHARED_ENGINE)

# --- SEEDING LOGIC ---

def seed_departments():
    """Seeds the global department list with Argon2 hashes."""
    db = SharedSession()
    try:
        initial_depts = {
            "deck": "deck@aqb",
            "electrical": "electrical@aqb",
            "engine": "engine@aqb",
            "store": "store@aqb"
        }
        
        for name, password in initial_depts.items():
            exists = db.query(Department).filter(Department.name == name).first()
            if not exists:
                # Argon2 handles salting automatically
                hashed_pw = ph.hash(password)
                new_dept = Department(name=name, password_hash=hashed_pw)
                db.add(new_dept)
                print(f"Seeding department: {name}")
        
        db.commit()
    except Exception as e:
        print(f"Error seeding: {e}")
        db.rollback()
    finally:
        db.close()

seed_departments()

# --- CACHE & RESOURCES ---
DEPT_CACHE = {}

def get_app_db() -> Generator[Session, None, None]:
    db = SharedSession()
    try: yield db
    finally: db.close()

async def get_dept_context(auth: dict = Depends(get_auth_data)) -> Generator[tuple[Session, dict], None, None]:
    dept_name = auth["sub"].lower()
    res = get_dept_resources(dept_name)
    
    db = res["sessionmaker"]()
    try:
        # Yield the whole 'res' dict so we can access any folder we need
        yield db, res 
    finally:
        db.close()


def get_dept_resources(dept_name: str):
    name = dept_name.lower()
    if name not in DEPT_CACHE:
        path = DEPT_DIR / name
        
        # Define all required paths
        resources = {
            "image-bucket": path / "image-bucket",
            "reports-daily": path / "reports" / "daily",
            "reports-weekly": path / "reports" / "2-weekly"
        }
        
        # Create directories
        resources["image-bucket"].mkdir(parents=True, exist_ok=True)
        resources["reports-daily"].mkdir(parents=True, exist_ok=True)
        resources["reports-weekly"].mkdir(parents=True, exist_ok=True)
        
        engine = create_engine(
            f"sqlite:///{path / f'data-{name}.db'}", 
            connect_args={"check_same_thread": False}
        )
        DeptBase.metadata.create_all(bind=engine)
        
        DEPT_CACHE[name] = {
            "sessionmaker": sessionmaker(bind=engine),
            **resources # Merge paths into the cache
        }
    return DEPT_CACHE[name]

# --- HELPERS ---

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a password against an Argon2 hash."""
    try:
        return ph.verify(hashed_password, plain_password)
    except VerifyMismatchError:
        return False
        