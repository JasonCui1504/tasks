// Run: TASKS_DATABASE_URL=file:/tmp/tasks-test.db npx tsx --test --test-concurrency=1 tests/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { cancelDeadlines, syncCancelTasks } from "../lib/cancelTasks";
import { createBooking, deleteBooking, listBookings, updateBooking } from "../lib/lists";
import { completeTask, deleteTask, listTasks } from "../lib/tasks";
import type { TripItinerary } from "../lib/types";

const tz = "America/New_York";
const now = new Date("2026-11-14T17:00:00Z");
const owner = `cancel-test-${Date.now()}`;

const trip = (items: { title: string; date: string }[], id = 7): TripItinerary => ({
  id,
  time_zone: tz,
  url: "",
  items: items.map((i) => ({ kind: "deadline", title: i.title, location: "", details: [], status: "", date: i.date })),
});

const mine = async () => (await listTasks(owner)).filter((t) => t.title.startsWith("Last day to cancel"));

test("deadlines come from bookings and itineraries, without duplicates", () => {
  const b = { id: 1, kind: "hotel", name: "Rosen Inn", number: "", from: "", to: "", cancelBy: "2026-12-08", status: "booked", tripId: 7 } as never;
  const d = cancelDeadlines([b], [trip([{ title: "Last day to cancel free: Rosen Inn Closest to Universal", date: "2026-12-08" }, { title: "Last day to cancel free: Hertz", date: "2026-12-09" }])]);
  assert.deepEqual(d.map((x) => x.name), ["Rosen Inn", "Hertz"]);
});

test("an itinerary deadline becomes a Critical Trips task reminding a day before", async () => {
  assert.equal(await syncCancelTasks(owner, [], [trip([{ title: "Last day to cancel free: Rosen Inn", date: "2026-12-08" }])], tz, now), true);
  const [t] = await mine();
  assert.equal(t.title, "Last day to cancel: Rosen Inn");
  assert.equal(t.category, "trip");
  assert.equal(t.urgency, 3);
  assert.equal(t.allDay, true);
  assert.deepEqual(t.reminders, [1440]);
  assert.equal(t.tripId, 7);
  assert.equal(t.dueAt, "2026-12-08T14:00:00.000Z"); // 9 AM Eastern
  // Running again changes nothing.
  assert.equal(await syncCancelTasks(owner, [], [trip([{ title: "Last day to cancel free: Rosen Inn", date: "2026-12-08" }])], tz, now), false);
  assert.equal((await mine()).length, 1);
});

test("a moved deadline moves its task; unreadable itineraries leave it alone", async () => {
  await syncCancelTasks(owner, [], [trip([{ title: "Last day to cancel free: Rosen Inn", date: "2026-12-10" }])], tz, now);
  assert.equal((await mine())[0].dueAt, "2026-12-10T14:00:00.000Z");
  assert.equal(await syncCancelTasks(owner, [], null, tz, now), false);
  assert.equal(await syncCancelTasks(owner, [], [trip([], 8)], tz, now), false); // trip 7 not read
  assert.equal((await mine()).length, 1);
});

test("a deadline gone from its trip removes the open task", async () => {
  assert.equal(await syncCancelTasks(owner, [], [trip([])], tz, now), true);
  assert.equal((await mine()).length, 0);
});

test("past deadlines aren't made; deleted or done tasks aren't made again", async () => {
  await syncCancelTasks(owner, [], [trip([{ title: "Last day to cancel free: Old", date: "2026-11-01" }])], tz, now);
  assert.equal((await mine()).length, 0);
  const items = [{ title: "Last day to cancel free: A", date: "2026-12-01" }, { title: "Last day to cancel free: B", date: "2026-12-02" }];
  await syncCancelTasks(owner, [], [trip(items)], tz, now);
  const [a, b] = await mine();
  await deleteTask(owner, a.id);
  await completeTask(owner, b.id, tz);
  await syncCancelTasks(owner, [], [trip(items)], tz, now);
  assert.equal((await mine()).filter((t) => t.status === "open").length, 0);
});

test("bookings entered here make, move and drop their task", async () => {
  const bk = await createBooking(owner, { kind: "car", name: "Hertz", startDate: "2026-12-11", cancelBy: "2026-12-05", status: "booked" });
  await syncCancelTasks(owner, await listBookings(owner), null, tz, now);
  const open = () => mine().then((l) => l.filter((t) => t.title === "Last day to cancel: Hertz" && t.status === "open"));
  assert.equal((await open()).length, 1);
  await updateBooking(owner, bk.id, { cancelBy: "2026-12-06" });
  await syncCancelTasks(owner, await listBookings(owner), null, tz, now);
  assert.equal((await open())[0].dueAt, "2026-12-06T14:00:00.000Z");
  await deleteBooking(owner, bk.id);
  await syncCancelTasks(owner, await listBookings(owner), null, tz, now);
  assert.equal((await open()).length, 0);
});
