import { expect, test, type Page } from "@playwright/test";

import { mountComponent, prepareHarness } from "./harness/mount";

// Keyboard and focus of the components that only a signed-in person sees (SAG-251). The E2E job
// cannot sign in, so each one is drawn alone in a real Chromium, with the CSS of the production
// build. The phone project is skipped: these are keyboard behaviors, and the layout of a phone is
// measured elsewhere.

// One bundle per worker, and only when this spec runs.
// eslint-disable-next-line no-empty-pattern
test.beforeAll(async ({}, testInfo) => {
  await prepareHarness(testInfo.workerIndex);
});

test.skip(
  ({ isMobile }) => isMobile,
  "Keyboard behavior; the desktop project covers it",
);

/**
 * Presses Escape until `closed` holds. The panel of the notes is a native `<details>` that opens at
 * once, and React puts its Escape listener on a moment later, when it hears the `toggle` event; a
 * person cannot press in that gap, a test can. An Escape pressed after it closed does nothing.
 */
const escapeUntil = (page: Page, closed: () => Promise<void>) =>
  expect(async () => {
    await page.keyboard.press("Escape");
    await closed();
  }).toPass({ timeout: 5000 });

/**
 * Whether the focus is on the page behind a modal (the two buttons around the component). A native
 * modal dialog lets Tab leave the document, to the browser's own bar, and come back to its first
 * control: that is not a keyboard trap. What it must never do is reach the page behind.
 */
const focusIsBehind = (page: Page) =>
  page.evaluate(() => {
    const id = document.activeElement?.id;
    return id === "before" || id === "after";
  });

const focusedText = (page: Page) =>
  page.evaluate(
    () =>
      (document.activeElement as HTMLElement | null)?.innerText?.trim() ?? "",
  );

test.describe("the confirmation dialog", () => {
  test.beforeEach(async ({ page }) => {
    await mountComponent(page, "confirm");
    await expect(page.locator("dialog[open]")).toBeVisible();
    // The dialog is opened as a modal and the focus is put on Cancel after the page is hydrated.
    await expect(page.getByRole("link", { name: "Cancelar" })).toBeFocused();
  });

  test("is a real modal and starts with the focus on Cancel, which changes nothing", async ({
    page,
  }) => {
    expect(
      await page.evaluate(() =>
        document.querySelector("dialog")?.matches(":modal"),
      ),
    ).toBe(true);
    await expect(page.getByRole("link", { name: "Cancelar" })).toBeFocused();
    await expect(
      page.getByRole("dialog", { name: "¿Eliminar esta entrada?" }),
    ).toBeVisible();
  });

  test("never lets Tab or Shift+Tab reach the page behind, and comes back to its first control", async ({
    page,
  }) => {
    const cancel = page.getByRole("link", { name: "Cancelar" });
    const confirm = page.getByRole("button", { name: "Eliminar" });
    const outOfTheDocument = () =>
      page.evaluate(() => document.activeElement === document.body);

    // The focus starts on Cancel. Tab goes to Delete, then out of the document (the browser's own
    // bar), then back to Cancel; Shift+Tab goes the other way. Never to the page behind.
    await page.keyboard.press("Tab");
    await expect(confirm).toBeFocused();
    await page.keyboard.press("Tab");
    expect(await outOfTheDocument()).toBe(true);
    await page.keyboard.press("Tab");
    await expect(cancel).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    expect(await outOfTheDocument()).toBe(true);
    await page.keyboard.press("Shift+Tab");
    await expect(confirm).toBeFocused();
    expect(await focusIsBehind(page)).toBe(false);

    // The page behind is inert: a script cannot give it the focus either.
    await page.evaluate(() => document.getElementById("before")?.focus());
    expect(await focusIsBehind(page)).toBe(false);
  });

  test("Escape closes it and goes where Cancel goes", async ({ page }) => {
    await expect(page.getByTestId("where")).toHaveText("/entry?confirm=1");
    await page.keyboard.press("Escape");

    await expect(page.getByTestId("where")).toHaveText("/entry");
    await expect(page.locator("dialog")).toHaveCount(0);
  });

  test("a click on the dim area around the box closes it, and a click inside does not", async ({
    page,
  }) => {
    await page
      .getByRole("heading", { name: "¿Eliminar esta entrada?" })
      .click();
    await expect(page.locator("dialog[open]")).toBeVisible();
    await expect(page.getByTestId("where")).toHaveText("/entry?confirm=1");

    // A point between the corner of the window and the box: on the dim layer, whatever the layout.
    const box = await page.locator("dialog").boundingBox();
    if (!box) throw new Error("The dialog has no box");
    await page.mouse.click(Math.max(2, box.x / 2), Math.max(2, box.y / 2));

    await expect(page.getByTestId("where")).toHaveText("/entry");
    await expect(page.locator("dialog")).toHaveCount(0);
  });

  test("Cancel is reached and pressed with the keyboard", async ({ page }) => {
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("where")).toHaveText("/entry");
  });
});

test.describe("the notes of a library card", () => {
  test.beforeEach(async ({ page }) => {
    await mountComponent(page, "notes");
  });

  // The icon is a `<summary>`, which has no role of button for a browser, only its label.
  const icon = (page: Page) =>
    page.locator('summary[aria-label="Ver las notas de Naruto"]');

  test("opens with Enter and with Space, and Escape closes it and gives the focus back to the icon", async ({
    page,
  }) => {
    for (const key of ["Enter", "Space"]) {
      await icon(page).focus();
      await page.keyboard.press(key);
      await expect(
        page.getByRole("group", { name: "Adelanto de las notas" }),
      ).toBeVisible();

      await escapeUntil(page, () =>
        expect(
          page.getByRole("group", { name: "Adelanto de las notas" }),
        ).toBeHidden({ timeout: 500 }),
      );
      await expect(icon(page)).toBeFocused();
    }
  });

  test("the whole note opens in a modal that keeps the focus inside, and Escape gives it back to the icon", async ({
    page,
  }) => {
    await icon(page).focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("button", { name: "Ver nota completa" })
      .press("Enter");

    const dialog = page.getByRole("dialog", { name: "Notas de Naruto" });
    await expect(dialog).toBeVisible();
    for (const key of ["Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab"]) {
      await page.keyboard.press(key);
      expect(await focusIsBehind(page), `after ${key}`).toBe(false);
    }
    // The page behind is inert.
    await page.evaluate(() => document.getElementById("before")?.focus());
    expect(await focusIsBehind(page)).toBe(false);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(icon(page)).toBeFocused();
  });

  test("the Close button of the dialog also gives the focus back to the icon", async ({
    page,
  }) => {
    await icon(page).focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("button", { name: "Ver nota completa" })
      .press("Enter");
    await page.getByRole("button", { name: "Cerrar" }).press("Enter");

    await expect(
      page.getByRole("dialog", { name: "Notas de Naruto" }),
    ).toBeHidden();
    await expect(icon(page)).toBeFocused();
  });
});

test.describe("the account menu", () => {
  test.beforeEach(async ({ page }) => {
    await mountComponent(page, "account");
  });

  const button = (page: Page) => page.getByRole("button", { name: "Cuenta" });

  test("opens with the keyboard, takes the focus into its links in order, and Escape gives it back", async ({
    page,
  }) => {
    await button(page).focus();
    await expect(button(page)).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Enter");
    await expect(button(page)).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.press("Tab");
    expect(await focusedText(page)).toBe("Perfil");
    await page.keyboard.press("Tab");
    expect(await focusedText(page)).toBe("Mis listas");

    await page.keyboard.press("Escape");
    await expect(button(page)).toHaveAttribute("aria-expanded", "false");
    await expect(button(page)).toBeFocused();
  });

  test("a click outside closes it, and Space opens it like Enter", async ({
    page,
  }) => {
    await button(page).focus();
    await page.keyboard.press("Space");
    await expect(button(page)).toHaveAttribute("aria-expanded", "true");

    await page.getByTestId("where").click();
    await expect(button(page)).toHaveAttribute("aria-expanded", "false");
  });
});

test.describe("the header of a signed-in person (SAG-263)", () => {
  // Free room of the row between the name of the app and the links, with the widest count ("99+")
  // in Spanish. The window of the test has no scrollbar strip (Chromium hides it), which a real
  // browser takes 15 px for. The font decides the room: the CI (Linux) measured 38 px at 1280 px and
  // 53 at 1535 (with 4 px between the bell and the account; it is 8 px now), where the development
  // machine (Windows) measured 111 at 1280 px. So the floor is 20 px, enough to say that the row has slack and is not at its edge on a wider font; that it is
  // one row at all is the height check.
  const room = (page: Page) =>
    page.evaluate(() => {
      const logo = document
        .querySelector('header a[href="/"]')
        ?.getBoundingClientRect();
      const nav = document.querySelector("header nav")?.getBoundingClientRect();
      const row = document
        .querySelector("header > div")
        ?.getBoundingClientRect();
      if (!logo || !nav || !row) throw new Error("The header is not drawn");
      return {
        // 16 px is the gap between the pieces of the row (`xl:gap-x-4`).
        room: Math.round(nav.left - logo.right - 16),
        height: row.height,
      };
    });

  for (const width of [1280, 1535, 1536, 1920]) {
    test(`keeps one row with the bell and "99+" at ${width} px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await mountComponent(page, "header");

      const { room: free, height } = await room(page);

      // One row is 66 or 68 px high; two would be about 114.
      expect(height).toBeLessThan(80);
      expect(free).toBeGreaterThanOrEqual(20);
      // The links of the row are words (and icons from 1536 px); the bell says the word only to a
      // screen reader and a tooltip.
      await expect(
        page.locator("header nav").getByText("Notificaciones"),
      ).toBeHidden();
      const bell = page.getByRole("link", {
        name: "Notificaciones, 99+ pendientes",
      });
      await expect(bell).toBeVisible();
      await expect(bell).toHaveAttribute("title", "Notificaciones");
    });
  }

  test("puts the bell right before the account button, at the end of the row", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mountComponent(page, "header");

    const bell = await page
      .getByRole("link", { name: /^Notificaciones, 99\+/ })
      .boundingBox();
    const account = await page
      .getByRole("button", { name: "Cuenta" })
      .boundingBox();
    const theme = await page
      .getByRole("switch", { name: "Modo oscuro" })
      .boundingBox();

    expect(bell && account && theme).toBeTruthy();
    expect((theme?.x ?? 0) + (theme?.width ?? 0)).toBeLessThanOrEqual(
      bell?.x ?? 0,
    );
    expect((bell?.x ?? 0) + (bell?.width ?? 0)).toBeLessThanOrEqual(
      account?.x ?? 0,
    );
    // A target of at least 40 px, like every control.
    expect(bell?.width).toBeGreaterThanOrEqual(40);
    expect(bell?.height).toBeGreaterThanOrEqual(40);
  });
});

test.describe("the toast", () => {
  test.beforeEach(async ({ page }) => {
    await mountComponent(page, "toast");
  });

  test("has a close button of at least 40 px (SAG-252), reached and pressed with the keyboard", async ({
    page,
  }) => {
    const close = page.getByRole("button", { name: "Cerrar" });
    await expect(close).toBeVisible();
    const box = await close.boundingBox();
    // 40 px, with a tenth of a pixel of room for the rounding of the layout.
    expect(box?.width).toBeGreaterThanOrEqual(39.9);
    expect(box?.height).toBeGreaterThanOrEqual(39.9);

    // Tab until the close button has the focus, whatever else the page has before it.
    for (let stops = 0; stops < 6; stops += 1) {
      if (await close.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(close).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Tu entrada se guardó.")).toHaveCount(0);
  });
});

test.describe("the search field", () => {
  test.beforeEach(async ({ page }) => {
    await mountComponent(page, "search");
  });

  const field = (page: Page) => page.getByRole("combobox");

  test("shows suggestions, moves through them with the arrows and says which one is active", async ({
    page,
  }) => {
    await field(page).focus();
    await page.keyboard.type("na");
    await expect(page.getByRole("option")).toHaveCount(3);
    await expect(field(page)).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("option").first()).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const active = await field(page).getAttribute("aria-activedescendant");
    expect(active).toBe(
      await page.getByRole("option").first().getAttribute("id"),
    );

    // Up from the first one goes to the last, and down from the last to the first.
    await page.keyboard.press("ArrowUp");
    await expect(page.getByRole("option").last()).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("option").first()).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("Escape closes the list and the focus stays in the field", async ({
    page,
  }) => {
    await field(page).focus();
    await page.keyboard.type("na");
    await expect(page.getByRole("option")).toHaveCount(3);

    await page.keyboard.press("Escape");
    await expect(field(page)).toHaveAttribute("aria-expanded", "false");
    await expect(field(page)).toBeFocused();
  });

  test("Enter on an active suggestion searches for it", async ({ page }) => {
    await field(page).focus();
    await page.keyboard.type("na");
    await expect(page.getByRole("option")).toHaveCount(3);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("where")).toContainText("q=Naruto+Shippuden");
  });

  test("Enter with no active suggestion sends what was typed", async ({
    page,
  }) => {
    await field(page).focus();
    await page.keyboard.type("bleach");
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("where")).toContainText("q=bleach");
  });
});
