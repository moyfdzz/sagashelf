import { data } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/settings.export";
import { exportAccount, profileCsv } from "~server/account/export";
import { requireUser } from "~server/auth/require";
import { rateLimit } from "~server/rate-limit";
import { getDb, getWriteLimiter } from "~server/runtime-env";
import { readForm } from "~server/http/body";

// The form has one button. Anything bigger is not from this page.
const maxFormBytes = 1024;

const formSchema = z.strictObject({ format: z.enum(["json", "csv"]) });

// Answering before the body is read leaves it open (see settings.profile.tsx).
async function answerWithoutReading<T>(request: Request, response: T) {
  await request.arrayBuffer().catch(() => undefined);
  return response;
}

// Only the button of the settings page asks for the file, with a POST.
export function loader() {
  throw data({ error: "method_not_allowed" }, { status: 405 });
}

export async function action(args: Route.ActionArgs) {
  const { request } = args;

  if (Number(request.headers.get("Content-Length") ?? 0) > maxFormBytes) {
    return answerWithoutReading(
      request,
      data({ error: "invalid_request" }, { status: 413 }),
    );
  }

  // A page on another site must not be able to start the download.
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return answerWithoutReading(
      request,
      data({ error: "forbidden" }, { status: 403 }),
    );
  }

  // The person is the one in the verified session, never a field of the form.
  const user = await requireUser(args);

  const limited = await rateLimit(
    getWriteLimiter(),
    request,
    `export:${user.id}`,
  );
  if (limited) return answerWithoutReading(request, limited);

  const parsed = formSchema.safeParse(await readForm(request, maxFormBytes));
  if (!parsed.success) {
    return data({ error: "invalid_request" }, { status: 400 });
  }

  const account = await exportAccount(await getDb(), user.id);
  if (!account) throw data({ error: "forbidden" }, { status: 403 });

  const day = account.exportedAt.slice(0, 10);
  const json = parsed.data.format === "json";
  return new Response(
    json ? JSON.stringify(account, null, 2) : profileCsv(account),
    {
      headers: {
        "Content-Type": json
          ? "application/json; charset=utf-8"
          : "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="sagashelf-data-${day}.${parsed.data.format}"`,
        // The file is one person's data: no shared cache keeps it.
        "Cache-Control": "private, no-store",
      },
    },
  );
}
