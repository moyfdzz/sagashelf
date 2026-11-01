/** The width of the panel of the account menu (`w-60`, 15 rem at the usual 16 px), in pixels. */
export const menuPanelWidth = 240;

/**
 * Which edge of the button the panel of a menu hangs from. On a wide screen the button is at the
 * right of the header and the panel opens to its left, ending at the button's right edge. On a
 * phone the header wraps and the button can be at the left, so the same panel would leave the
 * screen and its links could not be read: it then opens to the right instead, from the button's
 * left edge. `rightEdge` is where the button ends, from the left of the window; `margin` is what
 * is kept free at the edge.
 */
export function menuAlign(
  rightEdge: number,
  panelWidth: number = menuPanelWidth,
  margin = 8,
): "right" | "left" {
  return rightEdge >= panelWidth + margin ? "right" : "left";
}
