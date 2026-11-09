import { currentUser, unauthorized } from "@/lib/auth";
import { cleanEventInput, createEvent, listEvents } from "@/lib/lists";
import { DEFAULT_EVENT_REMINDERS } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return unauthorized();
  return Response.json({ events: await listEvents(user) });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const body = await request.json().catch(() => ({}));
  try {
    const input = cleanEventInput(body, false);
    input.reminders ??= DEFAULT_EVENT_REMINDERS;
    return Response.json({ event: await createEvent(user, input) }, { status: 201 });
  } catch (err) {
    if (typeof err === "string") return Response.json({ error: err }, { status: 400 });
    throw err;
  }
}
