/**
 * ═══════════════════ UI INPUTS ═══════════════════
 * DOM element references and input range synchronization.
 */

// ── Canvas & core elements ──
export const canvas = document.getElementById("tree-canvas");
export const ctx = canvas.getContext("2d");
export const hierEl = document.getElementById("tree-hierarchy");
export const btnGenerate = document.getElementById("btn-generate");
export const btnDownload = document.getElementById("btn-download");
export const modeSelect = document.getElementById("mode-select");
export const sectionLateral = document.getElementById("section-lateral");
export const sectionDot = document.getElementById("section-dot");
export const chkDebugView = document.getElementById("chk-debug-view");
export const chkSubBranchFade = document.getElementById("chk-subbranch-fade");
export const rFadeLevel = document.getElementById("r-fade-level");
export const rvFadeLevel = document.getElementById("rv-fade-level");

// ── Range slider references ──
export const R = {
    curveMin: document.getElementById("r-curve-min"),
    curveMax: document.getElementById("r-curve-max"),
    angleMin: document.getElementById("r-angle-min"),
    angleMax: document.getElementById("r-angle-max"),
    lenMin: document.getElementById("r-len-min"),
    lenMax: document.getElementById("r-len-max"),
    trunkLen: document.getElementById("r-trunk-len"),
    trunkWid: document.getElementById("r-trunk-wid"),
    leafHue: document.getElementById("r-leaf-hue"),
};

export const RV = {
    curveMin: document.getElementById("rv-curve-min"),
    curveMax: document.getElementById("rv-curve-max"),
    angleMin: document.getElementById("rv-angle-min"),
    angleMax: document.getElementById("rv-angle-max"),
    lenMin: document.getElementById("rv-len-min"),
    lenMax: document.getElementById("rv-len-max"),
    trunkLen: document.getElementById("rv-trunk-len"),
    trunkWid: document.getElementById("rv-trunk-wid"),
    leafHue: document.getElementById("rv-leaf-hue"),
};

export const RL = {
    minHeight: document.getElementById("r-lat-min-height"),
    angleMin: document.getElementById("r-lat-angle-min"),
    angleMax: document.getElementById("r-lat-angle-max"),
    widthRatio: document.getElementById("r-lat-width-ratio"),
};

export const RLV = {
    minHeight: document.getElementById("rv-lat-min-height"),
    angleMin: document.getElementById("rv-lat-angle-min"),
    angleMax: document.getElementById("rv-lat-angle-max"),
    widthRatio: document.getElementById("rv-lat-width-ratio"),
};

export const RD = {
    dotSpacing: document.getElementById("r-dot-spacing"),
    gridCols: document.getElementById("r-dot-cols"),
    gridRows: document.getElementById("r-dot-rows"),
    chainMin: document.getElementById("r-dot-chain-min"),
    chainMax: document.getElementById("r-dot-chain-max"),
    dotLeafHue: document.getElementById("r-dot-leaf-hue"),
    dotTrunkWid: document.getElementById("r-dot-trunk-wid"),
    dotCurveMin: document.getElementById("r-dot-curve-min"),
    dotCurveMax: document.getElementById("r-dot-curve-max"),
    dotShape: document.getElementById("r-dot-shape"),
    showDots: document.getElementById("chk-show-dots"),
};

export const RDV = {
    dotSpacing: document.getElementById("rv-dot-spacing"),
    gridCols: document.getElementById("rv-dot-cols"),
    gridRows: document.getElementById("rv-dot-rows"),
    chainMin: document.getElementById("rv-dot-chain-min"),
    chainMax: document.getElementById("rv-dot-chain-max"),
    dotLeafHue: document.getElementById("rv-dot-leaf-hue"),
    dotTrunkWid: document.getElementById("rv-dot-trunk-wid"),
    dotCurveMin: document.getElementById("rv-dot-curve-min"),
    dotCurveMax: document.getElementById("rv-dot-curve-max"),
};

// ── Wire up live value display ──
Object.keys(R).forEach((k) => {
    if (R[k])
        R[k].addEventListener("input", () => {
            RV[k].textContent = R[k].value;
        });
});
Object.keys(RL).forEach((k) => {
    if (RL[k])
        RL[k].addEventListener("input", () => {
            RLV[k].textContent = RL[k].value;
        });
});

const rdKeys = ["dotSpacing", "gridCols", "gridRows", "chainMin", "chainMax", "dotLeafHue", "dotTrunkWid", "dotCurveMin", "dotCurveMax"];
rdKeys.forEach((k) => {
    if (RD[k] && RDV[k])
        RD[k].addEventListener("input", () => {
            RDV[k].textContent = RD[k].value;
        });
});

// ── Read current ranges from sliders ──
export function getRanges() {
    let cMin = +R.curveMin.value,
        cMax = +R.curveMax.value;
    if (cMin > cMax) [cMin, cMax] = [cMax, cMin];
    let aMin = +R.angleMin.value,
        aMax = +R.angleMax.value;
    if (aMin > aMax) [aMin, aMax] = [aMax, aMin];
    let lMin = +R.lenMin.value,
        lMax = +R.lenMax.value;
    if (lMin > lMax) [lMin, lMax] = [lMax, lMin];
    return {
        curveMin: cMin / 100,
        curveMax: cMax / 100,
        angleMin: aMin,
        angleMax: aMax,
        lenMin: lMin,
        lenMax: lMax,
        trunkLen: +R.trunkLen.value,
        trunkWid: +R.trunkWid.value,
        leafHue: +R.leafHue.value,
    };
}

export function getLateralRanges() {
    let aMin = +RL.angleMin.value,
        aMax = +RL.angleMax.value;
    if (aMin > aMax) [aMin, aMax] = [aMax, aMin];
    const shared = getRanges();
    return {
        ...shared,
        latMinHeight: +RL.minHeight.value / 100,
        latAngleMin: aMin,
        latAngleMax: aMax,
        latWidthRatio: +RL.widthRatio.value / 100,
    };
}

export function getDotRanges() {
    let cMin = +(RD.dotCurveMin?.value ?? 10);
    let cMax = +(RD.dotCurveMax?.value ?? 50);
    if (cMin > cMax) [cMin, cMax] = [cMax, cMin];
    let chainMin = +(RD.chainMin?.value ?? 2);
    let chainMax = +(RD.chainMax?.value ?? 6);
    if (chainMin > chainMax) [chainMin, chainMax] = [chainMax, chainMin];
    return {
        dotSpacing: +(RD.dotSpacing?.value ?? 28),
        gridCols: +(RD.gridCols?.value ?? 20),
        gridRows: +(RD.gridRows?.value ?? 20),
        dotMinLen: chainMin,
        dotMaxLen: chainMax,
        leafHue: +(RD.dotLeafHue?.value ?? 115),
        trunkWid: +(RD.dotTrunkWid?.value ?? 14),
        curveMin: cMin / 100,
        curveMax: cMax / 100,
        shape: RD.dotShape?.value ?? "circle",
        showDots: RD.showDots?.checked ?? false,
    };
}
