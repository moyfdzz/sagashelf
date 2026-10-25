import { describe, expect, it } from "vitest";

import { profileCsv, type AccountExport } from "./export";

const base: AccountExport = {
  exportedAt: "2026-10-25T12:00:00.000Z",
  profile: {
    username: "ana",
    displayName: "Ana",
    avatarUrl: null,
    bio: null,
    locale: "es",
    privacy: "private",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  libraryEntries: [],
  customEntries: [],
  lists: [],
};

const lines = (csv: string) => csv.split("\r\n");

describe("profileCsv", () => {
  it("is only the profile when there is no library", () => {
    const csv = profileCsv(base);

    expect(lines(csv)).toEqual([
      "field,value",
      "username,ana",
      "display_name,Ana",
      "avatar_url,",
      "bio,",
      "language,es",
      "privacy,private",
      "created_at,2026-01-01T00:00:00.000Z",
      "",
    ]);
  });

  it("adds the library below the profile as a table with its own header", () => {
    const csv = profileCsv({
      ...base,
      libraryEntries: [
        {
          title: "Ataque a los Titanes",
          status: "completed",
          progress: 25,
          score: 9,
          startedAt: "2026-01-02",
          finishedAt: "2026-02-03",
          rewatchCount: 1,
          notes: "Muy buena, con coma",
          visibility: "private",
          createdAt: new Date("2026-01-01T10:00:00Z"),
        },
        {
          title: "Matrix",
          status: "planned",
          progress: 0,
          score: null,
          startedAt: null,
          finishedAt: null,
          rewatchCount: 0,
          notes: null,
          visibility: "public",
          createdAt: new Date("2026-03-04T10:00:00Z"),
        },
      ],
    });

    const rows = lines(csv);
    const at = rows.indexOf("");
    expect(rows.slice(at + 1)).toEqual([
      "title,status,progress,score,started_at,finished_at,times_watched_again,notes,visibility,added_at",
      'Ataque a los Titanes,completed,25,9,2026-01-02,2026-02-03,1,"Muy buena, con coma",private,2026-01-01',
      "Matrix,planned,0,,,,0,,public,2026-03-04",
      "",
    ]);
  });

  it("keeps a title or a note that starts like a formula from running in a spreadsheet", () => {
    const csv = profileCsv({
      ...base,
      profile: { ...base.profile, bio: '=HYPERLINK("http://evil")' },
      libraryEntries: [
        {
          title: "=1+1",
          status: "planned",
          progress: 0,
          score: null,
          startedAt: null,
          finishedAt: null,
          rewatchCount: 0,
          notes: "@SUM(A1)",
          visibility: "private",
          createdAt: new Date("2026-03-04T10:00:00Z"),
        },
      ],
    });

    expect(csv).toContain('bio,"\'=HYPERLINK(""http://evil"")"');
    expect(csv).toContain("'=1+1,planned");
    expect(csv).toContain("'@SUM(A1)");
    expect(csv).not.toMatch(/(^|,)[=@]/m);
  });
});
