"use client";

import { useEffect } from "react";
import { useConvexAuth } from "convex/react";
import { salvageOrphanedRecordings } from "@/lib/offlineQueue";
import { syncPendingCaptures } from "@/lib/syncEngine";

export function OfflineSyncBootstrap() {
  const { isAuthenticated } = useConvexAuth();

  useEffect(() => {
    if (!isAuthenticated) return;

    // Salvage any recording orphaned by the app being killed mid-capture
    // before triggering the normal sync pass, so a salvaged recording gets
    // picked up immediately rather than waiting for the next sync trigger.
    let cancelled = false;
    void salvageOrphanedRecordings().then(() => {
      if (!cancelled) void syncPendingCaptures();
    });
    window.addEventListener("online", syncPendingCaptures);
    return () => {
      cancelled = true;
      window.removeEventListener("online", syncPendingCaptures);
    };
  }, [isAuthenticated]);

  return null;
}
