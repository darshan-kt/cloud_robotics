// From-scratch binary parser for ROS's PGM (P5, binary grayscale) map
// format - reads the "P5" magic number, then width/height/maxval header
// tokens (skipping "#"-comment lines per the format spec), then blits the
// raw grayscale bytes into a canvas and exports a PNG data URL. No library
// for this: it's a small, well-understood binary format, and pulling in a
// whole image-parsing dependency just for it isn't worth it. If a real
// backend serves PNG/JPEG map tiles directly instead of raw .pgm, this file
// can be dropped entirely - see SimpleRoutePlannerPage's map-loading notes.

function isPgmWhitespace(byte: number): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

interface PgmHeader {
  width: number;
  height: number;
  maxval: number;
  dataOffset: number;
}

function parsePgmHeader(bytes: Uint8Array): PgmHeader {
  let offset = 0;

  function readToken(): string {
    // Skip whitespace and "#"-prefixed comment lines before the next token.
    while (offset < bytes.length) {
      const byte = bytes[offset];
      if (byte === 0x23 /* "#" */) {
        while (offset < bytes.length && bytes[offset] !== 0x0a) offset++;
        continue;
      }
      if (isPgmWhitespace(byte)) {
        offset++;
        continue;
      }
      break;
    }
    const start = offset;
    while (offset < bytes.length && !isPgmWhitespace(bytes[offset]) && bytes[offset] !== 0x23) {
      offset++;
    }
    return new TextDecoder("ascii").decode(bytes.subarray(start, offset));
  }

  const magic = readToken();
  if (magic !== "P5") {
    throw new Error(`Not a binary PGM (P5) file - got magic "${magic}"`);
  }
  const width = parseInt(readToken(), 10);
  const height = parseInt(readToken(), 10);
  const maxval = parseInt(readToken(), 10);

  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(maxval)) {
    throw new Error("Malformed PGM header - width/height/maxval didn't parse as numbers");
  }

  // Per the PGM spec, exactly one whitespace byte separates the maxval
  // token from the start of the binary pixel data. readToken()'s leading
  // whitespace-skip loop already consumed it, so `offset` now points
  // straight at the first data byte.
  return { width, height, maxval, dataOffset: offset };
}

/** Parses a raw PGM (P5) file into a PNG data URL, ready to hand to an
 * `Image`/`<img>`/canvas draw call. */
export function parsePgmToDataUrl(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const { width, height, maxval, dataOffset } = parsePgmHeader(bytes);

  const bytesPerSample = maxval > 255 ? 2 : 1;
  const expectedLength = width * height * bytesPerSample;
  if (dataOffset + expectedLength > bytes.length) {
    throw new Error("PGM file is shorter than its own header claims");
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  const imageData = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    const sampleOffset = dataOffset + i * bytesPerSample;
    const raw =
      bytesPerSample === 2
        ? (bytes[sampleOffset] << 8) | bytes[sampleOffset + 1]
        : bytes[sampleOffset];
    const gray = Math.round((raw / maxval) * 255);
    const p = i * 4;
    imageData.data[p] = gray;
    imageData.data[p + 1] = gray;
    imageData.data[p + 2] = gray;
    imageData.data[p + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);

  return canvas.toDataURL("image/png");
}

/** Small helper shared by every map-loading path (PGM, saved MapData, user
 * upload) - turns a data URL / object URL into a decoded, ready-to-draw
 * `HTMLImageElement`. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode image"));
    img.src = src;
  });
}
