"use client";

import { useEffect, useState } from "react";
import { daysBetween, formatDateKey, formatDue, localDateKey, money, relativeDue } from "@/lib/time";
import { URGENCIES, bookingKind, contactDueOn, isTodo } from "@/lib/types";
import { bucketOf, capitalize, type Actions, type Data } from "./shared";

type Item = { key: string; text: string; sub: string; tone: "red" | "amber"; onClick: () => void };

/** Everything that needs doing now, across every list, most pressing first. */
export function urgentItems(d: Data, a: Actions): Item[] {
  const today = localDateKey(d.now, d.tz);
  const items: Item[] = [];
  const open = d.tasks.filter(isTodo);

  const overdue = open.filter((t) => bucketOf(t, d.now, d.tz) === "overdue").sort((x, y) => y.urgency - x.urgency || (x.dueAt! < y.dueAt! ? -1 : 1));
  for (const t of overdue)
    items.push({
      key: `t${t.id}`,
      text: t.title,
      sub: `Overdue — was due ${relativeDue(new Date(t.dueAt!), d.now, d.tz, t.allDay)}`,
      tone: "red",
      onClick: () => a.openTask(t),
    });

  for (const t of open.filter((t) => bucketOf(t, d.now, d.tz) === "today").sort((x, y) => y.urgency - x.urgency))
    items.push({
      key: `t${t.id}`,
      text: t.title,
      sub: t.allDay ? "Due today" : `Due ${formatDue(new Date(t.dueAt!), d.tz, false, false).split(", ")[1] ?? "today"} today`,
      tone: "red",
      onClick: () => a.openTask(t),
    });

  // Critical things coming up in the next few days.
  for (const t of open) {
    if (t.urgency < 3 || !t.dueAt) continue;
    const b = bucketOf(t, d.now, d.tz);
    if (b !== "tomorrow" && b !== "week") continue;
    const days = daysBetween(today, localDateKey(new Date(t.dueAt), d.tz));
    if (days > 3) continue;
    items.push({ key: `t${t.id}`, text: t.title, sub: `${URGENCIES[3].label} · due ${relativeDue(new Date(t.dueAt), d.now, d.tz, t.allDay)}`, tone: "amber", onClick: () => a.openTask(t) });
  }

  for (const e of d.events) {
    const start = new Date(e.startsAt);
    if (localDateKey(start, d.tz) !== today) continue;
    if (!e.allDay && start.getTime() < d.now.getTime() - 60 * 60_000) continue;
    items.push({
      key: `e${e.id}`,
      text: e.title,
      sub: e.allDay ? "Today" : `Today at ${start.toLocaleTimeString("en-US", { timeZone: d.tz, hour: "numeric", minute: "2-digit" })}`,
      tone: "amber",
      onClick: () => a.openEvent(e),
    });
  }

  for (const trip of d.trips) {
    const days = daysBetween(today, trip.startDate);
    const prep = open.filter((t) => t.tripId === trip.id).length;
    if (days < 0 || days > 3 || !prep) continue;
    items.push({
      key: `trip${trip.id}`,
      text: `${trip.name} ${days === 0 ? "starts today" : days === 1 ? "starts tomorrow" : `in ${days} days`}`,
      sub: `${prep} prep task${prep === 1 ? "" : "s"} still open`,
      tone: "amber",
      onClick: () => a.goTab("trips", { trip: trip.id }),
    });
  }

  for (const c of d.cards) {
    if (c.status !== "active" || !c.expiresOn || c.balance <= 0) continue;
    const days = daysBetween(today, c.expiresOn);
    if (days < 0 || days > 7) continue;
    items.push({
      key: `c${c.id}`,
      text: `Spend the ${c.store} card`,
      sub: `${money(c.balance)} left · expires ${days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`}`,
      tone: "amber",
      onClick: () => a.openCard(c),
    });
  }

  for (const c of d.contacts) {
    const due = contactDueOn(c);
    if (!due || due >= today) continue;
    const late = daysBetween(due, today);
    items.push({
      key: `p${c.id}`,
      text: `Reach out to ${c.name}`,
      sub: `${late} day${late === 1 ? "" : "s"} overdue`,
      tone: "amber",
      onClick: () => a.openContact(c),
    });
  }

  // Free-cancellation deadlines in the next 3 days: bookings entered in Tracking,
  // and stays/cars from travel.jascui.com itineraries. Red on the last day.
  const whenText = (days: number) => (days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`);
  for (const bk of d.bookings) {
    if (bk.status !== "booked" || !bk.cancelBy) continue;
    const days = daysBetween(today, bk.cancelBy);
    if (days < 0 || days > 3) continue;
    const label = bk.name || [bk.number, bk.from && bk.to ? `${bk.from} → ${bk.to}` : ""].filter(Boolean).join(" ") || bookingKind(bk.kind).label;
    items.push({
      key: `b${bk.id}`,
      text: `Last day to cancel ${label} free ${whenText(days)}`,
      sub: `${bookingKind(bk.kind).label} · free cancellation until ${formatDateKey(bk.cancelBy)}`,
      tone: days === 0 ? "red" : "amber",
      onClick: () => a.openBooking(bk),
    });
  }
  for (const it of d.itineraries) {
    const trip = d.trips.find((t) => t.id === it.id);
    for (const i of it.items) {
      if (i.kind !== "deadline") continue;
      const days = daysBetween(today, i.date);
      if (days < 0 || days > 3) continue;
      const name = i.title.replace(/^Last day to cancel free:\s*/, "");
      items.push({
        key: `d${it.id}|${i.date}|${i.title}`,
        text: `Last day to cancel ${name} free ${whenText(days)}`,
        sub: `${trip ? `${trip.name} · ` : ""}from travel.jascui.com`,
        tone: days === 0 ? "red" : "amber",
        onClick: () => a.goTab("tracking"),
      });
    }
  }

  // One line per thing, even if it matched twice.
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)));
}

export function UrgentCallout({ data, actions, bare }: { data: Data; actions: Actions; bare?: boolean }) {
  const [all, setAll] = useState(false);
  // Fewer lines on a phone so the list below stays in view.
  const [show, setShow] = useState(6);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- screen size is only known after mount
    if (window.matchMedia("(max-width: 600px)").matches) setShow(3);
  }, []);
  const items = urgentItems(data, actions);

  if (!items.length) {
    return (
      <section className={`callout calm ${bare ? "bare" : ""}`} aria-label="Urgent">
        <span className="callout-dot" aria-hidden />
        <div>
          <p className="callout-title">All good</p>
          <p className="callout-sub">Nothing overdue or urgent right now.</p>
        </div>
      </section>
    );
  }

  const shown = all ? items : items.slice(0, show);
  return (
    <section className={`callout urgent ${bare ? "bare" : ""}`} aria-label="Urgent">
      <div className="callout-head">
        <p className="callout-title">
          Urgent — need to do <span className="callout-count">{items.length}</span>
        </p>
        {items.length > show && (
          <button className="link" onClick={() => setAll(!all)}>
            {all ? "Show less" : `Show all ${items.length}`}
          </button>
        )}
      </div>
      <ul className="callout-list">
        {shown.map((i) => (
          <li key={i.key}>
            <button onClick={i.onClick}>
              <span className={`bullet ${i.tone}`} aria-hidden />
              <span>
                <span className="callout-item">{capitalize(i.text)}</span>
                <span className="callout-sub">{i.sub}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
