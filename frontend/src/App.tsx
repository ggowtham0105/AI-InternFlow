import { useEffect, useState, useCallback, useId } from "react";
import {
  api,
  login,
  logout,
  loggedIn,
  RUBRIC,
  Candidate,
  Assessment,
  EmailLog,
  SheetCandidateItem,
  SheetPreviewResponse,
} from "./api";

function makeClientMeetLink() {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  const r = (n: number) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `https://meet.google.com/${r(3)}-${r(4)}-${r(3)}`;
}

const STATUS_LABELS: Record<string, { label: string; badge: string }> = {
  invited: { label: "Invited (Awaiting Repo)", badge: "bg-blue-50 text-blue-700 border-blue-200" },
  submitted: { label: "Submitted (Ready to Evaluate)", badge: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  evaluated: { label: "Evaluated (Needs Review)", badge: "bg-amber-50 text-amber-700 border-amber-200" },
  approved: { label: "Approved (Ready for 2nd Review)", badge: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  second_review_scheduled: { label: "2nd Review Scheduled", badge: "bg-teal-50 text-teal-700 border-teal-200" },
  rejected: { label: "Rejected", badge: "bg-rose-50 text-rose-700 border-rose-200" },
  feedback_sent: { label: "Feedback Delivered", badge: "bg-purple-50 text-purple-700 border-purple-200" },
};

function Login({ done }: { done: () => void }) {
  const [email, setEmail] = useState("admin@internflow.local");
  const [pw, setPw] = useState("admin123");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      await login(email, pw);
      done();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-teal-950 grid place-items-center p-4">
      <div className="w-full max-w-md bg-white/95 backdrop-blur-md border border-slate-200 shadow-2xl rounded-2xl p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-teal-600 to-emerald-500 text-white shadow-lg shadow-teal-500/20 mb-2">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">InternFlow AI</h1>
          <p className="text-sm text-slate-500">Internship lifecycle assessment & review portal</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="login-email" className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
              Admin Email
            </label>
            <input
              id="login-email"
              type="email"
              required
              className="w-full border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition-all outline-none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="login-password" className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              required
              className="w-full border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition-all outline-none"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
            />
          </div>

          {err && (
            <div role="alert" className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700 flex items-center gap-2">
              <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <span>{err}</span>
            </div>
          )}

          <button
            id="login-submit-btn"
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white font-medium py-2.5 rounded-lg shadow-md hover:shadow-lg transition-all text-sm disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Sign in to Dashboard"}
          </button>
        </form>

        <div className="pt-2 text-center text-xs text-slate-400 border-t border-slate-100">
          Default: <span className="font-mono text-slate-600">admin@internflow.local</span> / <span className="font-mono text-slate-600">admin123</span>
        </div>
      </div>
    </main>
  );
}

function GoogleSheetModal({
  isOpen,
  onClose,
  onImportComplete,
}: {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: (msg: string) => void;
}) {
  const [sheetUrl, setSheetUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<SheetPreviewResponse | null>(null);
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());

  // Interview Scheduling state
  const [interviewDate, setInterviewDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  });
  const [interviewTime, setInterviewTime] = useState("10:00 AM - 10:45 AM UTC");
  const [meetLink, setMeetLink] = useState(makeClientMeetLink);
  const [sendInvite, setSendInvite] = useState(true);
  const [hideDuplicates, setHideDuplicates] = useState(false);

  if (!isOpen) return null;

  const handleFetch = async (targetUrl = sheetUrl) => {
    if (!targetUrl.trim()) {
      setError("Please enter a Google Sheet URL or click 'Demo Sheet'.");
      return;
    }
    setError("");
    setLoading(true);
    setPreview(null);
    try {
      const data = await api<SheetPreviewResponse>("/candidates/sheet/preview", {
        method: "POST",
        body: JSON.stringify({ sheet_url: targetUrl }),
      });
      setPreview(data);
      if (data.default_schedule) {
        setInterviewDate(data.default_schedule.date);
        setInterviewTime(data.default_schedule.time);
        setMeetLink(data.default_schedule.meet_link);
      }
      // Automatically select all candidates in "ready" status
      const readyEmails = new Set(
        data.candidates.filter((c) => c.status === "ready").map((c) => c.email)
      );
      setSelectedEmails(readyEmails);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!preview) return;
    const candidatesToImport = preview.candidates
      .filter((c) => selectedEmails.has(c.email) && c.status === "ready")
      .map((c) => ({ name: c.name, email: c.email, task: c.task }));

    if (candidatesToImport.length === 0) {
      setError("No valid candidates selected for import.");
      return;
    }

    setImporting(true);
    setError("");
    try {
      const res = await api<{ imported_count: number; invites_sent: number; message: string }>("/candidates/sheet/import", {
        method: "POST",
        body: JSON.stringify({
          sheet_source: preview.source_label || "Google Sheet",
          candidates: candidatesToImport,
          send_invite: sendInvite,
          interview_date: interviewDate,
          interview_time: interviewTime,
          meet_link: meetLink,
        }),
      });
      onImportComplete(
        `Imported ${res.imported_count} candidate(s)` +
        (res.invites_sent ? ` & dispatched ${res.invites_sent} interview invite(s) with Google Meet link!` : "!")
      );
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const toggleEmail = (email: string) => {
    const next = new Set(selectedEmails);
    if (next.has(email)) next.delete(email);
    else next.add(email);
    setSelectedEmails(next);
  };

  const toggleAll = () => {
    if (!preview) return;
    const readyCandidates = preview.candidates.filter((c) => c.status === "ready");
    if (selectedEmails.size === readyCandidates.length) {
      setSelectedEmails(new Set());
    } else {
      setSelectedEmails(new Set(readyCandidates.map((c) => c.email)));
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-3xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-emerald-50/50 to-teal-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-md shadow-emerald-600/20">
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14H7v-2h5v2zm5-4H7v-2h10v2zm0-4H7V7h10v2z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Fetch Candidate Emails from Google Sheet</h2>
              <p className="text-xs text-slate-500">Import applicants & send interview invites with Google Meet</p>
            </div>
          </div>
          <button
            onClick={onClose}
            id="close-sheet-modal-btn"
            className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content body */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Input & Action */}
          <div>
            <label htmlFor="sheet-url-input" className="block text-xs font-semibold uppercase text-slate-600 mb-1.5">
              Google Sheet URL or Spreadsheet ID
            </label>
            <div className="flex gap-2">
              <input
                id="sheet-url-input"
                type="text"
                placeholder="https://docs.google.com/spreadsheets/d/1BxiMVs.../edit or Sheet ID"
                className="flex-1 border border-slate-300 rounded-lg px-3.5 py-2 text-sm focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 outline-none"
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleFetch()}
              />
              <button
                id="fetch-sheet-btn"
                onClick={() => handleFetch()}
                disabled={loading}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    <span>Fetching...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <span>Fetch Sheet</span>
                  </>
                )}
              </button>
            </div>

            {/* Quick helper */}
            <div className="flex items-center justify-between mt-2 text-xs text-slate-500">
              <span>Must be shared with <i>"Anyone with the link can view"</i>.</span>
              <button
                id="demo-sheet-btn"
                type="button"
                onClick={() => {
                  setSheetUrl("mock");
                  handleFetch("mock");
                }}
                className="text-emerald-700 hover:text-emerald-800 font-medium hover:underline flex items-center gap-1"
              >
                ✨ Load Sample Demo Sheet
              </button>
            </div>
          </div>

          {/* Error alert */}
          {error && (
            <div role="alert" className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700 flex items-start gap-2.5">
              <svg className="w-4 h-4 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div>{error}</div>
            </div>
          )}

          {/* Preview Results */}
          {preview && (
            <div className="space-y-4">
              {/* Interview Scheduling Box */}
              <div className="bg-gradient-to-r from-emerald-50/80 via-teal-50/60 to-slate-50 p-4 rounded-xl border border-emerald-200/90 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-100 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base">📅</span>
                    <div>
                      <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                        Interview Schedule & Google Meet Link
                      </h4>
                      <p className="text-[11px] text-slate-500">
                        Dispatched in the email invitation to selected candidates
                      </p>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-emerald-800 bg-white px-2.5 py-1 rounded-md border border-emerald-200 shadow-xs">
                    <input
                      type="checkbox"
                      checked={sendInvite}
                      onChange={(e) => setSendInvite(e.target.checked)}
                      className="rounded text-emerald-600 focus:ring-emerald-500"
                    />
                    <span>Send Invite Email Automatically</span>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Interview Date</label>
                    <input
                      type="date"
                      className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:border-emerald-600 outline-none"
                      value={interviewDate}
                      onChange={(e) => setInterviewDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Time Window</label>
                    <input
                      type="text"
                      className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:border-emerald-600 outline-none"
                      value={interviewTime}
                      onChange={(e) => setInterviewTime(e.target.value)}
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-[11px] font-semibold text-slate-600">Google Meet URL</label>
                      <button
                        type="button"
                        onClick={() => setMeetLink(makeClientMeetLink())}
                        className="text-[10px] text-emerald-700 hover:text-emerald-900 font-medium underline"
                      >
                        🔄 New Link
                      </button>
                    </div>
                    <input
                      type="text"
                      className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white font-mono text-emerald-800 focus:border-emerald-600 outline-none"
                      value={meetLink}
                      onChange={(e) => setMeetLink(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Summary Stats bar */}
              <div className="grid grid-cols-4 gap-2 text-center p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div>
                  <div className="text-lg font-bold text-slate-800">{preview.total_rows}</div>
                  <div className="text-[11px] text-slate-500 uppercase tracking-wide">Total Candidates</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-emerald-600">{preview.ready_count}</div>
                  <div className="text-[11px] text-emerald-700 uppercase tracking-wide">Ready to Import</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-amber-600">{preview.existing_count}</div>
                  <div className="text-[11px] text-amber-700 uppercase tracking-wide">Already in DB</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-slate-500">{preview.invalid_count}</div>
                  <div className="text-[11px] text-slate-500 uppercase tracking-wide">Invalid / Dups</div>
                </div>
              </div>

              {/* Candidates Table Filter Bar */}
              <div className="flex items-center justify-between text-xs text-slate-600 pt-1">
                <span className="font-medium">
                  {hideDuplicates ? `Showing only unique, ready candidates (${preview.ready_count})` : "Showing all detected sheet rows"}
                </span>
                {(preview.existing_count > 0 || preview.invalid_count > 0) && (
                  <button
                    type="button"
                    onClick={() => setHideDuplicates(!hideDuplicates)}
                    className="inline-flex items-center gap-1.5 font-semibold text-emerald-800 hover:text-emerald-950 bg-emerald-100/80 hover:bg-emerald-100 px-3 py-1 rounded-lg border border-emerald-300 transition-colors shadow-xs"
                  >
                    <span>🧹</span>
                    <span>{hideDuplicates ? "Show All Rows" : `Filter Out Duplicates & Existing (${preview.existing_count + preview.invalid_count})`}</span>
                  </button>
                )}
              </div>

              {/* Candidates Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <div className="max-h-60 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-700 uppercase tracking-wider sticky top-0 z-10 border-b border-slate-200">
                      <tr>
                        <th className="p-2.5 w-10 text-center">
                          <input
                            type="checkbox"
                            checked={
                              preview.ready_count > 0 &&
                              selectedEmails.size === preview.candidates.filter((c) => c.status === "ready").length
                            }
                            onChange={toggleAll}
                            className="rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                          />
                        </th>
                        <th className="p-2.5">Candidate Name</th>
                        <th className="p-2.5">Email Address</th>
                        <th className="p-2.5">Task / Track</th>
                        <th className="p-2.5 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(hideDuplicates ? preview.candidates.filter((c) => c.status === "ready") : preview.candidates).map((c) => {
                        const isReady = c.status === "ready";
                        const isSelected = selectedEmails.has(c.email);
                        return (
                          <tr
                            key={c.row_index + c.email}
                            className={`hover:bg-slate-50 transition-colors ${
                              isSelected ? "bg-emerald-50/40" : ""
                            }`}
                          >
                            <td className="p-2.5 text-center">
                              <input
                                type="checkbox"
                                disabled={!isReady}
                                checked={isSelected}
                                onChange={() => toggleEmail(c.email)}
                                className="rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                              />
                            </td>
                            <td className="p-2.5 font-medium text-slate-900">{c.name}</td>
                            <td className="p-2.5 font-mono text-slate-600">{c.email}</td>
                            <td className="p-2.5 text-slate-500">{c.task || "—"}</td>
                            <td className="p-2.5 text-right">
                              {c.status === "ready" && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-800">
                                  Ready
                                </span>
                              )}
                              {c.status === "existing" && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-800" title="Already added to database">
                                  Already in DB
                                </span>
                              )}
                              {(c.status === "invalid" || c.status === "duplicate_in_sheet") && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-rose-100 text-rose-800" title={c.message}>
                                  {c.status === "invalid" ? "Invalid" : "Duplicate"}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
          <div className="text-xs text-slate-600">
            {preview ? (
              <span>
                <b>{selectedEmails.size}</b> candidate(s) selected for import
              </span>
            ) : (
              <span>Enter a link to preview candidates</span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
            <button
              id="confirm-import-sheet-btn"
              disabled={!preview || selectedEmails.size === 0 || importing}
              onClick={handleImport}
              className="px-5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {importing ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  <span>Importing...</span>
                </>
              ) : (
                <span>Import {selectedEmails.size} Candidate(s) {sendInvite ? "& Send Invites" : ""}</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmailHistoryModal({
  candidate,
  onClose,
}: {
  candidate: Candidate | null;
  onClose: () => void;
}) {
  const [emails, setEmails] = useState<EmailLog[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!candidate) return;
    setLoading(true);
    api<EmailLog[]>(`/candidates/${candidate.id}/emails`)
      .then(setEmails)
      .catch(() => setEmails([]))
      .finally(() => setLoading(false));
  }, [candidate]);

  if (!candidate) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-teal-50 to-emerald-50">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg">✉️</span>
              <h2 className="text-base font-bold text-slate-900">Candidate Email History & Meet Links</h2>
            </div>
            <p className="text-xs text-slate-500">
              Audit trail for {candidate.name} ({candidate.email})
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {loading ? (
            <div className="py-12 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
              <svg className="w-4 h-4 animate-spin text-teal-600" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <span>Loading email logs...</span>
            </div>
          ) : emails.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              No emails recorded yet for this candidate.
            </div>
          ) : (
            <div className="space-y-3">
              {emails.map((e) => (
                <div key={e.id} className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        e.kind === "invite"
                          ? "bg-blue-100 text-blue-800"
                          : e.kind === "feedback"
                          ? "bg-purple-100 text-purple-800"
                          : "bg-teal-100 text-teal-800"
                      }`}>
                        {e.kind === "invite" ? "Round 1 Invite" : e.kind === "feedback" ? "Evaluation Feedback" : "Round 2 Second Review"}
                      </span>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">
                        {e.mode.toUpperCase()}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-400">
                      {new Date(e.at).toLocaleString()}
                    </span>
                  </div>

                  {e.subject && (
                    <div className="text-xs font-bold text-slate-800">
                      {e.subject}
                    </div>
                  )}

                  {e.details && (
                    <pre className="text-[11px] font-mono text-slate-600 bg-white p-3 rounded-lg border border-slate-200 whitespace-pre-wrap">
                      {e.details}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 text-white rounded-lg text-xs font-medium hover:bg-slate-900"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function ReviewPanel({ a, onDone }: { a: Assessment; onDone: (m: string) => void }) {
  const [scores, setScores] = useState(a.scores);
  const [comments, setComments] = useState(a.comments);
  const [submitting, setSubmitting] = useState(false);
  const total = Object.values(scores).reduce((x, y) => x + y, 0);

  // Round 2 Second Review Scheduling
  const [round2Date, setRound2Date] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    return d.toISOString().split("T")[0];
  });
  const [round2Time, setRound2Time] = useState("02:00 PM - 02:45 PM UTC");
  const [round2MeetLink, setRound2MeetLink] = useState(makeClientMeetLink);

  const send = async (decision: "approve" | "reject", sendFeedbackAndR2: boolean = false) => {
    setSubmitting(true);
    try {
      await api(`/assessments/${a.id}/review`, {
        method: "POST",
        body: JSON.stringify({
          scores,
          comments,
          decision,
          send_feedback_and_round2: sendFeedbackAndR2,
          round2_date: round2Date,
          round2_time: round2Time,
          round2_meet_link: round2MeetLink,
        }),
      });
      onDone(
        decision === "approve"
          ? (sendFeedbackAndR2
              ? `Assessment #${a.id} approved! Dispatched feedback email & Round 2 interview invite with Google Meet link.`
              : `Assessment #${a.id} approved!`)
          : `Assessment #${a.id} rejected.`
      );
    } catch (e) {
      onDone((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="border border-slate-200 rounded-xl bg-white p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full border border-teal-200">
            Assessment Review #{a.id}
          </span>
          <h3 className="text-base font-bold text-slate-800 mt-1">
            Candidate ID: #{a.candidate_id}
          </h3>
        </div>
        <div className="text-right">
          <div className="text-2xl font-black text-slate-900">{total}<span className="text-sm font-normal text-slate-400">/100</span></div>
          <div className="text-[11px] text-slate-500 font-medium">Draft Total Score</div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Object.entries(RUBRIC).map(([k, max]) => (
          <div key={k} className="p-3 bg-slate-50 rounded-lg border border-slate-200">
            <div className="flex justify-between items-center text-xs font-semibold text-slate-700 mb-1">
              <span className="capitalize">{k.replace("_", " ")}</span>
              <span className="text-slate-400">max {max}</span>
            </div>
            <input
              type="number"
              min={0}
              max={max}
              className="w-full border border-slate-300 rounded px-2 py-1 text-sm bg-white focus:border-teal-600 outline-none"
              value={scores[k] ?? 0}
              onChange={(e) =>
                setScores({
                  ...scores,
                  [k]: Math.min(max, Math.max(0, +e.target.value)),
                })
              }
            />
          </div>
        ))}
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">Reviewer Feedback & Comments</label>
        <textarea
          rows={2}
          className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:border-teal-600 outline-none"
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          aria-label="Reviewer comments"
        />
      </div>

      {/* Round 2 / Second Review Scheduling Box */}
      <div className="bg-gradient-to-r from-teal-50/80 via-emerald-50/50 to-slate-50 p-4 rounded-xl border border-teal-200/90 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-base">🚀</span>
          <div>
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
              Round 2: Technical Deep Dive & Second Review Schedule
            </h4>
            <p className="text-[11px] text-slate-500">
              When approved, the candidate receives their assessment feedback email PLUS the Round 2 interview invitation with Google Meet
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Round 2 Date</label>
            <input
              type="date"
              className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:border-teal-600 outline-none"
              value={round2Date}
              onChange={(e) => setRound2Date(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Round 2 Time Window</label>
            <input
              type="text"
              className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:border-teal-600 outline-none"
              value={round2Time}
              onChange={(e) => setRound2Time(e.target.value)}
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[11px] font-semibold text-slate-600">Round 2 Meet URL</label>
              <button
                type="button"
                onClick={() => setRound2MeetLink(makeClientMeetLink())}
                className="text-[10px] text-teal-700 hover:text-teal-900 font-medium underline"
              >
                🔄 New Link
              </button>
            </div>
            <input
              type="text"
              className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white font-mono text-teal-800 focus:border-teal-600 outline-none"
              value={round2MeetLink}
              onChange={(e) => setRound2MeetLink(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-2">
        <button
          disabled={submitting}
          className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-lg px-4 py-2 text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
          onClick={() => send("approve", true)}
        >
          <span>✓</span>
          <span>Approve & Send Feedback + 2nd Review Invite</span>
        </button>
        <button
          disabled={submitting}
          className="border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg px-3 py-2 text-xs font-semibold transition-all"
          onClick={() => send("approve", false)}
        >
          Approve Only
        </button>
        <button
          disabled={submitting}
          className="border border-rose-300 hover:bg-rose-50 text-rose-700 rounded-lg px-3 py-2 text-xs font-semibold transition-all"
          onClick={() => send("reject", false)}
        >
          Reject Assessment
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [auth, setAuth] = useState(loggedIn());
  const [cands, setCands] = useState<Candidate[]>([]);
  const [asm, setAsm] = useState<Assessment[]>([]);
  const [stats, setStats] = useState<{ total: number; by_status: Record<string, number> } | null>(null);
  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState<"success" | "error" | "info">("info");

  // Single candidate form
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [task, setTask] = useState("");
  const [repo, setRepo] = useState<Record<number, string>>({});

  // Sheets & Email modal state
  const [isSheetModalOpen, setIsSheetModalOpen] = useState(false);
  const [emailModalCandidate, setEmailModalCandidate] = useState<Candidate | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, a, s] = await Promise.all([
        api<Candidate[]>("/candidates"),
        api<Assessment[]>("/assessments"),
        api<any>("/dashboard"),
      ]);
      setCands(c);
      setAsm(a);
      setStats(s);
    } catch (e) {
      setMsg((e as Error).message);
      setMsgType("error");
    }
  }, []);

  useEffect(() => {
    if (auth) load();
  }, [auth, load]);

  const showBanner = (text: string, type: "success" | "error" | "info" = "info") => {
    setMsg(text);
    setMsgType(type);
    setTimeout(() => {
      setMsg("");
    }, 6000);
  };

  const act = async (path: string, body?: object, ok = "Action completed") => {
    try {
      await api(path, {
        method: "POST",
        body: body ? JSON.stringify(body) : undefined,
      });
      showBanner(ok, "success");
    } catch (e) {
      showBanner((e as Error).message, "error");
    }
    load();
  };

  if (!auth) return <Login done={() => setAuth(true)} />;

  const pending = asm.filter((a) => a.state === "pending");

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 pb-16">
      {/* Top Navbar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-teal-600 to-emerald-500 text-white flex items-center justify-center shadow-md shadow-teal-600/20">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <span className="text-lg font-bold text-slate-900 tracking-tight">InternFlow AI</span>
              <span className="hidden sm:inline-block ml-2 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                Mock Mode
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500 hidden sm:inline font-mono">admin@internflow.local</span>
            <button
              id="sign-out-btn"
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 transition-colors"
              onClick={() => {
                logout();
                setAuth(false);
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 space-y-6">
        {/* Banner notification */}
        {msg && (
          <div
            role="status"
            className={`p-4 rounded-xl border text-sm font-medium flex items-center justify-between shadow-xs transition-all ${
              msgType === "success"
                ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                : msgType === "error"
                ? "bg-rose-50 border-rose-200 text-rose-800"
                : "bg-blue-50 border-blue-200 text-blue-800"
            }`}
          >
            <span>{msg}</span>
            <button onClick={() => setMsg("")} className="text-slate-400 hover:text-slate-600">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Dashboard Metrics Ribbon */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-xs">
              <div className="text-xs font-semibold uppercase text-slate-400 tracking-wider">Total Candidates</div>
              <div className="text-2xl font-black text-slate-900 mt-1">{stats.total}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">Enrolled applicants</div>
            </div>
            <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-xs">
              <div className="text-xs font-semibold uppercase text-amber-500 tracking-wider">Awaiting Review</div>
              <div className="text-2xl font-black text-amber-600 mt-1">{pending.length}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">Pending human sign-off</div>
            </div>
            <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-xs">
              <div className="text-xs font-semibold uppercase text-emerald-600 tracking-wider">Approved</div>
              <div className="text-2xl font-black text-emerald-600 mt-1">{stats.by_status.approved ?? 0}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">Ready for feedback</div>
            </div>
            <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-xs">
              <div className="text-xs font-semibold uppercase text-purple-600 tracking-wider">Feedback Sent</div>
              <div className="text-2xl font-black text-purple-600 mt-1">{stats.by_status.feedback_sent ?? 0}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">Lifecycle completed</div>
            </div>
          </div>
        )}

        {/* Action Panel: Add candidate & Google Sheet Fetch */}
        <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">Add or Import Candidates</h2>
              <p className="text-xs text-slate-500">Register individual applicants or import candidate emails in batch from Google Sheets</p>
            </div>
            {/* Google Sheets Trigger Button */}
            <button
              id="open-sheet-import-btn"
              onClick={() => setIsSheetModalOpen(true)}
              className="inline-flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-semibold px-4 py-2 rounded-lg text-xs shadow-sm hover:shadow transition-all"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14H7v-2h5v2zm5-4H7v-2h10v2zm0-4H7V7h10v2z" />
              </svg>
              <span>Fetch from Google Sheet</span>
            </button>
          </div>

          {/* Manual Entry Form */}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await act("/candidates", { name, email, task: task || undefined }, "Candidate added successfully");
              setName("");
              setEmail("");
              setTask("");
            }}
            className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
          >
            <div>
              <label htmlFor="new-candidate-name" className="block text-xs font-semibold uppercase text-slate-600 mb-1">
                Full Name
              </label>
              <input
                id="new-candidate-name"
                required
                placeholder="e.g. Maya Lin"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:border-teal-600 outline-none"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="new-candidate-email" className="block text-xs font-semibold uppercase text-slate-600 mb-1">
                Email Address
              </label>
              <input
                id="new-candidate-email"
                type="email"
                required
                placeholder="maya@example.com"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:border-teal-600 outline-none"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="new-candidate-task" className="block text-xs font-semibold uppercase text-slate-600 mb-1">
                Track / Role (Optional)
              </label>
              <input
                id="new-candidate-task"
                placeholder="e.g. AI / Backend"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:border-teal-600 outline-none"
                value={task}
                onChange={(e) => setTask(e.target.value)}
              />
            </div>
            <div>
              <button
                id="manual-add-candidate-btn"
                type="submit"
                className="w-full bg-slate-800 hover:bg-slate-900 text-white font-semibold px-4 py-2 rounded-lg text-xs transition-colors"
              >
                + Add Single Candidate
              </button>
            </div>
          </form>
        </section>

        {/* Candidates Table */}
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">Enrolled Candidates ({cands.length})</h2>
            <div className="flex items-center gap-2">
              {cands.length > 0 && (
                <button
                  id="dedupe-cohort-btn"
                  onClick={async () => {
                    try {
                      const res = await api<{ duplicates_removed: number; message: string }>("/candidates/deduplicate", { method: "POST" });
                      showBanner(res.message, "success");
                      load();
                    } catch (e) {
                      showBanner((e as Error).message, "error");
                    }
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 px-3 py-1.5 rounded-lg border border-rose-200 transition-colors shadow-xs"
                >
                  <span>🧹</span>
                  <span>Delete Duplicate Records</span>
                </button>
              )}
              <span className="text-xs text-slate-500">Live cohort updates</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase tracking-wider border-b border-slate-200">
                <tr>
                  <th className="p-3.5">Candidate</th>
                  <th className="p-3.5">Task / Track</th>
                  <th className="p-3.5">Round 1 Interview & Meet</th>
                  <th className="p-3.5">Round 2 Second Review</th>
                  <th className="p-3.5">Lifecycle Stage</th>
                  <th className="p-3.5 text-right">Workflow Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cands.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400">
                      No candidates enrolled yet. Click <b>"Fetch from Google Sheet"</b> above or add one manually.
                    </td>
                  </tr>
                ) : (
                  cands.map((c) => {
                    const st = STATUS_LABELS[c.status] || { label: c.status, badge: "bg-slate-100 text-slate-700" };
                    return (
                      <tr key={c.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="p-3.5">
                          <div className="font-semibold text-slate-900 text-sm">{c.name}</div>
                          <div className="font-mono text-slate-500 text-xs">{c.email}</div>
                          <button
                            onClick={() => setEmailModalCandidate(c)}
                            className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-teal-700 hover:text-teal-900 hover:underline"
                          >
                            <span>✉️ View Sent Emails</span>
                          </button>
                        </td>
                        <td className="p-3.5 text-slate-600">
                          {c.task ? (
                            <span className="inline-block px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">
                              {c.task}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="p-3.5">
                          {c.meet_link ? (
                            <div className="space-y-1">
                              <div className="text-[11px] font-semibold text-slate-700">
                                📅 {c.interview_date || "Scheduled"}
                              </div>
                              <div className="text-[10px] text-slate-500">
                                ⏰ {c.interview_time || "10:00 AM UTC"}
                              </div>
                              <a
                                href={c.meet_link}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] font-mono text-emerald-700 hover:text-emerald-900 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 hover:bg-emerald-100 transition-colors"
                              >
                                <span>🎥</span>
                                <span className="underline">Join Meet</span>
                              </a>
                            </div>
                          ) : (
                            <span className="text-slate-400 text-xs">Not scheduled</span>
                          )}
                        </td>
                        <td className="p-3.5">
                          {c.round2_meet_link ? (
                            <div className="space-y-1">
                              <div className="text-[11px] font-semibold text-teal-800">
                                🚀 {c.round2_date || "Scheduled"}
                              </div>
                              <div className="text-[10px] text-slate-500">
                                ⏰ {c.round2_time || "02:00 PM UTC"}
                              </div>
                              <a
                                href={c.round2_meet_link}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] font-mono text-teal-700 hover:text-teal-900 bg-teal-50 px-2 py-0.5 rounded border border-teal-200 hover:bg-teal-100 transition-colors"
                              >
                                <span>🎥</span>
                                <span className="underline">Join Meet</span>
                              </a>
                            </div>
                          ) : (
                            <span className="text-slate-400 text-xs">
                              {c.status === "approved" ? "Ready to schedule" : "Awaiting review"}
                            </span>
                          )}
                        </td>
                        <td className="p-3.5">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${st.badge}`}>
                            {st.label}
                          </span>
                        </td>
                        <td className="p-3.5 text-right space-x-2">
                          {c.status === "invited" && (
                            <div className="inline-flex items-center gap-2 justify-end">
                              <button
                                id={`send-invite-${c.id}`}
                                className="px-2.5 py-1 text-xs font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 rounded border border-teal-200 transition-colors"
                                onClick={() => act(`/candidates/${c.id}/invite`, undefined, `Invite with Google Meet sent to ${c.email}`)}
                              >
                                Send Invite
                              </button>
                              <input
                                aria-label="GitHub repository URL"
                                placeholder="https://github.com/owner/repo"
                                className="border border-slate-300 rounded px-2 py-1 text-xs w-44 focus:border-teal-600 outline-none"
                                value={repo[c.id] ?? ""}
                                onChange={(e) => setRepo({ ...repo, [c.id]: e.target.value })}
                              />
                              <button
                                id={`save-repo-${c.id}`}
                                className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
                                onClick={() =>
                                   act(`/candidates/${c.id}/submission`, { repo_url: repo[c.id] ?? "" }, `Repo saved for ${c.name}`)
                                }
                              >
                                Save Repo
                              </button>
                            </div>
                          )}

                          {c.status === "submitted" && (
                            <button
                              id={`eval-candidate-${c.id}`}
                              className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors"
                              onClick={() => act(`/candidates/${c.id}/evaluate`, undefined, `Mock AI assessment created for ${c.name}`)}
                            >
                              Run AI Evaluation
                            </button>
                          )}

                          {c.status === "approved" && (
                            <button
                              id={`send-feedback-r2-${c.id}`}
                              className="px-3 py-1.5 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-lg shadow-sm transition-colors"
                              onClick={() => act(`/candidates/${c.id}/second-review`, undefined, `Second review email delivered to ${c.name}`)}
                            >
                              Dispatch 2nd Review Invite
                            </button>
                          )}

                          {c.status === "second_review_scheduled" && (
                            <span className="text-emerald-700 font-semibold text-xs inline-flex items-center gap-1">
                              <span>✓</span> 2nd Review Active
                            </span>
                          )}

                          {(c.status === "feedback_sent" || c.status === "rejected" || c.status === "evaluated") && (
                            <span className="text-slate-400 text-xs italic">
                              {c.status === "evaluated" ? "Awaiting review in queue below" : "No pending action"}
                            </span>
                          )}

                          <button
                            id={`delete-candidate-${c.id}`}
                            title={`Delete candidate ${c.name}`}
                            onClick={async () => {
                              if (confirm(`Delete candidate ${c.name} (${c.email})?`)) {
                                try {
                                  await api(`/candidates/${c.id}`, { method: "DELETE" });
                                  showBanner(`Candidate ${c.name} deleted`, "success");
                                  load();
                                } catch (e) {
                                  showBanner((e as Error).message, "error");
                                }
                              }
                            }}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 transition-colors inline-flex items-center justify-center align-middle ml-1"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Human Assessment Review Gate */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">Assessments Pending Human Review ({pending.length})</h2>
              <p className="text-xs text-slate-500">Human-in-the-loop review gate before feedback dispatch</p>
            </div>
          </div>

          {pending.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-6 text-center text-slate-400 text-xs">
              No assessments currently awaiting review. Evaluate a submitted candidate above to generate a draft.
            </div>
          ) : (
            <div className="space-y-4">
              {pending.map((a) => (
                <ReviewPanel
                  key={a.id}
                  a={a}
                  onDone={(m) => {
                    showBanner(m, "success");
                    load();
                  }}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {/* Google Sheets Modal Component */}
      <GoogleSheetModal
        isOpen={isSheetModalOpen}
        onClose={() => setIsSheetModalOpen(false)}
        onImportComplete={(msg) => {
          showBanner(msg, "success");
          load();
        }}
      />

      {/* Candidate Email Audit Log Modal */}
      <EmailHistoryModal
        candidate={emailModalCandidate}
        onClose={() => setEmailModalCandidate(null)}
      />
    </div>
  );
}
