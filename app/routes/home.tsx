import { useTranslation } from "react-i18next";

import type { Route } from "./+types/home";
import { getInstance } from "~/middleware/i18next";

export function loader({ context }: Route.LoaderArgs) {
  const { t } = getInstance(context);
  return { title: t("app.name"), description: t("home.description") };
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.title },
    { name: "description", content: loaderData?.description },
  ];
}

export default function Home() {
  const { t } = useTranslation();

  return (
    <main className="container mx-auto px-4 py-16">
      <h1 className="text-4xl font-bold">{t("app.name")}</h1>
      <p className="text-fg-muted mt-4 max-w-2xl text-lg">
        {t("home.description")}
      </p>
    </main>
  );
}
