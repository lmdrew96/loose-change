import { describe, expect, test } from "vitest";
import { createSerialQueue } from "./serialQueue";

// Lets queued work start: enqueue schedules onto a microtask, so nothing has
// run synchronously by the time the call returns.
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const defer = () => {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("createSerialQueue", () => {
  test("runs operations in call order, never overlapping", async () => {
    const enqueue = createSerialQueue();
    const events: string[] = [];
    const first = defer();

    // Enqueued first but resolves last — the second op must still wait.
    const a = enqueue(async () => {
      events.push("a:start");
      await first.promise;
      events.push("a:end");
    });
    const b = enqueue(async () => {
      events.push("b:start");
    });

    await flush();
    expect(events).toEqual(["a:start"]);
    first.resolve();
    await Promise.all([a, b]);
    expect(events).toEqual(["a:start", "a:end", "b:start"]);
  });

  test("a rejected operation does not poison the queue", async () => {
    const enqueue = createSerialQueue();
    const ran: string[] = [];

    const failing = enqueue(async () => {
      ran.push("failing");
      throw new Error("write failed");
    });
    await expect(failing).rejects.toThrow("write failed");

    // This is the regression that matters: chaining onto the rejected promise
    // would short-circuit every later op, so a recording would silently stop
    // persisting chunks from the first failed write onward.
    await enqueue(async () => {
      ran.push("after");
    });
    expect(ran).toEqual(["failing", "after"]);
  });

  test("the caller of a failing operation still sees its error", async () => {
    const enqueue = createSerialQueue();
    await expect(enqueue(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
  });

  test("ordering survives a failure mid-queue", async () => {
    const enqueue = createSerialQueue();
    const ran: string[] = [];

    const results = await Promise.allSettled([
      enqueue(async () => { ran.push("one"); }),
      enqueue(async () => { ran.push("two"); throw new Error("nope"); }),
      enqueue(async () => { ran.push("three"); }),
    ]);

    expect(ran).toEqual(["one", "two", "three"]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  });
});
