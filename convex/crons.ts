import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "delete expired audio",
  { hourUTC: 8, minuteUTC: 0 },
  internal.retention.deleteExpiredAudio,
);

export default crons;
