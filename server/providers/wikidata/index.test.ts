import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { mswServer } from "../../testing/msw";
import {
  animeQid,
  franchiseQid,
  wikidataEndpoint,
  wikidataHandlers,
  type SeenQuery,
} from "../../testing/wikidata";
import { providerUserAgent, ProviderError } from "../http";
import { createWikidataClientWithDefaults } from ".";

const fast = { sleep: async () => undefined };

describe("the Wikidata client", () => {
  it("looks titles up in one call, politely", async () => {
    const seen: SeenQuery[] = [];
    mswServer.use(...wikidataHandlers(seen));
    const client = createWikidataClientWithDefaults(fast);

    const hits = await client.lookup([
      { scheme: "tmdb_tv", value: "1429" },
      { scheme: "tmdb_movie", value: "603" },
    ]);

    expect(hits.map((hit) => hit.item.qid)).toEqual([animeQid]);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.headers.get("user-agent")).toBe(providerUserAgent);
    expect(seen[0]?.headers.get("accept")).toBe(
      "application/sparql-results+json",
    );
  });

  it("asks for the members of a franchise in one call", async () => {
    const seen: SeenQuery[] = [];
    mswServer.use(...wikidataHandlers(seen));
    const client = createWikidataClientWithDefaults(fast);

    const members = await client.members([franchiseQid], []);

    expect(members.map((item) => item.qid)).toContain(franchiseQid);
    expect(seen).toHaveLength(1);
  });

  it("makes no call when there is nothing valid to ask", async () => {
    const seen: SeenQuery[] = [];
    mswServer.use(...wikidataHandlers(seen));
    const client = createWikidataClientWithDefaults(fast);

    expect(await client.lookup([])).toEqual([]);
    expect(await client.members([], [])).toEqual([]);
    expect(seen).toHaveLength(0);
  });

  it("stops at a 429 without trying again, and keeps quiet afterwards", async () => {
    let calls = 0;
    mswServer.use(
      http.get(wikidataEndpoint, () => {
        calls += 1;
        return new HttpResponse(null, {
          status: 429,
          headers: { "Retry-After": "60" },
        });
      }),
    );
    const client = createWikidataClientWithDefaults(fast);
    const sources = [{ scheme: "tmdb_tv", value: "1429" }] as const;

    await expect(client.lookup(sources)).rejects.toMatchObject({
      kind: "http",
      status: 429,
    });
    await expect(client.lookup(sources)).rejects.toBeInstanceOf(ProviderError);

    expect(calls).toBe(1);
  });
});
