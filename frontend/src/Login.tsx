import { FormEvent, useState } from "react";
import { api, ApiError, User } from "./api";
import Wordmark from "./Wordmark";

export default function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLogin(await api.login(email, password));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="center">
      <form className="card login" onSubmit={submit}>
        <Wordmark big />
        <h1>Welcome back</h1>
        <p className="muted">Sign in to pick up your documents.</p>
        <label>
          Email
          <input type="email" value={email} autoComplete="username" required autoFocus
            onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" value={password} autoComplete="current-password" required
            onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Signing in..." : "Sign in"}
        </button>
        <p className="hint">
          Demo account: <code>alice@demo.com</code> / <code>demo1234</code>
          <button type="button" className="link"
            onClick={() => { setEmail("alice@demo.com"); setPassword("demo1234"); }}>
            Fill it in
          </button>
        </p>
      </form>
    </main>
  );
}
