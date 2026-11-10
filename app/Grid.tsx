"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { categoryInfo } from "@/lib/types";
import { CalendarView } from "./CalendarView";
import { DayView } from "./DayView";
import { TopInfo } from "./TopInfo";
import { ContactsView } from "./Contacts";
import { EventsView } from "./Events";
import { GiftCardsView } from "./GiftCards";
import { PackingView } from "./Packing";
import { CardsPanel, CategoryPanel, EventsPanel, PeoplePanel } from "./Panels";
import type { Actions, Data } from "./shared";
import { SummaryStats, TasksTab } from "./TasksTab";
import { TodayList } from "./Today";
import { ToBookView, TrackingView } from "./Tracking";
import { TripsView } from "./Trips";
import { UrgentCallout } from "./Urgent";

// The desktop workspace: a grid that always fills the window (COLS × ROWS cells,
// so a smaller window means smaller cells). Boxes snap to cells; drag one by its
// title bar to move it, drag any corner to resize it, and pick what it shows from
// its title menu. Boxes never overlap: dropping onto one box that fits your old
// spot swaps them; otherwise boxes in the way shrink back, and any squeezed below
// the minimum size are removed (with Undo). The layout is saved per device.

export const COLS = 24;
export const ROWS = 16;
const MIN_W = 3;
const MIN_H = 2;
const STORE_KEY = "tasks.grid.v3";

export type BoxView = "today" | "tasks" | "summary" | "urgent" | "calendar" | "day" | "events" | "trips" | "tracking" | "tobook" | "people" | "cards" | "packing" | `cat:${string}`;
export type Box = { id: string; view: BoxView; x: number; y: number; w: number; h: number };

const DEFAULT_LAYOUT: Box[] = [
  { id: "b1", view: "urgent", x: 0, y: 0, w: 13, h: 4 },
  { id: "b2", view: "summary", x: 13, y: 0, w: 11, h: 4 },
  { id: "b3", view: "today", x: 0, y: 4, w: 6, h: 12 },
  { id: "b4", view: "calendar", x: 6, y: 4, w: 8, h: 7 },
  { id: "b9", view: "day", x: 14, y: 4, w: 5, h: 12 },
  { id: "b5", view: "trips", x: 19, y: 4, w: 5, h: 6 },
  { id: "b6", view: "cat:work", x: 19, y: 10, w: 5, h: 6 },
  { id: "b7", view: "cards", x: 6, y: 11, w: 4, h: 5 },
  { id: "b8", view: "people", x: 10, y: 11, w: 4, h: 5 },
];

const BASE_VIEWS: { view: BoxView; label: string }[] = [
  { view: "today", label: "Today's to-do" },
  { view: "tasks", label: "All tasks" },
  { view: "urgent", label: "Urgent" },
  { view: "summary", label: "Summary numbers" },
  { view: "calendar", label: "Calendar" },
  { view: "day", label: "Day view" },
  { view: "events", label: "Events" },
  { view: "trips", label: "Trips" },
  { view: "tracking", label: "Tracking" },
  { view: "tobook", label: "Still to book" },
  { view: "people", label: "Stay in touch" },
  { view: "cards", label: "Gift cards" },
  { view: "packing", label: "Packing list" },
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

type Corner = "nw" | "ne" | "sw" | "se";
type Drag = {
  id: string;
  mode: "move" | Corner;
  startX: number;
  startY: number;
  orig: Box;
  preview: Box;
  swap: Box | null;
  /** Other boxes squeezed out of the way, by id. */
  pushed: Record<string, Box>;
  /** Boxes squeezed below the minimum size: removed on drop. */
  removed: string[];
};

/**
 * Make room for `box`: every box it overlaps shrinks back from the side it's
 * pushed on (keeping the biggest piece that clears it). A box that can't stay
 * at least MIN_W × MIN_H is removed.
 */
function pushAside(box: Box, layout: Box[]): { pushed: Record<string, Box>; removed: string[] } {
  const pushed: Record<string, Box> = {};
  const removed: string[] = [];
  for (const o of layout) {
    if (o.id === box.id || !overlaps(box, o)) continue;
    const options: Box[] = [
      { ...o, w: box.x - o.x }, // keep its left part
      { ...o, x: box.x + box.w, w: o.x + o.w - (box.x + box.w) }, // keep its right part
      { ...o, h: box.y - o.y }, // keep its top part
      { ...o, y: box.y + box.h, h: o.y + o.h - (box.y + box.h) }, // keep its bottom part
    ].filter((c) => c.w >= MIN_W && c.h >= MIN_H && c.x >= o.x && c.y >= o.y && c.x + c.w <= o.x + o.w && c.y + c.h <= o.y + o.h);
    if (!options.length) removed.push(o.id);
    else pushed[o.id] = options.sort((a, b) => b.w * b.h - a.w * a.h)[0];
  }
  return { pushed, removed };
}

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
  onToast: (text: string, undo?: () => void) => void;
  /** The bell and "+ New task" buttons, owned by the dashboard. */
  topActions: React.ReactNode;
};

export function GridWorkspace({ data, actions, onToast, topActions }: Props) {
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
      let preview: Box;
      if (drag.mode === "move") {
        preview = { ...o, x: Math.max(0, Math.min(COLS - o.w, o.x + dx)), y: Math.max(0, Math.min(ROWS - o.h, o.y + dy)) };
      } else {
        // Any corner: the opposite corner stays put.
        const left = drag.mode === "nw" || drag.mode === "sw";
        const top = drag.mode === "nw" || drag.mode === "ne";
        const x = left ? Math.max(0, Math.min(o.x + o.w - MIN_W, o.x + dx)) : o.x;
        const y = top ? Math.max(0, Math.min(o.y + o.h - MIN_H, o.y + dy)) : o.y;
        const w = left ? o.x + o.w - x : Math.max(MIN_W, Math.min(COLS - o.x, o.w + dx));
        const h = top ? o.y + o.h - y : Math.max(MIN_H, Math.min(ROWS - o.y, o.h + dy));
        preview = { ...o, x, y, w, h };
      }
      if (preview.x === drag.preview.x && preview.y === drag.preview.y && preview.w === drag.preview.w && preview.h === drag.preview.h) return;
      // Dropping onto a single box that fits our old spot swaps the two; otherwise others make room.
      const swap = drag.mode === "move" && !fits(preview, layout) ? swapTarget(preview, drag.orig, layout) : null;
      const { pushed, removed } = swap ? { pushed: {}, removed: [] } : pushAside(preview, layout);
      setDrag({ ...drag, preview, swap, pushed, removed });
    };
    const onUp = () => {
      const before = layout;
      const next = layout
        .filter((b) => !drag.removed.includes(b.id))
        .map((b) => (b.id === drag.id ? drag.preview : drag.swap && b.id === drag.swap.id ? drag.swap : (drag.pushed[b.id] ?? b)));
      save(next);
      setDrag(null);
      if (drag.removed.length) {
        const names = before.filter((b) => drag.removed.includes(b.id)).map((b) => viewLabel(b.view));
        onToast(`Removed ${names.join(", ")} — pushed out of space`, () => save(before));
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [drag, cw, ch, layout, save, onToast]);

  function startDrag(e: React.PointerEvent, box: Box, mode: Drag["mode"]) {
    if (e.button !== 0) return;
    if (mode === "move" && (e.target as HTMLElement).closest("select, button, input, a")) return;
    e.preventDefault();
    setDrag({ id: box.id, mode, startX: e.clientX, startY: e.clientY, orig: box, preview: box, swap: null, pushed: {}, removed: [] });
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

  const hasDayView = layout.some((b) => b.view === "day");

  const place = (b: Box): React.CSSProperties => ({
    left: b.x * cw,
    top: b.y * ch,
    width: b.w * cw,
    height: b.h * ch,
  });

  return (
    <div className="grid-shell">
      <header className="grid-top">
        <TopInfo data={data} />
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
        {drag && <div className="grid-ghost" style={place(drag.preview)} />}
        {size.w > 0 &&
          layout.map((box) => {
            const shown = drag?.id === box.id ? drag.preview : drag?.swap?.id === box.id ? drag.swap : (drag?.pushed[box.id] ?? box);
            const doomed = drag?.removed.includes(box.id);
            const px = { w: shown.w * cw, h: shown.h * ch };
            return (
              <section key={box.id} className={`box ${drag?.id === box.id ? "lifted" : ""} ${doomed ? "doomed" : ""}`} style={place(shown)} aria-label={viewLabel(box.view)}>
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
                      <AddButton view={box.view} actions={actions} data={data} />
                      <button className="panel-btn" onClick={() => save(layout.filter((b) => b.id !== box.id))} aria-label="Remove box" title="Remove box">
                        ×
                      </button>
                    </div>
                  </header>
                  <div className="box-body">
                    <BoxContent view={box.view} data={data} actions={actions} px={px} hasDayView={hasDayView} />
                  </div>
                </div>
                {(["nw", "ne", "sw", "se"] as const).map((c) => (
                  <span key={c} className={`resize-handle ${c}`} onPointerDown={(e) => startDrag(e, box, c)} aria-hidden title="Drag to resize" />
                ))}
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

function AddButton({ view, actions, data }: { view: BoxView; actions: Actions; data: Data }) {
  const cat = view.startsWith("cat:") ? view.slice(4) : null;
  const add =
    view === "events" ? () => actions.newEvent()
    : view === "people" ? actions.newContact
    : view === "cards" ? actions.newCard
    : view === "trips" ? () => actions.newTask({ category: "trip" })
    : view === "tracking" ? () => actions.newBooking()
    : view === "tobook" ? () => actions.newBooking({ status: "to_book" })
    : view === "calendar" || view === "day" ? () => actions.newEvent(data.selectedDay)
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

function BoxContent({ view, data, actions, px, hasDayView }: { view: BoxView; data: Data; actions: Actions; px: { w: number; h: number }; hasDayView: boolean }) {
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
      // With a Day view box on the grid, a picked day shows there instead of in a list under the month.
      return <CalendarView data={data} actions={actions} mini={px.w < 560 || px.h < 420} noAgenda={hasDayView} />;
    case "day":
      return <DayView data={data} actions={actions} />;
    case "events":
      return roomy ? (
        <EventsView events={data.events} now={data.now} tz={data.tz} onOpen={actions.openEvent} onNew={() => actions.newEvent()} />
      ) : (
        <EventsPanel data={data} actions={actions} />
      );
    case "trips":
      return <TripsView data={data} actions={actions} compact={!roomy} />;
    case "tracking":
      return <TrackingView data={data} actions={actions} />;
    case "tobook":
      return <ToBookView data={data} actions={actions} />;
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
    case "packing":
      return <PackingView />;
    default:
      return view.startsWith("cat:") ? <CategoryPanel cat={view.slice(4)} data={data} actions={actions} /> : null;
  }
}
