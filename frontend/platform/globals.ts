import type { BridgePort } from "../contracts/public-bridge.ts";
import type { RendererPort } from "../contracts/renderer.ts";

declare global {
    const __LYRICBRIDGE_VERSION__: string;
    interface GlobalEventHandlersEventMap {
        "lyricbridge:timing-panel": CustomEvent<HTMLElement>;
        viewshow: Event;
        viewbeforehide: Event;
        loadingdone: Event;
    }
    interface Window {
        LyricBridge?: BridgePort;
        JellyfinLyricMotion?: RendererPort;
    }
}
