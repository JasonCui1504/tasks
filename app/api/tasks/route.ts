import { currentUser, unauthorized } from "@/lib/auth";
import { cleanInput, createTask, listTasks } from "@/lib/tasks";
import { defaultReminders } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return unauthorized();
  return Response.json({ tasks: await listTasks(user) });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const body = await request.json().catch(() => ({}));
  try {
    const input = cleanInput(body, false);
    input.category ??= "personal";
    input.reminders ??= defaultReminders(input.category);
    return Response.json({ task: await createTask(user, input) }, { status: 201 });
  } catch (err) {
    if (typeof err === "string") return Response.json({ error: err }, { status: 400 });
    throw err;
  }
}
