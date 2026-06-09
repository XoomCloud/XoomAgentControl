"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, setSession, type SessionUser } from "@/lib/api";
import { Spinner } from "@/lib/ui";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@xoomagent.local");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api<{ token: string; user: SessionUser }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setSession(res.token, res.user);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <div className="brand" style={{ paddingBottom: 8 }}>
          <div className="brand-mark" />
          <div>
            <div className="brand-name">XoomAgent</div>
            <div className="brand-sub">Control Platform</div>
          </div>
        </div>
        <h2 style={{ margin: "8px 0 4px" }}>Operator sign in</h2>
        <p className="muted" style={{ marginTop: 0, marginBottom: 18 }}>
          Sign in to manage tenants, hosts and deployments.
        </p>
        {error && <div className="error-box">{error}</div>}
        <form onSubmit={onSubmit}>
          <div className="field">
            <label>Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label>Password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
          </div>
          <button className="btn primary" type="submit" disabled={loading} style={{ width: "100%", justifyContent: "center" }}>
            {loading ? <Spinner /> : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
