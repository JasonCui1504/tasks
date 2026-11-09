# Tasks

Everything outstanding in one place — deadlines, bills, subscriptions and trip prep — at **https://tasks.jascui.com**. Add it to your iPhone Home Screen and it behaves like an app, with push notifications.

## What it does

- **One dashboard** grouped by Overdue / Today / Tomorrow / Next 7 days / Later, or by urgency. Tiles at the top count what's overdue, due today and this week, and the days until your next trip.
- **Urgency levels**: Low, Normal, High, Critical — shown as colour on each task.
- **Categories**: Work, Trips, Subscriptions, Payments, Personal, Home, Health, or your own. Filter with the chips.
- **Subscriptions & payments**: amount, repeat (daily → yearly, every N), and “renews on its own” so subscriptions/autopay roll forward automatically. Filtering by either shows your monthly and yearly total.
- **Reminders**: per task (when due, 1 hour, 1 day, 3 days, 1 week before) plus a one-off “remind me at”. Snooze 1 hour / 1 day / 1 week.
- **Specific notifications**, e.g. “Payment due tomorrow: Rent — $1,800.00/month”, “Netflix renews in 3 days — cancel before then if you don’t want it”, “Needs attention: Expense report — overdue, was due yesterday”, “Tokyo starts in 3 days — 2 prep tasks still open: Book ryokan, Get yen”. Overdue Critical tasks nag every 4 hours, High once a day. Optional morning summary and quiet hours.
- **Trips from travel.jascui.com**: upcoming trips appear as cards; link prep tasks to a trip; heads-ups 2 weeks, 3 days and 1 day out.

## Setup

1. **Database** — create a Turso database (`turso db create tasks`, then `turso db show tasks --url` and `turso db tokens create tasks`).
2. **Vercel** — import this repo as a new project and set the environment variables from `.env.example`:
   - `TASKS_SESSION_SECRET` — `openssl rand -hex 32`
   - `TASKS_DATABASE_URL`, `TASKS_DATABASE_AUTH_TOKEN`
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` — from `npm run vapid`; `VAPID_SUBJECT=mailto:<your email>`
   - `CRON_SECRET` — another random string
   - `TRAVEL_FEED_SECRET` — copy the value of `TRAVEL_FEED_SECRET` from the travel_budget Vercel project
3. **Domain** — Project → Settings → Domains → add `tasks.jascui.com`, and add the `CNAME tasks → cname.vercel-dns.com` record at your DNS provider.
4. **Login** — open tasks.jascui.com: the first visit shows **Create your account**. Enter your `CRON_SECRET` value as the setup code, then a username and password. The form disappears once an account exists. (To reset a password later: `node scripts/set-password.mjs <username> --env .env.prod` with the production database values.)
5. **Reminder schedule** — in this GitHub repo: Settings → Secrets and variables → Actions → add secret `CRON_SECRET` (same value as in Vercel). The “Send reminders” workflow then runs every ~10 minutes; you can run it by hand from the Actions tab.
6. **iPhone** — open tasks.jascui.com in Safari → Share → **Add to Home Screen**. Open it from the Home Screen, tap the bell → **Turn on**, allow notifications, then **Send a test notification**.

## Local development

```bash
npm install
cp .env.example .env.local   # set TASKS_SESSION_SECRET at minimum
node scripts/set-password.mjs <username>
npm run dev
```
