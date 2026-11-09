import { currentUser, unauthorized } from "@/lib/auth";
import { getTrips } from "@/lib/travel";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return unauthorized();
  return Response.json({ trips: await getTrips() });
}
