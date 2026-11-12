import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { linkClass } from "~/lib/ui";

type Props = {
  /** Where it goes. */
  to: string;
  /**
   * Use the router's `Link`. Only for a page that is not a page of the session: those load a whole
   * new document, with a security policy of their own, so they are a plain anchor (ADR-018).
   */
  router?: boolean;
  /** The words that say where it goes: the arrow is only a picture and says nothing. */
  children: ReactNode;
};

// 40 px high, like the buttons with text, so it is easy to tap on a phone. A back link is a link,
// not a button: it keeps the colour and weight of the other links on their own.
const backLinkClass = `${linkClass} gap-1.5`;

/** The link that goes back: an arrow in front of the text, the same on every page (SAG-156). */
export function BackLink({ to, router = false, children }: Props) {
  const content = (
    <>
      <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
      {children}
    </>
  );
  return router ? (
    <Link to={to} className={backLinkClass}>
      {content}
    </Link>
  ) : (
    <a href={to} className={backLinkClass}>
      {content}
    </a>
  );
}
