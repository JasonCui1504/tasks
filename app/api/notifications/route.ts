import { currentUser, unauthorized } from "@/lib/auth";
import { recentNotifications } from "@/lib/tasks";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return unauthorized();
  return Response.json({ notifications: await recentNotifications(user) });
}
