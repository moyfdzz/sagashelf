import { expect, test } from "@playwright/test";

// The contact page (SAG-110). Sending a message needs the database, which the end-to-end run does
// not have, so what is tried here is the page: its fields, the trap, the state after sending, and
// that a page of another site cannot post to it.

test.describe("the contact page in Spanish", () => {
  test.use({ locale: "es-MX" });

  test("shows the form to a visitor, with an optional address and no sign of the trap", async ({
    page,
  }) => {
    const response = await page.goto("/contact");

    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "Contacto" }),
    ).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(3);
    await expect(page.getByRole("radio", { name: "Comentario" })).toBeChecked();
    await expect(page.getByLabel("Tu mensaje")).toBeVisible();
    await expect(page.getByLabel("Tu correo (opcional)")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Enviar mensaje" }),
    ).toBeVisible();
    // The trap is in the page for a bot, and never in front of a person.
    await expect(page.locator('input[name="website"]')).toBeHidden();
    await expect(page.locator('input[name="website"]')).toHaveCount(1);
  });

  test("says the message was sent, and offers the form again", async ({
    page,
  }) => {
    await page.goto("/contact?sent=1");

    await expect(page.getByRole("status")).toContainText("Mensaje enviado");
    await expect(
      page.getByRole("button", { name: "Enviar mensaje" }),
    ).toHaveCount(0);
    await page.getByRole("link", { name: "Enviar otro mensaje" }).click();
    await expect(page.getByLabel("Tu mensaje")).toBeVisible();
  });

  test("is not indexed, and is never kept by a shared cache", async ({
    request,
  }) => {
    const response = await request.get("/contact");

    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(await response.text()).toContain('content="noindex, nofollow"');
  });

  test("refuses a form posted from a page of another site", async ({
    request,
  }) => {
    const response = await request.post("/contact", {
      headers: { Origin: "https://evil.example" },
      form: { kind: "help", body: "hello" },
    });

    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);
  });

  test("does not scroll sideways on a phone, and the controls are easy to press", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/contact");

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const button = await page
      .getByRole("button", { name: "Enviar mensaje" })
      .boundingBox();
    expect(button?.height ?? 0).toBeGreaterThanOrEqual(40);
  });
});

test.describe("the contact page in English", () => {
  test.use({ locale: "en-US" });

  test("is written in English", async ({ page }) => {
    await page.goto("/contact");

    await expect(
      page.getByRole("heading", { level: 1, name: "Contact" }),
    ).toBeVisible();
    await expect(page.getByRole("radio", { name: "Feedback" })).toBeChecked();
    await expect(page.getByLabel("Your email (optional)")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Send message" }),
    ).toBeVisible();
  });
});
