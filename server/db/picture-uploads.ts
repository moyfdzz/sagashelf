import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";

/** How long the record of each try is kept, also after the account is erased (ADR-038). */
export const pictureUploadRetentionDays = 90;

export type PictureUploadRecord = {
  userId: string;
  sha256: string;
  result: "allowed" | "rejected" | "unavailable";
  scores: Record<string, number> | null;
  ipAddress: string | null;
};

/** Writes the record of one try. Nothing is published unless this succeeded. */
export async function recordPictureUpload(
  db: SqlExecutor,
  record: PictureUploadRecord,
): Promise<void> {
  const { userId, sha256, result, scores, ipAddress } = record;
  await db.execute(sql`
    INSERT INTO picture_uploads (user_id, sha256, result, scores, ip_address)
    VALUES (
      ${userId}::uuid, ${sha256}, ${result},
      ${scores === null ? null : JSON.stringify(scores)}::jsonb,
      ${ipAddress}
    )
  `);
}

/** Deletes what is past its time. It is one statement, in a job of the crons. */
export async function prunePictureUploads(db: SqlExecutor): Promise<number> {
  const { rows } = await db.execute(sql`
    WITH deleted AS (
      DELETE FROM picture_uploads
      WHERE created_at < now() - make_interval(days => ${pictureUploadRetentionDays}::int)
      RETURNING 1
    )
    SELECT count(*)::int AS deleted FROM deleted
  `);
  return Number(rows[0]?.deleted ?? 0);
}

/** The hash of a file, in hexadecimal: what identifies the file without keeping it. */
export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
