"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MicIcon, InboxIcon, LayersIcon, ArchiveIcon, SearchIcon, SettingsIcon } from "@/components/icons";

// Record leads because it's where the app starts. It's in the bar even though
// Record itself doesn't show one: with the per-screen back arrows gone, this is
// the only way back to capture.
const NAV = [
  { href: "/", label: "Record", Icon: MicIcon },
  { href: "/inbox", label: "Inbox", Icon: InboxIcon },
  { href: "/triage", label: "Triage", Icon: LayersIcon },
  { href: "/kept", label: "Archive", Icon: ArchiveIcon },
  { href: "/search", label: "Search", Icon: SearchIcon },
  { href: "/settings", label: "Settings", Icon: SettingsIcon },
] as const;

// Record keeps its single primary action, and the auth/offline pages aren't
// part of the app's navigation at all.
export const hasNavBar = (pathname: string): boolean =>
  pathname !== "/" && NAV.some((item) => item.href === pathname);

/**
 * The same bar, in the same place and order, on every screen but Record.
 * Navigation used to be a row of small icons in the Inbox header only, so
 * Archive → Search took two hops and Triage looked exactly like Settings.
 */
export function AppNav() {
  const pathname = usePathname();
  if (!hasNavBar(pathname)) return null;

  return (
    <>
      {/* Reserves the bar's height at the end of the page, so the last card,
          the pager and Triage's action grid never sit underneath it. */}
      <div aria-hidden className="h-[calc(3.5rem+env(safe-area-inset-bottom))] shrink-0" />
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-olive bg-jungle pb-[env(safe-area-inset-bottom)]"
      >
        <ul className="mx-auto flex max-w-lg">
          {NAV.map(({ href, label, Icon }) => {
            const current = pathname === href;
            return (
              <li key={href} className="flex-1">
                <Link
                  href={href}
                  aria-current={current ? "page" : undefined}
                  // The current screen is marked by the bar above it and a
                  // bolder label as well as colour.
                  className={`flex min-h-14 flex-col items-center justify-center gap-1 border-t-2 ${
                    current
                      ? "border-gold font-semibold text-gold"
                      : "border-transparent text-beaver hover:text-neutral-100"
                  }`}
                >
                  <Icon size={20} />
                  <span className="text-xs leading-none">{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
