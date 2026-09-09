"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Dismissal sticks. A prompt that reappears on every reload is a nag, and not
// nagging is the whole premise of this app.
const DISMISSED_KEY = "loose-change:install-dismissed";

// Storage access throws in some privacy modes. A failure to read shouldn't
// suppress the prompt, and a failure to write shouldn't break dismissing it.
function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberDismissal(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // Non-fatal — it just won't persist past this session.
  }
}

export function InstallPrompt() {
  const pathname = usePathname();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      // Checked here rather than in an effect body: the event is client-only
      // and post-hydration, so there's no server/client mismatch to reconcile
      // and no state to reset.
      if (wasDismissed()) return;
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // Record only. Elsewhere it's a low-value interruption sitting on top of real
  // controls — it used to cover Triage's action grid and the Archive undo
  // toast, both also fixed to the bottom.
  if (pathname !== "/" || !deferredPrompt) return null;

  function dismiss() {
    rememberDismissal();
    setDeferredPrompt(null);
  }

  const handleInstall = async () => {
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 bg-olive px-4 py-3 text-sm text-white">
      <span>Install Loose Change for quicker capture.</span>
      <div className="flex shrink-0 gap-2">
        <button onClick={dismiss} className="opacity-70 hover:opacity-100">
          Not now
        </button>
        <button onClick={handleInstall} className="font-medium text-gold underline">
          Install
        </button>
      </div>
    </div>
  );
}
