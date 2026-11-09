import { currentUser, unauthorized } from "@/lib/auth";
import { saveSettings } from "@/lib/tasks";

export async function PUT(request: Request) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const body = await request.json().catch(() => ({}));
  return Response.json({ settings: await saveSettings(user, body) });
}
