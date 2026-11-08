import { describe, expect, it } from "vitest";

import { listTitleView } from "./title-view";

const mediaId = "0199a3c2-7d4e-7b1a-8c3f-aaaaaaaaaaaa";

describe("listTitleView (SAG-163)", () => {
  it("gives a known kind and the address of the title", () => {
    expect(
      listTitleView({ mediaId, type: "movie", title: "Dune", year: 2021 }),
    ).toEqual({
      mediaId,
      title: "Dune",
      year: 2021,
      type: "movie",
      href: `/media/movie/dune-${mediaId}`,
    });
  });

  it.each(["custom", "", "ANIME", "../x"])(
    "gives no kind and no address for the type %j",
    (type) => {
      expect(
        listTitleView({ mediaId, type, title: "Mine", year: null }),
      ).toEqual({ mediaId, title: "Mine", year: null, type: null, href: null });
    },
  );
});
