import { useCallback, useEffect, useState } from "react";
import { api, User } from "./api";
import Login from "./Login";
import Dashboard from "./Dashboard";
import Editor from "./Editor";

// hash routing: "#/" = dashboard, "#/doc/42" = editor. no router lib, we're lean like that
function parseHash(): { docId: number | null } {
  const m = window.location.hash.match(/^#\/doc\/(\d+)$/);
  return { docId: m ? Number(m[1]) : null };
}

export function navigate(hash: string) {
  window.location.hash = hash;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [route, setRoute] = useState(parseHash());

  useEffect(() => {
    api.me().then(setUser).catch(() => setUser(null)).finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const logout = useCallback(async () => {
    try { await api.logout(); } catch { /* cookie may already be gone */ }
    setUser(null);
    navigate("#/");
  }, []);

  if (checking) return <div className="center muted" role="status">Loading...</div>;
  if (!user) return <Login onLogin={setUser} />;
  if (route.docId !== null) {
    return <Editor key={route.docId} docId={route.docId} user={user} onLogout={logout} />;
  }
  return <Dashboard user={user} onLogout={logout} />;
}
