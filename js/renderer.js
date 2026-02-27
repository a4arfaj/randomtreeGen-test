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

// Show base-collision allowance zone.
function drawBranchBaseAllowZone(path, allowT = 0.5, opacity = 1) {
    if (!path?.left || !path?.right) return;
    const n = Math.min(path.left.length, path.right.length);
    if (n < 4) return;
    const seg = Math.max(2, Math.floor(n * allowT));

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.beginPath();
    ctx.moveTo(path.left[0].x, path.left[0].y);
    for (let i = 1; i <= seg; i++) ctx.lineTo(path.left[i].x, path.left[i].y);
    for (let i = seg; i >= 0; i--) ctx.lineTo(path.right[i].x, path.right[i].y);
    ctx.closePath();
    ctx.fillStyle = "rgba(66,165,245,0.35)";
    ctx.fill();
    ctx.strokeStyle = "rgba(100,190,255,0.95)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
}

function drawCollisionPoint(x, y, opacity = 1) {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(220,50,47,0.92)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 5.6, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,190,190,0.95)";
    ctx.lineWidth = 1;
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
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = stroke;
    ctx.filter = "drop-shadow(0 0 2px black)";
    if (branch.isLeaf && branch.leafData) {
        // Draw the real leaf bezier outline — same transform as drawLeaf()
        const { x, y, angle, size } = branch.leafData;
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
        ctx.bezierCurveTo(-1.3, -3.15, -3.25, -3.15, -3.9, -5.4);
        ctx.bezierCurveTo(-4.55, -7.2, -3.25, -11.7, 0, -18);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
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
        if (!b.isLeaf) {
            drawBranchFill(b.path, b.depth, getBranchOpacity(b.depth));
        }
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

    if (isDebug) {
        // Base allowance (25%) where collisions are allowed.
        const highlighted = new Set();
        if (selectedBranch) {
            for (const b of ordered) {
                if (selectedNodeIds && b.nodeId && selectedNodeIds.has(b.nodeId)) {
                    highlighted.add(b);
                } else if (!selectedNodeIds && b === selectedBranch) {
                    highlighted.add(b);
                }
            }
        } else if (hoveredBranch) {
            highlighted.add(hoveredBranch);
        }
        for (const b of highlighted) {
            if (!b.isLeaf) {
                drawBranchBaseAllowZone(
                    b.path,
                    b.baseAllowT ?? 0.5,
                    getBranchOpacity(b.depth)
                );
            }
        }

        // Actual detected collisions outside allowance / leaf body overlaps.
        for (const b of ordered) {
            if (Array.isArray(b.collisionPoints)) {
                for (const p of b.collisionPoints) {
                    drawCollisionPoint(p.x, p.y, getBranchOpacity(b.depth));
                }
            }
            if (b.isLeaf && b.leafCollision && b.leafData) {
                renderDebugOverlay(b, "rgba(220,50,47,0.95)", false);
            }
        }
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

    // Secondary branch marker (green) and primary branch marker (white)
    for (const b of ordered) {
        if (b.isHighlightGreen) {
            renderDebugOverlay(b, "#66BB6A", false);
        }
    }

    // White polygon border on the primary branch being solved
    for (const b of ordered) {
        if (b.isHighlightWhite) {
            renderDebugOverlay(b, "#FFFFFF", false);
        }
    }

    // Agent draws its own red overlap zone + eyeball (on top of white border)
    if (state.agent && state.agent.active) {
        state.agent.draw(ctx);
    }

    // ── Show ALL collisions overlay (checkbox-driven) ──────────────────
    if (state.showAllCollisions) {
        const abs = state.allBranches;
        const parentMap = state.agent?._parentMap || new Map();
        const areAdj = (a, b) => {
            const n1 = a.nodeId, n2 = b.nodeId;
            return n1 === n2;
        };
        const isParentChild = (a, b) =>
            parentMap.get(a.nodeId) === b.nodeId || parentMap.get(b.nodeId) === a.nodeId;
        const isSibling = (a, b) => {
            const p1 = parentMap.get(a.nodeId);
            const p2 = parentMap.get(b.nodeId);
            return p1 != null && p1 === p2 && a.nodeId !== b.nodeId;
        };
        const baseAllowT = (b) => Math.max(0, Math.min(0.95, b?.baseAllowT ?? 0.5));
        const baseSampleLimit = (b) => {
            const n = b?.path?.samples?.length || 0;
            return n <= 0 ? 0 : Math.max(4, Math.floor(n * baseAllowT(b)));
        };
        const nearBasePoint = (b, pt) => {
            const p0 = b?.path?.samples?.[0];
            if (!p0 || !pt) return false;
            const bw = p0.w || 2;
            const r = Math.max(6, bw * 2.2);
            const dx = p0.x - pt.x;
            const dy = p0.y - pt.y;
            return dx * dx + dy * dy <= r * r;
        };
        const isNaturalBaseOnlyTouch = (source, target, pt, sourceSampleIdx = -1) => {
            if (!source || !target || !pt) return false;
            const sourceNearBase = sourceSampleIdx >= 0
                ? sourceSampleIdx <= baseSampleLimit(source)
                : nearBasePoint(source, pt);
            if (isParentChild(source, target)) {
                const child = parentMap.get(source.nodeId) === target.nodeId ? source : target;
                if (!child?.path?.samples?.[0]) return false;
                if (source === child) return sourceNearBase;
                return true;
            }
            const targetNearBase = nearBasePoint(target, pt);
            if (!sourceNearBase || !targetNearBase) return false;
            return true;
        };
        const pointHits = (source, target, pt, sourceSampleIdx = -1) => {
            if (!target?.path2d || !pt) return false;
            if (areAdj(source, target)) return false;
            if (isNaturalBaseOnlyTouch(source, target, pt, sourceSampleIdx)) return false;
            return ctx.isPointInPath(target.path2d, pt.x, pt.y);
        };

        // Phase 1: DETECT in identity transform (isPointInPath needs un-scaled context)
        const savedXform = ctx.getTransform();
        ctx.resetTransform();

        const stemHits = [];   // { branch, minI, maxI }
        const leafHits = [];   // { leafData }

        for (let i = 0; i < abs.length; i++) {
            const b1 = abs[i];
            if (!b1.path?.samples || !b1.path2d) continue;
            for (let j = i + 1; j < abs.length; j++) {
                const b2 = abs[j];
                if (!b2.path?.samples || !b2.path2d) continue;
                if (areAdj(b1, b2)) continue;

                // b1 samples in b2
                let minI = Infinity, maxI = -1;
                const s = b1.path.samples;
                for (let k = 4; k < s.length; k += 3) {
                    if (!s[k]) continue;
                    if (pointHits(b1, b2, s[k], k)) {
                        if (k < minI) minI = k;
                        if (k > maxI) maxI = k;
                    }
                }
                if (maxI >= minI && minI < Infinity) {
                    stemHits.push({ branch: b1, minI, maxI });
                }

                // b2 samples in b1
                minI = Infinity; maxI = -1;
                const s2 = b2.path.samples;
                for (let k = 4; k < s2.length; k += 3) {
                    if (!s2[k]) continue;
                    if (pointHits(b2, b1, s2[k], k)) {
                        if (k < minI) minI = k;
                        if (k > maxI) maxI = k;
                    }
                }
                if (maxI >= minI && minI < Infinity) {
                    stemHits.push({ branch: b2, minI, maxI });
                }

                // Leaf body hits
                if (b1.isLeaf && b1.leafData && b2.path2d) {
                    if (pointHits(b1, b2, { x: b1.leafData.x, y: b1.leafData.y }, -1)) {
                        leafHits.push({ leafData: b1.leafData });
                    }
                }
                if (b2.isLeaf && b2.leafData && b1.path2d) {
                    if (pointHits(b2, b1, { x: b2.leafData.x, y: b2.leafData.y }, -1)) {
                        leafHits.push({ leafData: b2.leafData });
                    }
                }
            }
        }

        // Phase 2: DRAW results in the correct render transform
        ctx.setTransform(savedXform);

        for (const { branch, minI, maxI } of stemHits) {
            const L = branch.path.left, R = branch.path.right;
            const mi = Math.max(4, minI);
            const ma = Math.min(maxI, Math.min(L.length, R.length) - 1);
            if (ma < mi) continue;
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(L[mi].x, L[mi].y);
            for (let ii = mi + 1; ii <= ma; ii++) ctx.lineTo(L[ii].x, L[ii].y);
            for (let ii = ma; ii >= mi; ii--)    ctx.lineTo(R[ii].x, R[ii].y);
            ctx.closePath();
            ctx.fillStyle = "rgba(255, 60, 20, 0.35)";
            ctx.fill();
            ctx.strokeStyle = "rgba(255, 120, 40, 0.7)";
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.restore();
        }

        for (const { leafData } of leafHits) {
            ctx.save();
            ctx.translate(leafData.x, leafData.y);
            ctx.rotate(leafData.angle);
            const sz = leafData.size / 18;
            ctx.scale(sz, sz);
            ctx.translate(0, 9);
            ctx.beginPath();
            ctx.moveTo(0, -18);
            ctx.bezierCurveTo(3.25, -11.7, 4.55, -7.2, 3.9, -5.4);
            ctx.bezierCurveTo(3.25, -3.15, 1.3, -1.35, 0, 0);
            ctx.bezierCurveTo(-1.3, -1.35, -3.25, -3.15, -3.9, -5.4);
            ctx.bezierCurveTo(-4.55, -7.2, -3.25, -11.7, 0, -18);
            ctx.closePath();
            ctx.fillStyle = "rgba(255, 50, 10, 0.40)";
            ctx.fill();
            ctx.strokeStyle = "rgba(255, 120, 40, 0.8)";
            ctx.lineWidth = 1.5 / sz;
            ctx.stroke();
            ctx.restore();
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
