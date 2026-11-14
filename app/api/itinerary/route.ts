import { currentUser, unauthorized } from "@/lib/auth";
import { syncCancelTasks } from "@/lib/cancelTasks";
import { connectTravel, disconnectTravel, listItineraries } from "@/lib/itinerary";
import { listBookings } from "@/lib/lists";
import { getSettings } from "@/lib/tasks";

/** Itineraries, plus whether free-cancellation tasks changed (so the page refetches tasks). */
async function withSync(user: string) {
  const r = await listItineraries(user);
  let tasksChanged = false;
  if (r.status.connected && !r.status.error) {
    const [bookings, s] = await Promise.all([listBookings(user), getSettings(user)]);
    tasksChanged = await syncCancelTasks(user, bookings, r.itineraries, s.timeZone).catch(() => false);
  }
  return { ...r, tasksChanged };
}

export const dynamic = "force-dynamic";

// Trip itineraries for the Day view, read from travel.jascui.com through the
// owner's own sign-in there. Fetched after the page loads, so a slow travel app never delays it.
export async function GET() {
  const user = await currentUser();
  if (!user) return unauthorized();
  return Response.json(await withSync(user));
}

// POST { username, password } connects (signs in to travel.jascui.com once).
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const body = await request.json().catch(() => ({}));
  try {
    await connectTravel(user, String(body.username ?? ""), String(body.password ?? ""));
  } catch (err) {
    return Response.json({ error: typeof err === "string" ? err : "Couldn't connect." }, { status: 400 });
  }
  return Response.json(await withSync(user));
}

// DELETE forgets the travel sign-in (and the saved password).
export async function DELETE() {
  const user = await currentUser();
  if (!user) return unauthorized();
  await disconnectTravel(user);
  return Response.json({ ok: true });
}
