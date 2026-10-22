import { describe, expect, it } from "vitest";

import { canonicalEmail } from "./canonical-email";

describe("canonicalEmail", () => {
  describe("any provider", () => {
    it("trims and lowercases", () => {
      expect(canonicalEmail("  Ana.Perez@Example.COM \n")).toBe(
        "ana.perez@example.com",
      );
    });

    it("keeps dots and plus tags for other providers (they are different inboxes there)", () => {
      expect(canonicalEmail("ana.perez+news@example.com")).toBe(
        "ana.perez+news@example.com",
      );
    });

    it("turns full-width and other compatibility characters into plain ones (NFKC)", () => {
      expect(canonicalEmail("ａｎａ＠ｅｘａｍｐｌｅ．ｃｏｍ")).toBe(
        "ana@example.com",
      );
    });

    it("writes an international domain in its ASCII (punycode) form", () => {
      expect(canonicalEmail("user@münchen.de")).toBe("user@xn--mnchen-3ya.de");
      expect(canonicalEmail("user@MÜNCHEN.de")).toBe("user@xn--mnchen-3ya.de");
    });

    it("drops the trailing dot of the domain", () => {
      expect(canonicalEmail("ana@example.com.")).toBe("ana@example.com");
    });

    it("is idempotent", () => {
      for (const input of [
        "Ana.Perez+x@Gmail.com",
        "user@münchen.de",
        "ａｎａ@example.com",
      ]) {
        const once = canonicalEmail(input);
        expect(once).not.toBeNull();
        expect(canonicalEmail(once ?? "")).toBe(once);
      }
    });
  });

  describe("Gmail and Googlemail", () => {
    it.each([
      "ana.perez@gmail.com",
      "anaperez@gmail.com",
      "a.n.a.p.e.r.e.z@gmail.com",
      "ana.perez+newsletter@gmail.com",
      "anaperez+a+b@gmail.com",
      "Ana.Perez@GMAIL.COM",
      "anaperez@googlemail.com",
      "ana.perez+x@googlemail.com",
      "  AnaPerez@GoogleMail.com ",
    ])("%s is the same inbox as anaperez@gmail.com", (input) => {
      expect(canonicalEmail(input)).toBe("anaperez@gmail.com");
    });

    it("keeps different inboxes apart", () => {
      expect(canonicalEmail("ana@gmail.com")).not.toBe(
        canonicalEmail("ana2@gmail.com"),
      );
    });

    it("does not treat another domain like Gmail", () => {
      expect(canonicalEmail("ana.perez@gmail.example.com")).toBe(
        "ana.perez@gmail.example.com",
      );
      expect(canonicalEmail("ana.perez@notgmail.com")).toBe(
        "ana.perez@notgmail.com",
      );
    });

    it("rejects look-alike characters in the name, because Gmail names are only ASCII", () => {
      // Cyrillic "а" (U+0430) looks like the Latin "a", but it is not the same address.
      expect(canonicalEmail("аna@gmail.com")).toBeNull();
      // Turkish dotted capital I lowercases to "i" plus a combining dot.
      expect(canonicalEmail("İvan@gmail.com")).toBeNull();
    });

    it("rejects a name that is empty once dots and tags are removed", () => {
      expect(canonicalEmail("+news@gmail.com")).toBeNull();
      expect(canonicalEmail("...@gmail.com")).toBeNull();
    });
  });

  describe("invalid input", () => {
    it.each([
      "",
      "   ",
      "no-at-sign",
      "@example.com",
      "ana@",
      "ana@@example.com",
      "a@b@example.com",
      "ana @example.com",
      "ana@exa mple.com",
      "ana@localhost",
      "ana@example..com",
      "ana@-example.com",
      "ana@example-.com",
      "ana@127.0.0.1",
      "ana@127.1",
      "ana@[::1]",
    ])("returns null for %j", (input) => {
      expect(canonicalEmail(input)).toBeNull();
    });

    it("returns null when the address is longer than email allows", () => {
      expect(canonicalEmail(`${"a".repeat(250)}@example.com`)).toBeNull();
    });
  });
});
