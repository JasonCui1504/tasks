// A small iCalendar (RFC 5545) reader: enough for the trip calendars that
// travel.jascui.com publishes (events with TZID or UTC times, all-day stays).

export type IcsTime =
  | { kind: "date"; date: string } // all-day, "YYYY-MM-DD"
  | { kind: "utc"; iso: string } // an exact instant
  | { kind: "local"; date: string; hour: number; tz: string }; // wall clock in tz ("" = floating)

export type IcsEvent = {
  uid: string;
  summary: string;
  location: string;
  description: string;
  start: IcsTime;
  end: IcsTime | null;
};

export type IcsCalendar = { name: string; timeZone: string; events: IcsEvent[] };

const unescape = (s: string) => s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

function parseTime(params: string, value: string): IcsTime | null {
  const date = (v: string) => `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  if (/VALUE=DATE(?!-)/i.test(params) || /^\d{8}$/.test(value)) return { kind: "date", date: date(value) };
  const m = /^(\d{8})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!m) return null;
  if (m[5]) return { kind: "utc", iso: `${date(m[1])}T${m[2]}:${m[3]}:${m[4]}Z` };
  const tz = /TZID=([^;:]+)/i.exec(params)?.[1] ?? "";
  return { kind: "local", date: date(m[1]), hour: Number(m[2]) + Number(m[3]) / 60, tz };
}

export function parseIcs(text: string): IcsCalendar {
  // Unfold continuation lines (a line starting with a space or tab continues the one before).
  const lines = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const cal: IcsCalendar = { name: "", timeZone: "", events: [] };
  let cur: Partial<IcsEvent> | null = null;
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const head = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const [name, ...rest] = head.split(";");
    const params = rest.join(";");
    const key = name.toUpperCase();
    if (key === "BEGIN" && value === "VEVENT") cur = { uid: "", summary: "", location: "", description: "", end: null };
    else if (key === "END" && value === "VEVENT") {
      if (cur?.start) cal.events.push(cur as IcsEvent);
      cur = null;
    } else if (!cur) {
      if (key === "X-WR-CALNAME") cal.name = unescape(value);
      if (key === "X-WR-TIMEZONE") cal.timeZone = value.trim();
    } else if (key === "UID") cur.uid = value;
    else if (key === "SUMMARY") cur.summary = unescape(value);
    else if (key === "LOCATION") cur.location = unescape(value);
    else if (key === "DESCRIPTION") cur.description = unescape(value);
    else if (key === "DTSTART") cur.start = parseTime(params, value) ?? undefined;
    else if (key === "DTEND") cur.end = parseTime(params, value);
  }
  return cal;
}
