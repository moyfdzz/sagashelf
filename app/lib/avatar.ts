/**
 * The initial of a person for the circle shown when there is no picture (SAG-39). The circle uses
 * the accent color of the app, whose pair with `accent-fg` has its contrast tested in both themes
 * (`app/palette.test.ts`).
 */
export function avatarInitial(username: string): string {
  const [first = ""] = Array.from(username.trim());
  return first.toLocaleUpperCase();
}
