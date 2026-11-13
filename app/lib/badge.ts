/**
 * The count the header draws over a button (SAG-263): the number as it is, and "99+" from 100 up, so
 * the circle never grows. The header and the bell both use it.
 */
export function cappedCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}
