import os, re, hashlib, hmac, jwt, random, string
from datetime import datetime, timedelta, timezone
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from .db import Base, engine, get_db, SessionLocal
from .models import User, Candidate, Assessment, AuditLog, EmailLog
from .sheets import fetch_sheet_csv, parse_candidates_from_csv

SECRET = os.getenv("JWT_SECRET", "dev-only-change-me")
INTEGRATIONS_LIVE = os.getenv("INTEGRATIONS_LIVE", "false") == "true"  # mock mode by default
RUBRIC = {"correctness": 30, "code_quality": 25, "testing": 20, "documentation": 15, "commit_history": 10}
app = FastAPI(title="InternFlow AI")
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173").split(","),
                   allow_methods=["*"], allow_headers=["*"])
oauth = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

def hash_pw(p: str, salt: bytes = b"internflow") -> str:
    return hashlib.pbkdf2_hmac("sha256", p.encode(), salt, 200_000).hex()

def generate_meet_link() -> str:
    p1 = "".join(random.choices(string.ascii_lowercase, k=3))
    p2 = "".join(random.choices(string.ascii_lowercase, k=4))
    p3 = "".join(random.choices(string.ascii_lowercase, k=3))
    return f"https://meet.google.com/{p1}-{p2}-{p3}"

def default_interview_schedule(days_ahead: int = 1) -> tuple[str, str]:
    target_dt = datetime.now(timezone.utc) + timedelta(days=days_ahead)
    return target_dt.strftime("%Y-%m-%d"), "10:00 AM - 10:45 AM UTC"

def default_round2_schedule(days_ahead: int = 3) -> tuple[str, str]:
    target_dt = datetime.now(timezone.utc) + timedelta(days=days_ahead)
    return target_dt.strftime("%Y-%m-%d"), "02:00 PM - 02:45 PM UTC"

def make_invite_email_body(name: str, task: str | None, date: str, time: str, meet: str) -> str:
    track_info = f" ({task})" if task else ""
    return (
        f"Dear {name},\n\n"
        f"Thank you for your application to InternFlow{track_info}. "
        f"You have been scheduled for an initial technical interview.\n\n"
        f"📅 Date: {date}\n"
        f"⏰ Time: {time}\n"
        f"💻 Google Meet Link: {meet}\n\n"
        f"Please ensure you join via the Google Meet link 5 minutes before your scheduled start time. "
        f"Have your camera and microphone ready.\n\n"
        f"Best regards,\n"
        f"InternFlow Admissions & Engineering Team"
    )

def make_feedback_email_body(name: str, aid: int, total: int, scores: dict, comments: str) -> str:
    breakdown = "\n".join(f"- {k.replace('_', ' ').title()}: {v}/{RUBRIC.get(k, 100)}" for k, v in scores.items())
    return (
        f"Dear {name},\n\n"
        f"Your technical submission for Assessment #{aid} has completed its formal human evaluation.\n\n"
        f"Overall Score: {total}/100\n\n"
        f"Score Breakdown:\n{breakdown}\n\n"
        f"Reviewer Feedback:\n{comments or 'Great work demonstrating key problem-solving competencies.'}\n\n"
        f"Best regards,\n"
        f"InternFlow Evaluation Board"
    )

def make_round2_email_body(name: str, date: str, time: str, meet: str) -> str:
    return (
        f"Dear {name},\n\n"
        f"Congratulations! Based on your successful Round 1 evaluation, you have advanced to Round 2: Technical Deep Dive & Second Review.\n\n"
        f"📅 Date: {date}\n"
        f"⏰ Time: {time}\n"
        f"💻 Google Meet Link: {meet}\n\n"
        f"In this second review interview, our senior engineers will discuss your project implementation, architectural tradeoffs, and extension challenges.\n\n"
        f"Best regards,\n"
        f"InternFlow Technical Hiring Team"
    )

def ensure_schema():
    with engine.connect() as conn:
        try:
            cols = [r[1] for r in conn.exec_driver_sql("PRAGMA table_info(candidates)").fetchall()]
            new_candidate_cols = {
                "interview_date": "VARCHAR(50)",
                "interview_time": "VARCHAR(50)",
                "meet_link": "VARCHAR(300)",
                "round2_date": "VARCHAR(50)",
                "round2_time": "VARCHAR(50)",
                "round2_meet_link": "VARCHAR(300)",
            }
            for col_name, col_type in new_candidate_cols.items():
                if col_name not in cols:
                    conn.exec_driver_sql(f"ALTER TABLE candidates ADD COLUMN {col_name} {col_type}")
            
            email_cols = [r[1] for r in conn.exec_driver_sql("PRAGMA table_info(email_logs)").fetchall()]
            new_email_cols = {
                "subject": "VARCHAR(255)",
                "details": "TEXT",
            }
            for col_name, col_type in new_email_cols.items():
                if col_name not in email_cols:
                    conn.exec_driver_sql(f"ALTER TABLE email_logs ADD COLUMN {col_name} {col_type}")
            conn.commit()
        except Exception:
            pass

@app.on_event("startup")
def startup():
    Base.metadata.create_all(engine)
    ensure_schema()
    with SessionLocal() as db:
        if not db.scalar(select(func.count(User.id))):
            pw = os.getenv("ADMIN_PASSWORD", "admin123")
            db.add(User(email="admin@internflow.local", password_hash=hash_pw(pw), role="admin")); db.commit()

def audit(db, actor, action, detail=""):
    db.add(AuditLog(actor=actor, action=action, detail=detail))

def current_user(token: str = Depends(oauth), db: Session = Depends(get_db)) -> User:
    try: uid = int(jwt.decode(token, SECRET, algorithms=["HS256"])["sub"])
    except Exception: raise HTTPException(401, "Invalid or expired token")
    u = db.get(User, uid)
    if not u: raise HTTPException(401, "Unknown user")
    return u

def require(*roles):
    def dep(u: User = Depends(current_user)):
        if u.role not in roles: raise HTTPException(403, "Insufficient permissions")
        return u
    return dep

@app.get("/api/health")
def health(): return {"ok": True, "integrations": "live" if INTEGRATIONS_LIVE else "mock"}

@app.post("/api/auth/login")
def login(f: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    u = db.scalar(select(User).where(User.email == f.username))
    if not u or not hmac.compare_digest(u.password_hash, hash_pw(f.password)):
        raise HTTPException(401, "Incorrect email or password")
    exp = datetime.now(timezone.utc) + timedelta(hours=8)
    audit(db, u.email, "login"); db.commit()
    return {"access_token": jwt.encode({"sub": str(u.id), "exp": exp}, SECRET, algorithm="HS256"),
            "token_type": "bearer", "role": u.role, "email": u.email}

class CandidateIn(BaseModel):
    name: str; email: EmailStr; task: str | None = None
    interview_date: str | None = None
    interview_time: str | None = None
    meet_link: str | None = None

class SheetPreviewIn(BaseModel):
    sheet_url: str

class CandidateSheetItem(BaseModel):
    name: str
    email: EmailStr
    task: str | None = None

class SheetImportIn(BaseModel):
    candidates: list[CandidateSheetItem]
    sheet_source: str | None = "Google Sheet"
    send_invite: bool = True
    interview_date: str | None = None
    interview_time: str | None = None
    meet_link: str | None = None

@app.get("/api/candidates")
def list_candidates(db: Session = Depends(get_db), _=Depends(current_user)):
    return db.scalars(select(Candidate).order_by(Candidate.id)).all()

@app.post("/api/candidates", status_code=201)
def add_candidate(c: CandidateIn, db: Session = Depends(get_db), u=Depends(require("admin"))):
    if db.scalar(select(Candidate).where(Candidate.email == c.email)):
        raise HTTPException(409, "Candidate with this email already exists")
    data = c.model_dump()
    if not data.get("interview_date") or not data.get("interview_time"):
        d, t = default_interview_schedule()
        data["interview_date"] = data.get("interview_date") or d
        data["interview_time"] = data.get("interview_time") or t
    if not data.get("meet_link"):
        data["meet_link"] = generate_meet_link()
    row = Candidate(**data); db.add(row); audit(db, u.email, "candidate.create", c.email)
    db.commit(); return row

@app.delete("/api/candidates/{cid}")
def delete_candidate(cid: int, db: Session = Depends(get_db), u=Depends(require("admin"))):
    c = db.get(Candidate, cid) or _404()
    email = c.email
    db.execute(select(Assessment).where(Assessment.candidate_id == cid))
    for a in db.scalars(select(Assessment).where(Assessment.candidate_id == cid)).all():
        db.delete(a)
    for el in db.scalars(select(EmailLog).where(EmailLog.candidate_id == cid)).all():
        db.delete(el)
    db.delete(c)
    audit(db, u.email, "candidate.delete", f"Deleted candidate #{cid} ({email})")
    db.commit()
    return {"deleted": True, "id": cid, "message": f"Candidate {email} deleted successfully"}

@app.post("/api/candidates/deduplicate")
def deduplicate_candidates(db: Session = Depends(get_db), u=Depends(require("admin"))):
    cands = db.scalars(select(Candidate).order_by(Candidate.id)).all()
    seen = set()
    deleted = 0
    for c in cands:
        clean = c.email.strip().lower()
        if clean in seen:
            for a in db.scalars(select(Assessment).where(Assessment.candidate_id == c.id)).all():
                db.delete(a)
            for el in db.scalars(select(EmailLog).where(EmailLog.candidate_id == c.id)).all():
                db.delete(el)
            db.delete(c)
            deleted += 1
        else:
            seen.add(clean)
    audit(db, u.email, "candidates.deduplicate", f"Removed {deleted} duplicate candidate(s)")
    db.commit()
    return {"duplicates_removed": deleted, "message": f"Removed {deleted} duplicate candidate(s)"}

@app.post("/api/candidates/sheet/preview")
async def preview_sheet(req: SheetPreviewIn, db: Session = Depends(get_db), _=Depends(require("admin", "reviewer"))):
    try:
        csv_text, source_label = await fetch_sheet_csv(req.sheet_url)
    except ValueError as e:
        raise HTTPException(400, str(e))
    existing_emails = set(db.scalars(select(Candidate.email)).all())
    try:
        result = parse_candidates_from_csv(csv_text, existing_emails)
        result["source_label"] = source_label
        default_d, default_t = default_interview_schedule(1)
        result["default_schedule"] = {
            "date": default_d,
            "time": default_t,
            "meet_link": generate_meet_link(),
        }
        return result
    except ValueError as e:
        raise HTTPException(400, str(e))

@app.post("/api/candidates/sheet/import", status_code=201)
def import_sheet_candidates(req: SheetImportIn, db: Session = Depends(get_db), u=Depends(require("admin"))):
    if not req.candidates:
        raise HTTPException(400, "No candidates provided for import")
    existing = set(db.scalars(select(Candidate.email)).all())
    created = []
    
    # Schedule setup
    default_d, default_t = default_interview_schedule(1)
    base_date = req.interview_date or default_d
    base_time = req.interview_time or default_t
    base_meet = req.meet_link or generate_meet_link()

    for item in req.candidates:
        clean_email = item.email.strip().lower()
        if clean_email in existing:
            continue
        candidate = Candidate(
            name=item.name.strip(),
            email=clean_email,
            task=item.task.strip() if item.task else None,
            interview_date=base_date,
            interview_time=base_time,
            meet_link=base_meet
        )
        db.add(candidate)
        created.append(candidate)
        existing.add(clean_email)
    
    db.flush()  # populate candidate IDs

    # If send_invite requested, generate interview email logs with Date, Time, and Google Meet link
    invites_sent = 0
    if req.send_invite:
        for c in created:
            subject = f"Interview Invitation: InternFlow Technical Assessment - {c.name}"
            body = make_invite_email_body(c.name, c.task, c.interview_date or base_date, c.interview_time or base_time, c.meet_link or base_meet)
            db.add(EmailLog(
                candidate_id=c.id,
                kind="invite",
                mode="live" if INTEGRATIONS_LIVE else "mock",
                subject=subject,
                details=body
            ))
            invites_sent += 1
            audit(db, u.email, "email.invite", f"{c.email} | {c.interview_date} {c.interview_time} | {c.meet_link}")

    audit(db, u.email, "candidates.sheet_import", f"Imported {len(created)} candidates from {req.sheet_source} (invites sent: {invites_sent})")
    db.commit()
    return {
        "imported_count": len(created),
        "invites_sent": invites_sent,
        "message": f"Successfully imported {len(created)} candidates" + (f" and sent {invites_sent} interview invite(s) with Google Meet link" if invites_sent else "")
    }

class InviteIn(BaseModel):
    interview_date: str | None = None
    interview_time: str | None = None
    meet_link: str | None = None

@app.post("/api/candidates/{cid}/invite")
def invite(cid: int, inv: InviteIn | None = None, db: Session = Depends(get_db), u=Depends(require("admin"))):
    c = db.get(Candidate, cid) or _404()
    if db.scalar(select(EmailLog).where(EmailLog.candidate_id == cid, EmailLog.kind == "invite")):
        raise HTTPException(409, "Invitation already sent")  # duplicate-email guard
    
    default_d, default_t = default_interview_schedule(1)
    date = (inv and inv.interview_date) or c.interview_date or default_d
    time = (inv and inv.interview_time) or c.interview_time or default_t
    meet = (inv and inv.meet_link) or c.meet_link or generate_meet_link()
    c.interview_date, c.interview_time, c.meet_link = date, time, meet

    subject = f"Interview Invitation: InternFlow Technical Assessment - {c.name}"
    body = make_invite_email_body(c.name, c.task, date, time, meet)
    db.add(EmailLog(
        candidate_id=cid,
        kind="invite",
        mode="live" if INTEGRATIONS_LIVE else "mock",
        subject=subject,
        details=body
    ))
    audit(db, u.email, "email.invite", f"{c.email} | {date} {time} | {meet}"); db.commit()
    return {
        "sent": INTEGRATIONS_LIVE,
        "mode": "live" if INTEGRATIONS_LIVE else "mock",
        "interview_date": date,
        "interview_time": time,
        "meet_link": meet
    }

class Submission(BaseModel): repo_url: str

@app.post("/api/candidates/{cid}/submission")
def submit(cid: int, s: Submission, db: Session = Depends(get_db), u=Depends(require("admin", "reviewer"))):
    if not re.fullmatch(r"https://github\.com/[\w.-]+/[\w.-]+/?", s.repo_url):
        raise HTTPException(422, "Repository must be a https://github.com/owner/repo URL")
    c = db.get(Candidate, cid) or _404()
    c.repo_url, c.status = s.repo_url, "submitted"
    audit(db, u.email, "submission", s.repo_url); db.commit(); return c

@app.post("/api/candidates/{cid}/evaluate", status_code=201)
def evaluate(cid: int, db: Session = Depends(get_db), u=Depends(require("admin", "reviewer"))):
    """Mock AI evaluation. Real provider is called via n8n; code is never executed here."""
    c = db.get(Candidate, cid) or _404()
    if c.status not in ("submitted", "evaluated"): raise HTTPException(409, "No submission to evaluate")
    seed = sum(map(ord, c.email))
    scores = {k: min(v, (seed * (i + 3)) % (v + 1)) for i, (k, v) in enumerate(RUBRIC.items())}
    a = Assessment(candidate_id=cid, scores=scores, total=sum(scores.values()), source="ai",
                   comments="Mock AI draft. Needs human review.")
    c.status = "evaluated"; db.add(a); audit(db, "ai", "assessment.draft", c.email); db.commit(); return a

@app.get("/api/assessments")
def assessments(db: Session = Depends(get_db), _=Depends(current_user)):
    return db.scalars(select(Assessment).order_by(Assessment.id.desc())).all()

class Review(BaseModel):
    scores: dict[str, int] | None = None
    comments: str | None = None
    decision: str  # approve|reject
    send_feedback_and_round2: bool = False
    round2_date: str | None = None
    round2_time: str | None = None
    round2_meet_link: str | None = None

@app.post("/api/assessments/{aid}/review")
def review(aid: int, r: Review, db: Session = Depends(get_db), u=Depends(require("admin", "reviewer"))):
    a = db.get(Assessment, aid) or _404()
    if a.state != "pending": raise HTTPException(409, "Assessment already decided")
    if r.decision not in ("approve", "reject"): raise HTTPException(422, "decision must be approve or reject")
    if r.scores:
        if any(k not in RUBRIC or not 0 <= v <= RUBRIC[k] for k, v in r.scores.items()):
            raise HTTPException(422, "Scores outside rubric range")
        a.scores = {**a.scores, **r.scores}; a.total = sum(a.scores.values()); a.source = "human-edited"
    if r.comments is not None: a.comments = r.comments
    a.state = "approved" if r.decision == "approve" else "rejected"; a.reviewed_by = u.id  # humans only
    c = db.get(Candidate, a.candidate_id)
    c.status = a.state

    # When approved and reviewer requests sending feedback & 2nd review invite:
    if r.decision == "approve" and r.send_feedback_and_round2:
        # 1. Send feedback email (if not already sent)
        if not db.scalar(select(EmailLog).where(EmailLog.candidate_id == c.id, EmailLog.kind == "feedback")):
            fb_subject = f"InternFlow Assessment Results & Review Feedback - {c.name}"
            fb_body = make_feedback_email_body(c.name, a.id, a.total, a.scores, a.comments)
            db.add(EmailLog(candidate_id=c.id, kind="feedback", mode="live" if INTEGRATIONS_LIVE else "mock", subject=fb_subject, details=fb_body))
            audit(db, u.email, "email.feedback", c.email)

        # 2. Send second review email (if not already sent)
        default_r2_d, default_r2_t = default_round2_schedule(3)
        r2_date = r.round2_date or c.round2_date or default_r2_d
        r2_time = r.round2_time or c.round2_time or default_r2_t
        r2_meet = r.round2_meet_link or c.round2_meet_link or generate_meet_link()
        c.round2_date, c.round2_time, c.round2_meet_link = r2_date, r2_time, r2_meet

        if not db.scalar(select(EmailLog).where(EmailLog.candidate_id == c.id, EmailLog.kind == "second_review")):
            r2_subject = f"InternFlow Round 2: Technical Deep Dive & Second Review - {c.name}"
            r2_body = make_round2_email_body(c.name, r2_date, r2_time, r2_meet)
            db.add(EmailLog(candidate_id=c.id, kind="second_review", mode="live" if INTEGRATIONS_LIVE else "mock", subject=r2_subject, details=r2_body))
            audit(db, u.email, "email.second_review", f"{c.email} | {r2_date} {r2_time} | {r2_meet}")

        c.status = "second_review_scheduled"

    audit(db, u.email, f"assessment.{a.state}", str(aid)); db.commit(); return a

@app.post("/api/candidates/{cid}/feedback")
def feedback(cid: int, db: Session = Depends(get_db), u=Depends(require("admin"))):
    c = db.get(Candidate, cid) or _404()
    ok = db.scalar(select(Assessment).where(Assessment.candidate_id == cid, Assessment.state == "approved"))
    if not ok: raise HTTPException(403, "Feedback requires an approved assessment")
    if c.status == "feedback_sent": raise HTTPException(409, "Feedback already sent")
    
    subject = f"InternFlow Assessment Results & Review Feedback - {c.name}"
    body = make_feedback_email_body(c.name, ok.id, ok.total, ok.scores, ok.comments)
    db.add(EmailLog(candidate_id=cid, kind="feedback", mode="live" if INTEGRATIONS_LIVE else "mock", subject=subject, details=body))
    c.status = "feedback_sent"; audit(db, u.email, "email.feedback", c.email); db.commit()
    return {"sent": INTEGRATIONS_LIVE, "mode": "live" if INTEGRATIONS_LIVE else "mock"}

class SecondReviewIn(BaseModel):
    round2_date: str | None = None
    round2_time: str | None = None
    round2_meet_link: str | None = None

@app.post("/api/candidates/{cid}/second-review")
def second_review(cid: int, req: SecondReviewIn | None = None, db: Session = Depends(get_db), u=Depends(require("admin", "reviewer"))):
    c = db.get(Candidate, cid) or _404()
    ok = db.scalar(select(Assessment).where(Assessment.candidate_id == cid, Assessment.state == "approved"))
    if not ok: raise HTTPException(403, "Second review requires an approved assessment")
    if db.scalar(select(EmailLog).where(EmailLog.candidate_id == cid, EmailLog.kind == "second_review")):
        raise HTTPException(409, "Second review invitation already sent")
    
    default_r2_d, default_r2_t = default_round2_schedule(3)
    r2_date = (req and req.round2_date) or c.round2_date or default_r2_d
    r2_time = (req and req.round2_time) or c.round2_time or default_r2_t
    r2_meet = (req and req.round2_meet_link) or c.round2_meet_link or generate_meet_link()
    c.round2_date, c.round2_time, c.round2_meet_link = r2_date, r2_time, r2_meet

    r2_subject = f"InternFlow Round 2: Technical Deep Dive & Second Review - {c.name}"
    r2_body = make_round2_email_body(c.name, r2_date, r2_time, r2_meet)
    db.add(EmailLog(candidate_id=c.id, kind="second_review", mode="live" if INTEGRATIONS_LIVE else "mock", subject=r2_subject, details=r2_body))
    c.status = "second_review_scheduled"
    audit(db, u.email, "email.second_review", f"{c.email} | {r2_date} {r2_time} | {r2_meet}")
    db.commit()
    return {"sent": INTEGRATIONS_LIVE, "mode": "live" if INTEGRATIONS_LIVE else "mock", "round2_date": r2_date, "round2_time": r2_time, "round2_meet_link": r2_meet}

@app.get("/api/candidates/{cid}/emails")
def candidate_emails(cid: int, db: Session = Depends(get_db), _=Depends(current_user)):
    return db.scalars(select(EmailLog).where(EmailLog.candidate_id == cid).order_by(EmailLog.id.desc())).all()

@app.get("/api/emails")
def all_emails(db: Session = Depends(get_db), _=Depends(current_user)):
    return db.scalars(select(EmailLog).order_by(EmailLog.id.desc()).limit(100)).all()

@app.get("/api/dashboard")
def dashboard(db: Session = Depends(get_db), _=Depends(current_user)):
    rows = db.execute(select(Candidate.status, func.count()).group_by(Candidate.status)).all()
    avg = db.scalar(select(func.avg(Assessment.total)).where(Assessment.state == "approved"))
    return {"by_status": dict(rows), "total": sum(n for _, n in rows), "avg_approved_score": avg}

@app.get("/api/audit")
def audit_log(db: Session = Depends(get_db), _=Depends(require("admin"))):
    return db.scalars(select(AuditLog).order_by(AuditLog.id.desc()).limit(200)).all()

def _404(): raise HTTPException(404, "Not found")

