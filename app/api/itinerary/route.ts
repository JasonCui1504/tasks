import { currentUser, unauthorized } from "@/lib/auth";
import { listItineraries, removeCalendarLink, saveCalendarLink } from "@/lib/itinerary";

export const dynamic = "force-dynamic";

// Trip itineraries for the Day view, read from each trip's calendar link on
// travel.jascui.com. Fetched after the page loads, so a slow travel app never delays it.
export async function GET() {
  const user = await currentUser();
  if (!user) return unauthorized();
  return Response.json({ itineraries: await listItineraries(user) });
}

// PUT { url } saves a trip's calendar link (the trip comes from the link itself).
export async function PUT(request: Request) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const body = await request.json().catch(() => ({}));
  try {
    return Response.json({ itinerary: await saveCalendarLink(user, String(body.url ?? "")) });
  } catch (err) {
    if (typeof err === "string") return Response.json({ error: err }, { status: 400 });
    return Response.json({ error: "Couldn't reach the travel app. Try again in a moment." }, { status: 502 });
  }
}

// DELETE ?trip=3 forgets a trip's link.
export async function DELETE(request: Request) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const trip = Number(new URL(request.url).searchParams.get("trip"));
  if (trip) await removeCalendarLink(user, trip);
  return Response.json({ ok: true });
}
