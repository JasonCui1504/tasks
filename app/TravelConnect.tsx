"use client";

import { useState } from "react";
import type { Actions, Data } from "./shared";

/**
 * Sign in to travel.jascui.com once so trip days show the actual itinerary.
 * The tasks app only reads trips there; nothing on the travel app changes.
 * `compact` is the one-line version for under a trip.
 */
export function TravelConnect({ data, actions, compact }: { data: Data; actions: Actions; compact?: boolean }) {
  const link = data.travelLink;
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState(link.username);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await actions.connectTravel(username, password);
      setPassword("");
      setOpen(false);
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  if (link.connected && !link.error && !open) {
    if (compact) return null;
    return (
      <p className="muted small travel-connect">
        ✓ Reading itineraries from travel.jascui.com as {link.username} ·{" "}
        <button className="link small" onClick={actions.disconnectTravel}>Disconnect</button>
      </p>
    );
  }

  if (!open) {
    return (
      <p className="small travel-connect">
        {link.error && <span className="danger">{link.error} </span>}
        <button className="link small strong" onClick={() => setOpen(true)}>
          {link.error ? "Sign in to travel.jascui.com again" : "See trip itineraries day by day — connect travel.jascui.com →"}
        </button>
      </p>
    );
  }

  return (
    <form className="travel-connect-form" onSubmit={connect}>
      <p className="muted small">
        Sign in with your travel.jascui.com login, once. Tasks only reads your trips there to show each day&apos;s plan — nothing on the travel app
        changes. Your password is kept encrypted, only to renew the sign-in every month; Disconnect deletes it.
      </p>
      <div className="row2">
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Travel username" autoComplete="off" autoCapitalize="none" aria-label="travel.jascui.com username" autoFocus />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Travel password" autoComplete="off" aria-label="travel.jascui.com password" />
      </div>
      <div className="inline">
        <button className="btn primary small-btn" disabled={busy || !username.trim() || !password}>{busy ? "Connecting…" : "Connect"}</button>
        <button type="button" className="link small" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
