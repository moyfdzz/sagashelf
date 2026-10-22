export const themes = ["light", "dark"] as const;
export type Theme = (typeof themes)[number];

const cookieName = "theme";
const oneYear = 60 * 60 * 24 * 365;

/** The mode the person chose with the switch, or null when they have not chosen one. */
export function readTheme(cookieHeader: string | null): Theme | null {
  for (const part of (cookieHeader ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== cookieName) continue;
    const value = rest.join("=");
    return themes.find((theme) => theme === value) ?? null;
  }
  return null;
}

/** What the page shows: the person's choice, else the system setting, else light. */
export function effectiveTheme(
  saved: Theme | null,
  systemDark: boolean,
): Theme {
  return saved ?? (systemDark ? "dark" : "light");
}

export function oppositeTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}

/**
 * The cookie that keeps the choice, in the form `document.cookie` takes. A preference and not
 * tracking, like the language cookie. `Secure` is added on https, which is every real visit.
 */
export function themeCookie(theme: Theme, secure: boolean): string {
  return `${cookieName}=${theme}; Path=/; Max-Age=${oneYear}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** Shows the mode now, and keeps the choice so the server draws the same mode next time. */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.cookie = themeCookie(theme, window.location.protocol === "https:");
}
