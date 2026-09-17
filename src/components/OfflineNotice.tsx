"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * Convex queries just stay undefined while the websocket is reconnecting, so
 * without this every data screen sat on "Loading…" offline with no reason
 * given. Record is excluded: capture works offline and has its own sync
 * status.
 */
export function OfflineNotice() {
  const pathname = usePathname();
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );

  if (online || pathname === "/") return null;

  return (
    <div role="status" className="bg-olive px-4 py-2 text-center text-sm text-white">
      You&rsquo;re offline — your inbox and archive will load when you reconnect. Recording still works.
    </div>
  );
}
