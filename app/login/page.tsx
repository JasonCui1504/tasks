import { redirect } from "next/navigation";
import { currentUser, hasAnyUser } from "@/lib/auth";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

// Same look as the sign-in pages on jascui.com and travel.jascui.com: a quiet
// card, a small uppercase eyebrow, a light headline, labelled fields.
export default async function LoginPage() {
  if (await currentUser()) redirect("/");
  const setup = !(await hasAnyUser());
  return (
    <main className="login">
      <div className="login-card">
        <p className="eyebrow">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
            <path d="M4 7h3M4 12h3M4 17h3M10 7.5l1.6 1.6L15 5.7M10 12h10M10 17h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Tasks
        </p>
        <h1>{setup ? "Create your account" : "Welcome back"}</h1>
        {setup && (
          <p className="login-note">
            First time here. Enter the setup code (the CRON_SECRET value from your Vercel settings), then choose a username and password.
          </p>
        )}
        <LoginForm setup={setup} />
      </div>
    </main>
  );
}
