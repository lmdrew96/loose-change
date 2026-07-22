export default function OfflinePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-2 bg-jungle p-8 text-center text-neutral-100">
      <h1 className="text-xl font-semibold">You&rsquo;re offline</h1>
      <p className="text-sm text-beaver">
        Voice and text capture still work — entries save locally and sync once you&rsquo;re back online.
      </p>
    </main>
  );
}
