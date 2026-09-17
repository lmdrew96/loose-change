"use client";

import { useEffect, useSyncExternalStore } from "react";

// ── Eyes-off confirmation ────────────────────────────────────────────────────
// The README's headline scenario is recording while driving, where the screen
// can't be checked. Everything here is best-effort: an unsupported browser
// (iOS Safari has no vibrate) just gets no feedback, never an error.

export function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(pattern);
  } catch {
    // Some browsers throw without a recent user gesture. Nothing to do.
  }
}

export const START_VIBRATION = 60;
export const STOP_VIBRATION = [60, 80, 60];

/**
 * Keeps the screen awake while `active`. A phone that auto-locks in a cradle
 * may pause or end the recording. The browser drops the lock whenever the
 * page is hidden, so it's re-requested when the page is visible again.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    async function acquire() {
      if (document.visibilityState !== "visible" || (sentinel && !sentinel.released)) return;
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (cancelled) void lock.release();
        else sentinel = lock;
      } catch (err) {
        // Battery saver or a permissions policy can refuse it. Recording still
        // works; the screen may just lock on its own.
        console.warn("Screen wake lock unavailable:", err);
      }
    }

    void acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", acquire);
      if (sentinel && !sentinel.released) void sentinel.release();
    };
  }, [active]);
}

// ── Optional start/stop tone ────────────────────────────────────────────────
// Off by default: an unexpected sound is a sensory surprise, so it's opt-in
// and remembered per device.

const TONES_KEY = "loose-change:record-tones";
const TONES_EVENT = "loose-change:record-tones-changed";

function readTonesEnabled(): boolean {
  try {
    return localStorage.getItem(TONES_KEY) === "1";
  } catch {
    return false;
  }
}

export function setTonesEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(TONES_KEY, "1");
    else localStorage.removeItem(TONES_KEY);
  } catch {
    // Can't persist in this browser mode; the toggle just won't stick.
  }
  window.dispatchEvent(new Event(TONES_EVENT));
}

function subscribeTones(onChange: () => void): () => void {
  window.addEventListener(TONES_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(TONES_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useTonesEnabled(): boolean {
  return useSyncExternalStore(subscribeTones, readTonesEnabled, () => false);
}

let audioContext: AudioContext | null = null;

// Created on the Start tap (a user gesture), so the Stop tone can play later
// from an async callback without being blocked by autoplay rules.
export function primeTones(): void {
  if (!readTonesEnabled() || typeof AudioContext === "undefined") return;
  try {
    audioContext ??= new AudioContext();
    if (audioContext.state === "suspended") void audioContext.resume();
  } catch (err) {
    console.warn("Couldn't set up recording tones:", err);
  }
}

function beep(ctx: AudioContext, at: number, frequency: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = frequency;
  // A short ramp avoids the click of a hard start and stop.
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(0.15, at + 0.01);
  gain.gain.linearRampToValueAtTime(0, at + 0.12);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + 0.13);
}

/** One rising beep for start, two falling beeps for stop. */
export function playTone(kind: "start" | "stop"): void {
  if (!readTonesEnabled() || !audioContext) return;
  try {
    const now = audioContext.currentTime;
    if (kind === "start") {
      beep(audioContext, now, 880);
    } else {
      beep(audioContext, now, 660);
      beep(audioContext, now + 0.18, 520);
    }
  } catch (err) {
    console.warn("Couldn't play recording tone:", err);
  }
}
