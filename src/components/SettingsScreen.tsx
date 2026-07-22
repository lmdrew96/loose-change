"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useClerk, useUser } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { ArrowLeftIcon } from "@/components/icons";
import { getExistingPushSubscription, isPushSupported, subscribeToPush } from "@/lib/push";

export function SettingsScreen() {
  const { isAuthenticated } = useConvexAuth();
  const { signOut } = useClerk();
  const { user } = useUser();
  const getOrCreateMcpToken = useMutation(api.mcpTokens.getOrCreateMcpToken);
  const regenerateMcpToken = useMutation(api.mcpTokens.regenerateMcpToken);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
    getOrCreateMcpToken({}).then(setToken);
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
    await navigator.clipboard.writeText(mcpUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleRegenerate() {
    const newToken = await regenerateMcpToken({});
    setToken(newToken);
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
      <header className="mb-6 flex items-center gap-3">
        <Link href="/inbox" aria-label="Back to inbox" className="rounded-full p-2 text-beaver hover:text-gold">
          <ArrowLeftIcon />
        </Link>
        <h1 className="font-heading text-2xl">Settings</h1>
      </header>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium text-beaver">Account</h2>
        <p className="mb-3 text-sm">{user?.primaryEmailAddress?.emailAddress}</p>
        <button
          onClick={() => signOut({ redirectUrl: "/sign-in" })}
          className="rounded-lg bg-engineering px-4 py-2 text-sm text-white"
        >
          Sign out
        </button>
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
            className="rounded-lg bg-olive px-4 py-2 text-sm text-white disabled:opacity-30"
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
                role="status"
                aria-live="polite"
                className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-jungle"
              >
                {copied ? "Copied ✓" : "Copy"}
              </button>
              <button onClick={handleRegenerate} className="rounded-lg bg-olive px-4 py-2 text-sm text-white">
                Regenerate
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-beaver">Loading…</p>
        )}
      </section>
    </main>
  );
}
