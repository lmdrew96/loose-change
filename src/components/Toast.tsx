"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { hasNavBar } from "@/components/AppNav";

export type ToastOptions = {
  message: string;
  action?: { label: string; onClick: () => void };
  // Leaves the app, e.g. "Open ControlledChaos" after a Send.
  link?: { label: string; href: string };
  durationMs?: number;
};

type ActiveToast = ToastOptions & { id: number };

const DEFAULT_DURATION_MS = 4000;

const ToastContext = createContext<(toast: ToastOptions) => void>(() => {});

/**
 * One toast at a time, app-wide. A new toast replaces the current one rather
 * than stacking — two screens' worth of fixed-position toasts used to land on
 * top of each other (Triage's discard and copied toasts shared bottom-24).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [toast, setToast] = useState<ActiveToast | null>(null);
  const nextId = useRef(0);

  const show = useCallback((options: ToastOptions) => {
    nextId.current += 1;
    setToast({ ...options, id: nextId.current });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(
      () => setToast((current) => (current?.id === toast.id ? null : current)),
      toast.durationMs ?? DEFAULT_DURATION_MS,
    );
    return () => clearTimeout(timer);
  }, [toast]);

  // Sits just above the nav bar where there is one.
  const position = hasNavBar(pathname) ? "bottom-[calc(4.5rem+env(safe-area-inset-bottom))]" : "bottom-6";

  return (
    <ToastContext.Provider value={show}>
      {children}
      {/* The live region stays mounted so the announcement fires when its
          content changes; a region inserted along with its text often isn't
          read at all. */}
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4 ${position}`}
      >
        {toast && (
          <div className="pointer-events-auto flex max-w-md flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-2xl bg-olive px-4 py-2 text-sm text-white shadow-lg">
            <span>{toast.message}</span>
            {toast.link && (
              <a
                href={toast.link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center font-medium text-gold underline"
              >
                {toast.link.label}
              </a>
            )}
            {toast.action && (
              <button
                onClick={() => {
                  const { onClick } = toast.action!;
                  setToast(null);
                  onClick();
                }}
                className="min-h-11 font-medium text-gold underline"
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): (toast: ToastOptions) => void {
  return useContext(ToastContext);
}

export type ActionResult<T> = { ok: true; value: T } | { ok: false };

/**
 * Runs a mutation and, if it rejects, says so in a toast naming the action.
 * A bare `void mutation()` turns a rejection into a button that just looks
 * dead — and a Keep that silently didn't register resurfaces later with no
 * explanation.
 */
export function useRunAction(): <T>(failureMessage: string, fn: () => Promise<T>) => Promise<ActionResult<T>> {
  const showToast = useToast();
  return useCallback(
    async <T,>(failureMessage: string, fn: () => Promise<T>): Promise<ActionResult<T>> => {
      try {
        return { ok: true, value: await fn() };
      } catch (err) {
        console.error(failureMessage, err);
        showToast({ message: failureMessage });
        return { ok: false };
      }
    },
    [showToast],
  );
}
