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
    try {
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
    } catch {
      setError("Something went wrong. Try again.");
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="login-form">
      {setup && (
        <label className="login-field">
          <span>Setup code</span>
          <input name="code" autoComplete="off" autoCapitalize="none" spellCheck={false} required />
        </label>
      )}
      <label className="login-field">
        <span>Username</span>
        <input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus required />
      </label>
      <label className="login-field">
        <span>Password</span>
        <input name="password" type="password" autoComplete={setup ? "new-password" : "current-password"} minLength={setup ? 8 : undefined} required />
      </label>
      {setup && (
        <label className="login-field">
          <span>Confirm password</span>
          <input name="confirm" type="password" autoComplete="new-password" required />
        </label>
      )}
      {error && <p className="error">{error}</p>}
      <button className="login-submit" disabled={busy}>
        {busy ? (setup ? "Creating…" : "Logging in…") : setup ? "Create account" : "Log in"}
      </button>
    </form>
  );
}
