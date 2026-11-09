"use client";

import { useState } from "react";
import type { Trip } from "@/lib/types";
import type { Actions, Data } from "./shared";

/**
 * Connect a trip's itinerary: paste the trip's calendar link from travel.jascui.com
 * (trip page → menu → Add to calendar → copy the Apple Calendar link). Read-only —
 * the travel app is never changed.
 */
export function TripLink({ trip, data, actions }: { trip: Trip; data: Data; actions: Actions }) {
  const itin = data.itineraries.find((i) => i.id === trip.id);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await actions.linkTripCalendar(url);
      setUrl("");
      setOpen(false);
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  if (itin && !itin.error && !open) {
    return (
      <p className="muted small trip-link">
        ✓ Itinerary linked ·{" "}
        <button className="link small" onClick={() => actions.unlinkTripCalendar(trip.id)}>Unlink</button>
      </p>
    );
  }

  if (!open) {
    return (
      <p className="small trip-link">
        {itin?.error && <span className="danger">{itin.error} </span>}
        <button className="link small strong" onClick={() => setOpen(true)}>
          {itin?.error ? "Paste the link again" : "Show this trip's itinerary day by day →"}
        </button>
      </p>
    );
  }

  return (
    <form className="trip-link-form" onSubmit={save}>
      <p className="muted small">
        On <a href={trip.url} target="_blank" rel="noreferrer">the trip page</a>, open the menu → <strong>Add to calendar</strong>, right-click{" "}
        <strong>Apple Calendar</strong> and copy the link, then paste it here. It&apos;s only read — nothing changes on the travel app.
      </p>
      <div className="inline">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="webcal://travel.jascui.com/api/trips/…" autoFocus aria-label="Trip calendar link" />
        <button className="btn primary small-btn" disabled={busy || !url.trim()}>{busy ? "Checking…" : "Link"}</button>
        <button type="button" className="link small" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
