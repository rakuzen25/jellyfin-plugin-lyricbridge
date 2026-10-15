/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. Derived shader notices: vendor/DYNAMIC-BACKGROUND-LICENSE and vendor/KAWARP-LICENSE. */
import type { Lifecycle } from "../shared/lifecycle.ts";
export interface BackgroundOptions {
    blurSize?: number;
    warpIntensity?: number;
    blurPasses?: number;
    animationSpeed?: number;
    transitionDuration?: number;
    saturation?: number;
    tintColor?: number[];
    tintIntensity?: number;
    dithering?: number;
    scale?: number;
    renderScale?: number;
    maxRenderLongEdge?: number;
    maxWarpLongEdge?: number;
    maxFps?: number;
    onContextLost?: () => void;
    onContextRestored?: () => void;
}
export interface BackgroundEnvironment {
    lifecycle: Lifecycle;
    isVisible(): boolean;
    isPaused(): boolean;
    reducedMotion(): boolean;
}
interface Framebuffer {
    framebuffer: WebGLFramebuffer;
    texture: WebGLTexture;
    width: number;
    height: number;
    type: number;
}
/*
 * Dynamic Background WebGL renderer.
 *
 * Visual model adapted from the MIT-licensed Better Lyrics Kawarp core used
 * by chengg's Dynamic Background theme. LyricMotion keeps the same
 * low-resolution Kawase blur + domain-warp architecture, but owns image
 * sequencing and interrupted-transition capture so rapid Jellyfin track
 * changes cannot flash stale artwork or jump through an unfinished blend.
 */
export class DynamicBackgroundRenderer {
    canvas: HTMLCanvasElement;
    gl: WebGLRenderingContext;
    tintColor: number[];
    halfFloatExt: OES_texture_half_float | null;
    halfFloatLinearExt: OES_texture_half_float_linear | null;
    colorBufferHalfFloatExt: EXT_color_buffer_half_float | null;
    _onLost: EventListener | null;
    _onRestored: EventListener | null;
    onContextLost: (() => void) | null;
    onContextRestored: (() => void) | null;
    blurSize: number;
    warpIntensity: number;
    blurPasses: number;
    animationSpeed: number;
    transitionDuration: number;
    saturation: number;
    tintIntensity: number;
    dithering: number;
    scale: number;
    renderScale: number;
    maxRenderLongEdge: number;
    readonly maxWarpLongEdge: number;
    readonly frameIntervalMs: number;
    private lastRenderedAt = 0;
    renderedFrames: number;
    animationId: number;
    lastFrameTime: number;
    accumulatedTime: number;
    transitionStartTime: number;
    renderWidth: number;
    renderHeight: number;
    transitionSerial: number;
    completedTransitions: number;
    interruptedTransitions: number;
    attribPosition: number;
    attribTexCoord: number;
    isPlaying: boolean;
    needsStaticFrame: boolean;
    hasCurrent: boolean;
    isTransitioning: boolean;
    contextLost: boolean;
    vertexShaderSource: string;
    blurShaderSource: string;
    blendShaderSource: string;
    tintShaderSource: string;
    warpShaderSource: string;
    outputShaderSource: string;
    blurProgram: WebGLProgram | null;
    blendProgram: WebGLProgram | null;
    tintProgram: WebGLProgram | null;
    warpProgram: WebGLProgram | null;
    outputProgram: WebGLProgram | null;
    positionBuffer: WebGLBuffer | null;
    texCoordBuffer: WebGLBuffer | null;
    blurFBO1: Framebuffer | null;
    blurFBO2: Framebuffer | null;
    currentAlbumFBO: Framebuffer | null;
    nextAlbumFBO: Framebuffer | null;
    snapshotAlbumFBO: Framebuffer | null;
    blendScratchFBO: Framebuffer | null;
    warpFBO: Framebuffer | null;
    sourceTexture: WebGLTexture | null;
    uniforms: {
        blur: {
            texture: WebGLUniformLocation | null;
            resolution: WebGLUniformLocation | null;
            offset: WebGLUniformLocation | null;
        };
        blend: {
            texture1: WebGLUniformLocation | null;
            texture2: WebGLUniformLocation | null;
            blend: WebGLUniformLocation | null;
        };
        tint: {
            texture: WebGLUniformLocation | null;
            tintColor: WebGLUniformLocation | null;
            tintIntensity: WebGLUniformLocation | null;
        };
        warp: {
            texture: WebGLUniformLocation | null;
            time: WebGLUniformLocation | null;
            intensity: WebGLUniformLocation | null;
        };
        output: {
            texture: WebGLUniformLocation | null;
            saturation: WebGLUniformLocation | null;
            dithering: WebGLUniformLocation | null;
            time: WebGLUniformLocation | null;
            scale: WebGLUniformLocation | null;
            resolution: WebGLUniformLocation | null;
        };
    };
    constructor(
        canvas: HTMLCanvasElement,
        options: BackgroundOptions,
        private readonly environment: BackgroundEnvironment,
    ) {
        this.canvas = canvas;
        const gl = canvas.getContext("webgl", {
            alpha: true,
            antialias: false,
            depth: false,
            stencil: false,
            premultipliedAlpha: false,
            preserveDrawingBuffer: false,
            powerPreference: "default",
        });
        if (!gl) throw new Error("WebGL not supported");
        this.gl = gl;

        this.blurSize = Math.max(64, Math.min(256, Math.round(options.blurSize || 128)));
        this.warpIntensity =
            typeof options.warpIntensity === "number" && Number.isFinite(options.warpIntensity) ? Math.max(0, Math.min(1, options.warpIntensity)) : 1;
        this.blurPasses =
            typeof options.blurPasses === "number" && Number.isFinite(options.blurPasses)
                ? Math.max(1, Math.min(20, Math.floor(options.blurPasses)))
                : 8;
        this.animationSpeed =
            typeof options.animationSpeed === "number" && Number.isFinite(options.animationSpeed)
                ? Math.max(0.1, Math.min(5, options.animationSpeed))
                : 1.8;
        this.transitionDuration =
            typeof options.transitionDuration === "number" && Number.isFinite(options.transitionDuration)
                ? Math.max(0, Math.min(2000, options.transitionDuration))
                : 340;
        this.saturation =
            typeof options.saturation === "number" && Number.isFinite(options.saturation) ? Math.max(0, Math.min(3, options.saturation)) : 1.7;
        this.tintColor =
            Array.isArray(options.tintColor) && options.tintColor.length >= 3
                ? options.tintColor.slice(0, 3).map((value) => Math.max(0, Math.min(1, Number(value) || 0)))
                : [0.157, 0.157, 0.235];
        this.tintIntensity =
            typeof options.tintIntensity === "number" && Number.isFinite(options.tintIntensity)
                ? Math.max(0, Math.min(1, options.tintIntensity))
                : 0.15;
        this.dithering =
            typeof options.dithering === "number" && Number.isFinite(options.dithering) ? Math.max(0, Math.min(0.1, options.dithering)) : 0;
        this.scale = typeof options.scale === "number" && Number.isFinite(options.scale) ? Math.max(0.8, Math.min(2, options.scale)) : 1.04;
        this.renderScale =
            typeof options.renderScale === "number" && Number.isFinite(options.renderScale) ? Math.max(0.35, Math.min(1.5, options.renderScale)) : 1;
        this.maxRenderLongEdge =
            typeof options.maxRenderLongEdge === "number" && Number.isFinite(options.maxRenderLongEdge)
                ? Math.max(720, Math.min(4096, options.maxRenderLongEdge))
                : 2560;
        this.frameIntervalMs =
            1000 / (typeof options.maxFps === "number" && Number.isFinite(options.maxFps) ? Math.max(1, Math.min(60, options.maxFps)) : 30);
        this.onContextLost = typeof options.onContextLost === "function" ? options.onContextLost : null;
        this.onContextRestored = typeof options.onContextRestored === "function" ? options.onContextRestored : null;

        this.isPlaying = false;
        this.renderedFrames = 0;
        this.needsStaticFrame = true;
        this.animationId = 0;
        this.lastFrameTime = 0;
        this.accumulatedTime = 0;
        this.hasCurrent = false;
        this.isTransitioning = false;
        this.transitionStartTime = 0;
        this.contextLost = false;
        this.maxWarpLongEdge = Math.max(64, Math.min(800, options.maxWarpLongEdge ?? 800));
        this.renderWidth = 0;
        this.renderHeight = 0;
        this.transitionSerial = 0;
        this.completedTransitions = 0;
        this.interruptedTransitions = 0;
        this.renderLoop = this.renderLoop.bind(this);

        this.halfFloatExt = this.gl.getExtension("OES_texture_half_float");
        this.halfFloatLinearExt = this.gl.getExtension("OES_texture_half_float_linear");
        this.colorBufferHalfFloatExt = this.gl.getExtension("EXT_color_buffer_half_float");

        this.vertexShaderSource = `
            attribute vec2 a_position;
            attribute vec2 a_texCoord;
            varying vec2 v_texCoord;
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
                v_texCoord = a_texCoord;
            }
        `;
        this.blurShaderSource = `
            precision highp float;
            uniform sampler2D u_texture;
            uniform vec2 u_resolution;
            uniform float u_offset;
            varying vec2 v_texCoord;
            void main() {
                vec2 texel = 1.0 / u_resolution;
                vec4 color = vec4(0.0);
                color += texture2D(u_texture, v_texCoord + vec2(-u_offset, -u_offset) * texel);
                color += texture2D(u_texture, v_texCoord + vec2( u_offset, -u_offset) * texel);
                color += texture2D(u_texture, v_texCoord + vec2(-u_offset,  u_offset) * texel);
                color += texture2D(u_texture, v_texCoord + vec2( u_offset,  u_offset) * texel);
                gl_FragColor = color * 0.25;
            }
        `;
        this.blendShaderSource = `
            precision highp float;
            uniform sampler2D u_texture1;
            uniform sampler2D u_texture2;
            uniform float u_blend;
            varying vec2 v_texCoord;
            void main() {
                gl_FragColor = mix(texture2D(u_texture1, v_texCoord), texture2D(u_texture2, v_texCoord), u_blend);
            }
        `;
        this.tintShaderSource = `
            precision highp float;
            uniform sampler2D u_texture;
            uniform vec3 u_tintColor;
            uniform float u_tintIntensity;
            varying vec2 v_texCoord;
            void main() {
                vec4 color = texture2D(u_texture, v_texCoord);
                float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
                float darkMask = 1.0 - smoothstep(0.0, 0.5, luma);
                color.rgb = mix(color.rgb, u_tintColor, darkMask * u_tintIntensity);
                gl_FragColor = color;
            }
        `;
        this.warpShaderSource = `
            precision highp float;
            uniform sampler2D u_texture;
            uniform float u_time;
            uniform float u_intensity;
            varying vec2 v_texCoord;
            vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
            vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
            vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
            float snoise(vec2 v) {
                const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
                vec2 i = floor(v + dot(v, C.yy));
                vec2 x0 = v - i + dot(i, C.xx);
                vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
                vec4 x12 = x0.xyxy + C.xxzz;
                x12.xy -= i1;
                i = mod289(i);
                vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
                vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
                m = m * m;
                m = m * m;
                vec3 x = 2.0 * fract(p * C.www) - 1.0;
                vec3 h = abs(x) - 0.5;
                vec3 ox = floor(x + 0.5);
                vec3 a0 = x - ox;
                m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
                vec3 g;
                g.x = a0.x * x0.x + h.x * x0.y;
                g.yz = a0.yz * x12.xz + h.yz * x12.yw;
                return 130.0 * dot(m, g);
            }
            void main() {
                vec2 uv = v_texCoord;
                float t = u_time * 0.05;
                vec2 center = uv - 0.5;
                float centerWeight = 1.0 - smoothstep(0.0, 0.7, length(center));
                float n1 = snoise(uv * 0.35 + vec2(t, t * 0.7));
                float n2 = snoise(uv * 0.35 + vec2(-t * 0.8, t * 0.5) + vec2(50.0));
                float n3 = snoise(uv * 0.9 + vec2(t * 1.2, -t) + vec2(100.0, 0.0));
                float n4 = snoise(uv * 0.9 + vec2(-t, t * 1.1) + vec2(0.0, 100.0));
                vec2 warp = vec2(n1 * 0.65 + n3 * 0.35, n2 * 0.65 + n4 * 0.35) * centerWeight;
                vec2 warpedUV = clamp(uv + warp * u_intensity, 0.0, 1.0);
                gl_FragColor = texture2D(u_texture, warpedUV);
            }
        `;
        this.outputShaderSource = `
            precision highp float;
            uniform sampler2D u_texture;
            uniform float u_saturation;
            uniform float u_dithering;
            uniform float u_time;
            uniform float u_scale;
            uniform vec2 u_resolution;
            varying vec2 v_texCoord;
            float hash(vec3 p) {
                p = fract(p * 0.1031);
                p += dot(p, p.zyx + 31.32);
                return fract((p.x + p.y) * p.z);
            }
            void main() {
                vec2 uv = (v_texCoord - 0.5) / u_scale + 0.5;
                uv = clamp(uv, 0.0, 1.0);
                vec4 color = texture2D(u_texture, uv);
                vec2 center = v_texCoord - 0.5;
                float vignette = 1.0 - dot(center, center) * 0.3;
                color.rgb *= vignette;
                float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
                color.rgb = mix(vec3(gray), color.rgb, u_saturation);
                vec2 pixelPos = floor(v_texCoord * u_resolution);
                float noise = hash(vec3(pixelPos, floor(u_time * 60.0)));
                color.rgb += (noise - 0.5) * u_dithering;
                gl_FragColor = vec4(color.rgb, 1.0);
            }
        `;

        this.blurProgram = null;
        this.blendProgram = null;
        this.tintProgram = null;
        this.warpProgram = null;
        this.outputProgram = null;
        this.positionBuffer = null;
        this.texCoordBuffer = null;
        this.sourceTexture = null;
        this.blurFBO1 = null;
        this.blurFBO2 = null;
        this.currentAlbumFBO = null;
        this.nextAlbumFBO = null;
        this.snapshotAlbumFBO = null;
        this.blendScratchFBO = null;
        this.warpFBO = null;
        this._onLost = null;
        this._onRestored = null;

        try {
            this.blurProgram = this.createProgram(this.vertexShaderSource, this.blurShaderSource);
            this.blendProgram = this.createProgram(this.vertexShaderSource, this.blendShaderSource);
            this.tintProgram = this.createProgram(this.vertexShaderSource, this.tintShaderSource);
            this.warpProgram = this.createProgram(this.vertexShaderSource, this.warpShaderSource);
            this.outputProgram = this.createProgram(this.vertexShaderSource, this.outputShaderSource);

            this.positionBuffer = this.createBuffer(new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]));
            this.texCoordBuffer = this.createBuffer(new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]));
            this.attribPosition = 0;
            this.attribTexCoord = 1;

            this.uniforms = {
                blur: {
                    texture: this.gl.getUniformLocation(this.blurProgram, "u_texture"),
                    resolution: this.gl.getUniformLocation(this.blurProgram, "u_resolution"),
                    offset: this.gl.getUniformLocation(this.blurProgram, "u_offset"),
                },
                blend: {
                    texture1: this.gl.getUniformLocation(this.blendProgram, "u_texture1"),
                    texture2: this.gl.getUniformLocation(this.blendProgram, "u_texture2"),
                    blend: this.gl.getUniformLocation(this.blendProgram, "u_blend"),
                },
                tint: {
                    texture: this.gl.getUniformLocation(this.tintProgram, "u_texture"),
                    tintColor: this.gl.getUniformLocation(this.tintProgram, "u_tintColor"),
                    tintIntensity: this.gl.getUniformLocation(this.tintProgram, "u_tintIntensity"),
                },
                warp: {
                    texture: this.gl.getUniformLocation(this.warpProgram, "u_texture"),
                    time: this.gl.getUniformLocation(this.warpProgram, "u_time"),
                    intensity: this.gl.getUniformLocation(this.warpProgram, "u_intensity"),
                },
                output: {
                    texture: this.gl.getUniformLocation(this.outputProgram, "u_texture"),
                    saturation: this.gl.getUniformLocation(this.outputProgram, "u_saturation"),
                    dithering: this.gl.getUniformLocation(this.outputProgram, "u_dithering"),
                    time: this.gl.getUniformLocation(this.outputProgram, "u_time"),
                    scale: this.gl.getUniformLocation(this.outputProgram, "u_scale"),
                    resolution: this.gl.getUniformLocation(this.outputProgram, "u_resolution"),
                },
            };

            this.sourceTexture = this.createTexture();
            this.blurFBO1 = this.createFramebuffer(this.blurSize, this.blurSize, true);
            this.blurFBO2 = this.createFramebuffer(this.blurSize, this.blurSize, true);
            this.currentAlbumFBO = this.createFramebuffer(this.blurSize, this.blurSize, true);
            this.nextAlbumFBO = this.createFramebuffer(this.blurSize, this.blurSize, true);
            this.snapshotAlbumFBO = this.createFramebuffer(this.blurSize, this.blurSize, true);
            this.blendScratchFBO = this.createFramebuffer(this.blurSize, this.blurSize, true);
            this.warpFBO = this.createFramebuffer(1, 1, false);

            this._onLost = (event) => {
                event.preventDefault();
                this.contextLost = true;
                this.stop();
                if (this.onContextLost) this.onContextLost();
            };
            this._onRestored = () => {
                this.contextLost = false;
                if (this.onContextRestored) this.onContextRestored();
            };
            canvas.addEventListener("webglcontextlost", this._onLost, false);
            canvas.addEventListener("webglcontextrestored", this._onRestored, false);
        } catch (error) {
            // Listener registration can itself fail after the first listener
            // has already been installed. Undo both registrations before
            // releasing GPU state so a failed constructor leaves no hooks.
            if (this._onLost) {
                try {
                    canvas.removeEventListener("webglcontextlost", this._onLost, false);
                } catch {
                    /* best effort */
                }
            }
            if (this._onRestored) {
                try {
                    canvas.removeEventListener("webglcontextrestored", this._onRestored, false);
                } catch {
                    /* best effort */
                }
            }
            this.releaseGpuResources();
            throw error;
        }
    }

    createShader(type: number, source: string) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        if (!shader) throw new Error("Failed to create WebGL shader");
        try {
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                const detail = gl.getShaderInfoLog(shader) || "unknown shader error";
                throw new Error(`Dynamic background shader compile error: ${detail}`);
            }
            return shader;
        } catch (error) {
            try {
                gl.deleteShader(shader);
            } catch {
                /* context can fail mid-init */
            }
            throw error;
        }
    }

    createProgram(vertexSource: string, fragmentSource: string) {
        const gl = this.gl;
        const vertex = this.createShader(gl.VERTEX_SHADER, vertexSource);
        let fragment = null;
        let program = null;
        try {
            fragment = this.createShader(gl.FRAGMENT_SHADER, fragmentSource);
            program = gl.createProgram();
            if (!program) throw new Error("Failed to create WebGL program");

            gl.attachShader(program, vertex);
            gl.attachShader(program, fragment);
            // Same attribute locations across every program. WebGL does not
            // guarantee this merely because the vertex shader source matches.
            gl.bindAttribLocation(program, 0, "a_position");
            gl.bindAttribLocation(program, 1, "a_texCoord");
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
                const detail = gl.getProgramInfoLog(program) || "unknown program link error";
                throw new Error(`Dynamic background program link error: ${detail}`);
            }
            return program;
        } catch (error) {
            if (program) {
                try {
                    gl.deleteProgram(program);
                } catch {
                    /* best effort */
                }
            }
            throw error;
        } finally {
            try {
                gl.deleteShader(vertex);
            } catch {
                /* best effort */
            }
            if (fragment) {
                try {
                    gl.deleteShader(fragment);
                } catch {
                    /* best effort */
                }
            }
        }
    }

    createBuffer(data: Float32Array<ArrayBuffer>) {
        const gl = this.gl;
        const buffer = gl.createBuffer();
        if (!buffer) throw new Error("Failed to create WebGL buffer");
        try {
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
            return buffer;
        } catch (error) {
            gl.deleteBuffer(buffer);
            throw error;
        }
    }

    createTexture() {
        const gl = this.gl;
        const texture = gl.createTexture();
        if (!texture) throw new Error("Failed to create WebGL texture");
        try {
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            return texture;
        } catch (error) {
            gl.deleteTexture(texture);
            throw error;
        }
    }

    allocateFramebuffer(width: number, height: number, type: number) {
        const gl = this.gl;
        const texture = this.createTexture();
        let framebuffer = null;
        try {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, type, null);
            framebuffer = gl.createFramebuffer();
            if (!framebuffer) throw new Error("Failed to create WebGL framebuffer");

            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
            const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            if (status !== gl.FRAMEBUFFER_COMPLETE) {
                try {
                    gl.deleteFramebuffer(framebuffer);
                } catch {
                    /* best effort */
                }
                try {
                    gl.deleteTexture(texture);
                } catch {
                    /* best effort */
                }
                return null;
            }
            return { framebuffer, texture, width, height, type };
        } catch (error) {
            try {
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            } catch {
                /* context can fail mid-init */
            }
            if (framebuffer) {
                try {
                    gl.deleteFramebuffer(framebuffer);
                } catch {
                    /* best effort */
                }
            }
            try {
                gl.deleteTexture(texture);
            } catch {
                /* best effort */
            }
            throw error;
        }
    }

    createFramebuffer(width: number, height: number, preferHighPrecision: boolean) {
        const gl = this.gl;
        if (preferHighPrecision && this.halfFloatExt && this.halfFloatLinearExt && this.colorBufferHalfFloatExt) {
            const high = this.allocateFramebuffer(width, height, this.halfFloatExt.HALF_FLOAT_OES);
            if (high) return high;
        }
        const normal = this.allocateFramebuffer(width, height, gl.UNSIGNED_BYTE);
        if (!normal) throw new Error("WebGL framebuffer is incomplete");
        return normal;
    }

    deleteFramebuffer(fbo: Framebuffer | null) {
        if (!fbo) return;
        this.gl.deleteFramebuffer(fbo.framebuffer);
        this.gl.deleteTexture(fbo.texture);
    }

    setupAttributes() {
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.enableVertexAttribArray(this.attribPosition);
        gl.vertexAttribPointer(this.attribPosition, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.enableVertexAttribArray(this.attribTexCoord);
        gl.vertexAttribPointer(this.attribTexCoord, 2, gl.FLOAT, false, 0, 0);
    }

    copyTexture(sourceTexture: WebGLTexture, targetFBO: Framebuffer) {
        const gl = this.gl;
        gl.useProgram(this.blurProgram);
        this.setupAttributes();
        gl.bindFramebuffer(gl.FRAMEBUFFER, targetFBO.framebuffer);
        gl.viewport(0, 0, targetFBO.width, targetFBO.height);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
        gl.uniform1i(this.uniforms.blur.texture, 0);
        gl.uniform2f(this.uniforms.blur.resolution, targetFBO.width, targetFBO.height);
        gl.uniform1f(this.uniforms.blur.offset, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    blurSourceInto(targetFBO: Framebuffer) {
        const gl = this.gl;
        gl.useProgram(this.tintProgram);
        this.setupAttributes();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFBO1!.framebuffer);
        gl.viewport(0, 0, this.blurSize, this.blurSize);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
        gl.uniform1i(this.uniforms.tint.texture, 0);
        gl.uniform3fv(this.uniforms.tint.tintColor, this.tintColor);
        gl.uniform1f(this.uniforms.tint.tintIntensity, this.tintIntensity);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        gl.useProgram(this.blurProgram);
        this.setupAttributes();
        gl.uniform2f(this.uniforms.blur.resolution, this.blurSize, this.blurSize);
        gl.uniform1i(this.uniforms.blur.texture, 0);
        let readFBO = this.blurFBO1!;
        let writeFBO = this.blurFBO2!;
        for (let index = 0; index < this.blurPasses; index += 1) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, writeFBO.framebuffer);
            gl.viewport(0, 0, this.blurSize, this.blurSize);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, readFBO.texture);
            gl.uniform1f(this.uniforms.blur.offset, index + 0.5);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            [readFBO, writeFBO] = [writeFBO, readFBO];
        }
        this.copyTexture(readFBO.texture, targetFBO);
    }

    transitionLinearFactor(now = performance.now()) {
        if (!this.isTransitioning || this.transitionDuration <= 0) return 1;
        return Math.max(0, Math.min(1, (now - this.transitionStartTime) / this.transitionDuration));
    }

    transitionFactor(now = performance.now()) {
        const t = this.transitionLinearFactor(now);
        // Fast ease-out. The new song becomes visually dominant early while
        // the final 20% still settles smoothly instead of flashing.
        return 1 - Math.pow(1 - t, 3);
    }

    blendInto(targetFBO: Framebuffer, fromTexture: WebGLTexture, toTexture: WebGLTexture, factor: number) {
        const gl = this.gl;
        gl.useProgram(this.blendProgram);
        this.setupAttributes();
        gl.bindFramebuffer(gl.FRAMEBUFFER, targetFBO.framebuffer);
        gl.viewport(0, 0, targetFBO.width, targetFBO.height);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, fromTexture);
        gl.uniform1i(this.uniforms.blend.texture1, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, toTexture);
        gl.uniform1i(this.uniforms.blend.texture2, 1);
        gl.uniform1f(this.uniforms.blend.blend, Math.max(0, Math.min(1, factor)));
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    captureInterruptedTransition() {
        if (!this.isTransitioning) return;
        const factor = this.transitionFactor(performance.now());
        this.blendInto(this.snapshotAlbumFBO!, this.currentAlbumFBO!.texture, this.nextAlbumFBO!.texture, factor);
        const oldCurrent = this.currentAlbumFBO;
        const oldNext = this.nextAlbumFBO;
        const oldSnapshot = this.snapshotAlbumFBO;
        this.currentAlbumFBO = oldSnapshot;
        this.nextAlbumFBO = oldCurrent;
        this.snapshotAlbumFBO = oldNext;
        this.isTransitioning = false;
        this.interruptedTransitions += 1;
    }

    commitTransition() {
        if (!this.isTransitioning) return;
        [this.currentAlbumFBO, this.nextAlbumFBO] = [this.nextAlbumFBO, this.currentAlbumFBO];
        this.isTransitioning = false;
        this.completedTransitions += 1;
    }

    loadImageElement(source: TexImageSource) {
        if (this.contextLost) return false;
        this.needsStaticFrame = true;
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

        if (!this.hasCurrent) {
            this.blurSourceInto(this.currentAlbumFBO!);
            this.copyTexture(this.currentAlbumFBO!.texture, this.nextAlbumFBO!);
            this.hasCurrent = true;
            this.isTransitioning = false;
            this.renderFrame();
            return true;
        }

        if (this.isTransitioning) this.captureInterruptedTransition();
        this.blurSourceInto(this.nextAlbumFBO!);
        this.transitionStartTime = performance.now();
        this.isTransitioning = this.transitionDuration > 0;
        this.transitionSerial += 1;
        if (!this.isTransitioning) {
            [this.currentAlbumFBO, this.nextAlbumFBO] = [this.nextAlbumFBO, this.currentAlbumFBO];
            this.completedTransitions += 1;
        }
        this.start();
        return true;
    }

    resizeToDisplaySize() {
        if (this.contextLost) return false;
        const cssWidth = Math.max(1, Math.round(this.canvas.clientWidth || window.innerWidth || 1));
        const cssHeight = Math.max(1, Math.round(this.canvas.clientHeight || window.innerHeight || 1));
        const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
        let width = Math.max(1, Math.round(cssWidth * dpr * this.renderScale));
        let height = Math.max(1, Math.round(cssHeight * dpr * this.renderScale));
        const longEdge = Math.max(width, height);
        if (longEdge > this.maxRenderLongEdge) {
            const factor = this.maxRenderLongEdge / longEdge;
            width = Math.max(1, Math.round(width * factor));
            height = Math.max(1, Math.round(height * factor));
        }
        if (width === this.renderWidth && height === this.renderHeight) return false;
        this.canvas.width = width;
        this.canvas.height = height;
        this.renderWidth = width;
        this.renderHeight = height;
        this.deleteFramebuffer(this.warpFBO!);
        const warpScale = Math.min(1, this.maxWarpLongEdge / Math.max(width, height));
        this.warpFBO = this.createFramebuffer(Math.max(1, Math.round(width * warpScale)), Math.max(1, Math.round(height * warpScale)), false);
        return true;
    }

    render(time: number, timestamp: number) {
        if (this.contextLost || !this.hasCurrent) return;
        // Display size is refreshed on mount, resize, orientation and visual-viewport events.
        // Avoid a layout read after every frame's lyric style writes.
        this.renderedFrames += 1;
        this.needsStaticFrame = false;
        const gl = this.gl;
        const width = this.renderWidth || this.canvas.width;
        const height = this.renderHeight || this.canvas.height;
        let sourceTexture = this.currentAlbumFBO!.texture;

        if (this.isTransitioning) {
            const linear = this.transitionLinearFactor(timestamp);
            if (linear >= 1) {
                this.commitTransition();
                sourceTexture = this.currentAlbumFBO!.texture;
            } else {
                const factor = 1 - Math.pow(1 - linear, 3);
                this.blendInto(this.blendScratchFBO!, this.currentAlbumFBO!.texture, this.nextAlbumFBO!.texture, factor);
                sourceTexture = this.blendScratchFBO!.texture;
            }
        }

        gl.useProgram(this.warpProgram);
        this.setupAttributes();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.warpFBO!.framebuffer);
        gl.viewport(0, 0, this.warpFBO!.width, this.warpFBO!.height);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
        gl.uniform1i(this.uniforms.warp.texture, 0);
        gl.uniform1f(this.uniforms.warp.time, time);
        gl.uniform1f(this.uniforms.warp.intensity, this.warpIntensity);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        gl.useProgram(this.outputProgram);
        this.setupAttributes();
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, width, height);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.warpFBO!.texture);
        gl.uniform1i(this.uniforms.output.texture, 0);
        gl.uniform1f(this.uniforms.output.saturation, this.saturation);
        gl.uniform1f(this.uniforms.output.dithering, this.dithering);
        gl.uniform1f(this.uniforms.output.time, time);
        gl.uniform1f(this.uniforms.output.scale, this.scale);
        gl.uniform2f(this.uniforms.output.resolution, width, height);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    renderFrame() {
        if (!this.hasCurrent || this.contextLost) return;
        const now = performance.now();
        if (!this.lastFrameTime) this.lastFrameTime = now;
        const dt = Math.max(0, Math.min(0.1, (now - this.lastFrameTime) / 1000));
        this.lastFrameTime = now;
        this.accumulatedTime += dt * this.animationSpeed;
        this.render(this.accumulatedTime, now);
    }

    renderLoop(timestamp: number) {
        if (!this.isPlaying || this.contextLost) return;
        if (!this.environment.isVisible() || this.environment.isPaused()) {
            this.stop();
            return;
        }
        const dt = Math.max(0, Math.min(0.1, (timestamp - this.lastFrameTime) / 1000));
        this.lastFrameTime = timestamp;
        this.accumulatedTime += dt * this.animationSpeed;
        if (!this.lastRenderedAt || timestamp - this.lastRenderedAt >= this.frameIntervalMs - 1) {
            this.lastRenderedAt = timestamp;
            this.render(this.accumulatedTime, timestamp);
        }
        this.animationId = this.environment.lifecycle.frame(this.renderLoop);
    }

    start() {
        if (this.isPlaying || this.contextLost || !this.hasCurrent) return;
        if (!this.environment.isVisible()) return;
        if (this.environment.isPaused() || this.environment.reducedMotion()) {
            if (this.isTransitioning) this.commitTransition();
            if (this.needsStaticFrame) this.renderFrame();
            return;
        }
        this.isPlaying = true;
        this.lastFrameTime = performance.now();
        this.lastRenderedAt = 0;
        this.animationId = this.environment.lifecycle.frame(this.renderLoop);
    }

    stop() {
        this.isPlaying = false;
        if (this.animationId) this.environment.lifecycle.cancelFrame(this.animationId);
        this.animationId = 0;
    }

    diagnostics() {
        return {
            engine: "kawarp-domain-warp-hardened",
            running: this.isPlaying,
            targetFps: 1000 / this.frameIntervalMs,
            renderedFrames: this.renderedFrames,
            webgl: true,
            blurSize: this.blurSize,
            blurPasses: this.blurPasses,
            warpIntensity: this.warpIntensity,
            animationSpeed: this.animationSpeed,
            transitionDurationMs: this.transitionDuration,
            transitionCurve: "ease-out-cubic",
            saturation: this.saturation,
            dithering: this.dithering,
            scale: this.scale,
            warpWidth: this.warpFBO?.width ?? 0,
            warpHeight: this.warpFBO?.height ?? 0,
            renderWidth: this.renderWidth,
            renderHeight: this.renderHeight,
            transitioning: this.isTransitioning,
            transitionSerial: this.transitionSerial,
            completedTransitions: this.completedTransitions,
            interruptedTransitions: this.interruptedTransitions,
            accumulatedTime: this.accumulatedTime,
            contextLost: this.contextLost,
        };
    }

    releaseGpuResources() {
        const gl = this.gl;
        if (gl && !this.contextLost) {
            [this.blurProgram, this.blendProgram, this.tintProgram, this.warpProgram, this.outputProgram].forEach((program) => {
                if (!program) return;
                try {
                    gl.deleteProgram(program);
                } catch {
                    /* best effort */
                }
            });

            [this.positionBuffer, this.texCoordBuffer].forEach((buffer) => {
                if (!buffer) return;
                try {
                    gl.deleteBuffer(buffer);
                } catch {
                    /* best effort */
                }
            });
            if (this.sourceTexture) {
                try {
                    gl.deleteTexture(this.sourceTexture);
                } catch {
                    /* best effort */
                }
            }

            [
                this.blurFBO1,
                this.blurFBO2,
                this.currentAlbumFBO,
                this.nextAlbumFBO,
                this.snapshotAlbumFBO,
                this.blendScratchFBO,
                this.warpFBO,
            ].forEach((fbo) => {
                if (!fbo) return;
                try {
                    this.deleteFramebuffer(fbo);
                } catch {
                    /* best effort */
                }
            });
        }

        this.blurProgram = null;
        this.blendProgram = null;
        this.tintProgram = null;
        this.warpProgram = null;
        this.outputProgram = null;
        this.positionBuffer = null;
        this.texCoordBuffer = null;
        this.sourceTexture = null;
        this.blurFBO1 = null;
        this.blurFBO2 = null;
        this.currentAlbumFBO = null;
        this.nextAlbumFBO = null;
        this.snapshotAlbumFBO = null;
        this.blendScratchFBO = null;
        this.warpFBO = null;
    }

    dispose() {
        this.stop();
        if (this._onLost) {
            this.canvas.removeEventListener("webglcontextlost", this._onLost, false);
        }
        if (this._onRestored) {
            this.canvas.removeEventListener("webglcontextrestored", this._onRestored, false);
        }
        this.releaseGpuResources();
    }
}
