/**
 * ═══════════════════ RENDERER ═══════════════════
 * All canvas drawing: sky, ground, branches, leaves, debug overlay.
 */

import { dpr } from "./utils.js";
import { ctx, canvas } from "./ui-inputs.js";
import { createLeafRenderData } from "./leaf.js";

// ── Draw branch as a filled polygon ──
export function drawBranchFill(path, depth, opacity = 1) {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.beginPath();
    ctx.moveTo(path.left[0].x, path.left[0].y);
    for (let i = 1; i < path.left.length; i++)
        ctx.lineTo(path.left[i].x, path.left[i].y);
    const end = path.right.length - 1;
    for (let i = end; i >= 0; i--) ctx.lineTo(path.right[i].x, path.right[i].y);
    ctx.closePath();
    ctx.fillStyle = "#5d4037";
    ctx.fill();
    ctx.strokeStyle = `rgba(30,20,10,${Math.max(0.05, 0.25 - depth * 0.04)})`;
    ctx.lineWidth = 0.5;
    ctx.stroke();
    ctx.restore();
}

// ── Draw tiny stem line for leaf minibranches ──
export function drawLeafStemLine(path, tipW, opacity = 1) {
    if (!path || !path.samples || path.samples.length < 2) return;
    let maxW = tipW || 0;
    for (const s of path.samples) maxW = Math.max(maxW, s.w || 0);
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.beginPath();
    ctx.moveTo(path.samples[0].x, path.samples[0].y);
    for (let i = 1; i < path.samples.length; i++)
        ctx.lineTo(path.samples[i].x, path.samples[i].y);
    ctx.strokeStyle = "#5d4037";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2.0, maxW * 0.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(path.samples[0].x, path.samples[0].y);
    for (let i = 1; i < path.samples.length; i++)
        ctx.lineTo(path.samples[i].x, path.samples[i].y);
    ctx.strokeStyle = "#4e342e";
    ctx.lineWidth = Math.max(1.5, maxW * 0.4);
    ctx.stroke();
    ctx.restore();
}

// ── Draw leaf shape ──
export function drawLeaf(x, y, angle, size, hue, opacity = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    const s = size / 18;
    ctx.scale(s, s);
    ctx.translate(0, 9);
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.bezierCurveTo(3.25, -11.7, 4.55, -7.2, 3.9, -5.4);
    ctx.bezierCurveTo(3.25, -3.15, 1.3, -1.35, 0, 0);
    ctx.bezierCurveTo(-1.3, -1.35, -3.25, -3.15, -3.9, -5.4);
    ctx.bezierCurveTo(-4.55, -7.2, -3.25, -11.7, 0, -18);
    ctx.closePath();
    ctx.fillStyle = "#7cc37d";
    ctx.globalAlpha = 0.9 * opacity;
    ctx.fill();
    ctx.globalAlpha = 1.0 * opacity;
    ctx.strokeStyle = "rgba(0,0,0,0.15)";
    ctx.lineWidth = 0.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(0, 0);
    ctx.strokeStyle = "rgba(0,0,0,0.2)";
    ctx.lineWidth = 0.4;
    ctx.stroke();
    ctx.restore();
}

// ── Draw leaf at branch tip (stem connector + leaf body) ──
export function drawLeafAtTip(path, tipW, ranges, leafData, opacity = 1) {
    ctx.save();
    ctx.globalAlpha = opacity;
    const leaf = leafData || createLeafRenderData(path, tipW, ranges, "fallback");
    const px = leaf.x,
        py = leaf.y,
        ang = leaf.angle;
    const base = path.samples[0];

    // Triangular stem connector
    ctx.beginPath();
    const hw = Math.max(0.7, leaf.stemHalfWidth || tipW * 0.55);
    ctx.moveTo(path.tipX + path.tipNormX * hw, path.tipY + path.tipNormY * hw);
    ctx.lineTo(path.tipX - path.tipNormX * hw, path.tipY - path.tipNormY * hw);
    ctx.lineTo(px, py);
    ctx.closePath();
    ctx.fillStyle = "#4e342e";
    ctx.fill();

    // Thin center line
    ctx.beginPath();
    ctx.moveTo(path.tipX, path.tipY);
    ctx.lineTo(px, py);
    ctx.strokeStyle = "rgba(44, 27, 20, 0.95)";
    ctx.lineWidth = Math.max(1.0, hw * 0.9);
    ctx.stroke();

    // Base-to-tip line
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(px, py);
    ctx.strokeStyle = "#4e342e";
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(2.0, base.w * 0.75);
    ctx.stroke();

    drawLeaf(px, py, ang, leaf.size, leaf.hue, opacity);
    ctx.restore();
}

// ── Draw sky background, stars, and ground ──
export function drawSky(W, H, groundY) {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#0d1b2a");
    grad.addColorStop(0.35, "#1b2838");
    grad.addColorStop(0.65, "#2a4a5e");
    grad.addColorStop(0.85, "#3e6b7a");
    grad.addColorStop(1, "#4a8070");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Stars
    let s = 42;
    const sr = () => {
        s = (s * 16807) % 2147483647;
        return s / 2147483647;
    };
    for (let i = 0; i < 80; i++) {
        ctx.beginPath();
        ctx.arc(sr() * W, sr() * groundY * 0.6, 0.4 + sr() * 1.2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${0.15 + sr() * 0.5})`;
        ctx.fill();
    }

    // Ground
    const gg = ctx.createLinearGradient(0, groundY - 10, 0, H);
    gg.addColorStop(0, "#2d4a2e");
    gg.addColorStop(1, "#0f1f10");
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.quadraticCurveTo(W * 0.25, groundY - 10, W * 0.5, groundY - 3);
    ctx.quadraticCurveTo(W * 0.75, groundY + 5, W, groundY);
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();

    // Grass blades
    let gs = 111;
    const gr = () => {
        gs = (gs * 16807) % 2147483647;
        return gs / 2147483647;
    };
    for (let i = 0; i < 150; i++) {
        const gx = gr() * W,
            gy = groundY + gr() * 8 - 4,
            gh = 4 + gr() * 10;
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.quadraticCurveTo(
            gx + (gr() - 0.5) * 6,
            gy - gh * 0.6,
            gx + (gr() - 0.5) * 3,
            gy - gh
        );
        ctx.strokeStyle = `hsla(${95 + gr() * 40},45%,${22 + gr() * 18}%,${0.3 + gr() * 0.4
            })`;
        ctx.lineWidth = 0.5 + gr();
        ctx.stroke();
    }
}

// ── Debug overlay (yellow border + red growth zone) ──
export function renderDebugOverlay(branch, stroke = "#FFFF00", showZone = true) {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = stroke;
    ctx.filter = "drop-shadow(0 0 2px black)";
    if (branch.isLeaf && branch.leafData) {
        ctx.beginPath();
        ctx.arc(branch.leafData.x, branch.leafData.y, branch.leafData.size * 1.0, 0, Math.PI * 2);
        ctx.stroke();
    } else {
        ctx.beginPath();
        ctx.moveTo(branch.path.left[0].x, branch.path.left[0].y);
        for (let p of branch.path.left) ctx.lineTo(p.x, p.y);
        for (let i = branch.path.right.length - 1; i >= 0; i--)
            ctx.lineTo(branch.path.right[i].x, branch.path.right[i].y);
        ctx.closePath();
        ctx.stroke();
    }
    ctx.filter = "none";
    if (showZone && branch.minT != null) {
        const minIdx = Math.floor(
            branch.minT * (branch.path.samples.length - 1)
        );
        const maxIdx = Math.floor(
            branch.maxT * (branch.path.samples.length - 1)
        );
        ctx.beginPath();
        const startL = Math.max(0, minIdx),
            endL = Math.min(branch.path.left.length - 1, maxIdx);
        for (let i = startL; i <= endL; i++) {
            const pt = branch.path.left[i];
            if (i === startL) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
        }
        for (let i = endL; i >= startL; i--) {
            const pt = branch.path.right[i];
            ctx.lineTo(pt.x, pt.y);
        }
        ctx.closePath();
        ctx.fillStyle = "rgba(255, 0, 0, 0.35)";
        ctx.fill();
    }
    ctx.restore();
}

/**
 * Main render — clears canvas and draws the full scene.
 */
export function renderScene(state) {
    const {
        allBranches,
        isDebug,
        isSubBranchFade,
        fadeFromLevel,
        hoveredBranch,
        selectedBranch,
        selectedNodeIds,
        rFadeLevel,
        rvFadeLevel,
        dotGridData,
        showDots,
    } = state;

    const W = canvas.width / dpr,
        H = canvas.height / dpr,
        groundY = H * 0.87;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    drawSky(W, H, groundY);

    // Sync fade slider range to tree depth
    syncFadeSliderRangeToTreeDepth(
        allBranches,
        rFadeLevel,
        rvFadeLevel,
        state
    );

    const getBranchOpacity = (depth) => {
        if (!isSubBranchFade) return 1;
        return depth >= state.fadeFromLevel ? 0.18 : 1;
    };

    const ordered = [...allBranches].sort((a, b) => a.depth - b.depth);

    // Draw dots behind tree so trunk/leaves are never hidden.
    if (dotGridData && showDots) {
        const { dots, dotSpacing } = dotGridData;
        const r = Math.max(3, dotSpacing * 0.16);
        ctx.save();
        ctx.globalAlpha = 0.38;
        for (const d of dots) {
            ctx.beginPath();
            ctx.arc(d.x, d.y, r, 0, Math.PI * 2);
            ctx.fillStyle = d.occupied ? "#ff8800" : "#3399ff";
            ctx.fill();
            ctx.beginPath();
            ctx.arc(d.x, d.y, r + 1, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(255,255,255,0.4)";
            ctx.lineWidth = 1;
            ctx.stroke();
        }
        ctx.restore();
    }

    // Pass 1: non-leaf branches
    for (const b of ordered) {
        if (!b.isLeaf) drawBranchFill(b.path, b.depth, getBranchOpacity(b.depth));
    }

    // Pass 2: leaf stems
    for (const b of ordered) {
        if (b.isLeaf) {
            const opacity = getBranchOpacity(b.depth);
            drawBranchFill(b.path, b.depth, opacity);
            drawLeafStemLine(b.path, b.tipWidth, opacity);
        }
    }

    // Pass 3: leaf bodies
    for (const b of ordered) {
        if (b.isLeaf)
            drawLeafAtTip(
                b.path,
                b.tipWidth,
                b.ranges,
                b.leafData,
                getBranchOpacity(b.depth)
            );
    }
    // Debug overlay
    if (isDebug) {
        if (selectedBranch) {
            if (selectedNodeIds && selectedNodeIds.size > 0) {
                for (const b of ordered) {
                    if (b.nodeId && selectedNodeIds.has(b.nodeId)) {
                        const isSelected = b === selectedBranch;
                        renderDebugOverlay(
                            b,
                            isSelected ? "#00E5FF" : "#FFE066",
                            isSelected
                        );
                    }
                }
            } else {
                renderDebugOverlay(selectedBranch, "#00E5FF", true);
            }
        } else if (hoveredBranch) {
            renderDebugOverlay(hoveredBranch);
        }
    }
    ctx.restore();
}

function syncFadeSliderRangeToTreeDepth(
    allBranches,
    rFadeLevel,
    rvFadeLevel,
    state
) {
    if (!rFadeLevel || !rvFadeLevel) return;
    let maxDepth = 1;
    for (const b of allBranches) maxDepth = Math.max(maxDepth, b.depth || 0);
    const safeMax = Math.max(1, maxDepth);
    if (+rFadeLevel.max !== safeMax) rFadeLevel.max = String(safeMax);
    if (state.fadeFromLevel > safeMax) {
        state.fadeFromLevel = safeMax;
        rFadeLevel.value = String(safeMax);
    }
    rvFadeLevel.textContent = String(state.fadeFromLevel);
}

