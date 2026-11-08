import { useTranslation } from "react-i18next";

import { BackLink } from "~/components/BackLink";

type ErrorPageProps = {
  status: number;
  title: string;
  message: string;
};

export function ErrorPage({ status, title, message }: ErrorPageProps) {
  const { t } = useTranslation();

  return (
    <main className="container mx-auto px-4 py-24 text-center">
      <title>{t("app.pageTitle", { title })}</title>
      <p className="text-accent text-6xl font-bold">{status}</p>
      <h1 className="mt-4 text-2xl font-semibold">{title}</h1>
      <p className="text-fg-muted mt-2">{message}</p>
      <p className="mt-8">
        <BackLink to="/" router>
          {t("errors.backHome")}
        </BackLink>
      </p>
    </main>
  );
}
