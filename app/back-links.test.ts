import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Every link that goes back is the `BackLink` component, with its arrow icon (SAG-156). This reads
// the text of the code, so it catches the usual way of getting this wrong: an `<a>` or a `<Link>`
// written by hand around a text whose key says "back".

const component = "app/components/BackLink.tsx";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name).replace(/\\/g, "/");
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)
      ? [path]
      : [];
  });
}

// An anchor or a router link whose content starts with a text like `t("lists.detail.back")` or
// `t("media.backToSearch")`.
const handWrittenBackLink =
  /<(?:a|Link)\b[^>]*>\s*\{t\(\s*["'`][\w.]*\.back\w*["'`]/;

describe("the links that go back (SAG-156)", () => {
  it.each(["es", "en"])("has no written arrow in the %s texts", (language) => {
    const text = readFileSync(`app/locales/${language}.json`, "utf8");
    expect(text).not.toContain("←");
  });

  it("draws every one with the BackLink component and not by hand", () => {
    const offenders = sourceFiles("app").filter(
      (path) =>
        path !== component &&
        handWrittenBackLink.test(readFileSync(path, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("recognises a back link written by hand", () => {
    const sample = `<a href="/lists" className={linkClass}>\n  {t("lists.detail.back")}\n</a>`;
    expect(handWrittenBackLink.test(sample)).toBe(true);
    expect(
      handWrittenBackLink.test(
        `<Link to="/x" className={a}>{t("media.backToEntry")}</Link>`,
      ),
    ).toBe(true);
    expect(
      handWrittenBackLink.test(`<a href="/x">{t("lists.detail.title")}</a>`),
    ).toBe(false);
  });
});
