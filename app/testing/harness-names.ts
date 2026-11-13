/** The components that `e2e/components.spec.ts` can mount alone (SAG-251), shared by both sides. */
export const harnessNames = [
  "confirm",
  "notes",
  "account",
  "search",
  "toast",
  "header",
] as const;

export type HarnessName = (typeof harnessNames)[number];
