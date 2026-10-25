import type { Route } from "./+types/img";
import { serveImage } from "~server/images/proxy";
import { getImageCache, getImageLimiter } from "~server/runtime-env";
import { rateLimit } from "~server/rate-limit";

// Only a real call to the provider counts against the limit; `serveImage` asks first.
export function loader({ params, request }: Route.LoaderArgs) {
  return serveImage(
    {
      cache: getImageCache(),
      allow: async () =>
        (await rateLimit(getImageLimiter(), request, "img")) === null,
    },
    params.provider,
    params.size,
    params.file,
  );
}
