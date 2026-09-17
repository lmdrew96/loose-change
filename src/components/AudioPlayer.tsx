"use client";

import { useEffect, useRef, useState } from "react";
import { PlayIcon, PauseIcon } from "@/components/icons";

// Shared by Triage and the archive/inbox cards. Callers that wrap it in
// pointer-gesture handlers must let it stop propagation — see the comment on
// the wrapper div below.
export function AudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [durationKnown, setDurationKnown] = useState(false);

  // MediaRecorder-produced webm has no duration in its header (the recorder
  // doesn't know the total length while still recording), so Chrome reports
  // audio.duration as Infinity until something forces it to scan to the real
  // end. Seeking near the end does that; the timeupdate that follows carries
  // the now-finite duration, then we rewind to the start.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    function onLoadedMetadata() {
      if (!audio) return;
      if (Number.isFinite(audio.duration)) {
        setDurationKnown(true);
        return;
      }
      audio.currentTime = 1e101;
      const onTimeUpdate = () => {
        audio.removeEventListener("timeupdate", onTimeUpdate);
        audio.currentTime = 0;
        setDurationKnown(Number.isFinite(audio.duration));
      };
      audio.addEventListener("timeupdate", onTimeUpdate);
    }

    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    return () => audio.removeEventListener("loadedmetadata", onLoadedMetadata);
  }, [src]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) audio.pause();
    else void audio.play();
  }

  function onTimeUpdate() {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration === 0) return;
    setProgress(audio.currentTime / audio.duration);
  }

  function onScrub(e: React.ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    const ratio = Number(e.target.value);
    audio.currentTime = ratio * audio.duration;
    setProgress(ratio);
  }

  return (
    // Triage's card wraps this in swipe-to-keep/discard pointer handlers
    // that call setPointerCapture on pointerdown — left unstopped, that
    // hijacks every pointer interaction inside the card, including taps on
    // the play button and drags on the scrubber.
    <div className="mt-3 flex items-center gap-3" onPointerDown={(e) => e.stopPropagation()}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={onTimeUpdate}
        className="hidden"
      />
      <button
        onClick={togglePlay}
        aria-label={playing ? "Pause" : "Play"}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gold text-jungle"
      >
        {playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={progress}
        onChange={onScrub}
        disabled={!durationKnown}
        aria-label="Seek"
        // The native track keeps its thin look while the input itself is a
        // 44px-tall touch target.
        className="h-11 flex-1 cursor-pointer accent-gold disabled:cursor-default disabled:opacity-50"
      />
    </div>
  );
}
