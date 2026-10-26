export type Candidate = {
  id: number;
  name: string;
  email: string;
  status: string;
  task: string | null;
  repo_url: string | null;
  interview_date?: string | null;
  interview_time?: string | null;
  meet_link?: string | null;
  round2_date?: string | null;
  round2_time?: string | null;
  round2_meet_link?: string | null;
};
export type Assessment = { id:number; candidate_id:number; scores:Record<string,number>; total:number; comments:string; source:string; state:string };
export type EmailLog = { id:number; candidate_id:number; kind:string; mode:string; at:string; subject:string|null; details:string|null };
export type SheetCandidateItem = { row_index:number; name:string; email:string; task:string|null; status:"ready"|"existing"|"invalid"|"duplicate_in_sheet"; message:string };
export type SheetPreviewResponse = {
  total_rows: number;
  ready_count: number;
  existing_count: number;
  invalid_count: number;
  source_label: string;
  default_schedule?: { date: string; time: string; meet_link: string };
  candidates: SheetCandidateItem[];
};
export const RUBRIC: Record<string,number> = { correctness:30, code_quality:25, testing:20, documentation:15, commit_history:10 };
let token = sessionStorage.getItem("t") || "";
export const loggedIn = () => !!token;
export const logout = () => { token = ""; sessionStorage.removeItem("t"); };
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch("/api" + path, { ...init, headers: { ...(init.body && !(init.body instanceof URLSearchParams) ? { "Content-Type":"application/json" } : {}), ...(token ? { Authorization:`Bearer ${token}` } : {}) } });
  if (r.status === 401 && token) { logout(); location.reload(); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || "Request failed");
  return data;
}
export async function login(email: string, password: string) {
  const d = await api<{access_token:string}>("/auth/login", { method:"POST", body:new URLSearchParams({ username:email, password }) });
  token = d.access_token; sessionStorage.setItem("t", token);
}
