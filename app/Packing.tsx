"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PackingItem, PackingList } from "@/lib/types";
import { api } from "./api-client";

// Packing lists: the box first shows just the trips; click one to see and tick
// off what to pack for it. Lists live in one module-level store so two Packing
// boxes stay in step, and every change shows at once and is undone if the save fails.

let lists: PackingList[] | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: PackingList[]) {
  lists = next;
  listeners.forEach((l) => l());
}

function load() {
  loading ??= api<{ lists: PackingList[] }>("/api/packing", "GET")
    .then((r) => set(r.lists))
    .catch(() => {})
    .finally(() => (loading = null));
  return loading;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Apply a change right away, save it, and put things back (with the error) if saving fails. */
async function optimistic(change: (ls: PackingList[]) => PackingList[], save: () => Promise<unknown>) {
  const before = lists ?? [];
  set(change(before));
  try {
    await save();
  } catch (err) {
    set(before);
    alert((err as Error).message);
  }
}

const mapList = (id: number, fn: (l: PackingList) => PackingList) => (ls: PackingList[]) => ls.map((l) => (l.id === id ? fn(l) : l));

function packedText(l: PackingList) {
  const packed = l.items.filter((i) => i.packed).length;
  if (!l.items.length) return "No items yet";
  return packed === l.items.length ? `All ${packed} packed ✓` : `${packed} of ${l.items.length} packed`;
}

export function PackingView() {
  const data = useSyncExternalStore(subscribe, () => lists, () => null);
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    load();
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  if (!data) return <p className="muted small panel-empty">Loading…</p>;
  const open = data.find((l) => l.id === openId);
  return open ? <TripPacking list={open} onBack={() => setOpenId(null)} /> : <TripList lists={data} onOpen={setOpenId} />;
}

function TripList({ lists: all, onOpen }: { lists: PackingList[]; onOpen: (id: number) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const { list } = await api<{ list: PackingList }>("/api/packing", "POST", { name: name.trim() });
      set([list, ...(lists ?? [])]);
      setName("");
      onOpen(list.id);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function remove(l: PackingList) {
    if (!confirm(`Delete the packing list for ${l.name}${l.items.length ? ` and its ${l.items.length} item${l.items.length === 1 ? "" : "s"}` : ""}?`)) return;
    optimistic((ls) => ls.filter((x) => x.id !== l.id), () => api(`/api/packing/${l.id}`, "DELETE"));
  }

  return (
    <>
      {all.length ? (
        <ul className="plain-list">
          {all.map((l) => (
            <li key={l.id} className="mini-row with-action">
              <button onClick={() => onOpen(l.id)}>
                <span className="mini-title">🧳 {l.name}</span>
                <span className="mini-meta">{packedText(l)}</span>
              </button>
              <button className="panel-btn" onClick={() => remove(l)} aria-label={`Delete ${l.name}`} title="Delete trip">
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small panel-empty">No trips yet. Name one below to start its packing list.</p>
      )}
      <form className="inline-add" onSubmit={add}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New trip…" aria-label="New trip name" enterKeyHint="done" disabled={busy} />
        {name.trim() && <button className="link">{busy ? "Adding…" : "Add"}</button>}
      </form>
    </>
  );
}

function TripPacking({ list, onBack }: { list: PackingList; onBack: () => void }) {
  const [item, setItem] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const renameDone = useRef(false); // Enter then blur shouldn't save twice
  const packed = list.items.filter((i) => i.packed).length;
  const base = `/api/packing/${list.id}`;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const name = item.trim();
    if (!name) return;
    setItem("");
    const temp: PackingItem = { id: -Date.now(), listId: list.id, name, packed: false };
    set(mapList(list.id, (l) => ({ ...l, items: [...l.items, temp] }))(lists ?? []));
    try {
      const { item: saved } = await api<{ item: PackingItem }>(`${base}/items`, "POST", { name });
      set(mapList(list.id, (l) => ({ ...l, items: l.items.map((i) => (i.id === temp.id ? saved : i)) }))(lists ?? []));
    } catch (err) {
      set(mapList(list.id, (l) => ({ ...l, items: l.items.filter((i) => i.id !== temp.id) }))(lists ?? []));
      alert((err as Error).message);
    }
  }

  function toggle(i: PackingItem) {
    if (i.id < 0) return; // still saving
    optimistic(
      mapList(list.id, (l) => ({ ...l, items: l.items.map((x) => (x.id === i.id ? { ...x, packed: !i.packed } : x)) })),
      () => api(`${base}/items/${i.id}`, "PATCH", { packed: !i.packed }),
    );
  }

  function removeItem(i: PackingItem) {
    if (i.id < 0) return;
    optimistic(mapList(list.id, (l) => ({ ...l, items: l.items.filter((x) => x.id !== i.id) })), () => api(`${base}/items/${i.id}`, "DELETE"));
  }

  function setAll(packedNow: boolean) {
    optimistic(
      mapList(list.id, (l) => ({ ...l, items: l.items.map((x) => ({ ...x, packed: packedNow })) })),
      () => api(base, "PATCH", { action: packedNow ? "pack-all" : "unpack-all" }),
    );
  }

  function rename(e: React.FormEvent) {
    e.preventDefault();
    if (renameDone.current) return;
    renameDone.current = true;
    const name = renaming?.trim();
    setRenaming(null);
    if (!name || name === list.name) return;
    optimistic(mapList(list.id, (l) => ({ ...l, name })), () => api(base, "PATCH", { name }));
  }

  function removeTrip() {
    if (!confirm(`Delete the packing list for ${list.name}?`)) return;
    onBack();
    optimistic((ls) => ls.filter((x) => x.id !== list.id), () => api(base, "DELETE"));
  }

  return (
    <>
      <div className="packing-head">
        <button className="link" onClick={onBack}>‹ All trips</button>
        <span className="panel-tools">
          {packed > 0 ? (
            <button className="panel-btn text" onClick={() => setAll(false)} title="Clear every tick, e.g. to pack for the way home">Unpack all</button>
          ) : (
            list.items.length > 0 && <button className="panel-btn text" onClick={() => setAll(true)}>Pack all</button>
          )}
          <button className="panel-btn text danger-text" onClick={removeTrip}>Delete trip</button>
        </span>
      </div>
      {renaming != null ? (
        <form onSubmit={rename}>
          <input className="title-input" value={renaming} onChange={(e) => setRenaming(e.target.value)} onBlur={rename} autoFocus aria-label="Trip name" />
        </form>
      ) : (
        <button className="packing-title" onClick={() => { renameDone.current = false; setRenaming(list.name); }} title="Rename">
          <strong>{list.name}</strong>
          <span className="mini-meta">{packedText(list)}</span>
        </button>
      )}
      {list.items.length ? (
        <ul className="plain-list">
          {list.items.map((i) => (
            <li key={i.id} className={`task compact u1 ${i.packed ? "done" : ""}`}>
              <button className="check" onClick={() => toggle(i)} aria-label={i.packed ? `Mark ${i.name} not packed` : `Mark ${i.name} packed`}>
                <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden>
                  <path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button className="task-main" onClick={() => toggle(i)}>
                <span className="task-title">{i.name}</span>
              </button>
              <button className="panel-btn" onClick={() => removeItem(i)} aria-label={`Remove ${i.name}`} title="Remove">
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small panel-empty">Nothing on this list yet.</p>
      )}
      <form className="inline-add" onSubmit={add}>
        <input value={item} onChange={(e) => setItem(e.target.value)} placeholder="Add an item…" aria-label={`Add an item to pack for ${list.name}`} enterKeyHint="done" autoFocus={!list.items.length} />
      </form>
    </>
  );
}
