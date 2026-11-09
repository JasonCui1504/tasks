import { currentUser, unauthorized } from "@/lib/auth";
import { removeSubscription, saveSubscription } from "@/lib/push";

// Save this device's push subscription: { subscription }
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const { subscription } = await request.json().catch(() => ({}));
  const ok = await saveSubscription(user, subscription ?? {}, request.headers.get("user-agent") ?? "");
  if (!ok) return Response.json({ error: "That isn't a valid push subscription." }, { status: 400 });
  return Response.json({ ok: true });
}

// Forget this device: { endpoint }
export async function DELETE(request: Request) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const { endpoint } = await request.json().catch(() => ({}));
  if (typeof endpoint === "string") await removeSubscription(user, endpoint);
  return Response.json({ ok: true });
}
