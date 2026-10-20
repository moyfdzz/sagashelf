import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import { ErrorPage } from "~/components/ErrorPage";
import { Navbar } from "~/components/Navbar";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <Navbar />
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <ErrorPage
        status={404}
        title="Page not found"
        message="We could not find the page you were looking for."
      />
    );
  }

  return (
    <ErrorPage
      status={isRouteErrorResponse(error) ? error.status : 500}
      title="Something went wrong"
      message={
        import.meta.env.DEV && error instanceof Error
          ? error.message
          : "An unexpected error occurred. Please try again."
      }
    />
  );
}
