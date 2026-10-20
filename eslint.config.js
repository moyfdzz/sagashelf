import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "build/",
      ".react-router/",
      ".wrangler/",
      "coverage/",
      "playwright-report/",
      "test-results/",
      "worker-configuration.d.ts",
    ],
  },
  js.configs.recommended,
  tseslint.configs.strict,
  {
    files: ["**/*.{ts,tsx}"],
    ...react.configs.flat.recommended,
    settings: { react: { version: "detect" } },
  },
  {
    files: ["**/*.{ts,tsx}"],
    ...react.configs.flat["jsx-runtime"],
  },
  { files: ["**/*.{ts,tsx}"], ...jsxA11y.flatConfigs.recommended },
  reactHooks.configs.flat.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      // TypeScript already checks props.
      "react/prop-types": "off",
    },
  },
  {
    // server/ holds database, provider and secret-handling code. UI building
    // blocks must never import it; only route loaders/actions may.
    files: ["app/components/**", "app/lib/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["~server/*", "**/server/*", "**/server"],
              message:
                "server/ code must not be imported from components or client libraries.",
            },
          ],
        },
      ],
    },
  },
  {
    // The other direction: server code stays independent of the UI layer.
    files: ["server/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["~/*", "**/app/*"],
              message: "server/ must not import from app/.",
            },
          ],
        },
      ],
    },
  },
  prettier,
);
