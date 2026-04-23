import { useMemo } from 'react';

/**
 * Filters a data array by the current sheet.
 * Returns unfiltered data when currentSheet is 'All Sheets'.
 */
export function useSheetFiltered<T>(
  data: T[],
  currentSheet: string,
  getSheet: (item: T) => string | null,
): T[] {
  return useMemo(() => {
    if (currentSheet === 'All Sheets') return data;
    return data.filter((item) => getSheet(item) === currentSheet);
  }, [data, currentSheet, getSheet]);
}
