import { currentUser, unauthorized } from "@/lib/auth";
import { connectTravel, disconnectTravel, listItineraries } from "@/lib/itinerary";

export const dynamic = "force-dynamic";

// Trip itineraries for the Day view, read from travel.jascui.com through the
// owner's own sign-in there. Fetched after the page loads, so a slow travel app never delays it.
export async function GET() {
  const user = await currentUser();
  if (!user) return unauthorized();
  return Response.json(await listItineraries(user));
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
  return Response.json(await listItineraries(user));
}

// DELETE forgets the travel sign-in (and the saved password).
export async function DELETE() {
  const user = await currentUser();
  if (!user) return unauthorized();
  await disconnectTravel(user);
  return Response.json({ ok: true });
}
