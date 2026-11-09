import { currentUser, unauthorized } from "@/lib/auth";
import { getItineraries } from "@/lib/travel";

export const dynamic = "force-dynamic";

// Trip itineraries for the Day view, fetched after the page loads so a slow travel app never delays it.
export async function GET() {
  const user = await currentUser();
  if (!user) return unauthorized();
  return Response.json({ itineraries: await getItineraries() });
}
