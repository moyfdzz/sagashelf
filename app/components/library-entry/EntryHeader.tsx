import { useTranslation } from "react-i18next";

import { BackLink } from "~/components/BackLink";
import type { LibraryEntryData } from "~/routes/library.$mediaId";
import { forwardLinkClass } from "~/lib/ui";

type Props = {
  media: LibraryEntryData["media"];
  /** The library the person came from, kept from the first load of the page. */
  libraryPathBack: string;
};

/** The way back to the library, and the poster, the name and the kind of the title. */
export function EntryHeader({ media, libraryPathBack }: Props) {
  const { t } = useTranslation();
  return (
    <>
      <p>
        <BackLink to={libraryPathBack} router>
          {t("library.editor.back")}
        </BackLink>
      </p>

      <div className="mt-4 flex gap-4">
        {media.poster ? (
          <img
            src={media.poster}
            alt={t("media.posterAlt", { title: media.title })}
            width={96}
            height={144}
            className="border-border h-36 w-24 shrink-0 rounded-md border"
          />
        ) : null}
        <div>
          <h1 className="text-3xl font-bold">{media.title}</h1>
          <p className="text-fg-muted mt-1 font-semibold">
            {t(`media.kinds.${media.type as "movie"}`)}
            {media.year ? ` ${t("search.year", { year: media.year })}` : ""}
          </p>
          <p className="mt-2">
            <a href={media.detailPath} className={forwardLinkClass}>
              {t("library.editor.viewTitle")}
            </a>
          </p>
        </div>
      </div>
    </>
  );
}
