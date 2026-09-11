import { getP } from './ui.js';
import { computeGeometry } from './geometry.js';
import { ui } from './state.js';
import { springConstants } from './material.js';

// Dihedral (fold) angles at the mountain crease AC (psi_m) and valley crease
// BC (psi_v) of one Kresling unit cell, at floor height h. A, B are two
// adjacent bottom-polygon vertices (z=0); C, D are the corresponding
// top-polygon vertices (z=h), twisted by phi = dxH/R (arc-length small-angle
// approximation, not modal.js's exact chord angle — see MODEL_NOTES).
// Exported (pure function of h, L_r0, R, n) so it can be verified directly
// against an independent dihedral-angle formula in test/regression.mjs,
// rather than only indirectly through the canvas draw.
export function getDihedral(h, L_r0, R, n) {
  if (h <= 0 || h >= L_r0) return null;
  const dxH   = Math.sqrt(Math.max(0, L_r0*L_r0 - h*h));
  const phi   = dxH / R;
  const alpha = Math.PI / n;
  const vsub  = ([ax,ay,az],[bx,by,bz]) => [ax-bx,ay-by,az-bz];
  const vcross= ([ax,ay,az],[bx,by,bz]) => [ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx];
  const vdot  = ([ax,ay,az],[bx,by,bz]) => ax*bx+ay*by+az*bz;
  const vnorm = v => { const l=Math.hypot(...v)||1; return v.map(x=>x/l); };
  const A=[R,0,0];
  const B=[R*Math.cos(2*alpha), R*Math.sin(2*alpha), 0];
  const C=[R*Math.cos(phi)*Math.cos(alpha)-R*Math.sin(phi)*Math.sin(alpha),
           R*Math.cos(phi)*Math.sin(alpha)+R*Math.sin(phi)*Math.cos(alpha), h];
  const D=[R*Math.cos(phi+2*alpha), R*Math.sin(phi+2*alpha), h];
  const n1=vnorm(vcross(vsub(B,A),vsub(C,A)));
  const n2=vnorm(vcross(vsub(C,A),vsub(D,A)));
  // Valley crease BC is shared by faces ABC and BCD (mirrors how n1/n2
  // share mountain crease AC between faces ABC and ACD, pivoting on the
  // other shared-edge endpoint B instead of A). The previous n3 only ever
  // referenced A, B, C — never D — so it was just ±n1 (the same face
  // renormalized), making psi_v a constant pi regardless of h. Verified
  // against an independent torsion-angle formula on the 4-point chain.
  const n3=vnorm(vcross(vsub(A,B),vsub(C,B)));
  const n4=vnorm(vcross(vsub(C,B),vsub(D,B)));
  return {
    psi_m: Math.acos(Math.max(-1,Math.min(1,vdot(n1,n2)))),
    psi_v: Math.acos(Math.max(-1,Math.min(1,vdot(n3,n4)))),
    dxH,
  };
}

export function drawEnergy() {
  const canvas = document.getElementById('canvasEnergy');
  const wrap   = canvas.parentElement;
  const rect   = wrap.getBoundingClientRect();
  const W = Math.max(200, Math.round(rect.width)  || 340);
  const H = Math.max(200, Math.round(rect.height) || 400);
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1a1d28'; ctx.fillRect(0, 0, W, H);

  const p = getP(), g = computeGeometry(p);
  const { n, floors, stack } = p;
  const { floor_h, R, b, dx } = g;
  const totalFloors = floors * stack;

  const L_r0  = g.red_len;
  const h_max = L_r0 * 0.999;
  const h_min = L_r0 * 0.02;
  const STEPS = 400;

  const rest = getDihedral(floor_h, L_r0, R, n);
  if (!rest) {
    ctx.fillStyle='#f87171'; ctx.font='12px monospace';
    ctx.fillText('Cannot compute energy: invalid geometry', 20, H/2); return;
  }
  const { psi_m: psi_m0, psi_v: psi_v0 } = rest;
  const { k_m, k_v } = springConstants(p, g);

  const energyPoints = [], heightPoints = [];
  let minE = Infinity, maxE = -Infinity;

  for (let i = 0; i <= STEPS; i++) {
    const h      = h_min + (i/STEPS) * (h_max - h_min);
    const angles = getDihedral(h, L_r0, R, n);
    if (!angles) { energyPoints.push(0); heightPoints.push(h * totalFloors); continue; }
    const { psi_m, psi_v } = angles;
    const E = (k_m*(psi_m-psi_m0)**2 + k_v*(psi_v-psi_v0)**2) * n * totalFloors;
    energyPoints.push(E); heightPoints.push(h * totalFloors);
    if (E < minE) minE = E; if (E > maxE) maxE = E;
  }

  // Quasi-static force needed to hold/drive the tube at height h: by the
  // principle of virtual work, F(h) = dE/dh along the deployment path. Only
  // meaningful in real Newtons when material=polyimide (k_m,k_v in N·cm/rad
  // from material.js); the generic material's k_m=2.0,k_v=1.0 are arbitrary
  // units, so a "force" derived from them wouldn't be physically real.
  const showForce = p.material === 'polyimide';
  const forcePoints = [];
  let minF = Infinity, maxF = -Infinity;
  if (showForce) {
    for (let i = 0; i <= STEPS; i++) {
      const i0 = Math.max(0, i-1), i1 = Math.min(STEPS, i+1);
      const dE = energyPoints[i1] - energyPoints[i0];
      const dh = heightPoints[i1] - heightPoints[i0];
      const F = dh !== 0 ? dE/dh : 0;
      forcePoints.push(F);
      if (F < minF) minF = F; if (F > maxF) maxF = F;
    }
    // Robust axis scaling: dE/dh genuinely diverges as h approaches the
    // crease-inextensibility limits (h -> h_min or h -> h_max) — that's a
    // real feature of the model (the underlying energy has a steep but
    // visually tiny uptick there, invisible on the 0..maxE scale), not a
    // bug. But it's not representative of any realistic operating range,
    // and letting it set the axis scale crushes the physically meaningful
    // region near the stable state into an unreadable sliver. Base the
    // visible range on the 92nd percentile of |F| instead, and let the
    // curve clip off the top/bottom near the edges.
    const sortedAbsF = forcePoints.map(Math.abs).slice().sort((a,b)=>a-b);
    const robustSpan = Math.max(sortedAbsF[Math.floor(sortedAbsF.length*0.92)], 1e-6);
    minF = -robustSpan * 1.15; maxF = robustSpan * 1.15;
  }

  // Find local minima. The window shrinks near the sweep edges (rather than
  // excluding those indices outright) so the one minimum that's always
  // present at the designed rest height isn't missed just because that
  // height happens to sit close to h_min/h_max (e.g. any near-90 deg preset,
  // or "tower": floor_h lands within WINDOW samples of h_max with a fixed
  // 8-sample margin, so it was silently dropped and the graph showed zero
  // equilibria). The two absolute endpoints are excluded here since they're
  // handled separately by endpointMinima below.
  const WINDOW = 8;
  const localMinima = [];
  for (let i = 1; i < energyPoints.length - 1; i++) {
    const w = Math.min(WINDOW, i, energyPoints.length - 1 - i);
    let isMin = true;
    for (let j = i-w; j <= i+w; j++) { if (j!==i && energyPoints[j]<=energyPoints[i]){isMin=false;break;} }
    if (isMin) localMinima.push({ idx:i, h:heightPoints[i], E:energyPoints[i] });
  }
  const mergedMinima = [];
  let lastH = -Infinity;
  for (const m of localMinima) {
    if (m.h - lastH > (h_max-h_min)*totalFloors*0.05) { mergedMinima.push(m); lastH=m.h; }
  }
  const endpointMinima = [];
  if (energyPoints[0]    < energyPoints[WINDOW])        endpointMinima.push({idx:0,     h:heightPoints[0],     E:energyPoints[0],     label:'Collapsed'});
  if (energyPoints[STEPS] < energyPoints[STEPS-WINDOW]) endpointMinima.push({idx:STEPS, h:heightPoints[STEPS], E:energyPoints[STEPS], label:'Extended'});
  const allMinima   = [...endpointMinima, ...mergedMinima];
  const isBistable  = mergedMinima.length >= 1 && (endpointMinima.length >= 1 || mergedMinima.length >= 2) && g.bistable;

  // Layout
  const PAD = { l:52, r: showForce ? 46 : 16, t:40, b:48 };
  const gW = W-PAD.l-PAD.r, gH = H-PAD.t-PAD.b;
  const totalH_max = heightPoints[STEPS], totalH_min = heightPoints[0];
  function toX(h) { return PAD.l + (h-totalH_min)/(totalH_max-totalH_min+1e-9)*gW; }
  function toY(E) { return PAD.t + gH - (E-minE)/(maxE-minE+1e-9)*gH; }
  function toY2(F) { return PAD.t + gH - (F-minF)/(maxF-minF+1e-9)*gH; }

  // Grid (tick counts shrink on narrow/short panels so labels never crowd
  // into each other \u2014 at the default size these evaluate to 5 and 4, i.e.
  // unchanged from before)
  const xDivs = Math.max(2, Math.min(5, Math.floor(gW / 45)));
  const yDivs = Math.max(2, Math.min(4, Math.floor(gH / 40)));
  ctx.strokeStyle='rgba(59,130,246,0.1)'; ctx.lineWidth=0.5;
  for(let i=0;i<=yDivs;i++){const y=PAD.t+i*(gH/yDivs);ctx.beginPath();ctx.moveTo(PAD.l,y);ctx.lineTo(PAD.l+gW,y);ctx.stroke();}
  for(let i=0;i<=xDivs;i++){const x=PAD.l+i*(gW/xDivs);ctx.beginPath();ctx.moveTo(x,PAD.t);ctx.lineTo(x,PAD.t+gH);ctx.stroke();}

  ctx.strokeStyle='rgba(180,200,255,0.45)'; ctx.lineWidth=1.2;
  ctx.beginPath();ctx.moveTo(PAD.l,PAD.t);ctx.lineTo(PAD.l,PAD.t+gH);ctx.lineTo(PAD.l+gW,PAD.t+gH);ctx.stroke();

  // Axis labels
  ctx.fillStyle='rgba(139,144,160,0.9)'; ctx.font='10px "JetBrains Mono",monospace'; ctx.textAlign='center';
  ctx.fillText('Total height (cm)', PAD.l+gW/2, H-6);
  const energyUnitLabel = p.material === 'polyimide' ? 'Energy (N\u00b7cm)' : 'Energy (a.u.)';
  ctx.save();ctx.translate(11,PAD.t+gH/2);ctx.rotate(-Math.PI/2);ctx.fillText(energyUnitLabel,0,0);ctx.restore();
  ctx.font='9px "JetBrains Mono",monospace';
  for(let i=0;i<=xDivs;i++){const h=totalH_min+(i/xDivs)*(totalH_max-totalH_min);ctx.fillStyle='rgba(139,144,160,0.7)';ctx.fillText(h.toFixed(1),toX(h),PAD.t+gH+13);}
  ctx.textAlign='right';
  for(let i=0;i<=yDivs;i++){const E=minE+(1-i/yDivs)*(maxE-minE);const y=PAD.t+(i/yDivs)*gH;ctx.fillStyle='rgba(139,144,160,0.6)';ctx.fillText(E.toFixed(3),PAD.l-4,y+3);}

  if (showForce) {
    ctx.strokeStyle='rgba(180,200,255,0.45)'; ctx.lineWidth=1.2;
    ctx.beginPath();ctx.moveTo(PAD.l+gW,PAD.t);ctx.lineTo(PAD.l+gW,PAD.t+gH);ctx.stroke();
    ctx.textAlign='left'; ctx.font='9px "JetBrains Mono",monospace';
    for(let i=0;i<=yDivs;i++){const F=minF+(1-i/yDivs)*(maxF-minF);const y=PAD.t+(i/yDivs)*gH;ctx.fillStyle='rgba(245,158,11,0.75)';ctx.fillText(F.toFixed(2),PAD.l+gW+4,y+3);}
    ctx.save();ctx.translate(W-8,PAD.t+gH/2);ctx.rotate(Math.PI/2);ctx.textAlign='center';ctx.font='10px "JetBrains Mono",monospace';ctx.fillStyle='rgba(245,158,11,0.85)';ctx.fillText('Force (N)',0,0);ctx.restore();
    // Zero-force reference line
    const y0 = toY2(0);
    ctx.beginPath();ctx.moveTo(PAD.l,y0);ctx.lineTo(PAD.l+gW,y0);ctx.strokeStyle='rgba(245,158,11,0.15)';ctx.lineWidth=0.8;ctx.setLineDash([2,3]);ctx.stroke();ctx.setLineDash([]);
  }

  // Fill + curve
  ctx.beginPath();ctx.moveTo(toX(heightPoints[0]),PAD.t+gH);
  for(let i=0;i<=STEPS;i++)ctx.lineTo(toX(heightPoints[i]),toY(energyPoints[i]));
  ctx.lineTo(toX(heightPoints[STEPS]),PAD.t+gH);ctx.closePath();
  ctx.fillStyle='rgba(59,130,246,0.07)';ctx.fill();
  ctx.beginPath();
  for(let i=0;i<=STEPS;i++){const x=toX(heightPoints[i]),y=toY(energyPoints[i]);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);}
  ctx.strokeStyle='#378ADD';ctx.lineWidth=2;ctx.setLineDash([]);ctx.stroke();

  if (showForce) {
    ctx.beginPath();
    for(let i=0;i<=STEPS;i++){
      const Fc = Math.max(minF, Math.min(maxF, forcePoints[i]));
      const x=toX(heightPoints[i]), y=toY2(Fc);
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
    }
    ctx.strokeStyle='#f59e0b';ctx.lineWidth=1.6;ctx.setLineDash([3,2]);ctx.stroke();ctx.setLineDash([]);
  }

  // Designed-state marker
  const designedH = floor_h * totalFloors;
  ctx.beginPath();ctx.moveTo(toX(designedH),PAD.t);ctx.lineTo(toX(designedH),PAD.t+gH);
  ctx.strokeStyle='rgba(160,160,200,0.3)';ctx.lineWidth=1;ctx.setLineDash([4,3]);ctx.stroke();ctx.setLineDash([]);

  // Current-state (compress slider) position, computed up front because the
  // minima-label loop below needs it: the as-designed height very often *is*
  // an energy minimum, so the current-state dot frequently lands right on
  // top of an equilibrium marker — their labels must not both claim the
  // normal "float near the dot" position or they render as illegible mush.
  const curH    = (1-p.compress)*(designedH - h_min*totalFloors) + h_min*totalFloors;
  const curIdx  = Math.max(0,Math.min(STEPS,Math.round((curH-totalH_min)/(totalH_max-totalH_min)*STEPS)));
  const curE    = energyPoints[curIdx];
  const curF    = showForce ? forcePoints[curIdx] : null;
  const cx2=toX(curH), cy2=toY(curE);
  const COINCIDE_PX = 8;

  // Minima
  const eqColors=['#4ade80','#fbbf24','#a78bfa','#f87171'];
  let coincidentIdx = -1;
  allMinima.forEach((eq,idx)=>{
    const x=toX(eq.h),y=toY(eq.E);
    ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fillStyle=eqColors[idx%eqColors.length];ctx.fill();
    ctx.strokeStyle='#1a1d28';ctx.lineWidth=1.5;ctx.stroke();
    ctx.beginPath();ctx.moveTo(x,y+5);ctx.lineTo(x,PAD.t+gH);ctx.strokeStyle=eqColors[idx%eqColors.length];ctx.lineWidth=0.7;ctx.setLineDash([2,3]);ctx.stroke();ctx.setLineDash([]);
    if (Math.hypot(x-cx2,y-cy2) < COINCIDE_PX) coincidentIdx = idx;
    ctx.fillStyle=eqColors[idx%eqColors.length];ctx.font='9px "JetBrains Mono",monospace';ctx.textAlign='center';
    ctx.fillText(eq.label||(idx===0?'Eq.A':'Eq.B'),x,y-8);ctx.fillText(eq.h.toFixed(1)+'cm',x,y-18);
  });

  // Current-state dot (compress slider)
  ctx.beginPath();ctx.arc(cx2,cy2,6,0,Math.PI*2);ctx.fillStyle='#ef4444';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();
  ctx.fillStyle='#f87171';ctx.font='9px "JetBrains Mono",monospace';
  if (coincidentIdx >= 0) {
    // Sitting on an equilibrium: stack just the non-redundant readout (the
    // eq marker already labels h) above its label instead of beside the dot.
    const extra = [`E=${curE.toFixed(4)}`];
    if (showForce) extra.push(`F=${curF.toFixed(3)}N`);
    ctx.textAlign = 'center';
    const lineH = 12;
    extra.forEach((l,i) => ctx.fillText(l, cx2, cy2 - 30 - i*lineH));
  } else {
    ctx.textAlign = cx2+80 > W-PAD.r ? 'right' : 'left';
    const tOff = cx2+80 > W-PAD.r ? -8 : 8;
    const curLines = [`h=${curH.toFixed(2)}`, `E=${curE.toFixed(4)}`];
    if (showForce) curLines.push(`F=${curF.toFixed(3)}N`);
    const nearBottom = cy2 > PAD.t+gH-24;
    const nearTop    = cy2 < PAD.t+20;
    const lineH = 12;
    const yStart = nearBottom ? cy2 - 8 - (curLines.length-1)*lineH : nearTop ? cy2 + 14 : cy2 - 3 - ((curLines.length-2)*lineH)/2;
    curLines.forEach((l,i) => ctx.fillText(l, cx2+tOff, yStart + i*lineH));
  }

  // Title / legend rows (adaptive: the left-aligned title and right-aligned
  // tags share a baseline, so at typical panel widths a long material tag or
  // the full "BISTABLE — two energy wells" wording can run straight into
  // the right-aligned text. Shorten or relocate pieces, cheapest first,
  // until what's left actually fits gW — otherwise they silently overlap.)
  function fitText(font, candidates, avail) {
    ctx.font = font;
    for (const c of candidates) if (ctx.measureText(c).width <= avail) return c;
    return candidates[candidates.length - 1];
  }
  const TITLE_GAP = 10;
  // Terser fallbacks for extremely narrow panels, where even the bare title
  // (with no material tag) would otherwise run into the stability tag.
  const titleCandidates = [
    `n=${n}  floors=${floors}×${stack}  dia=${p.dia}cm`,
    `n=${n} floors=${floors}×${stack} dia=${p.dia}cm`,
    `n=${n} f=${floors}×${stack}`,
    `n=${n}`,
  ];
  const matTag = p.material === 'polyimide' ? `· polyimide ${p.thicknessUm}µm` : '';
  const stabilityCandidates = isBistable
    ? ['BISTABLE — two energy wells', 'BISTABLE']
    : ['monostable'];
  const row2RightCandidates = showForce
    ? ['- - - Force (N, right axis, clipped near limits)', '- - - Force (N, right axis)', '- - - Force (N)']
    : ['Set material=Polyimide for Force (N)', 'Set material=Polyimide'];

  ctx.font = '9px "JetBrains Mono",monospace';
  const shortestTagW = ctx.measureText(stabilityCandidates[stabilityCandidates.length - 1]).width;

  ctx.font = '10px "JetBrains Mono",monospace';
  let matTagOnRow2 = false;
  let row1Title = null;
  if (matTag) {
    const withTag = `${titleCandidates[0]}  ${matTag}`;
    if (ctx.measureText(withTag).width + TITLE_GAP + shortestTagW <= gW) row1Title = withTag;
    else matTagOnRow2 = true;
  }
  if (row1Title === null) {
    // No material tag to place inline, or it didn't fit — fit the plain
    // title on its own, shrinking through terser candidates if necessary.
    row1Title = fitText('10px "JetBrains Mono",monospace', titleCandidates, gW - TITLE_GAP - shortestTagW);
  }
  ctx.font = '10px "JetBrains Mono",monospace';
  const row1TitleW = ctx.measureText(row1Title).width;
  const row1Tag = fitText('9px "JetBrains Mono",monospace', stabilityCandidates, gW - row1TitleW - TITLE_GAP);

  ctx.fillStyle='rgba(224,234,240,0.8)';ctx.font='10px "JetBrains Mono",monospace';ctx.textAlign='left';
  ctx.fillText(row1Title, PAD.l, PAD.t-18);
  ctx.font='9px "JetBrains Mono",monospace'; ctx.textAlign='right';
  ctx.fillStyle = isBistable ? '#4ade80' : 'rgba(139,144,160,0.7)';
  ctx.fillText(row1Tag, PAD.l+gW, PAD.t-18);

  ctx.font='9px "JetBrains Mono",monospace';
  let row2LeftW = 0, drawMatTagRow2 = false;
  if (matTagOnRow2) {
    const matTagW = ctx.measureText(matTag).width;
    const shortestRow2RightW = ctx.measureText(row2RightCandidates[row2RightCandidates.length - 1]).width;
    // Only place it if there's room even alongside the shortest right-hand
    // text — otherwise drop it rather than overlap (the material is still
    // visible in the sidebar controls).
    if (matTagW + TITLE_GAP + shortestRow2RightW <= gW) { drawMatTagRow2 = true; row2LeftW = matTagW; }
  }
  if (drawMatTagRow2) {
    ctx.textAlign='left'; ctx.fillStyle='rgba(224,234,240,0.6)';
    ctx.fillText(matTag, PAD.l, PAD.t-6);
  }
  const row2Text = fitText('9px "JetBrains Mono",monospace', row2RightCandidates, gW - row2LeftW - (drawMatTagRow2 ? TITLE_GAP : 0));
  ctx.textAlign='right';
  ctx.fillStyle = showForce ? '#f59e0b' : 'rgba(245,158,11,0.55)';
  ctx.fillText(row2Text, PAD.l+gW, PAD.t-6);

  // Hover crosshair
  if (ui.energyHoverX !== null) {
    const hx = ui.energyHoverX;
    if (hx >= PAD.l && hx <= PAD.l+gW) {
      const hoverH     = totalH_min + ((hx-PAD.l)/gW)*(totalH_max-totalH_min);
      const clampIdx   = Math.max(0,Math.min(STEPS,Math.round((hoverH-totalH_min)/(totalH_max-totalH_min+1e-9)*STEPS)));
      const hoverE     = energyPoints[clampIdx];
      const hoverHActual = heightPoints[clampIdx];
      const hy = toY(hoverE);
      ctx.save();
      ctx.beginPath();ctx.moveTo(hx,PAD.t);ctx.lineTo(hx,PAD.t+gH);ctx.strokeStyle='rgba(255,255,255,0.35)';ctx.lineWidth=1;ctx.setLineDash([4,3]);ctx.stroke();
      ctx.beginPath();ctx.moveTo(PAD.l,hy);ctx.lineTo(PAD.l+gW,hy);ctx.strokeStyle='rgba(255,255,255,0.2)';ctx.lineWidth=0.8;ctx.setLineDash([4,3]);ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();ctx.arc(hx,hy,4,0,Math.PI*2);ctx.fillStyle='#facc15';ctx.fill();ctx.strokeStyle='#1a1d28';ctx.lineWidth=1.5;ctx.stroke();
      const tipLines=[`h = ${hoverHActual.toFixed(3)} cm`,`E = ${hoverE.toFixed(5)}`,`h/H = ${(hoverHActual/designedH).toFixed(3)}`];
      if (showForce) tipLines.push(`F = ${forcePoints[clampIdx].toFixed(4)} N`);
      const tfs=9,tlh=tfs+3,tPad=6,tW=120,tH=tipLines.length*tlh+tPad*2;
      let tx=hx+10,ty=hy-tH/2;
      if(tx+tW>PAD.l+gW)tx=hx-tW-10;
      ty=Math.max(PAD.t,Math.min(PAD.t+gH-tH,ty));
      ctx.fillStyle='rgba(20,22,35,0.92)';ctx.strokeStyle='rgba(250,204,21,0.6)';ctx.lineWidth=1;
      ctx.beginPath();ctx.roundRect?ctx.roundRect(tx,ty,tW,tH,4):ctx.rect(tx,ty,tW,tH);ctx.fill();ctx.stroke();
      ctx.fillStyle='#facc15';ctx.font=`${tfs}px "JetBrains Mono",monospace`;ctx.textAlign='left';ctx.textBaseline='top';
      tipLines.forEach((l,i)=>ctx.fillText(l,tx+tPad,ty+tPad+i*tlh));
      ctx.textBaseline='alphabetic';ctx.restore();
    }
  }
}

export function initEnergyEvents() {
  const ec = document.getElementById('canvasEnergy');
  ec.style.cursor = 'crosshair';
  ec.addEventListener('mousemove', e => {
    const r = ec.getBoundingClientRect();
    ui.energyHoverX = (e.clientX - r.left) * (ec.width / r.width);
    drawEnergy();
  });
  ec.addEventListener('mouseleave', () => { ui.energyHoverX = null; drawEnergy(); });
}
