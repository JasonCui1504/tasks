import { currentUser, unauthorized } from "@/lib/auth";
import { cleanContactInput, createContact, listContacts } from "@/lib/lists";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return unauthorized();
  return Response.json({ contacts: await listContacts(user) });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const body = await request.json().catch(() => ({}));
  try {
    return Response.json({ contact: await createContact(user, cleanContactInput(body, false)) }, { status: 201 });
  } catch (err) {
    if (typeof err === "string") return Response.json({ error: err }, { status: 400 });
    throw err;
  }
}
