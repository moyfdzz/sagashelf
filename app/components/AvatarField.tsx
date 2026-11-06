import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { shrinkPicture, type ShrunkPicture } from "~/lib/picture";
import { primaryButtonClass, secondaryButtonClass } from "~/lib/ui";
import type { action } from "~/routes/settings.avatar";

/**
 * The picture of the profile (SAG-109): choose one, see it as it will look, then save it or remove
 * the one there is. The server checks it again and asks the moderation service before it is saved
 * (ADR-037), so nothing here is trusted.
 */
export function AvatarField({
  avatarUrl,
  name,
  canUpload,
}: {
  avatarUrl: string | null;
  name: string;
  /** False when this deployment has no moderation, and so takes no pictures. */
  canUpload: boolean;
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof action>();
  const [chosen, setChosen] = useState<ShrunkPicture | null>(null);
  const [unreadable, setUnreadable] = useState(false);
  const [seenSave, setSeenSave] = useState(0);

  const busy = fetcher.state !== "idle";
  const answer = fetcher.data;
  const error = answer && "error" in answer ? answer.error : null;
  const savedAt = answer && "ok" in answer && answer.ok ? answer.savedAt : 0;
  // A save that was not seen yet ends the preview and empties the field (its key changes).
  if (savedAt !== seenSave) {
    setSeenSave(savedAt);
    setChosen(null);
  }

  async function choose(file: File | undefined) {
    setChosen(null);
    setUnreadable(false);
    if (!file) return;
    const shrunk = await shrinkPicture(file);
    if (shrunk) setChosen(shrunk);
    else setUnreadable(true);
  }

  function send(form: FormData) {
    void fetcher.submit(form, {
      method: "post",
      action: "/settings/avatar",
      encType: "multipart/form-data",
    });
  }

  function upload() {
    if (!chosen) return;
    const form = new FormData();
    form.set("intent", "upload");
    form.set("picture", chosen.blob, "picture.jpg");
    send(form);
  }

  function remove() {
    const form = new FormData();
    form.set("intent", "remove");
    send(form);
  }

  const shown = chosen?.preview ?? avatarUrl;

  return (
    <section aria-labelledby="avatar-title" className="mt-8 space-y-3">
      <h2 id="avatar-title" className="font-semibold">
        {t("settings.avatar.title")}
      </h2>
      <div className="flex flex-wrap items-center gap-4">
        {shown ? (
          <img
            src={shown}
            alt={t("settings.avatar.alt", { name })}
            width={96}
            height={96}
            className="size-24 rounded-full object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="bg-accent text-accent-fg flex size-24 items-center justify-center rounded-full text-3xl font-bold"
          >
            {name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-3">
          {canUpload ? (
            <div>
              <label htmlFor="avatar-file" className="block font-semibold">
                {t("settings.avatar.choose")}
              </label>
              <input
                key={seenSave}
                id="avatar-file"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={busy}
                aria-describedby="avatar-hint"
                onChange={(event) => void choose(event.target.files?.[0])}
                className="mt-1 block w-full max-w-full text-sm"
              />
            </div>
          ) : null}
          <div className="flex flex-wrap gap-3">
            {chosen ? (
              <button
                type="button"
                disabled={busy}
                onClick={upload}
                className={`${primaryButtonClass} disabled:opacity-60`}
              >
                {busy ? t("settings.avatar.saving") : t("settings.avatar.save")}
              </button>
            ) : null}
            {avatarUrl && !chosen ? (
              <button
                type="button"
                disabled={busy}
                onClick={remove}
                className={`${secondaryButtonClass} disabled:opacity-60`}
              >
                {t("settings.avatar.remove")}
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <p id="avatar-hint" className="text-fg-muted text-sm">
        {canUpload ? t("settings.avatar.hint") : t("settings.avatar.off")}
      </p>
      {unreadable || error ? (
        <p role="alert" className="text-danger-text text-sm font-semibold">
          {t(
            `settings.avatar.errors.${unreadable ? "unreadable" : (error ?? "failed")}`,
          )}
        </p>
      ) : null}
      {savedAt && !chosen ? (
        <p role="status" className="text-sm font-semibold">
          {t("settings.avatar.saved")}
        </p>
      ) : null}
    </section>
  );
}
