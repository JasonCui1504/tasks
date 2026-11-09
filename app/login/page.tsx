import { redirect } from "next/navigation";
import { currentUser, hasAnyUser } from "@/lib/auth";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await currentUser()) redirect("/");
  const setup = !(await hasAnyUser());
  return (
    <main className="login">
      <div className="login-card">
        <div className="login-mark" aria-hidden>
          <svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <h1>{setup ? "Create your account" : "Tasks"}</h1>
        <p className="muted">
          {setup
            ? "First time here. Enter the setup code (CRON_SECRET from your Vercel settings) and choose a username and password."
            : "Sign in to see what’s outstanding."}
        </p>
        <LoginForm setup={setup} />
      </div>
    </main>
  );
}
