# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

# Tasks

Personal task tracker served at **https://tasks.jascui.com**, installable on the iPhone Home Screen as a web app.

- One page (`/`, `app/Dashboard.tsx`) plus `/login`. API under `/api/*`.
- The page is two layouts of the same data. Computer (≥900px): `app/Grid.tsx`, a window-filling 24×16 grid of movable/resizable boxes, each showing a chosen view; layout in localStorage (`tasks.grid.v3`); boxes push/shrink each other and resize from any corner. The top bar (`app/TopInfo.tsx`) has the time-of-day message (`lib/greeting.ts`), clocks, Open-Meteo weather (fetched by the browser) and the next-trip countdown. The Day view (`app/DayView.tsx`) shows `selectedDay` (shared by every calendar) hour by hour, including trip itineraries. Phone: fixed tabs (Today `app/Today.tsx`, All tasks `app/TasksTab.tsx`, Calendar `app/CalendarView.tsx`, Events, Trips `app/Trips.tsx`, Stay in touch, Gift cards) under the red Urgent callout (`app/Urgent.tsx`). Compact box views are in `app/Panels.tsx`. Every view gets `Data`/`Actions` from `app/shared.tsx`, so an edit opens the same sheet wherever it starts.
- Lists: Tasks, Events (`app/Events.tsx`, `/api/events`), Stay in touch (`app/Contacts.tsx`, `/api/contacts`; each catch-up is a row in `contact_log`, and `last_contact_on` always follows the latest one) and Gift cards (`app/GiftCards.tsx`, `/api/gift-cards`). These are stored by `lib/lists.ts`; their reminders and expiry alerts live in `lib/notify.ts` next to the task ones.
- Data: its own Turso/libSQL database (`TASKS_DATABASE_URL`/`TASKS_DATABASE_AUTH_TOKEN`); locally `.data/tasks.db`. Schema is created on first use (`lib/db.ts`).
- Login: scrypt hashes in `task_users`, falling back to `TASKS_USERS`. While neither has a user, `/login` shows a one-time "Create your account" form guarded by a setup code (the `CRON_SECRET` value); `node scripts/set-password.mjs <user> [--env file]` also sets or resets a password. Sessions are signed with `TASKS_SESSION_SECRET`.
- Notifications: Web Push (VAPID keys, `npm run vapid`). `lib/notify.ts` decides what to send; `/api/cron` runs it, called every ~10 min by `.github/workflows/notify.yml` with `CRON_SECRET`. Each notification is keyed in `notification_log` so it fires once.
- Trips: read-only from travel.jascui.com's `/api/feed` (names/dates) and `/api/feed/itinerary` (events, flights, stays, meals — loaded after the page via `/api/itinerary`; a 404 just means the travel app doesn't share them yet) (repo JasonCui1504/travel_budget) with `TRAVEL_FEED_SECRET` — the same secret Llamabear uses. Nothing is written back to the travel app; changes there need the owner's permission.
