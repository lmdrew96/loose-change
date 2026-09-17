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

// Hourly, because each device picks its own day, hour and timezone. The
// action decides who's due (reminderSchedule.ts), so the cron itself carries
// no schedule.
crons.hourly("send reminder notifications", { minuteUTC: 0 }, internal.push.sendReminders);

export default crons;
