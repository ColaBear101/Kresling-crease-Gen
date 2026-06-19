import { getP } from './ui.js';
import { computeGeometry } from './geometry.js';
import { cam3d } from './state.js';

export function init3d() {
  const canvas = document.getElementById('canvas3d');
  if (!canvas) return;
  const wrap = document.getElementById('wrap3d');
  const rect = wrap.getBoundingClientRect();
  canvas.width  = Math.max(100, Math.round(rect.width)  || wrap.offsetWidth  || 340);
  canvas.height = Math.max(100, Math.round(rect.height) || wrap.offsetHeight || 300);

  canvas.onpointerdown = e => {
    cam3d.isDragging = true;
    cam3d.lastMouse  = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  };
  canvas.onpointerup = canvas.onpointercancel = () => { cam3d.isDragging = false; };
  canvas.onpointermove = e => {
    if (!cam3d.isDragging) return;
    cam3d.rotY += (e.clientX - cam3d.lastMouse.x) * 0.012;
    cam3d.rotX += (e.clientY - cam3d.lastMouse.y) * 0.012;
    cam3d.rotX  = Math.max(-Math.PI/2, Math.min(Math.PI/2, cam3d.rotX));
    cam3d.lastMouse = { x: e.clientX, y: e.clientY };
    draw3d();
  };
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const cur = cam3d.dist || 8;
    cam3d.dist = e.deltaY > 0 ? Math.min(cur * 1.15, 60) : Math.max(cur * 0.87, 0.5);
    draw3d();
  }, { passive: false });
  canvas.addEventListener('dblclick', () => { cam3d.dist = null; draw3d(); });
}

export function draw3d() {
  const canvas = document.getElementById('canvas3d');
  if (!canvas) return;
  const W = canvas.width || 340, H = canvas.height || 300;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#13151e'; ctx.fillRect(0, 0, W, H);

  const p = getP(), g = computeGeometry(p);
  const { n, floors, stack, chir, compress } = p;
  const { floor_h, dx, R } = g;
  const totalFloors = floors * stack;
  const eFH = floor_h * (1 - compress * 0.98);
  const eDx = dx      * (1 - compress * 0.5);

  // Build 3-D vertex rings
  const rings = [];
  for (let f = 0; f <= totalFloors; f++) {
    const row = [];
    const y3d = f * eFH - (totalFloors * eFH / 2);
    const ang = (f % 2 === 1) ? (eDx / R) * chir : -(eDx / R) * chir;
    for (let k = 0; k < n; k++) {
      const a = (2 * Math.PI * k / n) + ang;
      row.push([R * Math.cos(a), y3d, R * Math.sin(a)]);
    }
    rings.push(row);
  }

  const cx = Math.cos(cam3d.rotX), sx = Math.sin(cam3d.rotX);
  const cy = Math.cos(cam3d.rotY), sy = Math.sin(cam3d.rotY);
  function rotate([x, y, z]) {
    const x1 = x*cy + z*sy, z1 = -x*sy + z*cy;
    return [x1, y*cx - z1*sx, y*sx + z1*cx];
  }

  const modelH   = totalFloors * eFH;
  const dist     = cam3d.dist || (Math.max(R * 2, modelH) * 1.8 + 2);
  const fovScale = Math.min(W, H) / (1.6 * dist);
  const cx2 = W / 2, cy2 = H / 2;

  function project(pt) {
    const [x, y, z] = rotate(pt);
    const zd = z + dist;
    if (zd <= 0.01) return null;
    const sc = fovScale * (dist / zd);
    return [cx2 + x * sc, cy2 - y * sc, zd];
  }

  const segs = [];
  for (let f = 0; f < totalFloors; f++) {
    for (let k = 0; k < n; k++) {
      const k2=(k+1)%n;
      const v1=rings[f][k],v2=rings[f][k2],v3=rings[f+1][k],v4=rings[f+1][k2];
      segs.push({ type:'blue',  pts:[v1,v2] });
      segs.push({ type:'red',   pts:[v1,v3] });
      segs.push({ type:'green', pts:(f*chir)%2===0?[v2,v3]:[v1,v4] });
      segs.push({ type:'face',  pts:[v1,v2,v4,v3] });
    }
  }
  for (let k = 0; k < n; k++)
    segs.push({ type:'blue', pts:[rings[totalFloors][k], rings[totalFloors][(k+1)%n]] });

  const projected = segs.map(s => {
    const pp = s.pts.map(project);
    if (pp.some(v => !v)) return null;
    const avgZ = pp.reduce((a, p) => a + p[2], 0) / pp.length;
    return { ...s, pp, avgZ };
  }).filter(Boolean).sort((a, b) => b.avgZ - a.avgZ);

  for (const seg of projected) {
    const { type, pp } = seg;
    ctx.beginPath();
    if (type === 'face') {
      ctx.moveTo(pp[0][0],pp[0][1]);
      for (let i=1;i<pp.length;i++) ctx.lineTo(pp[i][0],pp[i][1]);
      ctx.closePath(); ctx.fillStyle='rgba(40,80,180,0.10)'; ctx.fill();
      continue;
    }
    ctx.moveTo(pp[0][0],pp[0][1]);
    for (let i=1;i<pp.length;i++) ctx.lineTo(pp[i][0],pp[i][1]);
    if      (type==='blue')  { ctx.strokeStyle='#378ADD'; ctx.lineWidth=1.3; ctx.setLineDash([]); }
    else if (type==='red')   { ctx.strokeStyle='#e05252'; ctx.lineWidth=1.2; ctx.setLineDash([]); }
    else                     { ctx.strokeStyle='#3dba6e'; ctx.lineWidth=1.0; ctx.setLineDash([4,3]); }
    ctx.stroke(); ctx.setLineDash([]);
  }

  ctx.fillStyle='rgba(139,144,160,0.7)'; ctx.font='10px "JetBrains Mono",monospace';
  ctx.textAlign='left';
  ctx.fillText(`n=${n}  f=${totalFloors}  ⌀${(R*2).toFixed(1)}cm  h=${(totalFloors*eFH).toFixed(1)}cm`, 8, H-10);
  ctx.textAlign='right';
  ctx.fillText('drag=rotate  scroll=zoom  dbl=reset', W-8, H-10);
}
