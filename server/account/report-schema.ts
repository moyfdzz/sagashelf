import { z } from "zod";

/** What can be reported from a profile (ADR-038): the picture of a person, or the person. */
export const reportKinds = ["picture", "user"] as const;
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

export type ReportReason =
  (typeof pictureReasons)[number] | (typeof userReasons)[number];

/** Serious enough to hide the picture at once and never to be taken back by the reporter. */
export const hidingReason = "sexual_minors";

/** The column of the table allows the same. */
export const maxReportDetails = 1000;

export const reasonsOf = (kind: ReportKind): readonly ReportReason[] =>
  kind === "picture" ? pictureReasons : userReasons;

export const isReportKind = (value: unknown): value is ReportKind =>
  reportKinds.includes(value as ReportKind);

export const isReportReason = (value: unknown): value is ReportReason =>
  reasonsOf("picture").includes(value as ReportReason) ||
  reasonsOf("user").includes(value as ReportReason);

/** A report can be taken back while nobody has answered it, and never a report of minors. */
export const canCancelReport = (report: { reason: string; status: string }) =>
  report.status === "open" && report.reason !== hidingReason;

export const reportFormSchema = z
  .discriminatedUnion("intent", [
    z.strictObject({
      intent: z.literal("report"),
      kind: z.enum(reportKinds),
      reason: z.string(),
      details: z.string().trim().max(maxReportDetails).optional(),
    }),
    z.strictObject({ intent: z.literal("cancel"), id: z.uuid() }),
  ])
  .superRefine((form, context) => {
    if (form.intent !== "report") return;
    if (!reasonsOf(form.kind).includes(form.reason as ReportReason)) {
      context.addIssue({ code: "custom", message: "invalid_reason" });
    } else if (form.reason === "other" && !form.details) {
      context.addIssue({ code: "custom", message: "details_required" });
    }
  });

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
