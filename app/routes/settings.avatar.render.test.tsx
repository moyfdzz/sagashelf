import { createInstance } from "i18next";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { AvatarField } from "~/components/AvatarField";
import { resources } from "~/locales";

const picture = "https://img.clerk.com/ana";

async function render(
  props: Partial<Parameters<typeof AvatarField>[0]> = {},
  { locale = "es", address = "/settings/profile" } = {},
) {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    resources,
    lng: locale,
    fallbackLng: "es",
    interpolation: { escapeValue: false },
  });
  const element = (
    <AvatarField
      avatarUrl={null}
      name="ana"
      canUpload
      canRemove={false}
      {...props}
    />
  );
  const router = createMemoryRouter([{ path: "/settings/profile", element }], {
    initialEntries: [address],
  });
  return renderToString(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

const confirmAddress = "/settings/profile?confirm=remove_picture";

describe("the field of the profile picture (SAG-109, SAG-144)", () => {
  it("offers only the three accepted types, and says the rules", async () => {
    const html = await render();

    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(html).toContain("No se permite contenido sexual");
  });

  it("draws the button as the label of a control hidden from the eye, not removed", async () => {
    const html = await render();
    const input = /<input[^>]*type="file"[^>]*>/.exec(html)?.[0] ?? "";
    const label = /<label[^>]*>[^<]*<\/label>/.exec(html)?.[0] ?? "";

    // Still in the page, so the keyboard and a screen reader reach it.
    expect(input).toContain('id="avatar-file"');
    expect(input).toContain("sr-only");
    expect(input).toContain("peer");
    expect(input).not.toContain("hidden");
    expect(input).not.toContain('tabindex="-1"');
    expect(label).toContain('for="avatar-file"');
    expect(label).toContain(">Elegir foto<");
    // It looks pressed when it has the focus, as a button does.
    expect(label).toContain("peer-focus-visible:outline-2");
    expect(label).toContain("hover:brightness-95");
  });

  it("draws the first letter with no picture, and offers nothing to remove", async () => {
    const html = await render({ name: "ana" });

    expect(html).toContain(">A</div>");
    expect(html).not.toContain("Quitar foto");
  });

  it("offers to remove a person's own picture, in red, as a way to ask first", async () => {
    const html = await render({ avatarUrl: picture, canRemove: true });
    const link = /<a[^>]*>Quitar foto<\/a>/.exec(html)?.[0] ?? "";

    expect(html).toContain(`src="${picture}"`);
    expect(html).toContain('alt="Foto de perfil de ana"');
    expect(link).toContain(`href="${confirmAddress}"`);
    expect(link).toContain("text-danger-fg");
    // Nothing is sent by this link, and nothing is asked yet.
    expect(html).not.toContain("<dialog");
    expect(html).not.toContain('name="intent"');
  });

  it("offers nothing to remove on the image Clerk generates, even when asked by address", async () => {
    const html = await render(
      { avatarUrl: picture, canRemove: false },
      { address: confirmAddress },
    );

    expect(html).toContain(`src="${picture}"`);
    expect(html).not.toContain("Quitar foto");
    expect(html).not.toContain("<dialog");
  });

  it("asks before removing, with the way that changes nothing first", async () => {
    const html = await render(
      { avatarUrl: picture, canRemove: true },
      { address: confirmAddress },
    );
    const dialog = /<dialog.*<\/dialog>/s.exec(html)?.[0] ?? "";

    expect(dialog).toContain("¿Quitar tu foto de perfil?");
    expect(dialog).toContain("Tu perfil mostrará una imagen genérica");
    expect(dialog).toMatch(/<a [^>]*data-cancel[^>]*>Conservar foto<\/a>/);
    expect(dialog).toContain('action="/settings/avatar"');
    expect(dialog).toContain('name="intent" value="remove"');
    expect(dialog).toContain("text-danger-fg");
    expect(dialog.indexOf("Conservar foto")).toBeLessThan(
      dialog.indexOf('name="intent"'),
    );
  });

  it("ignores any other word in the address", async () => {
    const html = await render(
      { avatarUrl: picture, canRemove: true },
      { address: "/settings/profile?confirm=unfollow" },
    );

    expect(html).not.toContain("<dialog");
  });

  it("offers no upload when this deployment has no moderation, and says so", async () => {
    const html = await render({ canUpload: false });

    expect(html).not.toContain('type="file"');
    expect(html).not.toContain("Elegir foto");
    expect(html).toContain("Por ahora no se pueden subir fotos.");
  });

  it("still offers to remove a picture when there are no uploads", async () => {
    const html = await render({
      canUpload: false,
      avatarUrl: picture,
      canRemove: true,
    });

    expect(html).toContain("Quitar foto");
  });

  it("has a save button only after a picture is chosen", async () => {
    const html = await render();

    expect(html).not.toContain("Guardar foto");
    expect(html).not.toContain("Elegir otra");
  });

  it("says it in English", async () => {
    const html = await render(
      { avatarUrl: picture, canRemove: true },
      { locale: "en", address: confirmAddress },
    );

    expect(html).toContain("Choose picture");
    expect(html).toContain("Remove your profile picture?");
    expect(html).toContain("Keep picture");
    expect(html).toContain("Sexual content");
  });
});
