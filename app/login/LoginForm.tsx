"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginForm({ setup = false }: { setup?: boolean }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    if (setup && form.get("password") !== form.get("confirm")) {
      setError("The passwords don't match.");
      setBusy(false);
      return;
    }
    const res = await fetch(setup ? "/api/auth/setup" : "/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: form.get("code"), username: form.get("username"), password: form.get("password") }),
    });
    if (res.ok) {
      router.replace("/");
      router.refresh();
      return;
    }
    setError((await res.json().catch(() => ({}))).error ?? "Couldn't sign in.");
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="stack">
      {setup && <input name="code" placeholder="Setup code" autoComplete="off" autoCapitalize="none" spellCheck={false} required />}
      <input name="username" placeholder="Username" autoComplete="username" autoCapitalize="none" required />
      <input name="password" type="password" placeholder="Password" autoComplete={setup ? "new-password" : "current-password"} minLength={setup ? 8 : undefined} required />
      {setup && <input name="confirm" type="password" placeholder="Confirm password" autoComplete="new-password" required />}
      {error && <p className="error">{error}</p>}
      <button className="btn primary" disabled={busy}>{busy ? (setup ? "Creating…" : "Signing in…") : setup ? "Create account" : "Sign in"}</button>
    </form>
  );
}
