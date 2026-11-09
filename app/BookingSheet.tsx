"use client";

import { useState } from "react";
import { BOOKING_KINDS, bookingKind, type Booking, type BookingInput, type BookingKind, type Trip } from "@/lib/types";
import { Field, useSheet } from "./form";

type Props = {
  booking: Booking | null;
  draft?: BookingInput;
  trips: Trip[];
  onClose: () => void;
  onSave: (input: BookingInput, existing: Booking | null) => Promise<void>;
  onDelete: (booking: Booking) => Promise<void>;
};

/** Add or edit a tracked booking: a flight, train, rental car, hotel… */
export function BookingSheet({ booking, draft, trips, onClose, onSave, onDelete }: Props) {
  useSheet(onClose);
  const start = { ...draft, ...booking };
  const [kind, setKind] = useState<BookingKind>(start.kind ?? "flight");
  const [name, setName] = useState(start.name ?? "");
  const [number, setNumber] = useState(start.number ?? "");
  const [from, setFrom] = useState(start.from ?? "");
  const [to, setTo] = useState(start.to ?? "");
  const [startDate, setStartDate] = useState(start.startDate ?? "");
  const [startTime, setStartTime] = useState(start.startTime ?? "");
  const [endDate, setEndDate] = useState(start.endDate ?? "");
  const [endTime, setEndTime] = useState(start.endTime ?? "");
  const [confirmation, setConfirmation] = useState(start.confirmation ?? "");
  const [cancelBy, setCancelBy] = useState(start.cancelBy ?? "");
  const [status, setStatus] = useState<Booking["status"]>(start.status ?? "booked");
  const [tripId, setTripId] = useState(start.tripId != null ? String(start.tripId) : "");
  const [cost, setCost] = useState(start.cost != null ? String(start.cost) : "");
  const [notes, setNotes] = useState(start.notes ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const k = bookingKind(kind);
  const isTransport = kind === "flight" || kind === "train" || kind === "bus";

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!startDate) return setError(`When does it ${isTransport ? "leave" : "start"}?`);
    if (!name.trim() && !number.trim() && !from.trim()) return setError(`Add the ${k.name.toLowerCase()} or ${k.number.toLowerCase()}.`);
    run(() =>
      onSave(
        {
          kind,
          name,
          number,
          from,
          to: k.to ? to : "",
          startDate,
          startTime,
          endDate: endDate || null,
          endTime,
          confirmation,
          cancelBy: cancelBy || null,
          status,
          tripId: tripId ? Number(tripId) : null,
          cost: cost === "" ? null : Number(cost),
          notes,
        },
        booking,
      ),
    );
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet" onSubmit={submit} aria-label={booking ? "Edit booking" : "New booking"}>
        <div className="sheet-head">
          <button type="button" className="link" onClick={onClose}>Cancel</button>
          <strong>{booking ? k.label : `New ${k.label.toLowerCase()}`}</strong>
          <button className="link strong" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>

        <div className="sheet-body">
          <div className="chips wrap" role="group" aria-label="Kind">
            {BOOKING_KINDS.map((b) => (
              <button type="button" key={b.value} className={`chip ${kind === b.value ? "active" : ""}`} onClick={() => setKind(b.value)} aria-pressed={kind === b.value}>
                {b.label}
              </button>
            ))}
          </div>

          <div className="row2">
            <Field label={k.name}>
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus={!booking} placeholder={kind === "flight" ? "United" : kind === "train" ? "Amtrak" : kind === "car" ? "Hertz" : kind === "hotel" ? "Hotel name" : ""} />
            </Field>
            <Field label={k.number} hint="optional">
              <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder={kind === "flight" ? "UA 123" : kind === "train" ? "171" : ""} autoCapitalize="characters" />
            </Field>
          </div>

          <div className={k.to ? "row2" : ""}>
            <Field label={k.from} hint="optional">
              <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder={kind === "flight" ? "ORD" : ""} />
            </Field>
            {k.to && (
              <Field label={k.to} hint="optional">
                <input value={to} onChange={(e) => setTo(e.target.value)} placeholder={kind === "flight" ? "JFK" : ""} />
              </Field>
            )}
          </div>

          <div className="row2">
            <Field label={k.start}>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} aria-label={`${k.start} time`} />
            </Field>
            <Field label={k.end} hint="optional">
              <input type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} />
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} aria-label={`${k.end} time`} />
            </Field>
          </div>
          {isTransport && <p className="muted small">Local times, as printed on the ticket.</p>}

          <div className="row2">
            <Field label="Confirmation" hint="optional">
              <input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder="ABC123" autoCapitalize="characters" />
            </Field>
            <Field label="Free cancellation until" hint="optional">
              <input type="date" value={cancelBy} onChange={(e) => setCancelBy(e.target.value)} />
            </Field>
          </div>

          <div className="row2">
            <Field label="Trip" hint="optional">
              <select value={tripId} onChange={(e) => setTripId(e.target.value)}>
                <option value="">{trips.length ? "By date" : "None"}</option>
                {trips.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Cost" hint="optional">
              <div className="inline">
                <span className="muted">$</span>
                <input className="grow" type="number" inputMode="decimal" step="0.01" min="0" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.00" />
              </div>
            </Field>
          </div>

          <Field label="Status">
            <div className="seg" role="group" aria-label="Status">
              <button type="button" className={status === "booked" ? "on" : ""} onClick={() => setStatus("booked")}>Booked</button>
              <button type="button" className={status === "to_book" ? "on" : ""} onClick={() => setStatus("to_book")}>Still to book</button>
            </div>
          </Field>

          <Field label="Notes">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Seat, terminal, baggage, links…" />
          </Field>

          {cancelBy && status === "booked" && <p className="muted small">You&apos;ll get a heads-up a week and 2 days before the last day to cancel, and on the day.</p>}

          {error && <p className="error">{error}</p>}

          {booking && (
            <div className="sheet-foot">
              <button type="button" className="btn danger-text" onClick={() => confirm("Delete this booking?") && run(() => onDelete(booking))}>
                Delete
              </button>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
