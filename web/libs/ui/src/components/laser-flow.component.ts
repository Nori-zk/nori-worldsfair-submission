import { Component, RxElement, state } from '@yaw-rx/core';
import type { Observable, Subscription } from 'rxjs';
import * as THREE from 'three';
import {
    LASER_FLOW_FRAGMENT_SHADER,
    LASER_FLOW_VERTEX_SHADER,
} from './laser-flow/laser-flow.shaders.js';
import styles from './laser-flow.component.css';

/** A shader uniform holding a number. */
interface NumberUniform {
    value: number;
}

/** The uniforms LaserFlow's fragment shader reads. */
interface LaserFlowUniforms {
    iTime: NumberUniform;
    iResolution: { value: THREE.Vector3 };
    uFragScale: { value: THREE.Vector2 };
    iMouse: { value: THREE.Vector4 };
    uWispDensity: NumberUniform;
    uTiltScale: NumberUniform;
    uFlowTime: NumberUniform;
    uFogTime: NumberUniform;
    uBeamXFrac: NumberUniform;
    uBeamYFrac: NumberUniform;
    uFlowSpeed: NumberUniform;
    uVLenFactor: NumberUniform;
    uHLenFactor: NumberUniform;
    uFogIntensity: NumberUniform;
    uFogScale: NumberUniform;
    uWSpeed: NumberUniform;
    uWIntensity: NumberUniform;
    uFlowStrength: NumberUniform;
    uDecay: NumberUniform;
    uFalloffStart: NumberUniform;
    uFogFallSpeed: NumberUniform;
    uColor: { value: THREE.Vector3 };
    uFade: NumberUniform;
}

/**
 * The canvas's buffer, per CSS pixel of the element: the beam is a soft glow,
 * so half resolution, stretched by CSS, looks the same at a quarter of the
 * fragments. The pixel ratio stays 1 whatever the screen's.
 */
const BUFFER_SCALE = 0.5;
/**
 * The least time between two drawn frames: about 30 a second, on a 60 Hz or
 * a 120 Hz screen alike. The time uniforms follow real time, so the beam
 * flows at the same speed.
 */
const FRAME_INTERVAL_MS = 30;
/** The longest step the time uniforms take, after a pause or a stall. */
const MAX_STEP_S = 0.1;
/**
 * How far the element may outgrow or shrink from the canvas's buffer, on
 * either axis, before the buffer is re-sized: CSS stretches the buffer up to
 * that. A card's height changing (a countdown, a status line) stays well
 * inside it; a window resize or the beam first showing does not.
 */
const RESIZE_RATIO = 1.25;

/**
 * A colour as red, green and blue in 0..1.
 *
 * @param hex A `#rgb` or `#rrggbb` colour.
 * @returns Its channels.
 */
const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
    let c = hex.trim();
    if (c.startsWith('#')) c = c.slice(1);
    if (c.length === 3)
        c = c
            .split('')
            .map((x) => x + x)
            .join('');
    const n = parseInt(c, 16) || 0xffffff;
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
};

/**
 * React Bits' LaserFlow (reactbits.dev), as the bridge zkapp shows it beside
 * its card: a WebGL beam with flowing wisps and fog that tilts towards the
 * pointer. It draws about 30 frames a second and pauses while hidden or off
 * screen. Each `@state` field drives one shader uniform.
 *
 * The canvas's buffer is half the element's size, at a pixel ratio of 1,
 * sized once the element has a size, and CSS stretches it over the element:
 * re-sizing a WebGL buffer clears and redraws it, which stalls the beam, and
 * the element follows its card's height. Only the shader's resolution follows
 * the element, so the beam keeps its shape.
 */
@Component({
    selector: 'laser-flow',
    styles,
})
export class LaserFlow extends RxElement {
    @state color = '#64e18e';
    @state wispDensity = 1;
    @state mouseSmoothTime = 0;
    @state mouseTiltStrength = 0.01;
    @state horizontalBeamOffset = 0.1;
    @state verticalBeamOffset = 0;
    @state flowSpeed = 0.35;
    @state verticalSizing = 2;
    @state horizontalSizing = 0.5;
    @state fogIntensity = 0.45;
    @state fogScale = 0.3;
    @state wispSpeed = 15;
    @state wispIntensity = 5;
    @state flowStrength = 0.25;
    @state decay = 1.1;
    @state falloffStart = 1.2;
    @state fogFallSpeed = 0.6;

    private teardown: (() => void) | undefined;
    private bindings: Subscription[] = [];

    override onRender(): void {
        const renderer = new THREE.WebGLRenderer({
            antialias: false,
            alpha: false,
            depth: false,
            stencil: false,
            powerPreference: 'high-performance',
            premultipliedAlpha: false,
            preserveDrawingBuffer: false,
            failIfMajorPerformanceCaveat: false,
        });
        renderer.setPixelRatio(1);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.setClearColor(0x000000, 1);
        const canvas = renderer.domElement;
        this.appendChild(canvas);

        const scene = new THREE.Scene();
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
            'position',
            new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
        );

        const uniforms: LaserFlowUniforms = {
            iTime: { value: 0 },
            iResolution: { value: new THREE.Vector3(1, 1, 1) },
            uFragScale: { value: new THREE.Vector2(1, 1) },
            iMouse: { value: new THREE.Vector4(0, 0, 0, 0) },
            uWispDensity: { value: this.wispDensity },
            uTiltScale: { value: this.mouseTiltStrength },
            uFlowTime: { value: 0 },
            uFogTime: { value: 0 },
            uBeamXFrac: { value: this.horizontalBeamOffset },
            uBeamYFrac: { value: this.verticalBeamOffset },
            uFlowSpeed: { value: this.flowSpeed },
            uVLenFactor: { value: this.verticalSizing },
            uHLenFactor: { value: this.horizontalSizing },
            uFogIntensity: { value: this.fogIntensity },
            uFogScale: { value: this.fogScale },
            uWSpeed: { value: this.wispSpeed },
            uWIntensity: { value: this.wispIntensity },
            uFlowStrength: { value: this.flowStrength },
            uDecay: { value: this.decay },
            uFalloffStart: { value: this.falloffStart },
            uFogFallSpeed: { value: this.fogFallSpeed },
            uColor: { value: new THREE.Vector3(1, 1, 1) },
            uFade: { value: 1 },
        };
        this.bindUniforms(uniforms);

        const material = new THREE.RawShaderMaterial({
            vertexShader: LASER_FLOW_VERTEX_SHADER,
            fragmentShader: LASER_FLOW_FRAGMENT_SHADER,
            uniforms: { ...uniforms },
            transparent: false,
            depthTest: false,
            depthWrite: false,
            blending: THREE.NormalBlending,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        scene.add(mesh);

        const timer = new THREE.Timer();
        const mouseTarget = new THREE.Vector2(0, 0);
        const mouseSmooth = new THREE.Vector2(0, 0);
        let rect: DOMRect | undefined;
        let prevTime = 0;
        let lastFrame = -Infinity;
        let paused = false;
        let contextLost = false;
        let inView = true;

        // The element's size the buffer was last sized to, in CSS pixels; 0
        // until the element has a size.
        let bufferW = 0;
        let bufferH = 0;
        const outgrown = (size: number, buffer: number): boolean =>
            size > buffer * RESIZE_RATIO || size * RESIZE_RATIO < buffer;
        /**
         * Points the shader at the element's box, and re-sizes the buffer only
         * when the element has outgrown it. An element without a size yet (one
         * growing in) leaves the buffer unsized until it has one.
         *
         * @param resizeBuffer Re-size the buffer to the element even if it still fits.
         */
        const fit = (resizeBuffer: boolean): void => {
            const w = this.clientWidth;
            const h = this.clientHeight;
            rect = canvas.getBoundingClientRect();
            if (w === 0 || h === 0) return;
            let resized = false;
            if (resizeBuffer || outgrown(w, bufferW) || outgrown(h, bufferH)) {
                bufferW = w;
                bufferH = h;
                renderer.setSize(
                    Math.max(1, Math.round(w * BUFFER_SCALE)),
                    Math.max(1, Math.round(h * BUFFER_SCALE)),
                    false,
                );
                resized = true;
            }
            uniforms.iResolution.value.set(w, h, 1);
            uniforms.uFragScale.value.set(w / canvas.width, h / canvas.height);
            // Re-sizing the buffer clears it: draw again at once, not on the next frame.
            if (resized && !contextLost) renderer.render(scene, camera);
        };
        const onResize = (): void => {
            fit(false);
        };
        fit(true);
        const resizeObserver = new ResizeObserver(onResize);
        resizeObserver.observe(this);
        const intersectionObserver = new IntersectionObserver(
            (entries) => {
                inView = entries[0]?.isIntersecting ?? true;
            },
            { root: null, threshold: 0 },
        );
        intersectionObserver.observe(this);

        const onVisibility = (): void => {
            paused = document.hidden;
        };
        document.addEventListener('visibilitychange', onVisibility, { passive: true });
        const onMove = (event: PointerEvent): void => {
            if (rect === undefined) return;
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            mouseTarget.set(x, rect.height - y);
        };
        const onLeave = (): void => {
            mouseTarget.set(0, 0);
        };
        canvas.addEventListener('pointermove', onMove, { passive: true });
        canvas.addEventListener('pointerdown', onMove, { passive: true });
        canvas.addEventListener('pointerenter', onMove, { passive: true });
        canvas.addEventListener('pointerleave', onLeave, { passive: true });
        const onContextLost = (event: Event): void => {
            event.preventDefault();
            contextLost = true;
        };
        const onContextRestored = (): void => {
            contextLost = false;
            fit(true);
        };
        canvas.addEventListener('webglcontextlost', onContextLost, false);
        canvas.addEventListener('webglcontextrestored', onContextRestored, false);

        let raf = 0;
        const animate = (now: number): void => {
            raf = requestAnimationFrame(animate);
            if (paused || contextLost || !inView || bufferW === 0) return;
            if (now - lastFrame < FRAME_INTERVAL_MS) return;
            lastFrame = now;
            timer.update();
            const t = timer.getElapsed();
            const dt = Math.max(0, t - prevTime);
            prevTime = t;
            uniforms.iTime.value = t;
            const cdt = Math.min(MAX_STEP_S, Math.max(0.001, dt));
            uniforms.uFlowTime.value += cdt;
            uniforms.uFogTime.value += cdt;
            uniforms.uFade.value = 1;
            const alpha = 1 - Math.exp(-cdt / Math.max(1e-3, this.mouseSmoothTime));
            mouseSmooth.lerp(mouseTarget, alpha);
            uniforms.iMouse.value.set(mouseSmooth.x, mouseSmooth.y, 0, 0);
            renderer.render(scene, camera);
        };
        raf = requestAnimationFrame(animate);

        this.teardown = () => {
            cancelAnimationFrame(raf);
            resizeObserver.disconnect();
            intersectionObserver.disconnect();
            document.removeEventListener('visibilitychange', onVisibility);
            canvas.removeEventListener('pointermove', onMove);
            canvas.removeEventListener('pointerdown', onMove);
            canvas.removeEventListener('pointerenter', onMove);
            canvas.removeEventListener('pointerleave', onLeave);
            canvas.removeEventListener('webglcontextlost', onContextLost);
            canvas.removeEventListener('webglcontextrestored', onContextRestored);
            geometry.dispose();
            material.dispose();
            renderer.dispose();
            canvas.remove();
        };
    }

    override onDestroy(): void {
        for (const binding of this.bindings) binding.unsubscribe();
        this.bindings = [];
        this.teardown?.();
        this.teardown = undefined;
    }

    /**
     * Keeps each uniform equal to its `@state` field.
     *
     * @param uniforms The shader's uniforms.
     */
    private bindUniforms(uniforms: LaserFlowUniforms): void {
        const numbers: [Observable<number>, NumberUniform][] = [
            [this.wispDensity$, uniforms.uWispDensity],
            [this.mouseTiltStrength$, uniforms.uTiltScale],
            [this.horizontalBeamOffset$, uniforms.uBeamXFrac],
            [this.verticalBeamOffset$, uniforms.uBeamYFrac],
            [this.flowSpeed$, uniforms.uFlowSpeed],
            [this.verticalSizing$, uniforms.uVLenFactor],
            [this.horizontalSizing$, uniforms.uHLenFactor],
            [this.fogIntensity$, uniforms.uFogIntensity],
            [this.fogScale$, uniforms.uFogScale],
            [this.wispSpeed$, uniforms.uWSpeed],
            [this.wispIntensity$, uniforms.uWIntensity],
            [this.flowStrength$, uniforms.uFlowStrength],
            [this.decay$, uniforms.uDecay],
            [this.falloffStart$, uniforms.uFalloffStart],
            [this.fogFallSpeed$, uniforms.uFogFallSpeed],
        ];
        this.bindings = numbers.map(([value$, uniform]) =>
            value$.subscribe((value) => {
                uniform.value = value;
            }),
        );
        this.bindings.push(
            this.color$.subscribe((color) => {
                const { r, g, b } = hexToRgb(color);
                uniforms.uColor.value.set(r, g, b);
            }),
        );
    }
}
