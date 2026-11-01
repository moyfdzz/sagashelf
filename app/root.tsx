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
import { Footer } from "~/components/Footer";
import { Navbar } from "~/components/Navbar";
import { authMiddleware } from "~/middleware/clerk";
import { readTheme } from "~/lib/theme";
import { getLocale, i18nextMiddleware } from "~/middleware/i18next";
import { isAdministrator } from "~server/auth/is-admin";
import { isSignedIn } from "~server/auth/signed-in";

export const middleware = [i18nextMiddleware, authMiddleware];

// The logo, from public/ (built by scripts/build-icons.mjs). The SVG is for current browsers,
// the .ico for the rest, and the apple-touch-icon for a page saved to an iPhone's home screen.
export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml", sizes: "any" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
];

export async function loader(args: Route.LoaderArgs) {
  const { context, request } = args;
  const signedIn = await isSignedIn(args);
  return data({
    locale: getLocale(context),
    // The mode the person chose with the switch. With none, the page follows the system.
    theme: readTheme(request.headers.get("Cookie")),
    // Only a yes or no for the header. Who the person is stays in the pages that need it.
    signedIn,
    // Also a yes or no: the link to the administration is for an administrator (SAG-95). It is read
    // only for a person with a session, and the pages of the administration check the role again.
    isAdmin: signedIn ? await isAdministrator(args) : false,
  });
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { i18n } = useTranslation();
  const rootData = useRouteLoaderData<typeof loader>("root");
  const theme = rootData?.theme ?? null;
  const signedIn = rootData?.signedIn ?? false;
  const isAdmin = rootData?.isAdmin ?? false;

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
        <Navbar savedTheme={theme} signedIn={signedIn} isAdmin={isAdmin} />
        {children}
        <Footer />
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
