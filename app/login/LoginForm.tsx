"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginForm() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
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
      <input name="username" placeholder="Username" autoComplete="username" autoCapitalize="none" required />
      <input name="password" type="password" placeholder="Password" autoComplete="current-password" required />
      {error && <p className="error">{error}</p>}
      <button className="btn primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
