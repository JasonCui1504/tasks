"use client";

import { useMemo, useState } from "react";
import { daysBetween, formatDateKey, localDateKey, money, spanText } from "@/lib/time";
import type { GiftCard, GiftCardInput } from "@/lib/types";
import { Field, useSheet } from "./form";

/** How close to expiry a card is: drives its colour and sort. */
function expiryTone(card: GiftCard, today: string): { days: number | null; tone: "" | "warn" | "danger" } {
  if (!card.expiresOn) return { days: null, tone: "" };
  const days = daysBetween(today, card.expiresOn);
  return { days, tone: days < 0 || days <= 7 ? "danger" : days <= 30 ? "warn" : "" };
}

function expiryText(days: number | null, expiresOn: string | null): string {
  if (days == null || !expiresOn) return "No expiry";
  if (days < 0) return `Expired ${formatDateKey(expiresOn)}`;
  if (days === 0) return "Expires today";
  if (days === 1) return "Expires tomorrow";
  return `Expires in ${spanText(days)} · ${formatDateKey(expiresOn)}`;
}

type ViewProps = {
  cards: GiftCard[];
  now: Date;
  tz: string;
  onOpen: (card: GiftCard, spend?: boolean) => void;
  onNew: () => void;
};

export function GiftCardsView({ cards, now, tz, onOpen, onNew }: ViewProps) {
  const [showUsed, setShowUsed] = useState(false);
  const today = localDateKey(now, tz);
  const active = useMemo(() => cards.filter((c) => c.status === "active"), [cards]);
  const total = active.reduce((s, c) => s + c.balance, 0);
  const soon = active.filter((c) => {
    const { days } = expiryTone(c, today);
    return days != null && days >= 0 && days <= 30;
  });
  const shown = showUsed
    ? cards.filter((c) => c.status === "used").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    : active; // already sorted soonest-expiring first, no-expiry last

  return (
    <>
      <section className="stats three" aria-label="Gift card summary">
        <div className="stat static">
          <span className="stat-value">{money(total)}</span>
          <span className="stat-label">Left to spend</span>
        </div>
        <div className="stat static">
          <span className="stat-value">{active.length}</span>
          <span className="stat-label">Active card{active.length === 1 ? "" : "s"}</span>
        </div>
        <div className={`stat static ${soon.length ? "critical" : ""}`}>
          <span className="stat-value">{soon.length}</span>
          <span className="stat-label">Expiring soon</span>
        </div>
      </section>

      <div className="toolbar">
        <div className="seg" role="group" aria-label="Show">
          <button className={!showUsed ? "on" : ""} onClick={() => setShowUsed(false)}>Active</button>
          <button className={showUsed ? "on" : ""} onClick={() => setShowUsed(true)}>Used up</button>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="empty">
          <p>{showUsed ? "No used-up cards in the last 90 days." : "No gift cards yet. Add one so it doesn't go to waste."}</p>
          {!showUsed && <button className="btn" onClick={onNew}>Add a gift card</button>}
        </div>
      ) : (
        <section className="group">
          <ul>
            {shown.map((c) => {
              const { days, tone } = expiryTone(c, today);
              const spent = c.initialAmount != null && c.initialAmount > c.balance ? c.initialAmount - c.balance : 0;
              return (
                <li key={c.id} className={`task card-row ${tone ? `u${tone === "danger" ? 3 : 2}` : ""}`}>
                  <button className="task-main" onClick={() => onOpen(c)}>
                    <span className="task-title">{c.store}</span>
                    <span className="task-meta">
                      <span className={tone === "danger" ? "danger" : tone === "warn" ? "warn" : ""}>
                        {c.status === "used" ? "Used up" : expiryText(days, c.expiresOn)}
                      </span>
                      {spent > 0 && c.initialAmount != null && <span>Spent {money(spent)} of {money(c.initialAmount)}</span>}
                      {c.location && <span>⌖ {c.location}</span>}
                    </span>
                  </button>
                  <div className="card-side">
                    <span className="card-balance">{money(c.balance)}</span>
                    {c.status === "active" && (
                      <button className="link" onClick={() => onOpen(c, true)}>Spend</button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}

type SheetProps = {
  card: GiftCard | null;
  focusSpend?: boolean;
  onClose: () => void;
  onSave: (input: GiftCardInput, existing: GiftCard | null) => Promise<void>;
  onSpend: (card: GiftCard, amount: number) => Promise<void>;
  onStatus: (card: GiftCard, action: "used" | "reactivate") => Promise<void>;
  onDelete: (card: GiftCard) => Promise<void>;
};

export function GiftCardSheet({ card, focusSpend, onClose, onSave, onSpend, onStatus, onDelete }: SheetProps) {
  useSheet(onClose);
  const [store, setStore] = useState(card?.store ?? "");
  const [balance, setBalance] = useState(card ? String(card.balance) : "");
  const [initial, setInitial] = useState(card?.initialAmount != null ? String(card.initialAmount) : "");
  const [expiresOn, setExpiresOn] = useState(card?.expiresOn ?? "");
  const [location, setLocation] = useState(card?.location ?? "");
  const [notes, setNotes] = useState(card?.notes ?? "");
  const [spend, setSpend] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
    if (!store.trim()) return setError("Which store is the card for?");
    if (balance === "" || Number(balance) < 0) return setError("Enter the balance on the card.");
    run(() =>
      onSave(
        {
          store: store.trim(),
          balance: Number(balance),
          // A new card's original value defaults to its balance (set server-side).
          ...(initial !== "" || card ? { initialAmount: initial === "" ? null : Number(initial) } : {}),
          expiresOn: expiresOn || null,
          location,
          notes,
        },
        card,
      ),
    );
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet" onSubmit={submit} aria-label={card ? "Edit gift card" : "New gift card"}>
        <div className="sheet-head">
          <button type="button" className="link" onClick={onClose}>Cancel</button>
          <strong>{card ? "Gift card" : "New gift card"}</strong>
          <button className="link strong" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>

        <div className="sheet-body">
          {card && card.status === "active" && (
            <div className="card spend">
              <div className="setting-row">
                <span className="field-label">Spend</span>
                <span className="muted small">{money(card.balance)} left</span>
              </div>
              <div className="inline">
                <span className="muted">$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={spend}
                  onChange={(e) => setSpend(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (Number(spend) > 0) run(() => onSpend(card, Number(spend)));
                    }
                  }}
                  placeholder="Amount spent"
                  autoFocus={focusSpend}
                  aria-label="Amount spent"
                />
                <button type="button" className="btn primary" disabled={busy || !(Number(spend) > 0)} onClick={() => run(() => onSpend(card, Number(spend)))}>
                  Take off
                </button>
              </div>
              <button type="button" className="link" onClick={() => run(() => onSpend(card, card.balance))} disabled={busy}>
                Spent it all
              </button>
            </div>
          )}

          <input className="title-input" value={store} onChange={(e) => setStore(e.target.value)} placeholder="Store or brand" autoFocus={!card} aria-label="Store" />

          <div className="row2">
            <Field label="Balance">
              <div className="inline">
                <span className="muted">$</span>
                <input className="grow" type="number" inputMode="decimal" step="0.01" min="0" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="0.00" />
              </div>
            </Field>
            <Field label="Original value" hint="optional">
              <div className="inline">
                <span className="muted">$</span>
                <input className="grow" type="number" inputMode="decimal" step="0.01" min="0" value={initial} onChange={(e) => setInitial(e.target.value)} placeholder={balance || "0.00"} />
              </div>
            </Field>
          </div>

          <Field label="Expires" hint={expiresOn ? undefined : "Leave blank if it doesn't"}>
            <input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
          </Field>
          {expiresOn && (
            <div className="quick-dates">
              <button type="button" className="link" onClick={() => setExpiresOn("")}>No expiry</button>
            </div>
          )}

          <Field label="Where it is" hint="optional">
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Wallet, desk drawer, email from Mom, Amazon account…" />
            <div className="chips wrap">
              {["Wallet", "Email", "App / online account", "At home"].map((place) => (
                <button type="button" key={place} className={`chip ${location === place ? "active" : ""}`} onClick={() => setLocation(location === place ? "" : place)}>
                  {place}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Notes">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Online only, who gave it…" />
          </Field>

          {!card && <p className="muted small">You&apos;ll get a heads-up 30, 7 and 1 day before it expires while there&apos;s money on it.</p>}

          {error && <p className="error">{error}</p>}

          {card && (
            <div className="sheet-foot">
              {card.status === "active" ? (
                <button type="button" className="btn" onClick={() => run(() => onStatus(card, "used"))} disabled={busy}>Mark used up</button>
              ) : (
                <button type="button" className="btn" onClick={() => run(() => onStatus(card, "reactivate"))} disabled={busy}>Move back to active</button>
              )}
              <button type="button" className="btn danger-text" onClick={() => confirm(`Delete the ${card.store} card?`) && run(() => onDelete(card))}>
                Delete
              </button>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
