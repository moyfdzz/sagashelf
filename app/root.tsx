import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  data,
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import { ErrorPage } from "~/components/ErrorPage";
import { Navbar } from "~/components/Navbar";
import { authMiddleware } from "~/middleware/clerk";
import { readTheme } from "~/lib/theme";
import { getLocale, i18nextMiddleware } from "~/middleware/i18next";

export const middleware = [i18nextMiddleware, authMiddleware];

export function loader({ context, request }: Route.LoaderArgs) {
  return data({
    locale: getLocale(context),
    // The mode the person chose with the switch. With none, the page follows the system.
    theme: readTheme(request.headers.get("Cookie")),
  });
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { i18n } = useTranslation();
  const theme = useRouteLoaderData<typeof loader>("root")?.theme ?? null;

  return (
    <html
      lang={i18n.language}
      dir={i18n.dir(i18n.language)}
      data-theme={theme ?? undefined}
    >
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <Navbar savedTheme={theme} />
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App({ loaderData: { locale } }: Route.ComponentProps) {
  const { i18n } = useTranslation();

  // Keeps the browser in sync if a navigation changes the language.
  useEffect(() => {
    if (i18n.language !== locale) void i18n.changeLanguage(locale);
  }, [locale, i18n]);

  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { t } = useTranslation();

  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <ErrorPage
        status={404}
        title={t("errors.notFound.title")}
        message={t("errors.notFound.message")}
      />
    );
  }

  return (
    <ErrorPage
      status={isRouteErrorResponse(error) ? error.status : 500}
      title={t("errors.unexpected.title")}
      message={
        import.meta.env.DEV && error instanceof Error
          ? error.message
          : t("errors.unexpected.message")
      }
    />
  );
}
