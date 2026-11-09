"use client";

import { useState } from "react";
import { daysBetween, formatDateKey, localDateKey } from "@/lib/time";
import type { Trip } from "@/lib/types";
import { byDue, TaskRow, type Actions, type Data } from "./shared";
import { TripLink } from "./TripLink";

function countdown(trip: Trip, today: string): string {
  const days = daysBetween(today, trip.startDate);
  if (days > 1) return `In ${days} days`;
  if (days === 1) return "Tomorrow";
  if (days === 0) return "Starts today";
  return "Underway";
}

/** Upcoming trips from travel.jascui.com, each with its prep tasks. `compact` is the side-panel version. */
export function TripsView({ data, actions, compact, focus }: { data: Data; actions: Actions; compact?: boolean; focus?: number | null }) {
  const today = localDateKey(data.now, data.tz);

  if (!data.travelConfigured) {
    return <p className="muted small panel-empty">Trips come from travel.jascui.com. Set TRAVEL_FEED_SECRET to connect it.</p>;
  }
  if (!data.trips.length) {
    return <p className="muted small panel-empty">No upcoming trips on travel.jascui.com.</p>;
  }

  return (
    <div className={compact ? "trip-stack compact" : "trip-stack"}>
      {data.trips.map((trip) => (
        <TripCard key={trip.id} trip={trip} today={today} data={data} actions={actions} compact={compact} focused={(focus ?? data.focusTrip) === trip.id} />
      ))}
    </div>
  );
}

function TripCard({ trip, today, data, actions, compact, focused }: { trip: Trip; today: string; data: Data; actions: Actions; compact?: boolean; focused: boolean }) {
  const [quick, setQuick] = useState("");
  const prep = data.tasks.filter((t) => t.tripId === trip.id && t.status === "open").sort(byDue);
  const done = data.tasks.filter((t) => t.tripId === trip.id && t.status === "done").length;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const title = quick.trim();
    if (!title) return;
    setQuick("");
    await actions.addTask({ title, category: "trip", tripId: trip.id });
  }

  return (
    <article className={`trip-card ${focused ? "focused" : ""}`}>
      <header className="trip-card-head">
        <div>
          <span className="trip-when">{countdown(trip, today)}</span>
          <h3>{trip.name}</h3>
          <span className="muted small">
            {formatDateKey(trip.startDate)} – {formatDateKey(trip.endDate)}
          </span>
        </div>
        <a className="link small" href={trip.url} target="_blank" rel="noreferrer">
          Itinerary ↗
        </a>
      </header>
      {prep.length > 0 ? (
        <ul className="plain-list">
          {prep.map((t) => (
            <TaskRow key={t.id} task={t} now={data.now} tz={data.tz} compact={compact} hideCategory onToggle={() => actions.toggleTask(t)} onOpen={() => actions.openTask(t)} />
          ))}
        </ul>
      ) : (
        <p className="muted small">{done ? `All ${done} prep task${done === 1 ? "" : "s"} done.` : "No prep tasks yet."}</p>
      )}
      <TripLink trip={trip} data={data} actions={actions} />
      <form className="inline-add" onSubmit={add}>
        <input value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Add a prep task…" aria-label={`Add a prep task for ${trip.name}`} enterKeyHint="done" />
        {quick.trim() && (
          <button type="button" className="link" onClick={() => { actions.newTask({ title: quick.trim(), category: "trip", tripId: trip.id }); setQuick(""); }}>
            Details
          </button>
        )}
      </form>
    </article>
  );
}
