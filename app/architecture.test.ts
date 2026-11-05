import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The design rules of ADR-033, written as checks. Each rule has a list of the files that still
// break it. The list may only shrink: a new file that breaks a rule fails, and so does a file
// that was fixed but is still listed, so the list is emptied as the tickets land.

const roots = ["app", "server", "workers"];

const isTest = (path: string) =>
  /\.(test|integration\.test)\.tsx?$/.test(path) || path.includes("/testing/");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name).replace(/\\/g, "/");
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !isTest(path) ? [path] : [];
  });
}

const files = roots.flatMap(sourceFiles);
const read = (path: string) => readFileSync(path, "utf8");

// What the logs may hold (SAG-134, ADR-006). An error can carry the values of a failed statement
// in its message, so a `console` call is given the name of an error, never the error, its message
// or its stack. This reads the text of the code and not its syntax, so it catches the usual
// ways of getting this wrong and not every one.
const errorNames = "error|err|e|cause|reason|exception";
const unsafeArgument = [
  new RegExp(`^(${errorNames})$`),
  new RegExp(`\\b(${errorNames})\\.(message|stack|cause)\\b`),
  new RegExp(`String\\(\\s*(${errorNames})\\s*\\)`),
  new RegExp(`\\$\\{\\s*(${errorNames})\\s*\\}`),
];

/** The text between the parentheses of the call that opens at `open`. */
function textOfCall(source: string, open: number): string | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < source.length; i++) {
    const char = source[i] ?? "";
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if ("([{".includes(char)) depth++;
    else if (")]}".includes(char)) {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

/** The arguments of a call, split at the commas that are not inside a bracket or a string. */
function splitArguments(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i] ?? "";
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if ("([{".includes(char)) depth++;
    else if (")]}".includes(char)) depth--;
    else if (char === "," && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

/** The `console` calls in a source that are given an error, or what it says, to write. */
function unsafeConsoleCalls(source: string): string[] {
  const found: string[] = [];
  for (const call of source.matchAll(
    /console\.(log|error|warn|info|debug)\(/g,
  )) {
    const text = textOfCall(source, call.index + call[0].length - 1);
    if (text === null) continue;
    if (
      splitArguments(text).some((argument) =>
        unsafeArgument.some((pattern) => pattern.test(argument)),
      )
    ) {
      found.push(call[0] + text + ")");
    }
  }
  for (const handed of source.matchAll(/\.catch\(\s*console\.\w+/g)) {
    found.push(handed[0]);
  }
  return found;
}

/** Fails for a file that breaks the rule and is not listed, or is listed and no longer breaks it. */
function checkRule(
  breaks: (path: string) => boolean,
  allowed: readonly string[],
) {
  const broken = files.filter(breaks).sort();
  const expected = [...allowed].sort();
  return {
    unlisted: broken.filter((path) => !expected.includes(path)),
    stale: expected.filter((path) => !broken.includes(path)),
  };
}

// The limit of ADR-033. SAG-121 split the last three files that were over it, so the list of
// those still to split is empty: a file over the limit now fails at once.
const maxLines = 600;

describe("the design rules of ADR-033", () => {
  it("finds the source files it checks", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain("app/routes/library.tsx");
  });

  it("keeps every file under 600 lines", () => {
    const result = checkRule(
      (path) => read(path).split("\n").length > maxLines,
      [],
    );
    expect(result).toEqual({ unlisted: [], stale: [] });
  });

  it("does not write a body drain in a route: answerAndDrain does it for every route", () => {
    const result = checkRule(
      (path) =>
        path.startsWith("app/routes/") &&
        /(function|const) answerWithoutReading\b/.test(read(path)),
      [],
    );
    expect(result).toEqual({ unlisted: [], stale: [] });
  });

  it("reads a timestamp column with one asDate, in server/db/dates.ts, and no other function of that name", () => {
    const result = checkRule(
      (path) =>
        path !== "server/db/dates.ts" &&
        /(function|const) asDate\b/.test(read(path)),
      [],
    );
    expect(result).toEqual({ unlisted: [], stale: [] });
  });

  it("writes the shape of a username once, in server/account/profile-schema.ts", () => {
    const result = checkRule(
      (path) =>
        path !== "server/account/profile-schema.ts" &&
        /(function|const) usernameShape\b/.test(read(path)),
      [],
    );
    expect(result).toEqual({ unlisted: [], stale: [] });
  });

  it("asks every write the size and the Origin with checkWrite, and no route reads the Origin by hand", () => {
    // The Clerk webhook is called by Clerk's servers, not by a page, so it has no Origin to check:
    // it is checked by the signature of its body instead.
    const signedInstead = ["app/routes/webhooks.clerk.ts"];
    const withoutTheCheck = checkRule(
      (path) =>
        path.startsWith("app/routes/") &&
        /export (async )?function action\b/.test(read(path)) &&
        !/\b(checkWrite|readAdminWrite)\(/.test(read(path)),
      signedInstead,
    );
    const byHand = checkRule(
      (path) =>
        path !== "server/http/write-guard.ts" &&
        /headers\.get\("Origin"\)/.test(read(path)),
      [],
    );
    expect({ withoutTheCheck, byHand }).toEqual({
      withoutTheCheck: { unlisted: [], stale: [] },
      byHand: { unlisted: [], stale: [] },
    });
  });

  it("says what is never cached in one place, server/http/cache.ts, and not in each route", () => {
    const result = checkRule(
      (path) =>
        path !== "server/http/cache.ts" &&
        read(path).includes("private, no-store"),
      [],
    );
    expect(result).toEqual({ unlisted: [], stale: [] });
  });

  it("logs the name of an error and never the error, its message or its stack (SAG-134)", () => {
    // The one file that does is the entry of the browser: its console is the visitor's, and
    // nothing in it reaches the logs of the Worker. Hiding the error there would only hide what
    // went wrong from the person who is building the page.
    const inTheBrowser = ["app/entry.client.tsx"];
    const result = checkRule(
      (path) => unsafeConsoleCalls(read(path)).length > 0,
      inTheBrowser,
    );
    expect(result).toEqual({ unlisted: [], stale: [] });
  });

  it("knows an unsafe console call when it sees one, and lets a safe one pass", () => {
    const unsafe = [
      "console.error(error);",
      'console.log("failed", err);',
      "console.error(`failed: ${error}`);",
      "console.warn(error.message);",
      "console.error(String(e));",
      'console.error("x", cause.stack);',
      "main().catch(console.error);",
      "console.error(\n  'a note',\n  error,\n);",
    ];
    const safe = [
      'console.error("x", (error as Error).name);',
      'console.log(JSON.stringify({ event: "a", error: error instanceof Error ? error.name : "unknown" }));',
      "console.error(JSON.stringify(describeError(error, request)));",
      'console.log("hello");',
      "const e = new Error(); report(e);",
    ];
    for (const source of unsafe) {
      expect(unsafeConsoleCalls(source), source).not.toEqual([]);
    }
    for (const source of safe) {
      expect(unsafeConsoleCalls(source), source).toEqual([]);
    }
  });
});
