import js from "@eslint/js";
import prettier from "eslint-config-prettier";
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
  tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
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
  prettier,
);
