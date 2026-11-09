import { currentUser, unauthorized } from "@/lib/auth";
import type { ContactInput } from "@/lib/types";
import { cleanContactInput, deleteContact, deleteContactLog, listContactLog, logContact, updateContact } from "@/lib/lists";

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

// GET: the history of times you reached out to this person.
export async function GET(_request: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return unauthorized();
  return Response.json({ log: await listContactLog(user, Number((await params).id)) });
}

// PATCH { action: "log", on, note } records a catch-up; { action: "unlog", logId } removes one;
// otherwise edits name / frequency / notes. The last-contact date always follows the history.
export async function PATCH(request: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const id = Number((await params).id);
  const body = await request.json().catch(() => ({}));
  try {
    if (body.action === "log") {
      const r = await logContact(user, id, body.on, body.note);
      if (!r) return Response.json({ error: "Not found" }, { status: 404 });
      return Response.json(r);
    }
    const contact =
      body.action === "unlog"
        ? await deleteContactLog(user, id, Number(body.logId))
        : await updateContact(user, id, editable(cleanContactInput(body, true)));
    if (!contact) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ contact });
  } catch (err) {
    if (typeof err === "string") return Response.json({ error: err }, { status: 400 });
    throw err;
  }
}

/** The last-contact date only changes by logging, so the history stays the source of truth. */
function editable(input: ContactInput): ContactInput {
  delete input.lastContactOn;
  return input;
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return unauthorized();
  await deleteContact(user, Number((await params).id));
  return Response.json({ ok: true });
}
