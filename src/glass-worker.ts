import { INK_FILTER } from "./ocean-colors";

/**
 * Main → worker: draw { requestId, bitmap, w, h, scheme } / dispose
 * Worker → main: image { requestId, blob } / image { requestId, failed: true }
 * Input bitmaps are raw, already cropped/downsampled ocean snapshots. No init
 * is needed. Keep PNG encoding separate from the ocean's animation worker.
 */
type DrawMessage = {
  type: "draw";
  requestId: string | number;
  bitmap: ImageBitmap;
  w: number;
  h: number;
  scheme: "light" | "dark";
};

let canvas: OffscreenCanvas | null = null;
let busy = false;
let disposed = false;

async function draw(data: DrawMessage) {
  const { bitmap, requestId, w, h, scheme } = data;
  try {
    if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 1 || h < 1 ||
      !bitmap || bitmap.width !== w || bitmap.height !== h ||
      (scheme !== "light" && scheme !== "dark")) {
      throw new Error("Invalid glass snapshot");
    }
    if (!canvas) canvas = new OffscreenCanvas(w, h);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas2D unavailable");

    // Preserve the baseline order: the ocean worker downsamples first, then
    // this worker applies the color filter at 1:1 with the same default alpha.
    context.clearRect(0, 0, w, h);
    context.save();
    try {
      context.filter = scheme === "light" ? INK_FILTER : "none";
      context.drawImage(bitmap, 0, 0);
    } finally {
      context.restore();
    }
    const blob = await canvas.convertToBlob({ type: "image/png" });
    if (!disposed) self.postMessage({ type: "image", requestId, blob });
  } catch {
    if (!disposed) self.postMessage({ type: "image", requestId, failed: true });
  } finally {
    bitmap?.close();
    busy = false;
  }
}

self.onmessage = (event: MessageEvent<DrawMessage | { type: "dispose" }>) => {
  const data = event.data;
  if (data?.type === "dispose") {
    disposed = true;
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
      canvas = null;
    }
    return;
  }
  if (data?.type !== "draw") return;
  if (disposed || busy) {
    data.bitmap?.close();
    if (!disposed) self.postMessage({ type: "image", requestId: data.requestId, failed: true });
    return;
  }
  busy = true;
  void draw(data);
};
