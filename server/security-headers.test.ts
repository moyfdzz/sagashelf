import { describe, expect, it } from "vitest";

import headersFile from "../public/_headers?raw";

import {
  applySecurityHeaders,
  baseSecurityHeaders,
  buildContentSecurityPolicy,
  generateNonce,
} from "./security-headers";

describe("generateNonce", () => {
  it("is different every time and is base64", () => {
    const nonces = new Set(Array.from({ length: 50 }, () => generateNonce()));

    expect(nonces.size).toBe(50);
    for (const nonce of nonces) expect(nonce).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
});

describe("buildContentSecurityPolicy", () => {
  const policy = buildContentSecurityPolicy("abc123");
  const directives = Object.fromEntries(
    policy.split("; ").map((part) => {
      const [name, ...sources] = part.split(" ");
      return [name, sources];
    }),
  );

  it("allows scripts only from this site and with this nonce", () => {
    expect(directives["script-src"]).toEqual(["'self'", "'nonce-abc123'"]);
  });

  it("never allows inline or eval code", () => {
    expect(policy).not.toContain("unsafe-inline");
    expect(policy).not.toContain("unsafe-eval");
  });

  it("blocks framing, plugins, base tags and other origins", () => {
    expect(directives["frame-ancestors"]).toEqual(["'none'"]);
    expect(directives["frame-src"]).toEqual(["'none'"]);
    expect(directives["object-src"]).toEqual(["'none'"]);
    expect(directives["base-uri"]).toEqual(["'none'"]);
    expect(directives["form-action"]).toEqual(["'self'"]);
    expect(directives["default-src"]).toEqual(["'self'"]);
  });

  it("does not allow any other origin", () => {
    expect(policy).not.toMatch(/https?:\/\//);
  });
});

describe("applySecurityHeaders", () => {
  it("adds every base header to a JSON response and keeps the body and status", async () => {
    const response = applySecurityHeaders(
      Response.json({ ok: true }, { status: 201 }),
    );

    for (const [name, value] of Object.entries(baseSecurityHeaders)) {
      expect(response.headers.get(name), name).toBe(value);
    }
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("locks down responses that are not pages", () => {
    const response = applySecurityHeaders(Response.json({}));

    expect(response.headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
  });

  it("never replaces the CSP a page already has", () => {
    const page = new Response("<html></html>", {
      headers: {
        "Content-Type": "text/html",
        "Content-Security-Policy": "default-src 'self'; script-src 'nonce-x'",
      },
    });

    expect(
      applySecurityHeaders(page).headers.get("Content-Security-Policy"),
    ).toBe("default-src 'self'; script-src 'nonce-x'");
  });

  it("does not invent a CSP for a page that has none (the dev server)", () => {
    const page = new Response("<html></html>", {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });

    expect(
      applySecurityHeaders(page).headers.get("Content-Security-Policy"),
    ).toBeNull();
  });

  it("keeps other headers such as cookies and redirects", () => {
    const response = applySecurityHeaders(
      new Response(null, {
        status: 303,
        headers: { Location: "/x", "Set-Cookie": "locale=en" },
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/x");
    expect(response.headers.get("Set-Cookie")).toBe("locale=en");
  });
});

describe("public/_headers", () => {
  it("lists exactly the same security headers as the Worker", () => {
    const fromFile = Object.fromEntries(
      headersFile
        .split("\n")
        .filter((line) => /^\s+\S/.test(line))
        .map((line) => {
          const index = line.indexOf(":");
          return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
        }),
    );

    expect(fromFile).toEqual(baseSecurityHeaders);
  });
});
