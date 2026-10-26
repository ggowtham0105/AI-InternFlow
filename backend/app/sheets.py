import re
import csv
import io
import httpx
from typing import List, Dict, Any, Tuple, Optional

# Sample mock sheet data for demonstration and offline testing
MOCK_SHEET_CSV = """Name,Email,Role / Task
Alex Rivera,alex.rivera@example.com,Full Stack Track
Priya Sharma,priya.sharma@example.com,AI / Backend Track
Marcus Chen,marcus.chen@example.com,Frontend Engineering
Fatima Zahra,fatima.zahra@example.com,DevOps / Cloud
Liam O'Connor,liam.oconnor@example.com,Data Systems
"""

EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$")

def extract_sheet_id_and_gid(url_or_id: str) -> Tuple[Optional[str], Optional[str]]:
    """Extracts Google Sheet ID and optional GID from various Google Sheet URL formats."""
    text = url_or_id.strip()
    if not text:
        return None, None

    # Direct Sheet ID pattern (alphanumeric, dashes, underscores, usually 30-50 chars)
    if re.fullmatch(r"[a-zA-Z0-9-_]{20,}", text):
        return text, None

    # Matches /spreadsheets/d/<SHEET_ID>
    match = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", text)
    sheet_id = match.group(1) if match else None

    # Matches gid=<GID> in query string or URL fragment (#gid=...)
    gid_match = re.search(r"[?&#]gid=([0-9]+)", text)
    gid = gid_match.group(1) if gid_match else None

    return sheet_id, gid

def build_google_sheet_csv_url(url_or_id: str) -> Tuple[str, Optional[str]]:
    """Builds the direct CSV export URL for a Google Sheet."""
    cleaned = url_or_id.strip()

    # If it's already a direct CSV URL
    if cleaned.startswith("http") and ("export?format=csv" in cleaned or "output=csv" in cleaned):
        return cleaned, None

    sheet_id, gid = extract_sheet_id_and_gid(cleaned)
    if not sheet_id:
        # Fallback to direct URL if it's http
        if cleaned.startswith("http://") or cleaned.startswith("https://"):
            return cleaned, None
        raise ValueError(f"Could not extract a valid Google Sheet ID from '{url_or_id}'. Please provide a valid Google Sheet URL or ID.")

    csv_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv"
    if gid:
        csv_url += f"&gid={gid}"
    return csv_url, sheet_id

async def fetch_sheet_csv(url_or_id: str) -> Tuple[str, str]:
    """Fetches CSV content from Google Sheets or mock data.
    Returns (csv_content, source_label).
    """
    cleaned = url_or_id.strip()
    if cleaned.lower() in ("mock", "demo", "sample", "test"):
        return MOCK_SHEET_CSV, "Demo Google Sheet"

    csv_url, sheet_id = build_google_sheet_csv_url(cleaned)

    try:
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
            resp = await client.get(
                csv_url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) InternFlow/1.0"
                }
            )

        if resp.status_code == 404:
            raise ValueError("Google Sheet not found. Please verify the URL or Sheet ID.")
        if resp.status_code in (401, 403) or "accounts.google.com" in str(resp.url):
            raise ValueError(
                "Access denied to Google Sheet. Make sure the sheet's Share settings are set to 'Anyone with the link can view' or use 'Publish to the web' as CSV."
            )
        if resp.status_code != 200:
            raise ValueError(f"Failed to fetch Google Sheet: HTTP {resp.status_code}")

        content_type = resp.headers.get("content-type", "").lower()
        text = resp.text

        # Detect if Google returned an HTML login or error page instead of CSV
        if "<html" in text.lower() and not ("@ " in text or "@" in text):
            raise ValueError(
                "Google Sheet returned an HTML page instead of spreadsheet data. Please ensure 'Anyone with the link can view' is enabled in Google Sheets sharing settings."
            )

        source_label = f"Google Sheet ({sheet_id})" if sheet_id else "Google Sheet"
        return text, source_label

    except httpx.RequestError as exc:
        raise ValueError(f"Network error connecting to Google Sheets: {str(exc)}")

def parse_candidates_from_csv(csv_text: str, existing_emails: set[str], exclude_duplicates: bool = False) -> Dict[str, Any]:
    """Parses candidate records from CSV content with smart column detection, email validation, and deduplication."""
    reader = csv.reader(io.StringIO(csv_text))
    rows = [row for row in reader if any(cell.strip() for cell in row)]
    if not rows:
        return {
            "total_rows": 0,
            "ready_count": 0,
            "existing_count": 0,
            "invalid_count": 0,
            "duplicates_removed": 0,
            "candidates": []
        }

    headers = [col.strip().lower() for col in rows[0]]
    email_idx = -1
    name_idx = -1
    task_idx = -1

    # Heuristic 1: Match header names
    for i, h in enumerate(headers):
        clean_h = re.sub(r"[_\s\-]+", "", h)
        if email_idx == -1 and any(k in clean_h for k in ("email", "mail", "e-mail")):
            email_idx = i
        elif name_idx == -1 and any(k in clean_h for k in ("name", "applicant", "candidate", "student")):
            name_idx = i
        elif task_idx == -1 and any(k in clean_h for k in ("task", "role", "position", "track", "domain", "project")):
            task_idx = i

    start_row = 1

    # Heuristic 2: If no header match for email, inspect rows to detect email column automatically
    if email_idx == -1:
        # Check first row; if it's already data (contains @), start_row = 0
        for row_idx, r in enumerate(rows[:5]):
            for col_idx, cell in enumerate(r):
                if EMAIL_REGEX.match(cell.strip()):
                    email_idx = col_idx
                    if row_idx == 0:
                        start_row = 0
                    break
            if email_idx != -1:
                break

    if email_idx == -1:
        raise ValueError(
            "Could not detect an Email column in the Google Sheet. Please ensure a column header is named 'Email', 'Mail', or contains candidate email addresses."
        )

    # If name wasn't detected and start_row == 1, pick first other column
    if name_idx == -1:
        for i in range(len(rows[0])):
            if i != email_idx and i != task_idx:
                name_idx = i
                break

    parsed_candidates = []
    seen_in_sheet: set[str] = set()
    ready_count = 0
    existing_count = 0
    invalid_count = 0

    for idx, row in enumerate(rows[start_row:], start=start_row + 1):
        if not row or not any(c.strip() for c in row):
            continue

        raw_email = row[email_idx].strip() if email_idx < len(row) else ""
        raw_name = row[name_idx].strip() if (name_idx != -1 and name_idx < len(row)) else ""
        raw_task = row[task_idx].strip() if (task_idx != -1 and task_idx < len(row)) else ""

        if not raw_email and not raw_name:
            continue

        clean_email = raw_email.lower()

        # Derive a name from email if blank
        display_name = raw_name
        if not display_name and clean_email and "@" in clean_email:
            local = clean_email.split("@")[0]
            display_name = re.sub(r"[._-]+", " ", local).title()

        item: Dict[str, Any] = {
            "row_index": idx,
            "name": display_name or "Candidate",
            "email": clean_email,
            "task": raw_task or None,
            "status": "ready",
            "message": "Ready to import"
        }

        if not clean_email or not EMAIL_REGEX.match(clean_email):
            item["status"] = "invalid"
            item["message"] = f"Invalid email format: '{raw_email}'"
            invalid_count += 1
        elif clean_email in existing_emails:
            item["status"] = "existing"
            item["message"] = "Candidate already exists in database"
            existing_count += 1
        elif clean_email in seen_in_sheet:
            item["status"] = "duplicate_in_sheet"
            item["message"] = "Duplicate email in this sheet"
            invalid_count += 1
        else:
            seen_in_sheet.add(clean_email)
            ready_count += 1

        parsed_candidates.append(item)

    total_candidates = len(parsed_candidates)
    if exclude_duplicates:
        filtered = [c for c in parsed_candidates if c["status"] == "ready"]
        duplicates_removed = total_candidates - len(filtered)
        parsed_candidates = filtered
    else:
        duplicates_removed = 0

    return {
        "total_rows": total_candidates,
        "ready_count": ready_count,
        "existing_count": existing_count,
        "invalid_count": invalid_count,
        "duplicates_removed": duplicates_removed,
        "candidates": parsed_candidates
    }

