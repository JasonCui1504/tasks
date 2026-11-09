import { currentUser, unauthorized } from "@/lib/auth";
import { cleanBookingInput, createBooking, listBookings } from "@/lib/lists";

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
    return Response.json({ booking: await createBooking(user, cleanBookingInput(body, false)) }, { status: 201 });
  } catch (err) {
    if (typeof err === "string") return Response.json({ error: err }, { status: 400 });
    throw err;
  }
}
