import { describe, expect, it } from "vitest";

import { sitemapXml } from "./sitemap";

describe("sitemapXml (SAG-245)", () => {
  it("lists the page of the sagas and each saga, on the apex domain", () => {
    const xml = sitemapXml([{ slug: "naruto" }, { slug: "death-note" }]);

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    expect(xml.match(/<loc>[^<]*<\/loc>/g)).toEqual([
      "<loc>https://sagashelf.app/sagas</loc>",
      "<loc>https://sagashelf.app/sagas/naruto</loc>",
      "<loc>https://sagashelf.app/sagas/death-note</loc>",
    ]);
  });

  it("lists only the page of the sagas when there is none published", () => {
    expect(sitemapXml([]).match(/<loc>/g)).toHaveLength(1);
  });

  it("escapes what XML reserves, so a strange slug cannot break the file", () => {
    const xml = sitemapXml([{ slug: `a&b<c>"d'` }]);

    expect(xml).toContain("/sagas/a&amp;b&lt;c&gt;&quot;d&apos;</loc>");
    expect(xml).not.toContain("a&b");
  });
});
