import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import type { EntryContext, RouterContextProvider } from "react-router";
import { ServerRouter } from "react-router";

import { getInstance } from "~/middleware/i18next";
import {
  buildContentSecurityPolicy,
  generateNonce,
} from "~server/security-headers";

export const streamTimeout = 5_000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  loadContext: RouterContextProvider,
) {
  // The language depends on the cookie and on Accept-Language, so shared
  // caches must keep one copy per value.
  responseHeaders.append("Vary", "Cookie, Accept-Language");

  // A new nonce per page. Scripts without it are blocked by the CSP. The dev
  // server skips the policy because hot reload needs scripts it cannot sign.
  const nonce = generateNonce();
  if (import.meta.env.PROD) {
    responseHeaders.set(
      "Content-Security-Policy",
      buildContentSecurityPolicy(nonce),
    );
  }

  // https://httpwg.org/specs/rfc9110.html#HEAD
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, {
      status: responseStatusCode,
      headers: responseHeaders,
    });
  }

  let shellRendered = false;
  const userAgent = request.headers.get("user-agent");

  const body = await renderToReadableStream(
    // The server renders with the same i18next instance the middleware created.
    <I18nextProvider i18n={getInstance(loadContext)}>
      <ServerRouter context={routerContext} url={request.url} nonce={nonce} />
    </I18nextProvider>,
    {
      nonce,
      signal: AbortSignal.timeout(streamTimeout + 1000),
      onError(error: unknown) {
        responseStatusCode = 500;
        // Log streaming rendering errors from inside the shell. Don't log
        // errors encountered during initial shell rendering since they'll
        // reject and get logged in handleDocumentRequest.
        if (shellRendered) {
          console.error(error);
        }
      },
    },
  );
  shellRendered = true;

  // Ensure requests from bots and SPA Mode renders wait for all content to load before responding
  // https://react.dev/reference/react-dom/server/renderToPipeableStream#waiting-for-all-content-to-load-for-crawlers-and-static-generation
  if ((userAgent && isbot(userAgent)) || routerContext.isSpaMode) {
    await body.allReady;
  }

  responseHeaders.set("Content-Type", "text/html");
  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}
