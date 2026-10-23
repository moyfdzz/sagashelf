// Builds the raster icons from public/favicon.svg, the one source of the logo:
//   public/favicon.ico        16, 32 and 48 px (PNG images inside an ICO file)
//   public/apple-touch-icon.png  180 px, square (iOS rounds the corners itself)
//   public/icon-512.png       512 px, square
// Run with `node scripts/build-icons.mjs` after changing the SVG. It uses Playwright, which the
// project already has; `npx playwright install chromium` once if the browser is missing.
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const svg = await readFile("public/favicon.svg", "utf8");
// The tab icon has rounded corners; the app icons are full squares.
const square = svg.replace(/rx="224"/, 'rx="0"');

const browser = await chromium.launch();

async function render(source, size) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
  });
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(source).toString("base64")}`;
  await page.setContent(
    `<body style="margin:0;background:transparent"><img src="${dataUrl}" width="${size}" height="${size}" style="display:block"></body>`,
  );
  const png = await page.screenshot({ omitBackground: true });
  await page.close();
  return png;
}

function ico(images) {
  // ICONDIR (6 bytes), one ICONDIRENTRY (16 bytes) per image, then the PNG files.
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size, 0);
    entry.writeUInt8(size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

const icoImages = [];
for (const size of [16, 32, 48]) {
  icoImages.push({ size, png: await render(svg, size) });
}
await writeFile("public/favicon.ico", ico(icoImages));
await writeFile("public/apple-touch-icon.png", await render(square, 180));
await writeFile("public/icon-512.png", await render(square, 512));

await browser.close();
console.log(
  "favicon.ico, apple-touch-icon.png and icon-512.png written to public/",
);
