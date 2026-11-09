import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { pushConfigured } from "@/lib/push";
import { getSettings, listTasks } from "@/lib/tasks";
import { getTrips, travelConfigured, TRAVEL_URL } from "@/lib/travel";
import Dashboard from "./Dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const [tasks, trips, settings] = await Promise.all([listTasks(user), getTrips(), getSettings(user)]);
  return (
    <Dashboard
      user={user}
      initialTasks={tasks}
      initialTrips={trips}
      initialSettings={settings}
      vapidKey={pushConfigured() ? process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY! : null}
      travel={{ configured: travelConfigured(), url: TRAVEL_URL }}
    />
  );
}
