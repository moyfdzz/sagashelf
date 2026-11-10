import { describe, expect, it } from "vitest";

import { airedIn, simplifyTitle } from "./match";

describe("simplifyTitle", () => {
  it("drops a subtitle after a colon and a season marker", () => {
    expect(simplifyTitle("Serie de prueba: Segundo arco")).toBe(
      "Serie de prueba",
    );
    expect(simplifyTitle("Serie de prueba Season 3")).toBe("Serie de prueba");
    expect(simplifyTitle("Serie de prueba 2nd Season")).toBe("Serie de prueba");
    expect(simplifyTitle("Serie de prueba II")).toBe("Serie de prueba");
    expect(simplifyTitle("Serie de prueba 2")).toBe("Serie de prueba");
  });

  it("leaves a title with nothing to drop as it is, so no second search is made", () => {
    expect(simplifyTitle("Serie de prueba")).toBe("Serie de prueba");
    // A colon with no space is part of the name, not a subtitle.
    expect(simplifyTitle("Re:Cero de prueba")).toBe("Re:Cero de prueba");
    expect(simplifyTitle("Serie 10")).toBe("Serie 10");
  });

  it("never answers an empty text", () => {
    expect(simplifyTitle(": solo subtitulo")).toBe(": solo subtitulo");
  });
});

describe("airedIn", () => {
  const show = {
    first_air_date: "2010-04-01",
    last_air_date: "2014-09-30",
    seasons: [
      { air_date: "2010-04-01" },
      { air_date: null },
      { air_date: "2014-01-05" },
    ],
  };

  it("accepts a year inside the range of the series, or the year of a season", () => {
    expect(airedIn(show, 2010)).toBe(true);
    expect(airedIn(show, 2012)).toBe(true);
    expect(airedIn(show, 2014)).toBe(true);
    expect(airedIn({ seasons: [{ air_date: "2020-01-01" }] }, 2020)).toBe(true);
  });

  it("rejects a year outside the range and any season", () => {
    expect(airedIn(show, 2009)).toBe(false);
    expect(airedIn(show, 2015)).toBe(false);
    expect(airedIn({}, 2015)).toBe(false);
  });

  it("takes the first year as the only bound of a series with no last date", () => {
    expect(airedIn({ first_air_date: "2022-01-01" }, 2022)).toBe(true);
    expect(airedIn({ first_air_date: "2022-01-01" }, 2023)).toBe(false);
  });
});
