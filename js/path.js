/**
 * ═══════════════════ PATH COMPUTATION ═══════════════════
 * Cubic-bezier branch path generation and sampling.
 */

import { lerp } from "./utils.js";

/**
 * Compute a branch path as a filled shape (left/right outlines)
 * plus center-spine samples for collision & positioning.
 */
export function computeBranchPath(
    x0,
    y0,
    startAngle,
    endAngle,
    length,
    w0,
    w1,
    curviness,
    curveDir
) {
    const endX = x0 + Math.sin(endAngle) * length;
    const endY = y0 - Math.cos(endAngle) * length;
    const cpDist = length * 0.45;
    const cx1 = x0 + Math.sin(startAngle) * cpDist;
    const cy1 = y0 - Math.cos(startAngle) * cpDist;
    const cx2 = endX - Math.sin(endAngle) * cpDist;
    const cy2 = endY + Math.cos(endAngle) * cpDist;

    const midAngle = (startAngle + endAngle) / 2;
    const perpMid = midAngle + Math.PI / 2;
    const curveOffset = curviness * length * 0.4 * curveDir;

    const cx1f = cx1 + Math.cos(perpMid) * curveOffset * 0.5;
    const cy1f = cy1 + Math.sin(perpMid) * curveOffset * 0.5;
    const cx2f = cx2 + Math.cos(perpMid) * curveOffset * 0.35;
    const cy2f = cy2 + Math.sin(perpMid) * curveOffset * 0.35;

    const STEPS = 20;
    const pts = [];
    for (let i = 0; i <= STEPS; i++) {
        const t = i / STEPS;
        const mt = 1 - t;
        const mt2 = mt * mt,
            mt3 = mt2 * mt;
        const t3 = t * t * t;
        pts.push({
            x: mt3 * x0 + 3 * mt2 * t * cx1f + 3 * mt * t * t * cx2f + t3 * endX,
            y: mt3 * y0 + 3 * mt2 * t * cy1f + 3 * mt * t * t * cy2f + t3 * endY,
            w: lerp(w0, w1, t),
            t: t,
        });
    }

    // ── Build left/right outlines ──
    const left = [],
        right = [];
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        let tx, ty;
        if (i === 0) {
            tx = pts[1].x - p.x;
            ty = pts[1].y - p.y;
        } else if (i === pts.length - 1) {
            tx = p.x - pts[i - 1].x;
            ty = p.y - pts[i - 1].y;
        } else {
            tx = pts[i + 1].x - pts[i - 1].x;
            ty = pts[i + 1].y - pts[i - 1].y;
        }
        const len = Math.sqrt(tx * tx + ty * ty) || 1;
        const nx = -ty / len;
        const ny = tx / len;
        const hw = p.w / 2;
        left.push({ x: p.x + nx * hw, y: p.y + ny * hw });
        right.push({ x: p.x - nx * hw, y: p.y - ny * hw });
    }

    // ── Tip tangent ──
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    const tTx = last.x - prev.x,
        tTy = last.y - prev.y;
    const tLen = Math.sqrt(tTx * tTx + tTy * tTy) || 1;

    return {
        left,
        right,
        tipX: last.x,
        tipY: last.y,
        tipNormX: -tTy / tLen,
        tipNormY: tTx / tLen,
        tipTangentAngle: Math.atan2(tTx, -tTy),
        samples: pts,
    };
}

/**
 * Sample a point along the path at parameter t ∈ [0,1].
 */
export function samplePathAt(samples, t) {
    const idx = t * (samples.length - 1);
    const i0 = Math.floor(idx);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const f = idx - i0;
    const p0 = samples[i0],
        p1 = samples[i1];
    const nx = lerp(p0.x, p1.x, f);
    const ny = lerp(p0.y, p1.y, f);
    const nw = lerp(p0.w, p1.w, f);

    let tx, ty;
    if (i0 === 0) {
        tx = samples[1].x - samples[0].x;
        ty = samples[1].y - samples[0].y;
    } else if (i1 === samples.length - 1) {
        tx = samples[i1].x - samples[i1 - 1].x;
        ty = samples[i1].y - samples[i1 - 1].y;
    } else {
        tx = samples[i1].x - samples[i0].x;
        ty = samples[i1].y - samples[i0].y;
    }
    const len = Math.sqrt(tx * tx + ty * ty) || 1;
    return {
        x: nx,
        y: ny,
        w: nw,
        angle: Math.atan2(tx, -ty),
        normX: -ty / len,
        normY: tx / len,
    };
}
