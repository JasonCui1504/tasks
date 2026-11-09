# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

# Tasks

Personal task tracker served at **https://tasks.jascui.com**, installable on the iPhone Home Screen as a web app.

- One page (`/`, `app/Dashboard.tsx`) plus `/login`. API under `/api/*`.
- Data: its own Turso/libSQL database (`TASKS_DATABASE_URL`/`TASKS_DATABASE_AUTH_TOKEN`); locally `.data/tasks.db`. Schema is created on first use (`lib/db.ts`).
- Login: scrypt hashes in `task_users` (set with `node scripts/set-password.mjs <user> [--env file]`), falling back to `TASKS_USERS`. Sessions are signed with `TASKS_SESSION_SECRET`.
- Notifications: Web Push (VAPID keys, `npm run vapid`). `lib/notify.ts` decides what to send; `/api/cron` runs it, called every ~10 min by `.github/workflows/notify.yml` with `CRON_SECRET`. Each notification is keyed in `notification_log` so it fires once.
- Trips: read-only from travel.jascui.com's `/api/feed` (repo JasonCui1504/travel_budget) with `TRAVEL_FEED_SECRET` — the same secret Llamabear uses. Nothing is written back to the travel app; changes there need the owner's permission.
