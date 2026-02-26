/**
 * ═══════════════════ UTILS ═══════════════════
 * Math helpers, constants, and shared utilities.
 */

// ── ID counter ──
let idCounter = 0;
export const uid = () => "n" + (++idCounter);
export const resetIdCounter = () => { idCounter = 0; };
export const ensureIdCounterAtLeast = (n) => {
    if (Number.isFinite(n) && n > idCounter) idCounter = n;
};

// ── Math helpers ──
export const lerp = (a, b, t) => a + (b - a) * t;
export const deg2rad = (d) => (d * Math.PI) / 180;

// ── Seeded Random ──
let _seed = 1;
export function setSeed(s) { _seed = s; }
export function seededRandom() {
    _seed = (_seed * 9301 + 49297) % 233280;
    return _seed / 233280;
}
export const rand = (lo, hi) => lo + seededRandom() * (hi - lo);

// ── Constants ──
export const LEAF_SIZE = 30;

// ── DPR (mutable, updated on resize/generate) ──
export let dpr = window.devicePixelRatio || 1;
export function updateDpr() {
    dpr = window.devicePixelRatio || 1;
}

// ── FNV-1a hash → [0,1) ──
export function hash01(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 100000) / 100000;
}
