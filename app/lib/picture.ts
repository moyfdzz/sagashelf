/** The side of the square that is sent. The biggest place a picture is drawn is 96 px. */
const side = 512;

const quality = 0.85;

export type ShrunkPicture = { blob: Blob; preview: string };

/**
 * Cuts the middle square of a picture and makes it small, in the browser, since the Worker has no
 * time to do it. Drawing it on a canvas also leaves out what the file carried besides the image,
 * such as the place where a photo was taken. Null when the browser cannot read the file as a
 * picture. The preview is a `data:` address because the policy of the page allows no `blob:` image.
 */
export async function shrinkPicture(file: File): Promise<ShrunkPicture | null> {
  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file);
  } catch {
    return null;
  }
  const crop = Math.min(image.width, image.height);
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const context = canvas.getContext("2d");
  if (!context) {
    image.close();
    return null;
  }
  // A JPEG has no transparency, which would turn black.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, side, side);
  context.drawImage(
    image,
    (image.width - crop) / 2,
    (image.height - crop) / 2,
    crop,
    crop,
    0,
    0,
    side,
    side,
  );
  image.close();
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", quality);
  });
  return blob
    ? { blob, preview: canvas.toDataURL("image/jpeg", quality) }
    : null;
}
