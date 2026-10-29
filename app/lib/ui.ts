// The look of what a person presses, in one place. Three kinds, so that they are told apart:
// a hyperlink (blue, amber under the pointer, with a thin underline only inside a sentence), an
// option to choose (the tabs and the views, the chosen one filled) and an action (a button, even
// when it is a link to another page). The colors are the design tokens, light and dark.

const focus =
  "focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2";

export const primaryButtonClass = `bg-accent text-accent-fg ${focus} rounded-md px-4 py-2 font-semibold transition hover:brightness-95 disabled:opacity-60`;

/**
 * A link on its own (the footer, "Back to my library", the titles of a list): blue text with no
 * underline, which turns amber under the pointer and under the keyboard focus. A list or a line
 * of links is understood as links by where it is. No transition for a person who asked for less
 * motion.
 */
export const linkClass = `text-accent ${focus} rounded-sm transition-colors duration-150 hover:text-link-hover focus-visible:text-link-hover motion-reduce:transition-none`;

/**
 * A link inside a sentence: the same, with a thin underline a little apart from the text. Without
 * it the blue is only 2.56:1 against the text around it on the light page and 2.11:1 on the dark
 * one, and 3:1 is needed to tell a link from its text without a line (WCAG 1.4.1).
 */
export const textLinkClass = `${linkClass} underline decoration-1 underline-offset-4`;

// The arrow is drawn by the style and not written in the text, so it is the same in both
// languages. It says "" as its alternative text, so a screen reader does not read it, and it is an
// inline block so the underline does not run under it. The classes are written whole because the
// style generator only knows the ones it can read in the code.

/** A link that leads somewhere else in the site: "View the title page →". */
export const forwardLinkClass = `${linkClass} after:ml-1 after:inline-block after:content-['→'_/_'']`;

/** A link that leaves the site: "View on TMDB ↗". */
export const externalLinkClass = `${linkClass} after:ml-1 after:inline-block after:content-['↗'_/_'']`;

export const secondaryButtonClass = `border-input-edge bg-surface text-fg ${focus} rounded-md border px-4 py-2 font-semibold hover:brightness-95`;

/** A small button inside a line or a card, like the "+1": the same edge as the others, less padding. */
export const smallButtonClass = `border-input-edge bg-surface text-fg ${focus} rounded-md border px-2.5 py-0.5 text-sm font-semibold hover:brightness-95 disabled:opacity-60`;

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
