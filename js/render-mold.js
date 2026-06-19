import { A4_W, A4_H } from './constants.js';
import { getP } from './ui.js';
import { computeGeometry, buildVerts } from './geometry.js';
import { moldCam, ui } from './state.js';

export function initMold3d() {
  const canvas = document.getElementById('canvasMold');
  if (!canvas) return;
  const wrap = document.getElementById('center-pane-mold');
  const rect = wrap.getBoundingClientRect();
  canvas.width  = Math.max(100, Math.round(rect.width)  || 700);
  canvas.height = Math.max(100, Math.round(rect.height) || 500);

  canvas.onpointerdown = e => {
    moldCam.dragging = true;
    moldCam.lastMouse = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  };
  canvas.onpointerup = canvas.onpointercancel = () => { moldCam.dragging = false; };
  canvas.onpointermove = e => {
    if (!moldCam.dragging) return;
    moldCam.rotY += (e.clientX - moldCam.lastMouse.x) * 0.012;
    moldCam.rotX += (e.clientY - moldCam.lastMouse.y) * 0.012;
    moldCam.rotX  = Math.max(-Math.PI/2, Math.min(Math.PI/2, moldCam.rotX));
    moldCam.lastMouse = { x: e.clientX, y: e.clientY };
    drawMold3d();
  };
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const cur = moldCam.dist || 12;
    moldCam.dist = e.deltaY > 0 ? Math.min(cur * 1.15, 60) : Math.max(cur * 0.87, 1);
    drawMold3d();
  }, { passive: false });
  canvas.addEventListener('dblclick', () => { moldCam.dist = null; drawMold3d(); });
}

export function drawMold3d() {
  const canvas = document.getElementById('canvasMold');
  if (!canvas) return;

  // Resize to container if needed
  const wrap = document.getElementById('center-pane-mold');
  if (wrap) {
    const rect = wrap.getBoundingClientRect();
    const W2 = Math.max(100, Math.round(rect.width)  || 700);
    const H2 = Math.max(100, Math.round(rect.height) || 500);
    if (canvas.width !== W2 || canvas.height !== H2) { canvas.width = W2; canvas.height = H2; }
  }

  const W = canvas.width || 700, H = canvas.height || 500;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#13151e'; ctx.fillRect(0, 0, W, H);

  const p = getP(), g = computeGeometry(p);
  const { n, floors, extcols, stack, chir, scale } = p;
  const totalFloors = floors * stack;
  const col_min = -extcols, col_max = n + extcols, total_cols = col_max - col_min + 1;

  const baseT  = (p.moldbase || 3)   / 10;
  const ridgeH = (p.ridgeh   || 1.2) / 10;
  const margin = 0.2;

  const { verts, bounds, extS, seamlS, seamrS } = buildVerts(p, g);
  const olIdx = extcols, orIdx = extcols + n;
  const [x0, y0] = verts[0][olIdx], [x1] = verts[0][orIdx];
  const [, y3]   = verts[totalFloors][orIdx];
  const topY = y0 - extS, botY = y3 + extS;
  const seamLX = x0 - seamlS, seamRX = x1 + seamrS;

  const pw  = seamRX - seamLX + margin * 2, ph = botY - topY + margin * 2;
  const cx_ = seamLX - margin + pw / 2,    cz_ = topY - margin + ph / 2;
  const moldGap = ui.currentMoldTab === 'both' ? baseT * 2 + 0.3 : 0;

  const cosRX = Math.cos(moldCam.rotX), sinRX = Math.sin(moldCam.rotX);
  const cosRY = Math.cos(moldCam.rotY), sinRY = Math.sin(moldCam.rotY);
  function rotate([x, y, z]) {
    const x1 = x*cosRY + z*sinRY, z1 = -x*sinRY + z*cosRY;
    return [x1, y*cosRX - z1*sinRX, y*sinRX + z1*cosRX];
  }
  const modelDiag = Math.hypot(pw, ph, baseT + ridgeH) * 0.8;
  const dist      = moldCam.dist || modelDiag * 2.2 + 2;
  const fovScale  = Math.min(W, H) / (1.6 * dist);
  function project([x, y, z]) {
    const [rx, ry, rz] = rotate([x - cx_, y, z - cz_]);
    const zd = rz + dist;
    if (zd <= 0.01) return null;
    const sc = fovScale * (dist / zd);
    return [W/2 + rx * sc, H/2 - ry * sc, zd];
  }

  const drawCalls = [];
  function addFace(pts3d, color, alpha) {
    const pp = pts3d.map(project);
    if (pp.some(v => !v)) return;
    drawCalls.push({ type:'face', pp, color, alpha, z: pp.reduce((a,v)=>a+v[2],0)/pp.length });
  }
  function addLine(a3d, b3d, color, lw=1, dash=[]) {
    const pa = project(a3d), pb = project(b3d);
    if (!pa || !pb) return;
    drawCalls.push({ type:'line', pa, pb, color, lw, dash, z:(pa[2]+pb[2])/2 });
  }

  function drawMoldPlate(yOff, ridgeSegs, plateCol, ridgeCol, label) {
    const yBot=yOff-baseT, yTop=yOff;
    const bx0=seamLX-margin, bx1=seamRX+margin, bz0=topY-margin, bz1=botY+margin;
    const C = {
      tl0:[bx0,yBot,bz0],tr0:[bx1,yBot,bz0],tl1:[bx0,yBot,bz1],tr1:[bx1,yBot,bz1],
      bl0:[bx0,yTop,bz0],br0:[bx1,yTop,bz0],bl1:[bx0,yTop,bz1],br1:[bx1,yTop,bz1],
    };
    addFace([C.bl0,C.br0,C.br1,C.bl1],plateCol,0.82);
    addFace([C.tl0,C.tl1,C.tr1,C.tr0],plateCol,0.45);
    addFace([C.tl0,C.bl0,C.bl1,C.tl1],plateCol,0.55);
    addFace([C.tr0,C.tr1,C.br1,C.br0],plateCol,0.55);
    addFace([C.tl0,C.tr0,C.br0,C.bl0],plateCol,0.60);
    addFace([C.tl1,C.bl1,C.br1,C.tr1],plateCol,0.60);
    [[C.bl0,C.br0],[C.br0,C.br1],[C.br1,C.bl1],[C.bl1,C.bl0]].forEach(([a,b])=>addLine(a,b,'rgba(255,255,255,0.15)',0.8));
    for (const [[ax,ay],[bx_,by_]] of ridgeSegs) {
      const a3=[ax,yTop,ay],b3=[bx_,yTop,by_],ap=[ax,yTop+ridgeH,ay],bp=[bx_,yTop+ridgeH,by_];
      addFace([a3,b3,bp,ap],ridgeCol,0.85);
      addLine(ap,bp,ridgeCol,2); addLine(a3,ap,ridgeCol,1.2); addLine(b3,bp,ridgeCol,1.2);
    }
    const lp = project([cx_, yTop+ridgeH+0.2, cz_]);
    if (lp) drawCalls.push({ type:'label', pt:lp, text:label, z:lp[2] });
  }

  // Collect ridge segments
  const mountainSegs = [];
  for (let ci=1;ci<total_cols-1;ci++)
    for (let f=0;f<totalFloors;f++)
      mountainSegs.push([verts[f][ci], verts[f+1][ci]]);

  const valleySegs = [];
  for (let f=0;f<=totalFloors;f++) valleySegs.push([[seamLX,verts[f][0][1]],[seamRX,verts[f][0][1]]]);
  for (let f=0;f<totalFloors;f++)
    for (let ci=0;ci<total_cols-1;ci++) {
      const v1=verts[f][ci],v2=verts[f+1][ci+1],v3=verts[f][ci+1],v4=verts[f+1][ci];
      valleySegs.push((f*chir)%2===0 ? [v3,v4] : [v1,v2]);
    }

  const plateBase='#2a3050', mtnRidge='#e05252', valRidge='#378ADD';

  if (ui.currentMoldTab === 'mountain') {
    drawMoldPlate(0, mountainSegs, plateBase, mtnRidge, 'Mountain mold');
  } else if (ui.currentMoldTab === 'valley') {
    drawMoldPlate(0, valleySegs, plateBase, valRidge, 'Valley mold');
  } else {
    drawMoldPlate(moldGap + baseT, mountainSegs, '#253040', mtnRidge, 'Mountain mold (top)');
    const py = moldGap / 2;
    addFace([[seamLX-margin,py,topY-margin],[seamRX+margin,py,topY-margin],[seamRX+margin,py,botY+margin],[seamLX-margin,py,botY+margin]],'#ffffff',0.22);
    addLine([seamLX-margin,py,topY-margin],[seamRX+margin,py,topY-margin],'rgba(255,255,255,0.3)',0.8);
    addLine([seamRX+margin,py,topY-margin],[seamRX+margin,py,botY+margin],'rgba(255,255,255,0.3)',0.8);
    addLine([seamRX+margin,py,botY+margin],[seamLX-margin,py,botY+margin],'rgba(255,255,255,0.3)',0.8);
    addLine([seamLX-margin,py,botY+margin],[seamLX-margin,py,topY-margin],'rgba(255,255,255,0.3)',0.8);
    const pp = project([cx_, py, cz_]);
    if (pp) drawCalls.push({ type:'label', pt:pp, text:'paper', z:pp[2] });
    drawMoldPlate(0, valleySegs, '#253040', valRidge, 'Valley mold (bottom)');
  }

  // Paint back-to-front
  drawCalls.sort((a, b) => b.z - a.z);
  for (const dc of drawCalls) {
    if (dc.type === 'face') {
      ctx.beginPath();
      ctx.moveTo(dc.pp[0][0],dc.pp[0][1]);
      for (let i=1;i<dc.pp.length;i++) ctx.lineTo(dc.pp[i][0],dc.pp[i][1]);
      ctx.closePath(); ctx.globalAlpha=dc.alpha; ctx.fillStyle=dc.color; ctx.fill(); ctx.globalAlpha=1;
    } else if (dc.type === 'line') {
      ctx.beginPath(); ctx.moveTo(dc.pa[0],dc.pa[1]); ctx.lineTo(dc.pb[0],dc.pb[1]);
      ctx.strokeStyle=dc.color; ctx.lineWidth=dc.lw; ctx.setLineDash(dc.dash||[]); ctx.stroke(); ctx.setLineDash([]);
    } else if (dc.type === 'label') {
      ctx.fillStyle='rgba(220,230,255,0.7)'; ctx.font='10px "JetBrains Mono",monospace';
      ctx.textAlign='center'; ctx.textBaseline='bottom';
      ctx.fillText(dc.text, dc.pt[0], dc.pt[1]);
    }
  }

  ctx.globalAlpha=1; ctx.fillStyle='rgba(139,144,160,0.65)';
  ctx.font='9px "JetBrains Mono",monospace'; ctx.textAlign='left'; ctx.textBaseline='alphabetic';
  ctx.fillText(`base=${p.moldbase}mm  ridge h=${p.ridgeh}mm  w=${p.ridgew}mm`, 8, H-10);
  ctx.textAlign='right';
  ctx.fillText('drag=rotate  scroll=zoom  dbl=reset', W-8, H-10);
}
