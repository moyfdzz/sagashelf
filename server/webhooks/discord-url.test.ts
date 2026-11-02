import { describe, expect, it } from "vitest";

import {
  maskWebhookUrl,
  maxWebhookUrlLength,
  parseDiscordWebhookUrl,
} from "./discord-url";
import {
  fakeWebhookId,
  fakeWebhookToken,
  fakeWebhookUrl,
} from "../testing/discord";

const path = `/api/webhooks/${fakeWebhookId}/${fakeWebhookToken}`;

describe("parseDiscordWebhookUrl (SAG-27)", () => {
  it("accepts the address of a webhook on discord.com and on discordapp.com", () => {
    expect(parseDiscordWebhookUrl(fakeWebhookUrl)).toEqual({
      url: fakeWebhookUrl,
      id: fakeWebhookId,
    });
    expect(parseDiscordWebhookUrl(`https://discordapp.com${path}`)).toEqual({
      url: `https://discordapp.com${path}`,
      id: fakeWebhookId,
    });
  });

  it("trims the spaces around a pasted address, and writes the host in lower case", () => {
    expect(parseDiscordWebhookUrl(`  https://DISCORD.com${path}\n`)?.url).toBe(
      fakeWebhookUrl,
    );
  });

  it("saves the address built from the parts that were checked, not the text that came in", () => {
    // The default port, an empty query and an empty fragment are dropped by the parser; what is
    // saved is always the plain form.
    expect(
      parseDiscordWebhookUrl(`https://discord.com:443${path}?#`)?.url,
    ).toBe(fakeWebhookUrl);
  });

  describe("refuses what is not the address of a Discord webhook", () => {
    const refused: [string, string][] = [
      ["nothing", ""],
      ["only spaces", "   "],
      ["plain text", "hello"],
      ["no scheme", `discord.com${path}`],
      ["http", `http://discord.com${path}`],
      ["another scheme", `ftp://discord.com${path}`],
      ["a scheme that runs code", "javascript:alert(1)"],
      ["a data address", "data:text/plain,hello"],
      ["a file", `file:///etc/passwd`],
      ["another host", `https://example.com${path}`],
      [
        "a host that starts with discord.com",
        `https://discord.com.evil.test${path}`,
      ],
      ["a subdomain", `https://evil.discord.com${path}`],
      ["a sibling subdomain", `https://canary.discord.com${path}`],
      ["a host that ends with it", `https://notdiscord.com${path}`],
      ["a trailing dot", `https://discord.com.${path}`],
      ["the host in the user part", `https://discord.com@evil.test${path}`],
      [
        "the host in the user part, with a password",
        `https://discord.com:x@evil.test${path}`,
      ],
      ["credentials for the real host", `https://user:pass@discord.com${path}`],
      ["the host after a fragment", `https://evil.test#@discord.com${path}`],
      [
        "a backslash that the parser would turn into a slash",
        `https://discord.com\\@evil.test${path}`,
      ],
      ["a port", `https://discord.com:8443${path}`],
      ["a port of the local machine", `https://discord.com:22${path}`],
      ["an address in numbers", `https://127.0.0.1${path}`],
      ["an address in numbers, in hexadecimal", `https://0x7f000001${path}`],
      ["the name of the local machine", `https://localhost${path}`],
      ["a cloud metadata address", `https://169.254.169.254${path}`],
      ["an IPv6 address", `https://[::1]${path}`],
      ["a lookalike letter in the host", `https://discоrd.com${path}`],
      ["a query", `https://discord.com${path}?wait=true`],
      [
        "a query that points somewhere else",
        `https://discord.com${path}?url=https://evil.test`,
      ],
      ["a fragment", `https://discord.com${path}#x`],
      ["no id", `https://discord.com/api/webhooks/${fakeWebhookToken}`],
      ["no token", `https://discord.com/api/webhooks/${fakeWebhookId}`],
      [
        "another path",
        `https://discord.com/api/users/${fakeWebhookId}/${fakeWebhookToken}`,
      ],
      ["a path of the site", "https://discord.com/"],
      [
        "an id that is not a number",
        `https://discord.com/api/webhooks/abc/${fakeWebhookToken}`,
      ],
      [
        "an id that is too short",
        `https://discord.com/api/webhooks/12345/${fakeWebhookToken}`,
      ],
      [
        "a token that is too short",
        `https://discord.com/api/webhooks/${fakeWebhookId}/short`,
      ],
      [
        "characters that are not URL safe in the token",
        `https://discord.com/api/webhooks/${fakeWebhookId}/${"a".repeat(30)}!!`,
      ],
      [
        "an encoded slash",
        `https://discord.com/api/webhooks/${fakeWebhookId}%2F${fakeWebhookToken}`,
      ],
      [
        "an encoded dot segment",
        `https://discord.com/api/webhooks/%2e%2e/${fakeWebhookToken}`,
      ],
      [
        "a dot segment that climbs out of the path",
        `https://discord.com/api/webhooks/../../x/${fakeWebhookId}/${fakeWebhookToken}`,
      ],
      ["a path after the token", `https://discord.com${path}/extra`],
      ["a trailing slash", `https://discord.com${path}/`],
      [
        "a space inside",
        `https://discord.com/api/webhooks/${fakeWebhookId} /${fakeWebhookToken}`,
      ],
      ["a line break inside", `https://discord.com${path}\nhttps://evil.test`],
      ["a tab inside", `https://discord.com\t${path}`],
      ["a null character", `https://discord.com${path}\u0000`],
      ["two addresses", `${fakeWebhookUrl} ${fakeWebhookUrl}`],
    ];

    it.each(refused)("%s", (_name, input) => {
      expect(parseDiscordWebhookUrl(input)).toBeNull();
    });
  });

  it("refuses an address that is too long, even if its start is good", () => {
    const long = `${fakeWebhookUrl}${"a".repeat(maxWebhookUrlLength)}`;

    expect(parseDiscordWebhookUrl(long)).toBeNull();
  });
});

describe("maskWebhookUrl (SAG-27)", () => {
  it("shows the host, the id and the last four characters of the token, and nothing else", () => {
    const masked = maskWebhookUrl(fakeWebhookUrl);

    expect(masked).toBe(
      `https://discord.com/api/webhooks/${fakeWebhookId}/…${fakeWebhookToken.slice(-4)}`,
    );
    expect(masked).not.toContain(fakeWebhookToken);
    expect(masked).not.toContain(fakeWebhookToken.slice(0, 20));
  });

  it("shows nothing at all of something that is not an address", () => {
    expect(maskWebhookUrl("https://evil.test/secret-token-here")).toBe("…");
  });
});
