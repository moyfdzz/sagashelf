/**
 * Where to send a visitor who has no session, and where to bring them back to afterwards.
 *
 * React Router asks for the data of a page with its own request: `/settings/profile.data`
 * (and `/_root.data` for the home page), with a `_routes` parameter. That URL is not a page, so
 * the way back must be the page itself. The way back is always a path on this site.
 */
export function signInPath(requestUrl: string): string {
  const url = new URL(requestUrl);

  let path = url.pathname.replace(/\.data$/, "");
  if (path === "/_root" || path === "") path = "/";
  // Two slashes or a backslash at the start would read as another site.
  if (!/^\/(?![/\\])/.test(path)) path = "/";

  const params = new URLSearchParams(url.search);
  params.delete("_routes");
  const search = params.size > 0 ? `?${params.toString()}` : "";

  return `/sign-in?redirectTo=${encodeURIComponent(path + search)}`;
}
