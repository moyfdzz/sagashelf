import { createInstance } from "i18next";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { AvatarField } from "~/components/AvatarField";
import { resources } from "~/locales";

async function render(
  props: Partial<Parameters<typeof AvatarField>[0]> = {},
  locale: "es" | "en" = "es",
) {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    resources,
    lng: locale,
    fallbackLng: "es",
    interpolation: { escapeValue: false },
  });
  const element = (
    <AvatarField avatarUrl={null} name="ana" canUpload {...props} />
  );
  const router = createMemoryRouter([{ path: "/", element }]);
  return renderToString(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

describe("the field of the profile picture (SAG-109)", () => {
  it("offers only the three accepted types, and says the rules", async () => {
    const html = await render();

    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(html).toContain("No se permite contenido sexual");
  });

  it("draws the first letter with no picture, and offers nothing to remove", async () => {
    const html = await render({ name: "ana" });

    expect(html).toContain(">A</div>");
    expect(html).not.toContain("Quitar foto");
  });

  it("draws the picture and offers to remove it", async () => {
    const html = await render({ avatarUrl: "https://img.clerk.com/ana" });

    expect(html).toContain('src="https://img.clerk.com/ana"');
    expect(html).toContain('alt="Foto de perfil de ana"');
    expect(html).toContain("Quitar foto");
  });

  it("offers no upload when this deployment has no moderation, and says so", async () => {
    const html = await render({ canUpload: false });

    expect(html).not.toContain('type="file"');
    expect(html).toContain("Por ahora no se pueden subir fotos.");
  });

  it("has a save button only after a picture is chosen", async () => {
    expect(await render()).not.toContain("Guardar foto");
  });

  it("says it in English", async () => {
    const html = await render({}, "en");

    expect(html).toContain("Choose a picture");
    expect(html).toContain("Sexual content");
  });
});
