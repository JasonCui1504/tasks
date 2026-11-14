// Run: TASKS_DATABASE_URL=file:/tmp/tasks-test.db npx tsx --test --test-concurrency=1 tests/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { relativeDue, spanText } from "../lib/time";
import { acknowledgeTask, createTask, getGridLayout, saveGridLayout } from "../lib/tasks";

test("spans are exact and never round up", () => {
  assert.equal(spanText(1), "1 day");
  assert.equal(spanText(13), "13 days");
  assert.equal(spanText(14), "2 weeks");
  assert.equal(spanText(18), "2 weeks, 4 days");
  assert.equal(spanText(25), "3 weeks, 4 days");
  assert.equal(spanText(75), "2 months, 2 weeks");
  assert.equal(spanText(400), "1 year, 1 month");
});

test("relative due dates", () => {
  const tz = "America/New_York";
  assert.equal(relativeDue(new Date("2026-12-02T05:00:00Z"), new Date("2026-11-14T18:00:00Z"), tz, true), "in 2 weeks, 4 days");
  const now = new Date("2026-11-14T18:00:00Z");
  assert.equal(relativeDue(new Date(now.getTime() + 100 * 60_000), now, tz, false), "in 1 hour 40 min");
});

test("an acknowledged monthly payment comes back on the 1st of its month", async () => {
  const owner = `ack-test-${Date.now()}`;
  const t = await createTask(owner, { title: "Rent", category: "payment", dueAt: "2026-11-15T14:00:00Z", allDay: true, repeat: "month", repeatEvery: 1, reminders: [4320, 1440, 0] });
  const a = await acknowledgeTask(owner, t.id, "America/New_York");
  assert.equal(a?.dueAt?.slice(0, 10), "2026-12-15");
  assert.equal(a?.quietUntil, "2026-12-01T05:00:00.000Z");
});

test("the grid layout is saved to the account", async () => {
  const owner = `grid-test-${Date.now()}`;
  assert.equal(await getGridLayout(owner), null);
  await saveGridLayout(owner, [{ id: "b1", view: "today", x: 0, y: 0, w: 5, h: 5 }]);
  assert.deepEqual(await getGridLayout(owner), [{ id: "b1", view: "today", x: 0, y: 0, w: 5, h: 5 }]);
});
