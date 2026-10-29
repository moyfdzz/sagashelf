// The look of what a person presses, in one place. Three kinds, so that they are told apart:
// a hyperlink (blue and underlined, inside a sentence or the footer), an option to choose (the
// tabs and the views, the chosen one filled) and an action (a button, even when it is a link to
// another page). The colors are the design tokens, light and dark.

const focus =
  "focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2";

export const primaryButtonClass = `bg-accent text-accent-fg ${focus} rounded-md px-4 py-2 font-semibold transition hover:brightness-95 disabled:opacity-60`;

/**
 * A link to another page, inside a sentence or on its own: blue text with an underline a little
 * apart from it, which gets thicker and amber under the pointer and under the keyboard focus. The
 * underline is there before the pointer arrives, so the text color never carries the meaning
 * alone. No transition for a person who asked for less motion.
 */
export const linkClass = `text-accent underline decoration-1 underline-offset-4 ${focus} rounded-sm transition-[text-decoration-color,text-decoration-thickness] duration-150 hover:decoration-2 hover:decoration-link-hover focus-visible:decoration-2 focus-visible:decoration-link-hover motion-reduce:transition-none`;

// The arrow is drawn by the style and not written in the text, so it is the same in both
// languages. It says "" as its alternative text, so a screen reader does not read it, and it is an
// inline block so the underline does not run under it. The classes are written whole because the
// style generator only knows the ones it can read in the code.

/** A link that leads somewhere else in the site: "View the title page →". */
export const forwardLinkClass = `${linkClass} after:ml-1 after:inline-block after:content-['→'_/_'']`;

/** A link that leaves the site: "View on TMDB ↗". */
export const externalLinkClass = `${linkClass} after:ml-1 after:inline-block after:content-['↗'_/_'']`;

export const secondaryButtonClass = `border-input-edge bg-surface text-fg ${focus} rounded-md border px-4 py-2 font-semibold hover:brightness-95`;

/** A link to another page that acts as a button: the same look, as a box that sits in the line. */
export const secondaryLinkClass = `${secondaryButtonClass} inline-block whitespace-nowrap`;

/** One of several tabs: the chosen one is filled, the others have a border. */
export const tabClass = (selected: boolean) =>
  `${focus} inline-block rounded-md border px-3 py-1.5 font-semibold transition-colors ${
    selected
      ? "bg-accent text-accent-fg border-transparent"
      : "border-border text-fg hover:border-accent"
  }`;

/** One of the options of a group that sits inside a shared border (see `segmentedGroupClass`). */
export const segmentClass = (selected: boolean) =>
  `${focus} block px-3 py-1.5 font-semibold whitespace-nowrap transition-colors ${
    selected ? "bg-accent text-accent-fg" : "text-fg hover:bg-surface-raised"
  }`;

export const segmentedGroupClass =
  "border-border inline-flex overflow-hidden rounded-md border";
