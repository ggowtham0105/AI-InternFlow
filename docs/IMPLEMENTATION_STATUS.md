# Status
Built & Verified: FastAPI auth/RBAC, candidates, invites (dedupe & Google Meet scheduling), submissions (URL validation), mock AI draft, human review gate with feedback dispatch & Round 2 second review invitation, audit/email logs with modal viewer, dashboard; React login/candidates/review UI; Google Sheets candidate email fetching with live preview, email validation, deduplication, batch import, and automated invitation dispatch with date, time, and Google Meet URL.
Run & Verified: Vite frontend build (tsc + vite build), FastAPI backend server with SQLite, pytest test suite (test_full_flow and test_sheet_invite_and_second_review).
Not built: Alembic migrations, n8n live webhooks, GitHub commit validation, frontend unit tests, user management.
Security notes: change JWT_SECRET/ADMIN_PASSWORD; replace static PBKDF2 salt with per-user salt before pilot.

