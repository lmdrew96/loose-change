import Link from "next/link";

export default function OfflinePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 bg-jungle p-8 text-center text-neutral-100">
      <h1 className="text-xl font-semibold">You&rsquo;re offline</h1>
      <p className="max-w-sm text-sm text-beaver">
        Recording still works. Voice and text captures save to this device and sync on their own once
        you&rsquo;re back online.
      </p>
      <p className="max-w-sm text-sm text-beaver">
        Your inbox, archive and search need a connection, so those are unavailable until then.
      </p>
      <Link href="/" className="mt-2 rounded-lg bg-gold px-4 py-2 text-sm font-medium text-jungle">
        Go to Record
      </Link>
    </main>
  );
}
