// A line for the top of the workspace that changes with the time of day (and a
// few weekday/weekend moments). Shared with the browser.

type Slot = { from: number; to: number; days?: number[]; text: string };

// Hours are local, [from, to). Day-specific lines come first so they win.
// 0 = Sunday … 6 = Saturday.
const SLOTS: Slot[] = [
  { from: 7, to: 11, days: [6], text: "Saturday morning — anything fun on the list?" },
  { from: 7, to: 11, days: [0], text: "Slow Sunday morning. Coffee first." },
  { from: 17, to: 22, days: [0], text: "Sunday evening — set up the week ahead." },
  { from: 7, to: 10, days: [1], text: "Monday. Pick the one thing that matters this week." },
  { from: 14, to: 18, days: [5], text: "Friday afternoon — almost the weekend." },
  { from: 18, to: 23, days: [5], text: "Friday night. The tasks will keep." },
  { from: 0, to: 2, text: "Burning the midnight oil?" },
  { from: 2, to: 4, text: "Still up? Tomorrow-you says go to bed." },
  { from: 4, to: 6, text: "Up before the birds." },
  { from: 6, to: 7, text: "Early start — the quiet hour is yours." },
  { from: 7, to: 8, text: "Good morning. What's the one thing today?" },
  { from: 8, to: 9, text: "Coffee in hand? Let's see what's due." },
  { from: 9, to: 10, text: "Fresh hours — tackle the hardest thing first." },
  { from: 10, to: 11, text: "Deep-work time. Clear one box." },
  { from: 11, to: 12, text: "Almost lunch — knock one out first?" },
  { from: 12, to: 13, text: "Lunch time. Step away from the screen." },
  { from: 13, to: 14, text: "Post-lunch slump? Try the smallest task." },
  { from: 14, to: 15, text: "Afternoon push — you've got this." },
  { from: 15, to: 16, text: "Snack o'clock." },
  { from: 16, to: 17, text: "Golden hour for errands." },
  { from: 17, to: 18, text: "Wrapping up? Peek at tomorrow." },
  { from: 18, to: 19, text: "Almost dinner time?" },
  { from: 19, to: 20, text: "Dinner time. Everything else can wait." },
  { from: 20, to: 21, text: "Good evening — a nice time to call someone." },
  { from: 21, to: 22, text: "Wind-down hour. Plan tomorrow, then rest." },
  { from: 22, to: 23, text: "Getting late. Anything that can't wait till morning?" },
  { from: 23, to: 24, text: "Lights out soon?" },
];

export function greeting(hour: number, weekday: number): string {
  return (
    SLOTS.find((s) => hour >= s.from && hour < s.to && (!s.days || s.days.includes(weekday)))?.text ?? "Hello."
  );
}

/** How many different lines there are (for the curious). */
export const GREETING_COUNT = new Set(SLOTS.map((s) => s.text)).size;
