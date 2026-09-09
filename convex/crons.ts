import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "delete expired audio",
  { hourUTC: 8, minuteUTC: 0 },
  internal.retention.deleteExpiredAudio,
);

crons.daily(
  "purge expired discards",
  { hourUTC: 8, minuteUTC: 15 },
  internal.retention.purgeExpiredDiscards,
);

crons.weekly(
  "send reminder notifications",
  { dayOfWeek: "sunday", hourUTC: 16, minuteUTC: 0 },
  internal.push.sendReminders,
);

export default crons;
