"use client";

import { useEffect } from "react";
import { useConvexAuth } from "convex/react";
import { syncPendingCaptures } from "@/lib/syncEngine";

export function OfflineSyncBootstrap() {
  const { isAuthenticated } = useConvexAuth();

  useEffect(() => {
    if (!isAuthenticated) return;

    void syncPendingCaptures();
    window.addEventListener("online", syncPendingCaptures);
    return () => window.removeEventListener("online", syncPendingCaptures);
  }, [isAuthenticated]);

  return null;
}
