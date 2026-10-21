import type { resources } from "./index";

// Typed translation keys: an unknown key in `t("...")` fails `npm run typecheck`.
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: (typeof resources)["es"];
  }
}
