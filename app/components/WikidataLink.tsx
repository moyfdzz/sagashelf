import type { ReactNode } from "react";

import { textLinkClass } from "~/lib/ui";

/** The link back to Wikidata that its credit asks for; `Trans` puts the words inside it. */
export function WikidataLink({ children }: { children?: ReactNode }) {
  return (
    <a
      href="https://www.wikidata.org/"
      rel="noreferrer"
      className={textLinkClass}
    >
      {children}
    </a>
  );
}
