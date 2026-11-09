import { currentUser, unauthorized } from "@/lib/auth";
import { cleanEventInput, deleteEvent, updateEvent } from "@/lib/lists";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const body = await request.json().catch(() => ({}));
  let event;
  try {
    event = await updateEvent(user, Number((await params).id), cleanEventInput(body, true));
  } catch (err) {
    if (typeof err === "string") return Response.json({ error: err }, { status: 400 });
    throw err;
  }
  if (!event) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ event });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return unauthorized();
  await deleteEvent(user, Number((await params).id));
  return Response.json({ ok: true });
}
