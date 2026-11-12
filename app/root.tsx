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
import { Analytics } from "~/components/Analytics";
import { ErrorPage } from "~/components/ErrorPage";
import { Footer } from "~/components/Footer";
import { SkipLink } from "~/components/SkipLink";
import { Navbar } from "~/components/Navbar";
import { authMiddleware } from "~/middleware/clerk";
import { contentId } from "~/lib/skip";
import { readTheme } from "~/lib/theme";
import { getLocale, i18nextMiddleware } from "~/middleware/i18next";
import { getHeaderState } from "~server/auth/header-facts";
import { isSignedIn } from "~server/auth/signed-in";
import { getAnalyticsEnabled } from "~server/runtime-env";

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
  // One read for the three facts of the header, and none for a visitor.
  const header = signedIn
    ? await getHeaderState(args)
    : { isAdmin: false, username: null, avatarUrl: null, unread: 0 };
  return data({
    locale: getLocale(context),
    // The mode the person chose with the switch. With none, the page follows the system.
    theme: readTheme(request.headers.get("Cookie")),
    // A yes or no for the header. The little else it shows about the person (the role as a yes or no,
    // the username for the link "Perfil" and a count) comes from one read, below.
    signedIn,
    // Also a yes or no: the link to the administration is for an administrator (SAG-95). It is read
    // only for a person with a session, and the pages of the administration check the role again.
    isAdmin: header.isAdmin,
    // The username, for the link "Perfil" of the account menu (SAG-114).
    username: header.username,
    // The picture of the person, in place of the word "Cuenta" in the header (SAG-109).
    avatarUrl: header.avatarUrl,
    // How many notifications are unread, for the link in the header (SAG-102). 99 is the most shown.
    unread: header.unread,
    // Whether the pages load the tracker of the analytics (SAG-24, ADR-050): only where the
    // deployment switched it on, and never for an administrator, so the owner's visits are not counted.
    analytics: getAnalyticsEnabled() && !header.isAdmin,
  });
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { i18n } = useTranslation();
  const rootData = useRouteLoaderData<typeof loader>("root");
  const theme = rootData?.theme ?? null;
  const signedIn = rootData?.signedIn ?? false;
  const isAdmin = rootData?.isAdmin ?? false;
  const unread = rootData?.unread ?? 0;
  const username = rootData?.username ?? null;
  const avatarUrl = rootData?.avatarUrl ?? null;
  const analytics = rootData?.analytics ?? false;

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
      {/* The middle takes what is left of the screen, so on a short page the footer stays at the bottom. */}
      <body className="flex min-h-dvh flex-col">
        <SkipLink />
        <Navbar
          savedTheme={theme}
          signedIn={signedIn}
          isAdmin={isAdmin}
          username={username}
          avatarUrl={avatarUrl}
          unread={unread}
        />
        {/* The target of the skip link: it takes the focus by script or by the link, never by Tab,
            and it is not a control, so it shows no ring. */}
        <div id={contentId} tabIndex={-1} className="grow focus:outline-none">
          {children}
        </div>
        <Footer />
        {analytics && <Analytics />}
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

  if (isRouteErrorResponse(error) && error.status === 429) {
    return (
      <ErrorPage
        status={429}
        title={t("errors.tooMany.title")}
        message={t("errors.tooMany.message")}
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
