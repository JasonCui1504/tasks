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
- **Workspace (computer)**: the whole window is a grid (24 × 16 cells, so it always fills the screen — a bigger window gives bigger boxes). Place boxes on it and choose what each shows from its title menu: Today's to-do, All tasks, Urgent, Summary numbers, Calendar, Day view, Events, Trips, Stay in touch, Gift cards, or any task category. Drag a box by its title bar to move it (drop it on a box that fits your old spot to swap), drag any corner to resize. Boxes in the way shrink back; one squeezed below the minimum size is removed (with Undo). “+ Add box” places a new one in the first free space. The layout is saved on each device; “Reset layout” restores the default.
- **Top bar**: a message that changes with the time of day (27 of them, some just for weekends, Mondays and Fridays), a live clock, the time in Boulder and Stanford, today's and tomorrow's weather with sunrise and sunset (Open-Meteo, free; click the weather to switch between Boulder and Stanford), and the days until your next trip.
- **Day view**: click a day on any calendar and the Day view shows it hour by hour — timed tasks and events, all-day items, and on trip days the actual itinerary from travel.jascui.com: each planned event with its place and booking status, flights, where you're staying, rental cars and free-cancellation deadlines. To connect a trip, copy its calendar link once (travel.jascui.com → the trip → menu → Add to calendar → copy the Apple Calendar link) and paste it under the trip in Trips or the Day view. It's read-only: nothing changes on the travel app.
- **Phone**: a set view — Today's to-do list first, then tabs for All tasks, Calendar, Events, Trips, Stay in touch and Gift cards.
- **Urgent callout**: a red box at the top lists what needs doing now — overdue and due-today tasks, critical ones due within 3 days, today's events, trips starting within 3 days with prep left, gift cards expiring within a week, people overdue for a catch-up. It says “All good” when there's nothing.
- **Calendar**: a month grid of tasks, events, trips, gift card expiries and catch-ups; pick a day to see its agenda and add a task or event on it.
- **Events**: birthdays, appointments, concerts — a date, optional time and place, and reminders (1 week / 3 days / 1 day / 1 hour before, or when it starts). Grouped Today / Tomorrow / Next 7 days / by month. (Trips have their own tab, with each trip's prep tasks.) Today's events are in the morning summary.
- **Stay in touch**: people you want to keep up with and how often (every week → every year, or a custom number of days). Tap **Reached out** to log today, or open someone to log a catch-up on another date with a note (“called, 40 min”) and see the history. They're sorted into Reach out / Coming up / Later, and you get “Time to reach out to Mom — last time: Oct 28 (12 days ago)” the day someone's due, then weekly until you log it.
- **Gift cards**: store, balance, original value, expiry, and where the card is (wallet, email, an app…). Tap **Spend** to take a purchase off the balance; a card at $0 moves to “Used up”. Shows the total left to spend, and sends “Starbucks gift card expires in 5 days — $25.00 left to spend” 30, 7 and 1 day before expiry while there's money on it.

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
