import type { RendererBridgePort } from "../../contracts/renderer.ts";

/** Bridge consumers see only their integration capabilities, including partial installations. */
export function rendererPort(): RendererBridgePort | undefined {
    return window.JellyfinLyricMotion;
}
