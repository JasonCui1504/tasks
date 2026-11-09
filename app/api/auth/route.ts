import { configured, createSession, sessionCookie, validateCredentials } from "@/lib/auth";

const attempts = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const e = attempts.get(ip);
  if (!e || now > e.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + 15 * 60_000 });
    return false;
  }
  return ++e.count > 10;
}

// Sign in: { username, password }
export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (rateLimited(ip)) return Response.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });
  if (!configured()) return Response.json({ error: "TASKS_SESSION_SECRET isn't set." }, { status: 500 });
  const { username, password } = await request.json().catch(() => ({}));
  if (typeof username !== "string" || typeof password !== "string" || !(await validateCredentials(username.trim(), password))) {
    return Response.json({ error: "Wrong username or password." }, { status: 401 });
  }
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", sessionCookie(createSession(username.trim())));
  return res;
}

export async function DELETE() {
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", sessionCookie("", 0));
  return res;
}
