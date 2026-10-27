import {
  defaultLibraryView,
  libraryViewCookie,
  libraryViews,
  type LibraryView,
} from "./schema";

/** The way the person drew the library the last time, from the Cookie header. */
export function readViewCookie(request: Request): LibraryView | undefined {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === libraryViewCookie) {
      const found = value.join("=");
      return libraryViews.find((view) => view === found);
    }
  }
  return undefined;
}

/** What the page shows: the one in the address, else the one remembered, else covers. */
export const chooseView = (
  fromAddress: LibraryView | undefined,
  remembered: LibraryView | undefined,
): LibraryView => fromAddress ?? remembered ?? defaultLibraryView;

/**
 * A preference cookie, like the language one: it remembers how the library is drawn and nothing
 * else. The address wins when it names a view, and then the cookie is updated to match.
 */
export function viewCookieHeader(view: LibraryView, secure: boolean): string {
  return [
    `${libraryViewCookie}=${view}`,
    "Path=/",
    "SameSite=Lax",
    "HttpOnly",
    `Max-Age=${60 * 60 * 24 * 365}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}
