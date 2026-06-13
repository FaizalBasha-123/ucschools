import { useMemo } from 'react';
import type { ImageElementFilters } from '@/lib/types/slides';

/**
 * Calculate CSS filter string from image filters array
 * @param filters Array of image filters
 */
export function useFilter(filters?: ImageElementFilters) {
  const filter = useMemo(() => {
    if (!filters) return '';
    let filterStr = '';
    for (const [key, value] of Object.entries(filters)) {
      filterStr += `${key}(${value}) `;
    }
    return filterStr.trim();
  }, [filters]);

  return {
    filter,
  };
}
