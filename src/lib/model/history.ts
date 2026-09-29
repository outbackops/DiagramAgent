/** Undo/redo history over immutable values (used for diagram models). */

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /** Key and time of the last commit, for coalescing rapid edits (e.g. arrow-key nudges). */
  lastKey?: string;
  lastAt?: number;
}

export const HISTORY_LIMIT = 100;
const COALESCE_MS = 1000;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/**
 * Records `next` as the new present. Commits with the same `coalesceKey`
 * within a second replace the present instead of adding an undo step.
 */
export function commit<T>(history: History<T>, next: T, options: { coalesceKey?: string; now?: number; limit?: number } = {}): History<T> {
  if (Object.is(next, history.present)) return history;
  const now = options.now ?? Date.now();
  const limit = options.limit ?? HISTORY_LIMIT;
  const coalesce =
    options.coalesceKey !== undefined &&
    options.coalesceKey === history.lastKey &&
    history.lastAt !== undefined &&
    now - history.lastAt < COALESCE_MS;
  if (coalesce) {
    return { ...history, present: next, future: [], lastAt: now };
  }
  const past = [...history.past, history.present];
  if (past.length > limit) past.splice(0, past.length - limit);
  return { past, present: next, future: [], lastKey: options.coalesceKey, lastAt: now };
}

export function undo<T>(history: History<T>): History<T> {
  if (history.past.length === 0) return history;
  const past = history.past.slice(0, -1);
  return { past, present: history.past[history.past.length - 1], future: [history.present, ...history.future] };
}

export function redo<T>(history: History<T>): History<T> {
  if (history.future.length === 0) return history;
  const [present, ...future] = history.future;
  return { past: [...history.past, history.present], present, future };
}

/** Replaces the present without an undo step and forgets the history (e.g. loading a saved diagram). */
export function resetHistory<T>(present: T): History<T> {
  return createHistory(present);
}
