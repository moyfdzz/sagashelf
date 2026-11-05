/** The page asked for, from `?page=`: a whole number from 1 to the last one that can be asked for. */
export function pageParam(request: Request, lastPage: number): number {
  const raw = Number(new URL(request.url).searchParams.get("page"));
  return Number.isInteger(raw) && raw >= 1 ? Math.min(raw, lastPage) : 1;
}
