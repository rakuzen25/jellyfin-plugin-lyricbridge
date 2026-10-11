/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
interface ArtworkImage extends EventTarget {
    src: string;
    decoding: string;
    readonly complete: boolean;
    readonly naturalWidth: number;
}
/** Pending artwork belongs to one artwork generation and settles on cancellation. */
export class ArtworkLoader<TImage extends ArtworkImage> {
    private readonly createImage: () => TImage;
    private readonly timedOut: () => void;
    private readonly pending = new Set<() => void>();
    private disposed = false;
    constructor(createImage: () => TImage, timedOut: () => void) {
        this.createImage = createImage;
        this.timedOut = timedOut;
    }
    get pendingCount(): number {
        return this.pending.size;
    }
    load(url: string, timeoutMs: number): Promise<TImage> {
        if (this.disposed) return Promise.reject(new DOMException("Artwork owner was disposed.", "AbortError"));
        return new Promise((resolve, reject) => {
            const image = this.createImage();
            let settled = false;
            const finish = (error?: Error) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                image.removeEventListener("load", loaded);
                image.removeEventListener("error", failed);
                this.pending.delete(cancel);
                if (error) {
                    image.src = "";
                    reject(error);
                } else resolve(image);
            };
            const loaded = () => finish();
            const failed = () => finish(new Error("Artwork image load failed."));
            const cancel = () => finish(new DOMException("Artwork changed before loading finished.", "AbortError"));
            this.pending.add(cancel);
            const timer = setTimeout(
                () => {
                    this.timedOut();
                    finish(new Error("Artwork image load timed out."));
                },
                Math.max(1, timeoutMs),
            );
            image.addEventListener("load", loaded);
            image.addEventListener("error", failed);
            image.decoding = "async";
            image.src = url;
            if (image.complete && image.naturalWidth > 0) finish();
        });
    }
    invalidate(): void {
        for (const cancel of [...this.pending]) cancel();
    }
    dispose(): void {
        this.disposed = true;
        this.invalidate();
    }
}
