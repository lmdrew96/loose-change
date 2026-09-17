"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  inTimeZone,
  nextReminderAt,
  resolveSchedule,
  type ReminderFrequency,
  type ReminderSchedule,
} from "../../convex/reminderSchedule";
import { useRunAction } from "@/components/Toast";

const deviceTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

// 2026-09-20 is a Sunday; any week would do. Built in local time, so the
// names come out in the device's language.
const DAY_NAMES = Array.from({ length: 7 }, (_, day) =>
  new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(new Date(2026, 8, 20 + day)),
);

const HOUR_LABELS = Array.from({ length: 24 }, (_, hour) =>
  new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(2026, 0, 1, hour)),
);

const nextFormatter = new Intl.DateTimeFormat(undefined, { weekday: "long", hour: "numeric", minute: "2-digit" });

const selectClass =
  "min-h-11 rounded-lg border border-olive bg-jungle px-3 text-base text-neutral-100 outline-none focus:border-gold";

/**
 * When this device's reminder arrives. A resurfacing nudge that lands at a
 * bad moment gets swiped away unread, so the timing is the user's to pick.
 */
export function ReminderSettings({ endpoint }: { endpoint: string }) {
  const stored = useQuery(api.pushData.getMySchedule, { endpoint });
  const updateSchedule = useMutation(api.pushData.updateSchedule);
  const runAction = useRunAction();
  const [timeZone] = useState(deviceTimeZone);
  // Fixed per visit: "next reminder" only needs to be right to the hour.
  const [now] = useState(() => Date.now());
  const [saved, setSaved] = useState(false);

  if (stored === undefined) return <p className="mt-3 text-sm text-beaver">Loading your reminder time…</p>;
  // Subscribed in the browser but unknown to the server (e.g. mid-sync).
  if (stored === null) return null;

  const actual = resolveSchedule(stored);
  // Shown in this device's timezone. An older reminder still on the original
  // Sunday 16:00 UTC appears as its local equivalent and only moves if changed.
  const shown = inTimeZone(actual, timeZone, now);
  const next = nextReminderAt(actual, stored.lastSentAt, now);

  async function save(changes: Partial<ReminderSchedule>) {
    setSaved(false);
    const result = await runAction("Couldn't save your reminder time — try again.", () =>
      updateSchedule({ endpoint, ...shown, ...changes, timeZone }),
    );
    if (result.ok) setSaved(true);
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex flex-col gap-1 text-sm text-beaver">
          How often
          <select
            value={shown.frequency}
            onChange={(e) => void save({ frequency: e.target.value as ReminderFrequency })}
            className={selectClass}
          >
            <option value="weekly">Once a week</option>
            <option value="every3days">Every 3 days</option>
          </select>
        </label>
        {shown.frequency === "weekly" && (
          <label className="flex flex-col gap-1 text-sm text-beaver">
            Day
            <select
              value={shown.dayOfWeek}
              onChange={(e) => void save({ dayOfWeek: Number(e.target.value) })}
              className={selectClass}
            >
              {DAY_NAMES.map((name, day) => (
                <option key={day} value={day}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm text-beaver">
          Time
          <select
            value={shown.hour}
            onChange={(e) => void save({ hour: Number(e.target.value) })}
            className={selectClass}
          >
            {HOUR_LABELS.map((label, hour) => (
              <option key={hour} value={hour}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p role="status" aria-live="polite" className="text-sm text-beaver">
        {saved && "Saved. "}
        {next !== null && `Next reminder: ${nextFormatter.format(next)}`}
      </p>
    </div>
  );
}
