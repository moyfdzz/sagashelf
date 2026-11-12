/**
 * The `id` of the box that holds every page, which `root.tsx` draws and the skip link points to
 * (SAG-256). It lives apart from the component so editing the link does not reload the page in
 * development, and the layout and the tests read the same value.
 */
export const contentId = "content";
