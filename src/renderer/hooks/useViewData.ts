import { useEffect, useRef } from 'react';

/**
 * Standard data-loading hook for views.
 *
 * Replaces the twin-useEffect pattern duplicated across Transactions,
 * Activities, Dashboard, and Reports views:
 *   1. On mount: call a list of store loaders (sheets, categories, planned, etc.)
 *   2. On currentSheet change: reload primary data scoped to that sheet
 *
 * All loader functions come from Zustand stores and are referentially stable,
 * so the mount effect runs exactly once.
 */
export function useViewData(
  mountLoaders: (() => void | Promise<void>)[],
  loadAll: (sheet?: string) => void | Promise<void>,
  currentSheet: string,
): void {
  const loadersRef = useRef(mountLoaders);

  useEffect(() => {
    for (const fn of loadersRef.current) fn();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadAll(currentSheet === 'All Sheets' ? undefined : currentSheet);
  }, [currentSheet, loadAll]);
}
