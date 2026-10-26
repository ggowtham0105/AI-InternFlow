import os; os.environ["DATABASE_URL"] = "sqlite:///./test.db"
import pytest
from fastapi.testclient import TestClient
from app.main import app, startup
from app.db import Base, engine

@pytest.fixture(autouse=True)
def clean_db():
    Base.metadata.drop_all(engine)
    startup()
    yield

def tok(c):
    return {"Authorization": "Bearer " + c.post("/api/auth/login", data={"username": "admin@internflow.local", "password": "admin123"}).json()["access_token"]}
def test_full_flow():
    with TestClient(app) as c:
        assert c.get("/api/candidates").status_code == 401
        h = tok(c)
        cid = c.post("/api/candidates", json={"name": "Test", "email": "t@example.com"}, headers=h).json()["id"]
        assert c.post(f"/api/candidates/{cid}/invite", headers=h).json()["mode"] == "mock"
        assert c.post(f"/api/candidates/{cid}/invite", headers=h).status_code == 409
        assert c.post(f"/api/candidates/{cid}/submission", json={"repo_url": "bad"}, headers=h).status_code == 422
        c.post(f"/api/candidates/{cid}/submission", json={"repo_url": "https://github.com/a/b"}, headers=h)
        aid = c.post(f"/api/candidates/{cid}/evaluate", headers=h).json()["id"]
        assert c.post(f"/api/candidates/{cid}/feedback", headers=h).status_code == 403  # AI draft can't release feedback
        assert c.post(f"/api/assessments/{aid}/review", json={"decision": "approve"}, headers=h).json()["state"] == "approved"
        assert c.post(f"/api/candidates/{cid}/feedback", headers=h).status_code == 200

def test_sheet_invite_and_second_review():
    with TestClient(app) as c:
        h = tok(c)
        # 1. Import from Gsheet with interview date, time, and Google Meet link
        res = c.post("/api/candidates/sheet/import", json={
            "candidates": [{"name": "Sara Connor", "email": "sara@example.com", "task": "Full Stack"}],
            "sheet_source": "Admissions Sheet",
            "send_invite": True,
            "interview_date": "2026-10-30",
            "interview_time": "11:00 AM - 11:45 AM UTC",
            "meet_link": "https://meet.google.com/abc-defg-hij"
        }, headers=h)
        assert res.status_code == 201
        assert res.json()["invites_sent"] == 1

        # Check candidate details and email log
        cands = c.get("/api/candidates", headers=h).json()
        sara = next(x for x in cands if x["email"] == "sara@example.com")
        assert sara["meet_link"] == "https://meet.google.com/abc-defg-hij"
        assert sara["interview_date"] == "2026-10-30"

        emails = c.get(f"/api/candidates/{sara['id']}/emails", headers=h).json()
        assert len(emails) == 1
        assert emails[0]["kind"] == "invite"
        assert "Google Meet Link: https://meet.google.com/abc-defg-hij" in emails[0]["details"]

        # 2. Candidate submits repo and AI evaluates
        c.post(f"/api/candidates/{sara['id']}/submission", json={"repo_url": "https://github.com/sara/task"}, headers=h)
        aid = c.post(f"/api/candidates/{sara['id']}/evaluate", headers=h).json()["id"]

        # 3. First review finishes -> sends feedback email and second review interview email
        rev = c.post(f"/api/assessments/{aid}/review", json={
            "decision": "approve",
            "send_feedback_and_round2": True,
            "round2_date": "2026-11-05",
            "round2_time": "03:00 PM - 03:45 PM UTC",
            "round2_meet_link": "https://meet.google.com/xyz-uvwx-rst"
        }, headers=h)
        assert rev.status_code == 200

        # Verify candidate updated to second_review_scheduled
        updated_sara = next(x for x in c.get("/api/candidates", headers=h).json() if x["id"] == sara["id"])
        assert updated_sara["status"] == "second_review_scheduled"
        assert updated_sara["round2_meet_link"] == "https://meet.google.com/xyz-uvwx-rst"

        # Verify email logs contain both feedback and second_review
        sara_emails = c.get(f"/api/candidates/{sara['id']}/emails", headers=h).json()
        kinds = [e["kind"] for e in sara_emails]
        assert "feedback" in kinds
        assert "second_review" in kinds
        r2_email = next(e for e in sara_emails if e["kind"] == "second_review")
        assert "https://meet.google.com/xyz-uvwx-rst" in r2_email["details"]

