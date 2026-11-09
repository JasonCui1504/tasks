import { currentUser, unauthorized } from "@/lib/auth";
import { cleanCardInput, deleteGiftCard, setGiftCardStatus, spendGiftCard, updateGiftCard } from "@/lib/lists";

type Ctx = { params: Promise<{ id: string }> };

// PATCH { ...fields } edits; PATCH { action: "spend", amount } | { action: "used" | "reactivate" } acts on it.
export async function PATCH(request: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const id = Number((await params).id);
  const body = await request.json().catch(() => ({}));
  let card;
  try {
    if (body.action === "spend") card = await spendGiftCard(user, id, Number(body.amount));
    else if (body.action === "used") card = await setGiftCardStatus(user, id, "used");
    else if (body.action === "reactivate") card = await setGiftCardStatus(user, id, "active");
    else card = await updateGiftCard(user, id, cleanCardInput(body, true));
  } catch (err) {
    if (typeof err === "string") return Response.json({ error: err }, { status: 400 });
    throw err;
  }
  if (!card) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ card });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return unauthorized();
  await deleteGiftCard(user, Number((await params).id));
  return Response.json({ ok: true });
}
