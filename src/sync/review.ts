import type { SyncChoice, SyncConflict } from './webdav.ts';

// A lock/cancel rejects a pending review immediately, even while no request is in flight.
export function reviewSyncConflicts(
  signal: AbortSignal,
  present: (complete: (choices: readonly SyncChoice[]) => void) => () => void,
): Promise<readonly SyncChoice[]> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let dismiss = () => {};
    const cleanup = () => { signal.removeEventListener('abort', cancel); dismiss(); };
    const cancel = () => { settled = true; cleanup(); reject(new Error('WebDAV sync cancelled.')); };
    if (signal.aborted) { cancel(); return; }
    signal.addEventListener('abort', cancel, { once: true });
    try {
      dismiss = present((choices) => { if (settled) return; settled = true; cleanup(); resolve(choices); });
      if (settled) dismiss();
    } catch (error) {
      settled = true;
      cleanup();
      reject(error);
    }
  });
}

export interface SyncReview {
  conflicts: readonly SyncConflict[];
  complete: (choices: readonly SyncChoice[]) => void;
}
