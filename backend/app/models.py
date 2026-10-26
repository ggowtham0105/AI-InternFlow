from datetime import datetime, timezone
from sqlalchemy import String, Integer, ForeignKey, Text, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base
now = lambda: datetime.now(timezone.utc)
class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20))  # admin | reviewer | viewer
class Candidate(Base):
    __tablename__ = "candidates"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(255), unique=True)
    # invited -> submitted -> evaluated -> approved | rejected -> feedback_sent | second_review_scheduled
    status: Mapped[str] = mapped_column(String(30), default="invited")
    task: Mapped[str | None] = mapped_column(String(300), nullable=True)
    repo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    interview_date: Mapped[str | None] = mapped_column(String(50), nullable=True)
    interview_time: Mapped[str | None] = mapped_column(String(50), nullable=True)
    meet_link: Mapped[str | None] = mapped_column(String(300), nullable=True)
    round2_date: Mapped[str | None] = mapped_column(String(50), nullable=True)
    round2_time: Mapped[str | None] = mapped_column(String(50), nullable=True)
    round2_meet_link: Mapped[str | None] = mapped_column(String(300), nullable=True)

class Assessment(Base):
    __tablename__ = "assessments"
    id: Mapped[int] = mapped_column(primary_key=True)
    candidate_id: Mapped[int] = mapped_column(ForeignKey("candidates.id"))
    scores: Mapped[dict] = mapped_column(JSON)
    total: Mapped[int] = mapped_column(Integer)
    comments: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(20), default="ai")
    state: Mapped[str] = mapped_column(String(20), default="pending")  # pending|approved|rejected
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    actor: Mapped[str] = mapped_column(String(255))
    action: Mapped[str] = mapped_column(String(100))
    detail: Mapped[str] = mapped_column(Text, default="")

class EmailLog(Base):
    __tablename__ = "email_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    candidate_id: Mapped[int] = mapped_column(ForeignKey("candidates.id"))
    kind: Mapped[str] = mapped_column(String(30))  # invite | feedback | second_review
    mode: Mapped[str] = mapped_column(String(10))  # mock | live
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    subject: Mapped[str | None] = mapped_column(String(255), nullable=True)
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
