import { currentUser, unauthorized } from "@/lib/auth";
import { saveGridLayout } from "@/lib/tasks";

export async function PUT(request: Request) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const body = await request.json().catch(() => ({}));
  await saveGridLayout(user, body?.layout);
  return Response.json({ ok: true });
}
