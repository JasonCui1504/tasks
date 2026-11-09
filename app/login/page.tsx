import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  if (await currentUser()) redirect("/");
  return (
    <main className="login">
      <div className="login-card">
        <div className="login-mark" aria-hidden>
          <svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <h1>Tasks</h1>
        <p className="muted">Sign in to see what&rsquo;s outstanding.</p>
        <LoginForm />
      </div>
    </main>
  );
}
