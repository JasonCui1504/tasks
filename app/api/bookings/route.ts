import { currentUser, unauthorized } from "@/lib/auth";
import { syncCancelTasks } from "@/lib/cancelTasks";
import { getSettings } from "@/lib/tasks";
import { cleanBookingInput, createBooking, listBookings } from "@/lib/lists";

/** Booking deadlines only (travel ones are left to the itinerary sync). */
async function syncBookingDeadlines(user: string) {
  const [bookings, s] = await Promise.all([listBookings(user), getSettings(user)]);
  await syncCancelTasks(user, bookings, null, s.timeZone).catch(() => false);
}

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return unauthorized();
  return Response.json({ bookings: await listBookings(user) });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const body = await request.json().catch(() => ({}));
  try {
    const booking = await createBooking(user, cleanBookingInput(body, false));
    await syncBookingDeadlines(user);
    return Response.json({ booking }, { status: 201 });
  } catch (err) {
    if (typeof err === "string") return Response.json({ error: err }, { status: 400 });
    throw err;
  }
}
