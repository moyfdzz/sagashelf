import { z } from "zod";

/** What can be reported from a profile (ADR-038): the picture of a person, or the person. */
export const profileReportKinds = ["picture", "user"] as const;
export type ProfileReportKind = (typeof profileReportKinds)[number];

/** Everything that can be reported: a review too, from its own page (SAG-22, ADR-057). */
export const reportKinds = [...profileReportKinds, "review"] as const;
export type ReportKind = (typeof reportKinds)[number];

export const pictureReasons = [
  "sexual_content",
  "sexual_minors",
  "other_person",
  "violent",
  "other",
] as const;

export const userReasons = [
  "spam",
  "harassment",
  "impersonation",
  "hate",
  "other",
] as const;

/** A review: `spoiler` is a spoiler with no mark, which the author can still fix (ADR-057). */
export const reviewReasons = [
  "spoiler",
  "spam",
  "harassment",
  "hate",
  "sexual_content",
  "other",
] as const;

export type ReportReason =
  | (typeof pictureReasons)[number]
  | (typeof userReasons)[number]
  | (typeof reviewReasons)[number];

/** Serious enough to hide the picture at once and never to be taken back by the reporter. */
export const hidingReason = "sexual_minors";

/** The column of the table allows the same. */
export const maxReportDetails = 1000;

export const reasonsOf = (kind: ReportKind): readonly ReportReason[] => {
  switch (kind) {
    case "picture":
      return pictureReasons;
    case "user":
      return userReasons;
    case "review":
      return reviewReasons;
  }
};

export const isReportKind = (value: unknown): value is ReportKind =>
  reportKinds.includes(value as ReportKind);

export const isProfileReportKind = (
  value: unknown,
): value is ProfileReportKind =>
  profileReportKinds.includes(value as ProfileReportKind);

export const isReportReason = (value: unknown): value is ReportReason =>
  reportKinds.some((kind) => reasonsOf(kind).includes(value as ReportReason));

/**
 * The reasons the reporter must explain in the details: "other", and a spoiler, so the reviewer
 * knows what it gives away without reading the whole review for it.
 */
export const reasonNeedsDetails = (reason: string) =>
  reason === "other" || reason === "spoiler";

/** A report can be taken back while nobody has answered it, and never a report of minors. */
export const canCancelReport = (report: { reason: string; status: string }) =>
  report.status === "open" && report.reason !== hidingReason;

/**
 * The form of a report, for the kinds a page offers: a profile sends its kind, a review page sends
 * `review`. The reason must be one of the kind, and some reasons need the details.
 */
const reportForm = <Kinds extends readonly [ReportKind, ...ReportKind[]]>(
  kinds: Kinds,
) =>
  z
    .discriminatedUnion("intent", [
      z.strictObject({
        intent: z.literal("report"),
        kind: z.enum(kinds),
        reason: z.string(),
        details: z.string().trim().max(maxReportDetails).optional(),
      }),
      z.strictObject({ intent: z.literal("cancel"), id: z.uuid() }),
    ])
    .superRefine((form, context) => {
      if (form.intent !== "report") return;
      if (!reasonsOf(form.kind).includes(form.reason as ReportReason)) {
        context.addIssue({ code: "custom", message: "invalid_reason" });
      } else if (reasonNeedsDetails(form.reason) && !form.details) {
        context.addIssue({ code: "custom", message: "details_required" });
      }
    });

export const reportFormSchema = reportForm(profileReportKinds);
export const reviewReportFormSchema = reportForm(["review"] as const);

/** The type of the notification a person gets when an administrator warns them (ADR-040). */
export const warningType = "moderation.warning";

/**
 * What the notification of a warning says, from its payload, or null when it is not readable: the
 * kind and the reason, and never who reported or the picture.
 */
export function warningNotice(payload: Record<string, unknown>) {
  const { kind, reason } = payload;
  if (!isReportKind(kind) || !isReportReason(reason)) return null;
  return { kind, reason };
}

/**
 * What the notification of a report says, from its payload, or null when it is not readable. Only
 * the kind, the reason and the username: never the image and never who reported.
 */
export function reportNotice(payload: Record<string, unknown>) {
  const { kind, reason, username } = payload;
  if (!isReportKind(kind) || !isReportReason(reason)) return null;
  if (typeof username !== "string" || !username) return null;
  return { kind, reason, username };
}

const uuidShape =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * What a notification about the author's own review says (ADR-057), from its payload, or null when
 * it is not readable: the title, its id for the link to the review, and the reason of the report.
 * Never who reported.
 */
export function reviewModerationNotice(payload: Record<string, unknown>) {
  const { mediaId, title, reason } = payload;
  if (typeof mediaId !== "string" || !uuidShape.test(mediaId)) return null;
  if (typeof title !== "string" || !title) return null;
  return {
    mediaId,
    title,
    reason: reasonsOf("review").includes(reason as ReportReason)
      ? (reason as ReportReason)
      : null,
  };
}
