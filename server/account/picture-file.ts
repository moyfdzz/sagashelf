/**
 * The page makes a picture small before sending it, about 512 px wide and far under this limit. A
 * bigger file did not come from the page.
 */
export const maxPictureBytes = 1024 * 1024;

export type PictureType = "image/jpeg" | "image/png" | "image/webp";

const startsWith = (bytes: Uint8Array, expected: readonly number[], at = 0) =>
  expected.every((byte, index) => bytes[at + index] === byte);

/**
 * The real type of a file, read from its first bytes, or null when it is not one of the three that
 * are accepted. The name and the type a browser sends can say anything. An SVG is refused because
 * it can carry a script, and so is anything else that is not a plain picture.
 */
export function pictureType(bytes: Uint8Array): PictureType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  // "RIFF", four bytes of size, then "WEBP".
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }
  return null;
}
