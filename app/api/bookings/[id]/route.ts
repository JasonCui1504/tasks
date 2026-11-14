import { currentUser, unauthorized } from "@/lib/auth";
import { syncCancelTasks } from "@/lib/cancelTasks";
import { getSettings } from "@/lib/tasks";
import { cleanBookingInput, deleteBooking, listBookings, updateBooking } from "@/lib/lists";

/** Booking deadlines only (travel ones are left to the itinerary sync). */
async function syncBookingDeadlines(user: string) {
  const [bookings, s] = await Promise.all([listBookings(user), getSettings(user)]);
  await syncCancelTasks(user, bookings, null, s.timeZone).catch(() => false);
}

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
  await syncBookingDeadlines(user);
  return Response.json({ booking });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return unauthorized();
  await deleteBooking(user, Number((await params).id));
  await syncBookingDeadlines(user);
  return Response.json({ ok: true });
}
