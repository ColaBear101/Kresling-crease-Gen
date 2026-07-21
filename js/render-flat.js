import { A4_W, A4_H } from './constants.js';
import { computeGeometry, buildVerts } from './geometry.js';
import { getP, updateStats, drawInfoBoxCanvas, creaseLengthLabels, drawCreaseLabelsCanvas } from './ui.js';
import { flatCam } from './state.js';

// ─── Private: nearest-crease hit-test ────────────────────────────────────────
function getNearestCrease(px, py, verts, p, g, toC) {
  const { n, floors, seaml, seamr, extcols, stack, chir, scale } = p;
  const col_min     = -extcols, col_max = n + extcols, total_cols = col_max - col_min + 1;
  const totalFloors = floors * stack;
  const olIdx       = extcols, orIdx = extcols + n;
  const [x0]        = verts[0][olIdx], [x1] = verts[0][orIdx];
  const seamLX      = x0 - seaml * scale, seamRX = x1 + seamr * scale;

  function distPtSeg(px, py, ax, ay, bx, by) {
    const ddx = bx - ax, ddy = by - ay, l2 = ddx*ddx + ddy*ddy;
    if (l2 === 0) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px-ax)*ddx + (py-ay)*ddy) / l2));
    return Math.hypot(px - (ax + t*ddx), py - (ay + t*ddy));
  }

  const THRESH = 12;
  let best = { type: null, dist: Infinity, label: '' };

  function check(ax, ay, bx, by, type, label) {
    const [cax, cay] = toC(ax, ay), [cbx, cby] = toC(bx, by);
    const d = distPtSeg(px, py, cax, cay, cbx, cby);
    if (d < THRESH && d < best.dist) best = { type, dist: d, label };
  }

  for (let f = 0; f <= totalFloors; f++) {
    const yL = verts[f][0][1];
    check(seamLX, yL, seamRX, yL, 'blue', 'Valley (horizontal)');
  }
  for (let ci = 1; ci < total_cols - 1; ci++)
    for (let f = 0; f < totalFloors; f++)
      check(verts[f][ci][0], verts[f][ci][1], verts[f+1][ci][0], verts[f+1][ci][1], 'red', 'Mountain');

  for (let f = 0; f < totalFloors; f++)
    for (let ci = 0; ci < total_cols - 1; ci++) {
      const v1=verts[f][ci], v2=verts[f+1][ci+1], v3=verts[f][ci+1], v4=verts[f+1][ci];
      const [ax, ay, bxv, byv] = (f * chir) % 2 === 0
        ? [v3[0],v3[1],v4[0],v4[1]] : [v1[0],v1[1],v2[0],v2[1]];
      check(ax, ay, bxv, byv, 'green', 'Valley (diagonal)');
    }
  return best;
}

// ─── Main flat-canvas draw ────────────────────────────────────────────────────
export function drawFlat() {
  const p = getP(), g = computeGeometry(p);
  updateStats(p, g);

  const canvas = document.getElementById('flatCanvas');
  const wrap   = canvas.parentElement;
  const W = wrap.clientWidth || 700, H = wrap.clientHeight || 500;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1a1d28'; ctx.fillRect(0, 0, W, H);

  const { n, floors, extcols, stack, chir, scale, showA4, showGrid,
          showmv, showMountain, showValley, showDiagonal } = p;
  const { b, floor_h, dx } = g;
  const col_min     = -extcols, col_max = n + extcols, total_cols = col_max - col_min + 1;
  const totalFloors = floors * stack;
  // Screen-only: "Show M/V colors" off swaps mountain/valley/diagonal to one
  // neutral color; the toggles below hide/show each layer independently.
  // Neither affects SVG/PDF/PNG/DXF/STL exports — those must always contain
  // every crease line, since they're the physical pattern used to fold it.
  const neutralCol = '#9aa0b0';
  const mtnCol  = showmv ? '#e05252' : neutralCol;
  const valCol  = showmv ? '#378ADD' : neutralCol;
  const diagCol = showmv ? '#3dba6e' : neutralCol;

  // Base transform: A4 + margin fitted to canvas, then zoom/pan on top
  const margin_cm = 1.5;
  const sceneW = A4_W + margin_cm * 2, sceneH = A4_H + margin_cm * 2;
  const sc0 = Math.min((W - 20) / sceneW, (H - 20) / sceneH);
  const sc  = sc0 * flatCam.zoom;
  const ox  = (W / 2 - sceneW * sc0 / 2) * flatCam.zoom + flatCam.panX;
  const oy  = (H / 2 - sceneH * sc0 / 2) * flatCam.zoom + flatCam.panY;
  function toC(xcm, ycm) { return [ox + (xcm + margin_cm) * sc, oy + (sceneH - ycm - margin_cm) * sc]; }

  // Grid
  if (showGrid) {
    ctx.save(); ctx.strokeStyle = 'rgba(59,130,246,0.07)'; ctx.lineWidth = 0.5;
    for (let x = 0; x <= A4_W; x++) { const [cx,cy]=toC(x,0),[cx2,cy2]=toC(x,A4_H); ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx2,cy2);ctx.stroke(); }
    for (let y = 0; y <= A4_H; y++) { const [cx,cy]=toC(0,y),[cx2,cy2]=toC(A4_W,y); ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx2,cy2);ctx.stroke(); }
    ctx.restore();
  }

  // A4 frame shading
  const [a4x,a4y]=toC(0,A4_H), [a4x2,a4y2]=toC(A4_W,0);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0,0,W,a4y); ctx.fillRect(0,a4y2,W,H-a4y2);
  ctx.fillRect(0,a4y,a4x,a4y2-a4y); ctx.fillRect(a4x2,a4y,W-a4x2,a4y2-a4y);
  if (showA4) {
    ctx.save(); ctx.strokeStyle='rgba(200,200,220,0.5)'; ctx.lineWidth=1.2; ctx.setLineDash([6,4]);
    ctx.strokeRect(a4x,a4y,a4x2-a4x,a4y2-a4y); ctx.setLineDash([]);
    ctx.fillStyle='rgba(200,200,220,0.4)'; ctx.font='10px "JetBrains Mono",monospace';
    ctx.fillText('A4  21×29.7 cm', a4x+4, a4y+12); ctx.restore();
  }

  // Rulers
  ctx.save();
  ctx.fillStyle='rgba(200,210,255,0.45)'; ctx.strokeStyle='rgba(200,210,255,0.35)'; ctx.lineWidth=0.7;
  ctx.font='7px "JetBrains Mono",monospace'; ctx.textAlign='center';
  for (let x = 0; x <= A4_W; x++) {
    const [rx,ry]=toC(x,0), major=x%5===0, tickH=major?8:4;
    ctx.beginPath();ctx.moveTo(rx,ry);ctx.lineTo(rx,ry+tickH);ctx.stroke();
    if (major && x > 0) ctx.fillText(x+'cm', rx, ry+18);
  }
  ctx.textAlign='right';
  for (let y = 0; y <= A4_H; y++) {
    const [rx,ry]=toC(0,y), major=y%5===0, tickW=major?8:4;
    ctx.beginPath();ctx.moveTo(rx,ry);ctx.lineTo(rx-tickW,ry);ctx.stroke();
    if (major && y > 0) ctx.fillText(y+'cm', rx-10, ry+3);
  }
  ctx.restore();

  // Build verts (replaces the inline loop that used to live here)
  const { verts, bounds, extS, seamlS, seamrS } = buildVerts(p, g);
  const olIdx = extcols, orIdx = extcols + n;
  const [x0,y0]=verts[0][olIdx],              [x1,y1]=verts[0][orIdx];
  const [x2,y2]=verts[totalFloors][olIdx],    [x3,y3]=verts[totalFloors][orIdx];
  const topY = y0 - extS, botY = y3 + extS;
  const seamLX = x0 - seamlS, seamRX = x1 + seamrS;

  function line(ax, ay, bx, by, col, lw, dash) {
    const [cx1,cy1]=toC(ax,ay),[cx2,cy2]=toC(bx,by);
    ctx.beginPath();ctx.moveTo(cx1,cy1);ctx.lineTo(cx2,cy2);
    ctx.strokeStyle=col; ctx.lineWidth=lw||1.2; ctx.setLineDash(dash||[]); ctx.stroke(); ctx.setLineDash([]);
  }

  // Purple cut box
  const purp = '#9f6fdf';
  line(x0,topY,x0,botY,purp,1.8); line(x1,topY,x1,botY,purp,1.8);
  line(x0,topY,x1,topY,purp,1.8); line(x2,botY,x3,botY,purp,1.8);
  if (seamlS > 0) { line(seamLX,topY,seamLX,botY,'slateblue',1.2,[4,3]); [topY,botY,y0,y2].forEach(yy => line(seamLX,yy,x0,yy,'slateblue',1.2,[4,3])); }
  if (seamrS > 0) { line(seamRX,topY,seamRX,botY,'slateblue',1.2,[4,3]); [topY,botY,y1,y3].forEach(yy => line(x1,yy,seamRX,yy,'slateblue',1.2,[4,3])); }

  // Info box in bottom gap
  drawInfoBoxCanvas(ctx, toC, sc, x0, x1, y0, topY, p, g, bounds);

  // Red mountain zigzags
  if (showMountain) {
    for (let ci = 1; ci < total_cols - 1; ci++) {
      ctx.beginPath();
      for (let f = 0; f <= totalFloors; f++) { const [vx,vy]=verts[f][ci],[cx,cy]=toC(vx,vy); f===0?ctx.moveTo(cx,cy):ctx.lineTo(cx,cy); }
      ctx.strokeStyle=mtnCol; ctx.lineWidth=1.2; ctx.setLineDash([]); ctx.stroke();
    }
    const rPts = Array.from({length:totalFloors+1},(_,f)=>verts[f][orIdx]);
    ctx.beginPath(); rPts.forEach(([vx,vy],i)=>{ const [cx,cy]=toC(vx,vy); i===0?ctx.moveTo(cx,cy):ctx.lineTo(cx,cy); });
    ctx.strokeStyle=mtnCol; ctx.lineWidth=1.1; ctx.setLineDash([4,3]); ctx.stroke(); ctx.setLineDash([]);
    const lPts = Array.from({length:totalFloors+1},(_,f)=>verts[f][olIdx]);
    ctx.beginPath(); lPts.forEach(([vx,vy],i)=>{ const [cx,cy]=toC(vx,vy); i===0?ctx.moveTo(cx,cy):ctx.lineTo(cx,cy); });
    ctx.strokeStyle=mtnCol; ctx.lineWidth=1.1; ctx.setLineDash([4,3]); ctx.stroke(); ctx.setLineDash([]);
  }

  // Blue valley horizontals
  if (showValley) {
    for (let f = 0; f <= totalFloors; f++) {
      const yL=verts[f][0][1], [lx,ly]=toC(seamLX,yL), [rx,ry]=toC(seamRX,yL);
      ctx.beginPath();ctx.moveTo(lx,ly);ctx.lineTo(rx,ry);
      ctx.strokeStyle=valCol; ctx.lineWidth=1.3; ctx.setLineDash([]); ctx.stroke();
    }
  }

  // Green diagonal valley creases
  if (showDiagonal) {
    ctx.strokeStyle=diagCol; ctx.lineWidth=1.0; ctx.setLineDash([5,4]);
    for (let f = 0; f < totalFloors; f++)
      for (let ci = 0; ci < total_cols - 1; ci++) {
        const v1=verts[f][ci],v2=verts[f+1][ci+1],v3=verts[f][ci+1],v4=verts[f+1][ci];
        const [ax2,ay2,bx2,by2] = (f*chir)%2===0 ? [v3[0],v3[1],v4[0],v4[1]] : [v1[0],v1[1],v2[0],v2[1]];
        const [px1,py1]=toC(ax2,ay2), [px2,py2]=toC(bx2,by2);
        ctx.beginPath();ctx.moveTo(px1,py1);ctx.lineTo(px2,py2);ctx.stroke();
      }
    ctx.setLineDash([]);
  }

  // Dimension labels
  ctx.save(); ctx.fillStyle='rgba(180,220,255,0.55)'; ctx.font='9px "JetBrains Mono",monospace';
  const [lx0,ly0]=toC(x0-seamlS,topY-0.3), [rx0]=toC(x1+seamrS,topY-0.3);
  ctx.fillText(`W=${(bounds.w*scale).toFixed(1)}cm`, (lx0+rx0)/2-18, ly0-3);
  const [hx0,hy0]=toC(x1+seamrS+0.25,botY), [,hy1]=toC(x1+seamrS+0.25,topY);
  ctx.fillText(`H=${(bounds.h*scale).toFixed(1)}cm`, hx0+3, (hy0+hy1)/2); ctx.restore();

  // Per-crease-type length annotations (one red/blue/green example) — lets
  // someone fabricating the pattern spot-check a ruler measurement.
  drawCreaseLabelsCanvas(ctx, toC, creaseLengthLabels(p, g, verts, olIdx));

  // Hover crosshair + nearest crease tooltip
  if (flatCam.hoverPx) {
    const { x: hpx, y: hpy } = flatCam.hoverPx;
    const hcm_x = (hpx - ox) / sc - margin_cm;
    const hcm_y = sceneH - (hpy - oy) / sc - margin_cm;
    ctx.save();
    ctx.strokeStyle='rgba(255,255,255,0.18)'; ctx.lineWidth=0.8; ctx.setLineDash([4,4]);
    ctx.beginPath();ctx.moveTo(hpx,0);ctx.lineTo(hpx,H);ctx.stroke();
    ctx.beginPath();ctx.moveTo(0,hpy);ctx.lineTo(W,hpy);ctx.stroke();
    ctx.setLineDash([]);
    const nc = getNearestCrease(hpx, hpy, verts, p, g, toC);
    const creaseColors = { blue:'#60c8ff', red:'#ff8080', green:'#80ffb0' };
    const tipLines = [`x = ${hcm_x.toFixed(2)} cm`, `y = ${hcm_y.toFixed(2)} cm`];
    if (nc.type) tipLines.push(nc.label);
    const tfs=9, tlh=12, tPad=5, tW=130, tH=tipLines.length*tlh+tPad*2;
    let tx=hpx+10, ty=hpy-tH-6;
    if (tx+tW>W-4) tx=hpx-tW-10;
    if (ty<4) ty=hpy+10;
    ctx.fillStyle='rgba(15,18,30,0.88)'; ctx.strokeStyle='rgba(255,255,255,0.18)'; ctx.lineWidth=0.8;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(tx,ty,tW,tH,4); else ctx.rect(tx,ty,tW,tH);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle='rgba(220,235,255,0.9)'; ctx.font=`${tfs}px "JetBrains Mono",monospace`;
    ctx.textAlign='left'; ctx.textBaseline='top';
    tipLines.forEach((l, i) => {
      if (i === 2) ctx.fillStyle = creaseColors[nc.type] || 'rgba(220,235,255,0.9)';
      ctx.fillText(l, tx+tPad, ty+tPad+i*tlh);
    });
    ctx.textBaseline='alphabetic'; ctx.restore();
  }
}

// ─── Off-screen render (PNG export) ──────────────────────────────────────────
export function renderPatternToCtx(ctx, p, g, W, H, sc, ox, oy, forPrint) {
  const { n, floors, extcols, stack, chir, scale, showA4, showGrid } = p;
  const col_min = -extcols, col_max = n + extcols, total_cols = col_max - col_min + 1;
  const totalFloors = floors * stack;
  function toC(xcm, ycm) { return [ox + xcm * sc, oy + (A4_H - ycm) * sc]; }

  if (!forPrint) {
    const [a4x,a4y]=toC(0,A4_H), [a4x2,a4y2]=toC(A4_W,0);
    if (showGrid) {
      ctx.save(); ctx.strokeStyle='rgba(59,130,246,0.07)'; ctx.lineWidth=0.5;
      for(let x=0;x<=A4_W;x++){const[cx,cy]=toC(x,0),[cx2,cy2]=toC(x,A4_H);ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx2,cy2);ctx.stroke();}
      for(let y=0;y<=A4_H;y++){const[cx,cy]=toC(0,y),[cx2,cy2]=toC(A4_W,y);ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx2,cy2);ctx.stroke();}
      ctx.restore();
    }
    ctx.fillStyle='rgba(0,0,0,0.25)';
    ctx.fillRect(0,0,W,a4y);ctx.fillRect(0,a4y2,W,H-a4y2);
    ctx.fillRect(0,a4y,a4x,a4y2-a4y);ctx.fillRect(a4x2,a4y,W-a4x2,a4y2-a4y);
    if (showA4){
      ctx.save();ctx.strokeStyle='rgba(200,200,220,0.5)';ctx.lineWidth=1.2;ctx.setLineDash([6,4]);
      ctx.strokeRect(a4x,a4y,a4x2-a4x,a4y2-a4y);ctx.setLineDash([]);
      ctx.fillStyle='rgba(200,200,220,0.4)';ctx.font='10px "JetBrains Mono",monospace';
      ctx.fillText('A4  21×29.7 cm',a4x+4,a4y+12);ctx.restore();
    }
  }

  const { verts, bounds, extS, seamlS, seamrS } = buildVerts(p, g);
  const olIdx=extcols, orIdx=extcols+n;
  const [x0,y0]=verts[0][olIdx], [x1]=verts[0][orIdx];
  const [x2]=verts[totalFloors][olIdx], [x3,y3]=verts[totalFloors][orIdx];
  const topY=y0-extS, botY=y3+extS;
  const seamLX=x0-seamlS, seamRX=x1+seamrS;
  const lw = forPrint ? sc / 37.795 : 1;

  function line(ax,ay,bx,by,col,w,dash){
    const[cx1,cy1]=toC(ax,ay),[cx2,cy2]=toC(bx,by);
    ctx.beginPath();ctx.moveTo(cx1,cy1);ctx.lineTo(cx2,cy2);
    ctx.strokeStyle=col;ctx.lineWidth=(w||1.2)*lw;
    ctx.setLineDash(dash?dash.map(d=>d*lw):[]);ctx.stroke();ctx.setLineDash([]);
  }

  const purp=forPrint?'#6a1fa0':'#9f6fdf';
  line(x0,topY,x0,botY,purp,forPrint?2.5:1.8);line(x1,topY,x1,botY,purp,forPrint?2.5:1.8);
  line(x0,topY,x1,topY,purp,forPrint?2.5:1.8);line(x2,botY,x3,botY,purp,forPrint?2.5:1.8);
  if(seamlS>0){line(seamLX,topY,seamLX,botY,'slateblue',1.2,[4,3]);[topY,botY,y0,verts[totalFloors][olIdx][1]].forEach(yy=>line(seamLX,yy,x0,yy,'slateblue',1.2,[4,3]));}
  if(seamrS>0){line(seamRX,topY,seamRX,botY,'slateblue',1.2,[4,3]);[topY,botY,verts[0][orIdx][1],verts[totalFloors][orIdx][1]].forEach(yy=>line(x1,yy,seamRX,yy,'slateblue',1.2,[4,3]));}

  drawInfoBoxCanvas(ctx, toC, sc, x0, x1, y0, topY, p, g, bounds, forPrint);

  const redCol=forPrint?'#cc0000':'#e05252';
  for(let ci=1;ci<total_cols-1;ci++){
    ctx.beginPath();
    for(let f=0;f<=totalFloors;f++){const[vx,vy]=verts[f][ci],[cx,cy]=toC(vx,vy);f===0?ctx.moveTo(cx,cy):ctx.lineTo(cx,cy);}
    ctx.strokeStyle=redCol;ctx.lineWidth=(forPrint?2.0:1.2)*lw;ctx.setLineDash([]);ctx.stroke();
  }
  [verts.map((_,f)=>verts[f][orIdx]),verts.map((_,f)=>verts[f][olIdx])].forEach(pts=>{
    ctx.beginPath();pts.forEach(([vx,vy],i)=>{const[cx,cy]=toC(vx,vy);i===0?ctx.moveTo(cx,cy):ctx.lineTo(cx,cy);});
    ctx.strokeStyle=redCol;ctx.lineWidth=(forPrint?1.6:1.1)*lw;ctx.setLineDash([5*lw,3*lw]);ctx.stroke();ctx.setLineDash([]);
  });

  const blueCol=forPrint?'#0044cc':'#378ADD';
  for(let f=0;f<=totalFloors;f++){
    const yL=verts[f][0][1],[lx,ly]=toC(seamLX,yL),[rx,ry]=toC(seamRX,yL);
    ctx.beginPath();ctx.moveTo(lx,ly);ctx.lineTo(rx,ry);ctx.strokeStyle=blueCol;ctx.lineWidth=(forPrint?2.0:1.3)*lw;ctx.setLineDash([]);ctx.stroke();
  }

  const greenCol=forPrint?'#007a30':'#3dba6e';
  ctx.strokeStyle=greenCol;ctx.lineWidth=(forPrint?1.5:1.0)*lw;ctx.setLineDash([5*lw,4*lw]);
  for(let f=0;f<totalFloors;f++)
    for(let ci=0;ci<total_cols-1;ci++){
      const v1=verts[f][ci],v2=verts[f+1][ci+1],v3=verts[f][ci+1],v4=verts[f+1][ci];
      const[ax2,ay2,bx2,by2]=(f*chir)%2===0?[v3[0],v3[1],v4[0],v4[1]]:[v1[0],v1[1],v2[0],v2[1]];
      const[px1c,py1c]=toC(ax2,ay2),[px2c,py2c]=toC(bx2,by2);
      ctx.beginPath();ctx.moveTo(px1c,py1c);ctx.lineTo(px2c,py2c);ctx.stroke();
    }
  ctx.setLineDash([]);

  if (!forPrint) {
    ctx.save();ctx.fillStyle='rgba(180,220,255,0.55)';ctx.font='9px "JetBrains Mono",monospace';
    const[lx0,ly0]=toC(x0-seamlS,topY-0.3),[rx0]=toC(x1+seamrS,topY-0.3);
    ctx.fillText(`W=${(bounds.w*scale).toFixed(1)}cm`,(lx0+rx0)/2-18,ly0-3);
    const[hx0,hy0]=toC(x1+seamrS+0.25,botY),[,hy1]=toC(x1+seamrS+0.25,topY);
    ctx.fillText(`H=${(bounds.h*scale).toFixed(1)}cm`,hx0+3,(hy0+hy1)/2);ctx.restore();
    drawCreaseLabelsCanvas(ctx, toC, creaseLengthLabels(p, g, verts, olIdx));
  }
}

// ─── Event bindings ───────────────────────────────────────────────────────────
export function initFlatCanvasEvents() {
  const canvas = document.getElementById('flatCanvas');

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const rect  = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const delta = e.deltaY < 0 ? 1.12 : 1/1.12;
    const newZoom = flatCam.zoom * delta;
    if (newZoom <= 1.0) {
      flatCam.zoom = 1; flatCam.panX = 0; flatCam.panY = 0;
    } else {
      flatCam.panX = (flatCam.panX - mx) * delta + mx;
      flatCam.panY = (flatCam.panY - my) * delta + my;
      flatCam.zoom = Math.min(newZoom, 20);
    }
    drawFlat();
  }, { passive: false });

  canvas.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    flatCam.dragging = true; flatCam.lastMouse = { x: e.clientX, y: e.clientY };
    canvas.style.cursor = 'grabbing';
  });
  window.addEventListener('mouseup', () => {
    flatCam.dragging = false;
    const c = document.getElementById('flatCanvas'); if (c) c.style.cursor = 'crosshair';
  });
  canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    flatCam.hoverPx = {
      x: (e.clientX - rect.left) * (canvas.width  / rect.width),
      y: (e.clientY - rect.top)  * (canvas.height / rect.height),
    };
    if (flatCam.dragging) {
      flatCam.panX += e.clientX - flatCam.lastMouse.x;
      flatCam.panY += e.clientY - flatCam.lastMouse.y;
      flatCam.lastMouse = { x: e.clientX, y: e.clientY };
    }
    drawFlat();
  });
  canvas.addEventListener('mouseleave', () => { flatCam.hoverPx = null; drawFlat(); });
  canvas.addEventListener('dblclick',   () => { flatCam.zoom=1; flatCam.panX=0; flatCam.panY=0; drawFlat(); });
}
