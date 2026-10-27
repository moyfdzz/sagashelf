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
