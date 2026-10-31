import type { ReactNode } from "react";

import { textLinkClass } from "~/lib/ui";

/** The link back to TVmaze that its license (CC BY-SA) asks for; `Trans` puts the words inside it. */
export function TvmazeLink({ children }: { children?: ReactNode }) {
  return (
    <a
      href="https://www.tvmaze.com/"
      rel="noreferrer"
      className={textLinkClass}
    >
      {children}
    </a>
  );
}
