"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { categoryInfo } from "@/lib/types";
import { CalendarView } from "./CalendarView";
import { ContactsView } from "./Contacts";
import { EventsView } from "./Events";
import { GiftCardsView } from "./GiftCards";
import { CardsPanel, CategoryPanel, EventsPanel, PeoplePanel } from "./Panels";
import type { Actions, Data } from "./shared";
import { SummaryStats, TasksTab } from "./TasksTab";
import { TodayList } from "./Today";
import { TripsView } from "./Trips";
import { UrgentCallout } from "./Urgent";

// The desktop workspace: a grid that always fills the window (COLS × ROWS cells,
// so a smaller window means smaller cells). Boxes snap to cells; drag one by its
// title bar to move it, drag its corner to resize it, and pick what it shows from
// its title menu. Boxes never overlap: a move or resize that would collide is
// shown in red and snaps back. The layout is saved per device.

export const COLS = 24;
export const ROWS = 16;
const MIN_W = 3;
const MIN_H = 2;
const STORE_KEY = "tasks.grid.v2";

export type BoxView = "today" | "tasks" | "summary" | "urgent" | "calendar" | "events" | "trips" | "people" | "cards" | `cat:${string}`;
export type Box = { id: string; view: BoxView; x: number; y: number; w: number; h: number };

const DEFAULT_LAYOUT: Box[] = [
  { id: "b1", view: "urgent", x: 0, y: 0, w: 14, h: 4 },
  { id: "b2", view: "summary", x: 14, y: 0, w: 10, h: 4 },
  { id: "b3", view: "today", x: 0, y: 4, w: 7, h: 12 },
  { id: "b4", view: "calendar", x: 7, y: 4, w: 10, h: 7 },
  { id: "b5", view: "trips", x: 17, y: 4, w: 7, h: 6 },
  { id: "b6", view: "cat:work", x: 17, y: 10, w: 7, h: 6 },
  { id: "b7", view: "cards", x: 7, y: 11, w: 5, h: 5 },
  { id: "b8", view: "people", x: 12, y: 11, w: 5, h: 5 },
];

const BASE_VIEWS: { view: BoxView; label: string }[] = [
  { view: "today", label: "Today's to-do" },
  { view: "tasks", label: "All tasks" },
  { view: "urgent", label: "Urgent" },
  { view: "summary", label: "Summary numbers" },
  { view: "calendar", label: "Calendar" },
  { view: "events", label: "Events" },
  { view: "trips", label: "Trips" },
  { view: "people", label: "Stay in touch" },
  { view: "cards", label: "Gift cards" },
];

export function viewLabel(v: BoxView): string {
  if (v.startsWith("cat:")) return categoryInfo(v.slice(4)).label;
  return BASE_VIEWS.find((b) => b.view === v)?.label ?? v;
}

function overlaps(a: Box, b: Box) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function fits(box: Box, others: Box[]) {
  return box.x >= 0 && box.y >= 0 && box.x + box.w <= COLS && box.y + box.h <= ROWS && !others.some((o) => o.id !== box.id && overlaps(box, o));
}

/** The first free spot for a new box, trying smaller sizes if the grid is crowded. */
function freeSpot(layout: Box[], view: BoxView): Box | null {
  const id = `b${Date.now().toString(36)}`;
  for (const [w, h] of [[7, 6], [6, 5], [5, 4], [4, 3], [3, 2]]) {
    for (let y = 0; y + h <= ROWS; y++)
      for (let x = 0; x + w <= COLS; x++) {
        const box = { id, view, x, y, w, h };
        if (fits(box, layout)) return box;
      }
  }
  return null;
}

function valid(saved: unknown): saved is Box[] {
  return (
    Array.isArray(saved) &&
    saved.every((b) => b && typeof b.id === "string" && typeof b.view === "string" && [b.x, b.y, b.w, b.h].every((n) => Number.isInteger(n))) &&
    saved.every((b, i) => fits(b, saved.slice(0, i)))
  );
}

type Drag = { id: string; mode: "move" | "resize"; startX: number; startY: number; orig: Box; preview: Box; ok: boolean; swap: Box | null };

/** Dropping a box onto exactly one other box swaps them, if each fits the other's spot. */
function swapTarget(preview: Box, orig: Box, layout: Box[]): Box | null {
  const hits = layout.filter((o) => o.id !== preview.id && overlaps(preview, o));
  if (hits.length !== 1) return null;
  const other = hits[0];
  const moved = { ...other, x: orig.x, y: orig.y };
  const rest = layout.filter((b) => b.id !== preview.id && b.id !== other.id);
  return fits(preview, rest) && fits(moved, [...rest, preview]) ? moved : null;
}

type Props = {
  data: Data;
  actions: Actions;
  onToast: (text: string) => void;
  /** The bell and "+ New task" buttons, owned by the dashboard. */
  topActions: React.ReactNode;
  dateLine: string;
};

export function GridWorkspace({ data, actions, onToast, topActions, dateLine }: Props) {
  const [layout, setLayout] = useState<Box[]>(DEFAULT_LAYOUT);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const areaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the saved layout is only readable after mount
      if (valid(saved)) setLayout(saved);
    } catch {}
  }, []);

  const save = useCallback((next: Box[]) => {
    setLayout(next);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {}
  }, []);

  // Cells are a fraction of the area, so the grid always fills the window.
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const cw = size.w / COLS;
  const ch = size.h / ROWS;

  // Pointer tracking while moving or resizing a box.
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const dx = Math.round((e.clientX - drag.startX) / cw);
      const dy = Math.round((e.clientY - drag.startY) / ch);
      const o = drag.orig;
      const preview =
        drag.mode === "move"
          ? { ...o, x: Math.max(0, Math.min(COLS - o.w, o.x + dx)), y: Math.max(0, Math.min(ROWS - o.h, o.y + dy)) }
          : { ...o, w: Math.max(MIN_W, Math.min(COLS - o.x, o.w + dx)), h: Math.max(MIN_H, Math.min(ROWS - o.y, o.h + dy)) };
      if (preview.x !== drag.preview.x || preview.y !== drag.preview.y || preview.w !== drag.preview.w || preview.h !== drag.preview.h)
      {
        const free = fits(preview, layout);
        const swap = !free && drag.mode === "move" ? swapTarget(preview, drag.orig, layout) : null;
        setDrag({ ...drag, preview, ok: free || swap != null, swap });
      }
    };
    const onUp = () => {
      if (drag.ok) save(layout.map((b) => (b.id === drag.id ? drag.preview : drag.swap && b.id === drag.swap.id ? drag.swap : b)));
      setDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [drag, cw, ch, layout, save]);

  function startDrag(e: React.PointerEvent, box: Box, mode: Drag["mode"]) {
    if (e.button !== 0) return;
    if (mode === "move" && (e.target as HTMLElement).closest("select, button, input, a")) return;
    e.preventDefault();
    setDrag({ id: box.id, mode, startX: e.clientX, startY: e.clientY, orig: box, preview: box, ok: true, swap: null });
  }

  function addBox(view: BoxView) {
    const box = freeSpot(layout, view);
    if (!box) return onToast("No free space — shrink or remove a box first.");
    save([...layout, box]);
  }

  const viewOptions = useMemo(
    () => [...BASE_VIEWS, ...data.categories.map((c) => ({ view: `cat:${c}` as BoxView, label: c === "trip" ? "Trip prep tasks" : categoryInfo(c).label }))],
    [data.categories],
  );

  const place = (b: Box): React.CSSProperties => ({
    left: b.x * cw,
    top: b.y * ch,
    width: b.w * cw,
    height: b.h * ch,
  });

  return (
    <div className="grid-shell">
      <header className="grid-top">
        <div className="brand">
          <span className="eyebrow-sm">Workspace</span>
          <p className="muted small">{dateLine}</p>
        </div>
        <div className="top-actions">
          <label className="btn add-box">
            + Add box
            <select value="" onChange={(e) => e.target.value && addBox(e.target.value as BoxView)} aria-label="Add a box">
              <option value="">Add a box showing…</option>
              {viewOptions.map((o) => (
                <option key={o.view} value={o.view}>{o.label}</option>
              ))}
            </select>
          </label>
          <button className="btn" onClick={() => confirm("Reset the workspace to the default layout?") && save(DEFAULT_LAYOUT)}>
            Reset layout
          </button>
          {topActions}
        </div>
      </header>

      <div
        ref={areaRef}
        className={`grid-area ${drag ? "dragging" : ""}`}
        style={{ "--cw": `${cw}px`, "--ch": `${ch}px` } as React.CSSProperties}
      >
        {drag && <div className={`grid-ghost ${drag.ok ? "" : "bad"}`} style={place(drag.preview)} />}
        {size.w > 0 &&
          layout.map((box) => {
            const shown = drag?.id === box.id ? drag.preview : drag?.swap?.id === box.id ? drag.swap : box;
            const px = { w: shown.w * cw, h: shown.h * ch };
            return (
              <section key={box.id} className={`box ${drag?.id === box.id ? "lifted" : ""}`} style={place(shown)} aria-label={viewLabel(box.view)}>
                <div className="box-inner">
                  <header className="box-head" onPointerDown={(e) => startDrag(e, box, "move")}>
                    <span className="grip" aria-hidden>⠿</span>
                    {box.view.startsWith("cat:") && <span className="dot" style={{ background: categoryInfo(box.view.slice(4)).color }} />}
                    <select
                      className="panel-select"
                      value={box.view}
                      onChange={(e) => save(layout.map((b) => (b.id === box.id ? { ...b, view: e.target.value as BoxView } : b)))}
                      aria-label="What this box shows"
                    >
                      {viewOptions.map((o) => (
                        <option key={o.view} value={o.view}>{o.label}</option>
                      ))}
                    </select>
                    <div className="panel-tools">
                      <AddButton view={box.view} actions={actions} />
                      <button className="panel-btn" onClick={() => save(layout.filter((b) => b.id !== box.id))} aria-label="Remove box" title="Remove box">
                        ×
                      </button>
                    </div>
                  </header>
                  <div className="box-body">
                    <BoxContent view={box.view} data={data} actions={actions} px={px} />
                  </div>
                </div>
                <span className="resize-handle" onPointerDown={(e) => startDrag(e, box, "resize")} aria-hidden title="Drag to resize" />
              </section>
            );
          })}
        {layout.length === 0 && (
          <div className="grid-empty">
            <p>Your workspace is empty.</p>
            <p className="muted small">Use “+ Add box” to place a to-do list, calendar, gift card tracker…</p>
          </div>
        )}
      </div>
    </div>
  );
}

function AddButton({ view, actions }: { view: BoxView; actions: Actions }) {
  const cat = view.startsWith("cat:") ? view.slice(4) : null;
  const add =
    view === "events" ? () => actions.newEvent()
    : view === "people" ? actions.newContact
    : view === "cards" ? actions.newCard
    : view === "trips" ? () => actions.newTask({ category: "trip" })
    : view === "calendar" ? () => actions.newEvent()
    : view === "today" || view === "tasks" ? () => actions.newTask()
    : cat ? () => actions.newTask({ category: cat })
    : null;
  if (!add) return null;
  return (
    <button className="panel-btn" onClick={add} aria-label={`Add to ${viewLabel(view)}`} title="Add">
      +
    </button>
  );
}

function BoxContent({ view, data, actions, px }: { view: BoxView; data: Data; actions: Actions; px: { w: number; h: number } }) {
  const roomy = px.w >= 520;
  switch (view) {
    case "today":
      return <TodayList data={data} actions={actions} compact={!roomy} />;
    case "tasks":
      return <TasksTab data={data} actions={actions} noStats />;
    case "urgent":
      return <UrgentCallout data={data} actions={actions} bare />;
    case "summary":
      return <SummaryStats data={data} actions={actions} />;
    case "calendar":
      return <CalendarView data={data} actions={actions} mini={px.w < 560 || px.h < 420} />;
    case "events":
      return roomy ? (
        <EventsView events={data.events} now={data.now} tz={data.tz} onOpen={actions.openEvent} onNew={() => actions.newEvent()} />
      ) : (
        <EventsPanel data={data} actions={actions} />
      );
    case "trips":
      return <TripsView data={data} actions={actions} compact={!roomy} />;
    case "people":
      return roomy ? (
        <ContactsView contacts={data.contacts} now={data.now} tz={data.tz} onOpen={actions.openContact} onLog={actions.logContact} onNew={actions.newContact} />
      ) : (
        <PeoplePanel data={data} actions={actions} />
      );
    case "cards":
      return roomy ? (
        <GiftCardsView cards={data.cards} now={data.now} tz={data.tz} onOpen={actions.openCard} onNew={actions.newCard} />
      ) : (
        <CardsPanel data={data} actions={actions} />
      );
    default:
      return view.startsWith("cat:") ? <CategoryPanel cat={view.slice(4)} data={data} actions={actions} /> : null;
  }
}
