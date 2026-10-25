import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("sign-in/*", "routes/sign-in.tsx"),
  route("sign-up/*", "routes/sign-up.tsx"),
  route("search", "routes/search.tsx"),
  route("sign-out", "routes/sign-out.tsx"),
  route("privacy", "routes/privacy.tsx"),
  route("terms", "routes/terms.tsx"),
  route("community", "routes/community.tsx"),
  route("credits", "routes/credits.tsx"),
  route("settings/profile", "routes/settings.profile.tsx"),
  route("settings/export", "routes/settings.export.ts"),
  route("settings/delete", "routes/settings.delete.ts"),
  route("settings/username", "routes/settings.username.ts"),
  route("api/health", "routes/api.health.ts"),
  route("api/locale", "routes/api.locale.ts"),
  route("webhooks/clerk", "routes/webhooks.clerk.ts"),
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
