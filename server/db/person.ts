/**
 * A person as a list of people shows them: enough to draw a name and a picture and to link to the
 * profile. Shared by the lists around a profile and the lists of blocked and muted people (SAG-118).
 */
export type Person = {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

export const text = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

export const toPerson = (row: Record<string, unknown>): Person => ({
  username: String(row.username),
  displayName: text(row.display_name),
  avatarUrl: text(row.avatar_url),
});
