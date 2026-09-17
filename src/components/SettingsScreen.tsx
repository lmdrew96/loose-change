"use client";

import { useEffect, useState } from "react";
import { useClerk, useUser } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { StuckCaptures } from "@/components/StuckCaptures";
import { STATUS_LABELS } from "@/lib/labels";
import { getExistingPushSubscription, isPushSupported, subscribeToPush } from "@/lib/push";

export function SettingsScreen() {
  const { isAuthenticated } = useConvexAuth();
  const { signOut } = useClerk();
  const { user } = useUser();
  const getOrCreateMcpToken = useMutation(api.mcpTokens.getOrCreateMcpToken);
  const regenerateMcpToken = useMutation(api.mcpTokens.regenerateMcpToken);
  const [token, setToken] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const stats = useQuery(api.entries.getStats, isAuthenticated ? {} : "skip");
  const vapidPublicKey = useQuery(api.pushData.getVapidPublicKey, isAuthenticated ? {} : "skip");
  const subscribePush = useMutation(api.pushData.subscribe);
  const unsubscribePush = useMutation(api.pushData.unsubscribe);
  // null until the initial support/subscription check resolves — doubles as
  // the "is push even supported" gate for rendering the section at all.
  const [pushEnabled, setPushEnabled] = useState<boolean | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    getOrCreateMcpToken({})
      .then(setToken)
      .catch((err) => {
        console.error("Couldn't load MCP token:", err);
        setTokenError("Couldn't load your MCP URL — reload the page to try again.");
      });
  }, [isAuthenticated, getOrCreateMcpToken]);

  useEffect(() => {
    if (!isPushSupported()) return;
    let cancelled = false;
    getExistingPushSubscription().then((sub) => {
      if (!cancelled) setPushEnabled(sub !== null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const mcpUrl = token && typeof window !== "undefined" ? `${window.location.origin}/${token}/mcp` : null;

  async function handleCopy() {
    if (!mcpUrl) return;
    // Same reasoning as Triage's handoff: writeText can reject, and an
    // unhandled rejection reads as a dead button. The URL is selectable above,
    // so say so rather than leaving the user stuck.
    try {
      await navigator.clipboard.writeText(mcpUrl);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    setTimeout(() => setCopyState("idle"), 3000);
  }

  async function handleRegenerate() {
    setTokenError(null);
    try {
      setToken(await regenerateMcpToken({}));
    } catch (err) {
      console.error("Couldn't regenerate MCP token:", err);
      setTokenError("Couldn't regenerate — your current URL still works. Try again.");
    }
    setConfirmingRegenerate(false);
  }

  async function handleTogglePush() {
    setPushError(null);
    setPushBusy(true);
    try {
      if (pushEnabled) {
        const sub = await getExistingPushSubscription();
        if (sub) {
          await sub.unsubscribe();
          await unsubscribePush({ endpoint: sub.endpoint });
        }
        setPushEnabled(false);
        return;
      }

      if (!vapidPublicKey) {
        setPushError("Not ready yet — try again in a moment.");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushError("Notification permission denied.");
        return;
      }
      const sub = await subscribeToPush(vapidPublicKey);
      const json = sub.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error("Push subscription missing endpoint/keys");
      }
      await subscribePush({ endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth });
      setPushEnabled(true);
    } catch {
      setPushError("Couldn't update reminder notifications.");
    } finally {
      setPushBusy(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col bg-jungle p-6 text-neutral-100">
      <header className="mb-6">
        <h1 className="font-heading text-2xl">Settings</h1>
      </header>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium text-beaver">Account</h2>
        <p className="mb-3 text-sm">{user?.primaryEmailAddress?.emailAddress}</p>
        <button
          onClick={() => signOut({ redirectUrl: "/sign-in" })}
          className="rounded-lg bg-engineering min-h-11 px-4 text-sm text-white"
        >
          Sign out
        </button>
      </section>

      <StuckCaptures />

      {/* The same breakdown lc_get_stats returns. Plain counts, no charts, no
          streaks, no framing about being behind — the README rules those out,
          and the point here is parity with the tool, not a dashboard. */}
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium text-beaver">Your captures</h2>
        {stats === undefined ? (
          <p className="text-sm text-beaver">Loading…</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              {(
                [
                  [STATUS_LABELS.untriaged, stats.untriaged],
                  [STATUS_LABELS.kept, stats.kept],
                  [STATUS_LABELS.promoted, stats.promoted],
                  [STATUS_LABELS.discarded, stats.discarded],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex justify-between">
                  <dt className="text-beaver">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {stats.capped && (
              <p className="mt-2 text-xs text-beaver">
                Counts stop at 500 per status, so any 500 above means 500 or more.
              </p>
            )}
          </>
        )}
      </section>

      {/* Explained up front, so "Audio was cleared" on an old card isn't the
          first you hear of it. */}
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium text-beaver">What happens to your captures</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-beaver">
          <li>Everything in your Inbox stays, audio included, until you triage it.</li>
          <li>Once triaged, a voice memo&rsquo;s audio is kept for 30 days. The transcript stays.</li>
          <li>Discarded captures can be restored from Archive for 30 days, then they&rsquo;re removed.</li>
        </ul>
      </section>

      {pushEnabled !== null && (
        <section className="mb-8">
          <h2 className="mb-2 text-sm font-medium text-beaver">Reminders</h2>
          <p className="mb-3 text-sm text-beaver">
            Once a week, get a notification resurfacing a random idea you&rsquo;ve kept — not a nag about your
            inbox, just a nudge to revisit something you already decided mattered.
          </p>
          <button
            onClick={handleTogglePush}
            disabled={pushBusy}
            className="rounded-lg bg-olive min-h-11 px-4 text-sm text-white disabled:opacity-30"
          >
            {pushEnabled ? "Turn off reminders" : "Turn on reminders"}
          </button>
          {pushError && (
            <p role="status" aria-live="polite" className="mt-2 text-sm text-engineering">
              {pushError}
            </p>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium text-beaver">MCP connection</h2>
        <p className="mb-3 text-sm text-beaver">
          Use this URL to connect your own MCP client (e.g. Claude Code) to your Loose Change entries. Each
          person gets their own — nobody else can use yours without this exact link.
        </p>
        {mcpUrl ? (
          <div className="space-y-2">
            <div className="break-all rounded-lg border border-olive p-3 text-xs">{mcpUrl}</div>
            <div className="flex gap-2">
              <button
                onClick={handleCopy}
                className="rounded-lg bg-gold min-h-11 px-4 text-sm font-medium text-jungle"
              >
                {copyState === "copied" ? "Copied ✓" : "Copy"}
              </button>
              {/* The one action here that can't be undone: every configured
                  MCP client stops working the moment the old token dies. Worth
                  a confirm, unlike Copy or Sign out (which you can just do
                  again). */}
              {confirmingRegenerate ? (
                <>
                  <button
                    onClick={handleRegenerate}
                    className="rounded-lg bg-engineering min-h-11 px-4 text-sm text-white"
                  >
                    Yes, regenerate
                  </button>
                  <button
                    onClick={() => setConfirmingRegenerate(false)}
                    className="rounded-lg min-h-11 px-4 text-sm text-beaver hover:text-neutral-100"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setConfirmingRegenerate(true)}
                  className="rounded-lg bg-olive min-h-11 px-4 text-sm text-white"
                >
                  Regenerate
                </button>
              )}
            </div>
            {confirmingRegenerate && (
              <p className="text-sm text-beaver">
                This replaces your URL. Any MCP client using the old one stops working until you paste
                the new URL in.
              </p>
            )}
            {/* A button isn't a live region — announce from a sibling so a
                screen reader hears the outcome, not a relabelled control. */}
            <p role="status" aria-live="polite" className="min-h-5 text-sm text-beaver">
              {copyState === "copied" && "Copied to clipboard."}
              {copyState === "failed" && "Couldn't copy — select the URL above and copy it manually."}
              {tokenError}
            </p>
          </div>
        ) : (
          <p className="text-sm text-beaver">{tokenError ?? "Loading…"}</p>
        )}
      </section>
    </main>
  );
}
