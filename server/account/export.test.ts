import { describe, expect, it } from "vitest";

import { profileCsv, type AccountExport } from "./export";

const base: AccountExport = {
  schemaVersion: 1,
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
          timesWatched: 2,
          source: { provider: "tmdb", id: "tv/1429" },
          viewings: [
            {
              startedOn: "2025-05-01",
              finishedOn: "2025-05-03",
              notes: "En el cine, con coma",
            },
            { startedOn: null, finishedOn: null, notes: null },
          ],
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
          timesWatched: 0,
          source: null,
          viewings: [],
          notes: null,
          visibility: "public",
          createdAt: new Date("2026-03-04T10:00:00Z"),
        },
        {
          title: "Dune",
          status: "in_progress",
          progress: 120,
          progressUnit: "pages",
          progressTotal: 320,
          score: null,
          startedAt: null,
          finishedAt: null,
          timesWatched: 0,
          source: null,
          viewings: [],
          notes: null,
          visibility: "private",
          createdAt: new Date("2026-04-05T10:00:00Z"),
        },
      ],
    });

    const rows = lines(csv);
    const at = rows.indexOf("");
    expect(rows.slice(at + 1)).toEqual([
      "title,status,progress,progress_unit,progress_total,score,started_at,finished_at,times_watched,notes,visibility,added_at,provider,external_id",
      'Ataque a los Titanes,completed,25,,,9,2026-01-02,2026-02-03,2,"Muy buena, con coma",private,2026-01-01,tmdb,tv/1429',
      "Matrix,planned,0,,,,,,0,,public,2026-03-04,,",
      "Dune,in_progress,120,pages,320,,,,0,,private,2026-04-05,,",
      "",
      "title,started_on,finished_on,notes",
      'Ataque a los Titanes,2025-05-01,2025-05-03,"En el cine, con coma"',
      "Ataque a los Titanes,,,",
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
          timesWatched: 0,
          viewings: [{ startedOn: null, finishedOn: null, notes: "=2+2" }],
          notes: "@SUM(A1)",
          visibility: "private",
          createdAt: new Date("2026-03-04T10:00:00Z"),
        },
      ],
    });

    expect(csv).toContain('bio,"\'=HYPERLINK(""http://evil"")"');
    expect(csv).toContain("'=1+1,planned");
    expect(csv).toContain("'@SUM(A1)");
    expect(csv).toContain("'=2+2");
    expect(csv).not.toMatch(/(^|,)[=@]/m);
  });
});
