import { useEffect, useRef } from 'react';

let preparing = false;
const flushers = new Set<() => Promise<void>>();
export function isPreparingUpdate(): boolean { return preparing; }
export function setPreparingUpdate(value: boolean): void { preparing = value; }

export function useUpdateFlusher(flush: () => Promise<void>): void {
  const latest = useRef(flush);
  latest.current = flush;
  useEffect(() => {
    const save = () => latest.current();
    flushers.add(save);
    return () => { flushers.delete(save); };
  }, []);
}

export async function flushUpdateWork(): Promise<void> {
  for (const flush of flushers) await flush();
}

const guards = new Set<() => string | null>();

/** Protect form state that has not reached IPC yet (including incomplete drafts). */
export function useUpdateGuard(guard: () => string | null): void {
  const latest = useRef(guard);
  latest.current = guard;
  useEffect(() => {
    const check = () => latest.current();
    guards.add(check);
    return () => { guards.delete(check); };
  }, []);
}

export function updateBlocker(includeGuards = true): string | null {
  if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"]')) {
    return 'Finish or close the open dialog before continuing.';
  }
  for (const check of includeGuards ? guards : []) {
    const reason = check();
    if (reason) return reason;
  }
  return null;
}
