/** How many characters of a note the popover shows before "see the whole note". */
export const notesPreviewLength = 200;

/**
 * The start of a note for the popover. It counts characters, as the database does (an emoji is
 * one, not two), and never cuts through one. `truncated` says whether there is more to read.
 */
export function previewNotes(
  notes: string,
  max = notesPreviewLength,
): { text: string; truncated: boolean } {
  const characters = [...notes];
  if (characters.length <= max) return { text: notes, truncated: false };
  return {
    text: `${characters.slice(0, max).join("").trimEnd()}…`,
    truncated: true,
  };
}

/** How many characters a text has, as the database counts them: an emoji is one. */
export const countCharacters = (text: string) => [...text].length;

export type LimitState = "ok" | "near" | "full" | "over";

/** Where the count of a field stands against its limit: "near" starts at 90%. */
export function limitState(count: number, max: number): LimitState {
  if (count > max) return "over";
  if (count === max) return "full";
  return count >= max * 0.9 ? "near" : "ok";
}

/**
 * How far to move a panel that hangs from an icon, to the right (or to the left, if negative), so
 * it stays `margin` pixels inside the screen. It starts aligned to the left of the icon; if that
 * would run past the right edge it slides left just enough, and a panel as wide as the screen
 * allows ends up centered between the margins.
 */
export function panelOffset({
  iconLeft,
  panelWidth,
  viewportWidth,
  margin = 16,
}: {
  iconLeft: number;
  panelWidth: number;
  viewportWidth: number;
  margin?: number;
}): number {
  const farthestLeft = viewportWidth - margin - panelWidth;
  const left = Math.max(margin, Math.min(iconLeft, farthestLeft));
  return left - iconLeft;
}
