import { currentUser, unauthorized } from "@/lib/auth";
import { cleanBookingInput, deleteBooking, updateBooking } from "@/lib/lists";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const id = Number((await params).id);
  const body = await request.json().catch(() => ({}));
  let booking;
  try {
    booking = await updateBooking(user, id, cleanBookingInput(body, true));
  } catch (err) {
    if (typeof err === "string") return Response.json({ error: err }, { status: 400 });
    throw err;
  }
  if (!booking) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ booking });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return unauthorized();
  await deleteBooking(user, Number((await params).id));
  return Response.json({ ok: true });
}
