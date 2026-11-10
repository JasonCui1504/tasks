import { currentUser, unauthorized } from "@/lib/auth";
import { addPackingItem } from "@/lib/lists";

type Ctx = { params: Promise<{ id: string }> };

// POST { name } adds an item to the trip's list.
export async function POST(request: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const body = await request.json().catch(() => ({}));
  let item;
  try {
    item = await addPackingItem(user, Number((await params).id), body.name);
  } catch (err) {
    if (typeof err === "string") return Response.json({ error: err }, { status: 400 });
    throw err;
  }
  if (!item) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ item }, { status: 201 });
}
