/**
 * The initial of a person for the circle shown when there is no picture (SAG-39). The circle uses
 * the accent color of the app, whose pair with `accent-fg` has its contrast tested in both themes
 * (`app/palette.test.ts`).
 */
export function avatarInitial(username: string): string {
  const name = username.trim();
  // The first whole character as a person sees it (an emoji with joiners is one), and capitals
  // that do not depend on the language of the device.
  const first = new Intl.Segmenter().segment(name)[Symbol.iterator]().next();
  return (first.done ? "" : first.value.segment).toUpperCase();
}

/** Whether the circle has an initial to show: the one rule for the button and the circle. */
export function hasInitial(username: string | null | undefined): boolean {
  return avatarInitial(username ?? "") !== "";
}
