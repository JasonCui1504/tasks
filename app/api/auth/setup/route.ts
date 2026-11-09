import { createFirstUser, createSession, hasAnyUser, sessionCookie, setupCodeMatches } from "@/lib/auth";

let failures = 0;
let lockedUntil = 0;

// One-time account creation: { code, username, password }. Gone once any login exists.
export async function POST(request: Request) {
  if (Date.now() < lockedUntil) return Response.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });
  if (await hasAnyUser()) return Response.json({ error: "An account already exists. Sign in instead." }, { status: 409 });
  const { code, username, password } = await request.json().catch(() => ({}));
  if (typeof code !== "string" || !setupCodeMatches(code)) {
    if (++failures >= 10) {
      failures = 0;
      lockedUntil = Date.now() + 15 * 60_000;
    }
    return Response.json({ error: "That setup code isn't right." }, { status: 401 });
  }
  const name = typeof username === "string" ? username.trim() : "";
  if (!/^[A-Za-z0-9_.-]{2,40}$/.test(name)) {
    return Response.json({ error: "Use 2–40 letters, numbers, dots, dashes or underscores for the username." }, { status: 400 });
  }
  if (typeof password !== "string" || password.length < 8) {
    return Response.json({ error: "Use at least 8 characters for the password." }, { status: 400 });
  }
  if (!(await createFirstUser(name, password))) {
    return Response.json({ error: "An account already exists. Sign in instead." }, { status: 409 });
  }
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", sessionCookie(createSession(name)));
  return res;
}
