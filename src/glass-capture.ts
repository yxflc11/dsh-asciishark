import { GLASS_WORKER_SOURCE } from "./worker-source.generated";

/** One small image in flight, including encoding and decoding. The visible
 * SVG filter reads an immutable image instead of a changing Canvas resource. */
export class GlassCapture {
  private worker: Worker;
  private workerUrl: string;
  private urls = new Set<string>();
  private displayedUrl = "";
  private sequence = 0;
  private disposed = false;
  private pending: { id: number; accept: () => boolean; complete: (accepted: boolean) => void } | null = null;
  private decoding: HTMLImageElement | null = null;

  static supported() { return typeof Image === "function" && typeof Image.prototype.decode === "function"; }

  constructor(readonly element: HTMLImageElement, private failed: () => void) {
    this.workerUrl = URL.createObjectURL(new Blob([GLASS_WORKER_SOURCE], { type: "text/javascript" }));
    try { this.worker = new Worker(this.workerUrl); }
    catch (error) { URL.revokeObjectURL(this.workerUrl); throw error; }
    this.worker.onmessage = event => { void this.receive(event.data); };
    this.worker.onerror = () => this.fail();
    element.alt = "";
    element.decoding = "async";
  }

  get busy() { return this.pending !== null; }

  render(bitmap: ImageBitmap, scheme: "light" | "dark", w: number, h: number,
    accept: () => boolean, complete: (accepted: boolean) => void) {
    if (this.disposed || this.busy) { bitmap.close(); return; }
    const id = ++this.sequence;
    this.pending = { id, accept, complete };
    try { this.worker.postMessage({ type: "draw", requestId: id, bitmap, scheme, w, h }, [bitmap]); }
    catch { bitmap.close(); this.fail(); }
  }

  private release(url: string) {
    if (this.urls.delete(url)) URL.revokeObjectURL(url);
  }

  private async receive(data: { type?: string; requestId?: number; blob?: Blob; failed?: boolean }) {
    const job = this.pending;
    if (this.disposed || !job || data.type !== "image" || data.requestId !== job.id) return;
    if (data.failed || !data.blob) { this.fail(); return; }
    // A theme/geometry change can make a result obsolete before decoding starts.
    if (!job.accept()) { this.pending = null; job.complete(false); return; }
    const url = URL.createObjectURL(data.blob);
    this.urls.add(url);
    const image = new Image(); this.decoding = image;
    image.decoding = "async"; image.src = url;
    try {
      await image.decode();
      if (this.disposed || this.pending !== job) { this.release(url); return; }
      const accepted = job.accept();
      if (accepted) {
        const previous = this.displayedUrl;
        this.element.src = url;
        this.displayedUrl = url;
        this.release(previous);
      } else this.release(url);
      this.decoding = null;
      this.pending = null;
      job.complete(accepted);
    } catch {
      this.release(url);
      if (!this.disposed && this.pending === job) this.fail();
    }
  }

  private fail() {
    if (this.disposed) return;
    this.destroy();
    this.failed();
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.onmessage = null; this.worker.onerror = null;
    this.worker.terminate();
    URL.revokeObjectURL(this.workerUrl);
    this.decoding?.removeAttribute("src"); this.decoding = null;
    this.pending = null;
    for (const url of [...this.urls]) this.release(url);
    this.displayedUrl = "";
  }
}
