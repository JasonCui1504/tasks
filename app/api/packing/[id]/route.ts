import { currentUser, unauthorized } from "@/lib/auth";
import { deletePackingList, renamePackingList, setAllPacked } from "@/lib/lists";

type Ctx = { params: Promise<{ id: string }> };

// PATCH { name } renames the trip; PATCH { action: "pack-all" | "unpack-all" } ticks or clears every item.
export async function PATCH(request: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const id = Number((await params).id);
  const body = await request.json().catch(() => ({}));
  try {
    if (body.action === "pack-all" || body.action === "unpack-all") await setAllPacked(user, id, body.action === "pack-all");
    else if (!(await renamePackingList(user, id, body.name))) return Response.json({ error: "Not found" }, { status: 404 });
  } catch (err) {
    if (typeof err === "string") return Response.json({ error: err }, { status: 400 });
    throw err;
  }
  return Response.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return unauthorized();
  await deletePackingList(user, Number((await params).id));
  return Response.json({ ok: true });
}
