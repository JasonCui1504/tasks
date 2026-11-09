"use client";

import { useEffect, useState } from "react";
import { greeting } from "@/lib/greeting";
import { daysBetween, localDateKey, zonedParts } from "@/lib/time";
import type { Data } from "./shared";

// The workspace's top line: a time-of-day message, a live clock, the time in
// Boulder and Stanford, today's and tomorrow's weather with sunrise/sunset
// (Open-Meteo, free and keyless, fetched by the browser), and the countdown to
// the next trip from travel.jascui.com.

type Place = { id: "boulder" | "stanford"; name: string; lat: number; lon: number; tz: string };
const PLACES: Place[] = [
  { id: "boulder", name: "Boulder", lat: 40.015, lon: -105.2705, tz: "America/Denver" },
  { id: "stanford", name: "Stanford", lat: 37.4275, lon: -122.1697, tz: "America/Los_Angeles" },
];
const PLACE_KEY = "tasks.weather.place";

type Weather = {
  now: { temp: number; code: number } | null;
  days: { max: number; min: number; code: number; rain: number; sunrise: string; sunset: string }[];
};

/** WMO weather codes → a symbol and a word. */
function sky(code: number): { icon: string; text: string } {
  if (code === 0) return { icon: "☀️", text: "Clear" };
  if (code <= 2) return { icon: "🌤️", text: "Partly cloudy" };
  if (code === 3) return { icon: "☁️", text: "Cloudy" };
  if (code === 45 || code === 48) return { icon: "🌫️", text: "Fog" };
  if (code >= 51 && code <= 57) return { icon: "🌦️", text: "Drizzle" };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { icon: "🌧️", text: "Rain" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { icon: "🌨️", text: "Snow" };
  if (code >= 95) return { icon: "⛈️", text: "Storms" };
  return { icon: "🌡️", text: "" };
}

const hhmm = (iso: string) => {
  const [h, m] = iso.slice(11, 16).split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

function useWeather(place: Place | null): Weather | null {
  const [weather, setWeather] = useState<Weather | null>(null);
  useEffect(() => {
    if (!place) return;
    let stop = false;
    const load = async () => {
      try {
        const url =
          `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
          `&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset` +
          `&temperature_unit=fahrenheit&timezone=${encodeURIComponent(place.tz)}&forecast_days=2`;
        const r = await fetch(url);
        if (!r.ok) return;
        const j = await r.json();
        if (stop) return;
        const d = j.daily ?? {};
        setWeather({
          now: j.current ? { temp: Math.round(j.current.temperature_2m), code: j.current.weather_code } : null,
          days: (d.time ?? []).map((_: string, i: number) => ({
            max: Math.round(d.temperature_2m_max[i]),
            min: Math.round(d.temperature_2m_min[i]),
            code: d.weather_code[i],
            rain: d.precipitation_probability_max?.[i] ?? 0,
            sunrise: d.sunrise[i],
            sunset: d.sunset[i],
          })),
        });
      } catch {}
    };
    load();
    const t = setInterval(load, 30 * 60_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [place]);
  return weather;
}

function timeIn(now: Date, tz: string, seconds = false) {
  return now.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", second: seconds ? "2-digit" : undefined });
}

export function TopInfo({ data, compact }: { data: Data; compact?: boolean }) {
  // The clock ticks every second; it starts empty so the server render and the first client render agree.
  const [clock, setClock] = useState<Date | null>(null);
  const [place, setPlace] = useState<Place | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the clock only exists in the browser
    setClock(new Date());
    const t = setInterval(() => setClock(new Date()), 1000);
    let id: string | null = null;
    try {
      id = localStorage.getItem(PLACE_KEY);
    } catch {}
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setPlace(PLACES.find((p) => p.id === id) ?? (tz === "America/Denver" ? PLACES[0] : PLACES[1]));
    return () => clearInterval(t);
  }, []);

  const weather = useWeather(place);

  function switchPlace() {
    const next = place?.id === "boulder" ? PLACES[1] : PLACES[0];
    setPlace(next);
    try {
      localStorage.setItem(PLACE_KEY, next.id);
    } catch {}
  }

  const now = clock ?? data.now;
  const parts = zonedParts(now, data.tz);
  const weekday = new Date(Date.UTC(parts.y, parts.m - 1, parts.d)).getUTCDay();
  const message = greeting(parts.h, weekday);
  const dateLine = now.toLocaleDateString("en-US", { timeZone: data.tz, weekday: "long", month: "long", day: "numeric" });

  // Next trip: the first that hasn't started yet, or the one underway.
  const today = localDateKey(now, data.tz);
  const trip = data.trips.find((t) => t.endDate >= today);
  const tripDays = trip ? daysBetween(today, trip.startDate) : null;

  const [w0, w1] = weather?.days ?? [];

  const tiles = (
    <>
      <div className="info-tile clock">
        <span className="info-label">Now</span>
        <span className="info-value mono">{clock ? timeIn(clock, data.tz, true) : "--:--:--"}</span>
      </div>
      {PLACES.map((p) => (
        <div key={p.id} className="info-tile">
          <span className="info-label">{p.name}</span>
          <span className="info-value mono">{clock ? timeIn(clock, p.tz) : "--:--"}</span>
        </div>
      ))}
      <button className="info-tile" onClick={switchPlace} title={`Weather for ${place?.name ?? ""} — click to switch`}>
        <span className="info-label">Today · {place?.name ?? "…"}</span>
        <span className="info-value">
          {w0 ? (
            <>
              {sky(weather?.now?.code ?? w0.code).icon} {weather?.now ? `${weather.now.temp}°` : ""}{" "}
              <span className="info-sub">{w0.max}° / {w0.min}°</span>
            </>
          ) : (
            "—"
          )}
        </span>
      </button>
      <button className="info-tile" onClick={switchPlace} title={`Weather for ${place?.name ?? ""} — click to switch`}>
        <span className="info-label">Tomorrow</span>
        <span className="info-value">
          {w1 ? (
            <>
              {sky(w1.code).icon} {w1.max}° <span className="info-sub">/ {w1.min}°{w1.rain >= 20 ? ` · ${w1.rain}% rain` : ""}</span>
            </>
          ) : (
            "—"
          )}
        </span>
      </button>
      <div className="info-tile">
        <span className="info-label">Sunrise · Sunset</span>
        <span className="info-value">{w0 ? `${hhmm(w0.sunrise)} · ${hhmm(w0.sunset)}` : "—"}</span>
      </div>
      <div className="info-tile">
        <span className="info-label">{trip ? `Next trip · ${trip.name}` : "Next trip"}</span>
        <span className="info-value">
          {tripDays == null ? "None planned" : tripDays > 0 ? `${tripDays} day${tripDays === 1 ? "" : "s"}` : tripDays === 0 ? "Today!" : "Underway"}
        </span>
      </div>
    </>
  );

  if (compact) {
    return (
      <div className="top-info compact">
        <p className="greeting">{message}</p>
        <div className="info-strip">{tiles}</div>
      </div>
    );
  }

  return (
    <div className="top-info">
      <div className="brand">
        <span className="eyebrow-sm">Workspace · {dateLine}</span>
        <p className="greeting">{message}</p>
      </div>
      <div className="info-strip">{tiles}</div>
    </div>
  );
}
