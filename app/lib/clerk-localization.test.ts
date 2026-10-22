import { esMX } from "@clerk/localizations";
import { describe, expect, it } from "vitest";

import { spanish } from "./clerk-localization";

describe("Clerk Spanish localization", () => {
  it("fills the username placeholder that es-MX leaves empty", () => {
    expect(esMX.formFieldInputPlaceholder__username).toBeUndefined();
    expect(spanish.formFieldInputPlaceholder__username).toBe(
      "Ingresa tu nombre de usuario",
    );
  });

  it("keeps what es-MX already translates", () => {
    expect(spanish.formFieldLabel__username).toBe(
      esMX.formFieldLabel__username,
    );
    expect(spanish.signIn?.start?.title).toBe(esMX.signIn?.start?.title);
  });

  it("translates the bot check in both flows", () => {
    expect(spanish.signIn?.protectCheck?.title).toBe(
      "Verificando tu solicitud",
    );
    expect(spanish.signUp?.protectCheck?.title).toBe(
      "Verificando tu solicitud",
    );
  });
});
