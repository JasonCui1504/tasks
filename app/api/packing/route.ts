import { currentUser, unauthorized } from "@/lib/auth";
import { createPackingList, listPackingLists } from "@/lib/lists";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return unauthorized();
  return Response.json({ lists: await listPackingLists(user) });
}

// POST { name } starts a new trip's packing list.
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const body = await request.json().catch(() => ({}));
  try {
    return Response.json({ list: await createPackingList(user, body.name) }, { status: 201 });
  } catch (err) {
    if (typeof err === "string") return Response.json({ error: err }, { status: 400 });
    throw err;
  }
}
