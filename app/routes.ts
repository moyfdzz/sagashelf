import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("sign-in/*", "routes/sign-in.tsx"),
  route("sign-up/*", "routes/sign-up.tsx"),
  route("api/health", "routes/api.health.ts"),
  route("api/locale", "routes/api.locale.ts"),
  route("webhooks/clerk", "routes/webhooks.clerk.ts"),
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
