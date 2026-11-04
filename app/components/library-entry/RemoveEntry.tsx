import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { dangerButtonClass } from "~/lib/ui";

/** Takes the entry out of the library, behind a warning. */
export function RemoveEntry() {
  const { t } = useTranslation();
  return (
    <details className="border-border mt-8 rounded-md border">
      <summary className="cursor-pointer px-4 py-3 font-semibold">
        {t("library.editor.remove.summary")}
      </summary>
      <Form method="post" className="border-border space-y-3 border-t p-4">
        <input type="hidden" name="intent" value="remove" />
        <p>{t("library.editor.remove.warning")}</p>
        <button type="submit" className={dangerButtonClass}>
          {t("library.editor.remove.confirm")}
        </button>
      </Form>
    </details>
  );
}
