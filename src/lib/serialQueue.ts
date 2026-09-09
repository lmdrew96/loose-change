/**
 * Runs async operations strictly in call order, one at a time.
 *
 * Used for in-progress recording writes: without serialization a chunk could
 * try to append before the record it belongs to exists, or two concurrent
 * read-modify-writes on the same record could race and silently drop a chunk.
 */
export function createSerialQueue(): (op: () => Promise<void>) => Promise<void> {
  let tail: Promise<unknown> = Promise.resolve();

  return (op) => {
    const result = tail.then(op);
    // The queue continues from a SETTLED tail, not a fulfilled one. Chaining
    // straight onto `result` would mean a single rejected write poisons the
    // queue forever — every later .then(op) would short-circuit without
    // running, so an audio recording would silently stop persisting chunks
    // from the first failed write onward. Callers still see their own
    // rejection; only the queue recovers.
    tail = result.catch(() => {});
    return result;
  };
}
