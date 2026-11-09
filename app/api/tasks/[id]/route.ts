import { currentUser, unauthorized } from "@/lib/auth";
import { cleanInput, completeTask, deleteTask, getSettings, reopenTask, snoozeTask, updateTask } from "@/lib/tasks";

type Ctx = { params: Promise<{ id: string }> };

// PATCH { ...fields } edits; PATCH { action: "complete" | "reopen" | "snooze", minutes? } acts on it.
export async function PATCH(request: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const id = Number((await params).id);
  const body = await request.json().catch(() => ({}));
  let task;
  try {
    if (body.action === "complete") task = await completeTask(user, id, (await getSettings(user)).timeZone);
    else if (body.action === "reopen") task = await reopenTask(user, id);
    else if (body.action === "snooze") task = await snoozeTask(user, id, Math.max(5, Number(body.minutes) || 60));
    else task = await updateTask(user, id, cleanInput(body, true));
  } catch (err) {
    if (typeof err === "string") return Response.json({ error: err }, { status: 400 });
    throw err;
  }
  if (!task) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ task });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return unauthorized();
  await deleteTask(user, Number((await params).id));
  return Response.json({ ok: true });
}
