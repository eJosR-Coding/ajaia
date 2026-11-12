// Tiny typed fetch wrapper. One place that knows the {"error":{code,message}} shape.

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface User { id: number; email: string; name: string }
export interface DocMeta {
  id: number; title: string; revision: number; owner_id: number;
  is_owner: boolean; updated_at: string | null;
}
export interface Doc extends DocMeta { content_html: string }
export interface VersionMeta { id: number; title: string; created_at: string }

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api" + path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // fetch only rejects when the network is cooked
    throw new ApiError(0, "network", "Cannot reach the server. Check your connection.");
  }
  if (!res.ok) {
    let code = "unknown";
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) { code = data.error.code ?? code; message = data.error.message ?? message; }
    } catch { /* non-JSON error body, keep defaults */ }
    throw new ApiError(res.status, code, message);
  }
  return (await res.json()) as T;
}

export const api = {
  login: (email: string, password: string) => request<User>("POST", "/auth/login", { email, password }),
  logout: () => request<{ ok: boolean }>("POST", "/auth/logout"),
  me: () => request<User>("GET", "/me"),
  list: () => request<{ owned: DocMeta[]; shared: DocMeta[] }>("GET", "/documents"),
  create: (title?: string) => request<Doc>("POST", "/documents", { title }),
  importFile: (filename: string, text: string) =>
    request<Doc>("POST", "/documents/import", { filename, text }),
  get: (id: number) => request<Doc>("GET", `/documents/${id}`),
  rename: (id: number, title: string) => request<Doc>("PATCH", `/documents/${id}`, { title }),
  save: (id: number, content_html: string, revision: number) =>
    request<Doc>("PUT", `/documents/${id}`, { content_html, revision }),
  shares: (id: number) => request<User[]>("GET", `/documents/${id}/shares`),
  share: (id: number, email: string) => request<User>("POST", `/documents/${id}/shares`, { email }),
  versions: (id: number) => request<VersionMeta[]>("GET", `/documents/${id}/versions`),
  restore: (id: number, vid: number) =>
    request<Doc>("POST", `/documents/${id}/versions/${vid}/restore`),
};
