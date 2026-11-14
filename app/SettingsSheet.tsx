"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { SentNotification, Settings } from "@/lib/types";
import { disablePush, enablePush, isIos, pushState, type PushState } from "./push-client";

type Props = {
  user: string;
  settings: Settings;
  vapidKey: string | null;
  travelConfigured: boolean;
  onChange: (patch: Partial<Settings>) => Promise<void>;
  onClose: () => void;
};

function hourLabel(h: number) {
  return new Date(2000, 0, 1, h).toLocaleTimeString("en-US", { hour: "numeric" });
}
const HOURS = Array.from({ length: 24 }, (_, h) => h);

export default function SettingsSheet({ user, settings, vapidKey, travelConfigured, onChange, onClose }: Props) {
  const [state, setState] = useState<PushState | "loading">("loading");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<SentNotification[] | null>(null);
  const router = useRouter();

  useEffect(() => {
    pushState().then(setState);
    fetch("/api/notifications")
      .then((r) => r.json())
      .then((d) => setHistory(d.notifications ?? []))
      .catch(() => setHistory([]));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.classList.add("locked");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("locked");
    };
  }, [onClose]);

  async function turnOn() {
    if (!vapidKey) return;
    setBusy(true);
    setMessage("");
    try {
      setState(await enablePush(vapidKey));
    } catch (err) {
      setMessage((err as Error).message);
    }
    setBusy(false);
  }

  async function turnOff() {
    setBusy(true);
    setState(await disablePush());
    setBusy(false);
  }

  async function test() {
    setBusy(true);
    const res = await fetch("/api/push/test", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setMessage(res.ok ? "Sent — it should arrive in a few seconds." : data.error ?? "Couldn't send.");
    setBusy(false);
  }

  async function signOut() {
    await fetch("/api/auth", { method: "DELETE" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-label="Settings">
        <div className="sheet-head">
          <span />
          <strong>Notifications</strong>
          <button className="link strong" onClick={onClose}>Done</button>
        </div>
        <div className="sheet-body">
          <section className="card">
            {!vapidKey ? (
              <p className="muted">Push isn&rsquo;t set up on the server yet (VAPID keys are missing — see the README).</p>
            ) : state === "loading" ? (
              <p className="muted">Checking…</p>
            ) : state === "needs-install" ? (
              <div className="install">
                <p><strong>Add Tasks to your Home Screen first.</strong> iPhone only allows notifications from installed web apps.</p>
                <ol>
                  <li>In Safari, tap the <strong>Share</strong> button.</li>
                  <li>Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
                  <li>Open Tasks from your Home Screen and come back here.</li>
                </ol>
              </div>
            ) : state === "unsupported" ? (
              <p className="muted">This browser can&rsquo;t receive push notifications.</p>
            ) : state === "denied" ? (
              <p className="muted">
                Notifications are blocked.{" "}
                {isIos() ? "Turn them on in iPhone Settings → Notifications → Tasks." : "Allow them for this site in your browser settings."}
              </p>
            ) : (
              <div className="setting-row">
                <div>
                  <strong>Push notifications</strong>
                  <p className="muted small">{state === "on" ? "On for this device." : "Get pinged when deadlines and payments come up."}</p>
                </div>
                {state === "on" ? (
                  <button className="btn" onClick={turnOff} disabled={busy}>Turn off</button>
                ) : (
                  <button className="btn primary" onClick={turnOn} disabled={busy}>Turn on</button>
                )}
              </div>
            )}
            {state === "on" && (
              <button className="link" onClick={test} disabled={busy}>Send a test notification</button>
            )}
            {message && <p className="small">{message}</p>}
          </section>

          <section className="card">
            <div className="setting-row">
              <div>
                <strong>Morning summary</strong>
                <p className="muted small">Overdue, today, bills and renewals, and the week ahead. Sent even in quiet hours.</p>
              </div>
              <select
                value={settings.morningHour ?? ""}
                onChange={(e) => onChange({ morningHour: e.target.value === "" ? null : Number(e.target.value) })}
                aria-label="Morning summary time"
              >
                <option value="">Off</option>
                {[5, 6, 7, 8, 9, 10, 11, 12].map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
            </div>
            <div className="setting-row">
              <div>
                <strong>Evening summary</strong>
                <p className="muted small">What&rsquo;s still open, tomorrow, bills and renewals, and later this week.</p>
              </div>
              <select
                value={settings.eveningHour ?? ""}
                onChange={(e) => onChange({ eveningHour: e.target.value === "" ? null : Number(e.target.value) })}
                aria-label="Evening summary time"
              >
                <option value="">Off</option>
                {[17, 18, 19, 20, 21, 22, 23].map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
            </div>
            <div className="setting-row">
              <div>
                <strong>Quiet hours</strong>
                <p className="muted small">Held until morning, except Critical reminders.</p>
              </div>
              <div className="inline">
                <select value={settings.quietStart} onChange={(e) => onChange({ quietStart: Number(e.target.value) })} aria-label="Quiet hours start">
                  {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
                </select>
                <span className="muted">to</span>
                <select value={settings.quietEnd} onChange={(e) => onChange({ quietEnd: Number(e.target.value) })} aria-label="Quiet hours end">
                  {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
                </select>
              </div>
            </div>
            {travelConfigured && (
              <label className="setting-row">
                <div>
                  <strong>Trip heads-ups</strong>
                  <p className="muted small">2 weeks, 3 days and 1 day before each trip on travel.jascui.com.</p>
                </div>
                <input type="checkbox" checked={settings.tripAlerts} onChange={(e) => onChange({ tripAlerts: e.target.checked })} />
              </label>
            )}
            <p className="muted small">Times are in {settings.timeZone.replace(/_/g, " ")}.</p>
          </section>

          <section>
            <h3 className="field-label">Recent notifications</h3>
            {history == null ? (
              <p className="muted small">Loading…</p>
            ) : history.length === 0 ? (
              <p className="muted small">None yet.</p>
            ) : (
              <ul className="history">
                {history.map((n) => (
                  <li key={n.id}>
                    <a href={n.url}>
                      <strong>{n.title}</strong>
                      <span className="muted small">{n.body}</span>
                      <span className="muted small">
                        {new Date(n.sentAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="sheet-foot">
            <span className="muted small">Signed in as {user}</span>
            <button className="btn" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </div>
    </div>
  );
}
