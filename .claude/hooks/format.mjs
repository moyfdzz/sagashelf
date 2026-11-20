// PostToolUse hook of Claude Code (SAG-269): formats with Prettier the file an agent just wrote or
// edited, so `npm run check` does not fail on formatting and nobody runs `prettier --write` by
// hand. It reads the hook's JSON from stdin, skips files outside the repository, ignored by
// `.prettierignore` or unknown to Prettier, and never fails the edit: errors go to stderr only.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const target = input.tool_input?.file_path ?? input.tool_response?.filePath;
  if (typeof target === "string") {
    const file = resolve(root, target);
    const inside = relative(root, file);
    if (inside && !inside.startsWith("..") && !isAbsolute(inside)) {
      const prettier = await import("prettier");
      const info = await prettier.getFileInfo(file, {
        ignorePath: join(root, ".prettierignore"),
        resolveConfig: true,
      });
      if (!info.ignored && info.inferredParser) {
        const source = readFileSync(file, "utf8");
        const options = (await prettier.resolveConfig(file)) ?? {};
        const formatted = await prettier.format(source, {
          ...options,
          filepath: file,
        });
        if (formatted !== source) writeFileSync(file, formatted);
      }
    }
  }
} catch (error) {
  // A file that does not parse yet is normal in the middle of an edit: say so, do not block.
  console.error(
    `format hook: ${error instanceof Error ? error.message.split("\n")[0] : error}`,
  );
}
