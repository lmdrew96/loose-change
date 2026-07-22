"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useClerk, useUser } from "@clerk/nextjs";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { ArrowLeftIcon } from "@/components/icons";

export function SettingsScreen() {
  const { isAuthenticated } = useConvexAuth();
  const { signOut } = useClerk();
  const { user } = useUser();
  const getOrCreateMcpToken = useMutation(api.mcpTokens.getOrCreateMcpToken);
  const regenerateMcpToken = useMutation(api.mcpTokens.regenerateMcpToken);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    getOrCreateMcpToken({}).then(setToken);
  }, [isAuthenticated, getOrCreateMcpToken]);

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
              <button onClick={handleCopy} className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-jungle">
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
