import { currentUser, unauthorized } from "@/lib/auth";
import { deletePackingItem, updatePackingItem } from "@/lib/lists";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

// PATCH { name?, packed? } edits an item.
export async function PATCH(request: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const { id, itemId } = await params;
  const body = await request.json().catch(() => ({}));
  let item;
  try {
    item = await updatePackingItem(user, Number(id), Number(itemId), body);
  } catch (err) {
    if (typeof err === "string") return Response.json({ error: err }, { status: 400 });
    throw err;
  }
  if (!item) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ item });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const { id, itemId } = await params;
  await deletePackingItem(user, Number(id), Number(itemId));
  return Response.json({ ok: true });
}
