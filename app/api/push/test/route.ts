import { currentUser, unauthorized } from "@/lib/auth";
import { pushConfigured, sendToUser } from "@/lib/push";

export async function POST() {
  const user = await currentUser();
  if (!user) return unauthorized();
  if (!pushConfigured()) return Response.json({ error: "VAPID keys aren't set on the server." }, { status: 500 });
  const n = await sendToUser(user, {
    title: "Notifications are on",
    body: "You'll hear from Tasks when a deadline is coming up or something needs attention.",
    url: "/",
    tag: "test",
  });
  if (!n) return Response.json({ error: "No device accepted it. Try turning notifications off and on again." }, { status: 502 });
  return Response.json({ ok: true, devices: n });
}
