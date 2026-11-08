import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useFetcher, useNavigate, useSearchParams } from "react-router";

import { ConfirmDialog } from "~/components/ConfirmDialog";
import { StatusRegion } from "~/components/StatusRegion";
import { shrinkPicture, type ShrunkPicture } from "~/lib/picture";
import {
  dangerButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "~/lib/ui";
import type { action } from "~/routes/settings.avatar";

const page = "/settings/profile";
const confirmWord = "remove_picture";

/**
 * The picture of the profile (SAG-109, SAG-144): choose one, see it as it will look, then save it or
 * discard it, or remove the one there is, which asks first. The server checks it again and asks the
 * moderation service before it is saved (ADR-037), so nothing here is trusted.
 *
 * The control of the browser writes "Choose File" in the language of the browser, which the page
 * cannot change. So it is hidden from the eye and stays in the page, reachable with the keyboard,
 * and its label is drawn as the button. `peer` carries its focus and its state to the label.
 */
export function AvatarField({
  avatarUrl,
  name,
  canUpload,
  canRemove,
}: {
  avatarUrl: string | null;
  name: string;
  /** False when this deployment has no moderation, and so takes no pictures. */
  canUpload: boolean;
  /** False when the image is the one Clerk generates, so there is nothing to remove. */
  canRemove: boolean;
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [chosen, setChosen] = useState<
    (ShrunkPicture & { fileName: string }) | null
  >(null);
  const [unreadable, setUnreadable] = useState(false);
  const [seenSave, setSeenSave] = useState(0);
  // A new key empties the control, so the same file can be chosen again after discarding it.
  const [inputKey, setInputKey] = useState(0);

  const busy = fetcher.state !== "idle";
  const answer = fetcher.data;
  const error = answer && "error" in answer ? answer.error : null;
  const savedAt = answer && "ok" in answer && answer.ok ? answer.savedAt : 0;
  // A save that was not seen yet ends the preview and empties the field.
  if (savedAt !== seenSave) {
    setSeenSave(savedAt);
    setChosen(null);
    setInputKey((key) => key + 1);
  }

  async function choose(file: File | undefined) {
    setChosen(null);
    setUnreadable(false);
    if (!file) return;
    const shrunk = await shrinkPicture(file);
    if (shrunk) setChosen({ ...shrunk, fileName: file.name });
    else setUnreadable(true);
  }

  function discard() {
    setChosen(null);
    setUnreadable(false);
    setInputKey((key) => key + 1);
  }

  function upload() {
    if (!chosen) return;
    const form = new FormData();
    form.set("intent", "upload");
    form.set("picture", chosen.blob, "picture.jpg");
    void fetcher.submit(form, {
      method: "post",
      action: "/settings/avatar",
      encType: "multipart/form-data",
    });
  }

  const shown = chosen?.preview ?? avatarUrl;
  const removable = canRemove && avatarUrl !== null;
  const confirming = removable && searchParams.get("confirm") === confirmWord;

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
          <div className="flex flex-wrap items-center gap-3">
            {canUpload ? (
              <>
                <input
                  key={inputKey}
                  id="avatar-file"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={busy}
                  aria-describedby="avatar-hint"
                  onChange={(event) => void choose(event.target.files?.[0])}
                  className="peer sr-only"
                />
                <label
                  htmlFor="avatar-file"
                  className={`${secondaryButtonClass} peer-focus-visible:outline-accent inline-block cursor-pointer peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-disabled:cursor-default peer-disabled:opacity-60`}
                >
                  {chosen
                    ? t("settings.avatar.chooseAnother")
                    : t("settings.avatar.choose")}
                </label>
              </>
            ) : null}
            {chosen ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={upload}
                  className={primaryButtonClass}
                >
                  {busy
                    ? t("settings.avatar.saving")
                    : t("settings.avatar.save")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={discard}
                  className={`${secondaryButtonClass} disabled:opacity-60`}
                >
                  {t("settings.avatar.discard")}
                </button>
              </>
            ) : removable && !busy ? (
              <Link
                to={`${page}?confirm=${confirmWord}`}
                preventScrollReset
                className={`${dangerButtonClass} inline-block`}
              >
                {t("settings.avatar.remove")}
              </Link>
            ) : null}
          </div>
          {chosen ? (
            <p className="text-sm break-all">
              {t("settings.avatar.chosen", { name: chosen.fileName })}
            </p>
          ) : null}
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
      <StatusRegion
        message={savedAt && !chosen ? t("settings.avatar.saved") : null}
        messageKey={savedAt}
      />
      {confirming ? (
        <ConfirmDialog
          title={t("settings.avatar.removeTitle")}
          message={t("settings.avatar.removeWarning")}
          cancelHref={page}
          cancelLabel={t("settings.avatar.removeCancel")}
        >
          <fetcher.Form
            method="post"
            action="/settings/avatar"
            // The address that asked goes away, so the dialog does not come back with a new picture.
            onSubmit={() => void navigate(page, { replace: true })}
          >
            <input type="hidden" name="intent" value="remove" />
            <button type="submit" className={dangerButtonClass}>
              {t("settings.avatar.remove")}
            </button>
          </fetcher.Form>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
