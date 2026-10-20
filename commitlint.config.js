export default {
  extends: ["@commitlint/config-conventional"],
  plugins: [
    {
      rules: {
        "scope-is-ticket": ({ scope }) => [
          /^SAG-\d+$/.test(scope ?? ""),
          "scope must be a ticket like SAG-12, e.g. feat(SAG-12): add saga page",
        ],
      },
    },
  ],
  rules: {
    "scope-is-ticket": [2, "always"],
  },
};
