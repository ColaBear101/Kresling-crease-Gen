import { getP } from './ui.js';
import { computeGeometry } from './geometry.js';

// ─── Kidambi, N., & Wang, K. W. (2020). Dynamics of Kresling origami
// deployment. Physical Review E, 101(6), 063003. ────────────────────────────
// Reproduces Fig. 13(b): modal frequencies of the axial and off-axis
// vibration modes of a single Kresling module at its two stable branches,
// swept over the stress-free twist angle δ0, for the current n and R0.
//
// Model (their Sec. II & V-B): rigid n-gon top/bottom panels of circumradius
// R0 (nondimensionalised by the stress-free height h0), joined by n "vertical"
// (mountain) trusses of natural length a0 and n "diagonal" (valley) trusses
// of natural length b0, linear-elastic with unit stiffness (ka=kb=1, i.e.
// rk=1). State x=[pB1,pB2,pB3,γ,β,α] is the position + 3-2-1 Euler angles of
// the top panel relative to the fixed bottom panel. Mass matrix M=diag(mB·I3,
// IB0) with mB=(ρ/ρ0)πR0² and IB0=(ρ/4ρ0)πR0⁴·diag(1,1,2); using their
// dynamics-section default ρ/ρ0=1/(πR0²) gives mB=1, IB0=diag(R0²/4,R0²/4,R0²/2)
// — and because the two transverse principal moments are equal (I1=I2), this
// mass matrix is *exact* in Euler-angle-rate coordinates at any equilibrium
// with β=α=0 (true for both branches here), not just a small-angle approximation.
//
// This module numerically differentiates the truss strain energy (rather than
// the analytic force/torque expressions in their Eqs. 11-12/18) to build the
// stiffness matrix — physically equivalent, and avoids re-deriving those
// per-truss force formulas by hand. Natural frequencies come from a
// hand-rolled cyclic Jacobi eigensolver (mass-normalised, so it's a plain
// symmetric eigenproblem) since no linear-algebra library is loaded here.

// ─── Small 3-vector / 3x3-matrix helpers ─────────────────────────────────────
const vAdd = (a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
const vSub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const vLen = a => Math.hypot(a[0], a[1], a[2]);
function matMul3(A, B) {
  const C = [[0,0,0],[0,0,0],[0,0,0]];
  for (let i=0;i<3;i++) for (let j=0;j<3;j++) { let s=0; for (let k=0;k<3;k++) s += A[i][k]*B[k][j]; C[i][j]=s; }
  return C;
}
function matVec3(A, v) {
  return [A[0][0]*v[0]+A[0][1]*v[1]+A[0][2]*v[2],
          A[1][0]*v[0]+A[1][1]*v[1]+A[1][2]*v[2],
          A[2][0]*v[0]+A[2][1]*v[1]+A[2][2]*v[2]];
}
// 3-2-1 Euler rotation tensor R = R1(γ)·R2(β)·R3(α), Eqs. (2)-(3).
function rot321(gamma, beta, alpha) {
  const cg=Math.cos(gamma), sg=Math.sin(gamma);
  const cb=Math.cos(beta),  sb=Math.sin(beta);
  const ca=Math.cos(alpha), sa=Math.sin(alpha);
  const R1=[[cg,-sg,0],[sg,cg,0],[0,0,1]];
  const R2=[[cb,0,sb],[0,1,0],[-sb,0,cb]];
  const R3=[[1,0,0],[0,ca,-sa],[0,sa,ca]];
  return matMul3(matMul3(R1,R2),R3);
}

// ─── Truss geometry & strain energy (Eqs. 4-9, nondimensional, h0=1) ────────
function nodeA(i, n, R0) { const t=2*Math.PI*i/n; return [R0*Math.cos(t), R0*Math.sin(t), 0]; }
function nodeBBody(i, n, R0, delta0) { const t=2*Math.PI*i/n + delta0; return [R0*Math.cos(t), R0*Math.sin(t), 0]; }

function naturalLengths(n, R0, delta0) {
  const A0=nodeA(0,n,R0), B0=vAdd(nodeBBody(0,n,R0,delta0),[0,0,1]);
  const B1=vAdd(nodeBBody(1,n,R0,delta0),[0,0,1]);
  return { a0: vLen(vSub(B0,A0)), b0: vLen(vSub(B1,A0)) };
}

function strainEnergy(x, n, R0, delta0, a0, b0) {
  const [pB1,pB2,pB3,gamma,beta,alpha] = x;
  const R = rot321(gamma,beta,alpha);
  const p = [pB1,pB2,pB3];
  let E = 0;
  for (let i=0;i<n;i++) {
    const Ai  = nodeA(i,n,R0);
    const Bi  = vAdd(p, matVec3(R, nodeBBody(i,n,R0,delta0)));
    const Bi1 = vAdd(p, matVec3(R, nodeBBody((i+1)%n,n,R0,delta0)));
    const La = vLen(vSub(Bi,Ai));
    const Lb = vLen(vSub(Bi1,Ai));
    E += 0.5*(La-a0)**2 + 0.5*(Lb-b0)**2;
  }
  return E;
}

// ─── Minimum-energy axial deployment path (analogue of their Fig. 5/6) ─────
// Off-axis DOF (pB1,pB2,β,α) are zero on this path by symmetry; γ is the
// only DOF coupled to pB3, so a 1-D minimisation over γ is exact.
function energyAxial(pB3, gamma, n, R0, delta0, a0, b0) {
  return strainEnergy([0,0,pB3,gamma,0,0], n, R0, delta0, a0, b0);
}
function minimizeGamma(pB3, n, R0, delta0, a0, b0) {
  const GRID = 20;
  let bestG = 0, bestE = Infinity;
  for (let k=0;k<=GRID;k++) {
    const gm = -Math.PI + 2*Math.PI*k/GRID;
    const E = energyAxial(pB3, gm, n,R0,delta0,a0,b0);
    if (E < bestE) { bestE = E; bestG = gm; }
  }
  const step = 2*Math.PI/GRID;
  let lo = bestG - step, hi = bestG + step;
  const gr = (Math.sqrt(5)-1)/2;
  let c = hi-gr*(hi-lo), d = lo+gr*(hi-lo);
  let fc = energyAxial(pB3,c,n,R0,delta0,a0,b0), fd = energyAxial(pB3,d,n,R0,delta0,a0,b0);
  for (let it=0; it<20; it++) {
    if (fc < fd) { hi=d; d=c; fd=fc; c=hi-gr*(hi-lo); fc=energyAxial(pB3,c,n,R0,delta0,a0,b0); }
    else         { lo=c; c=d; fc=fd; d=lo+gr*(hi-lo); fd=energyAxial(pB3,d,n,R0,delta0,a0,b0); }
  }
  const gEq = (lo+hi)/2;
  return { gamma: gEq, E: energyAxial(pB3,gEq,n,R0,delta0,a0,b0) };
}

// Finds local energy minima along the pB3-axis (both stable branches).
function findBranches(n, R0, delta0) {
  const { a0, b0 } = naturalLengths(n, R0, delta0);
  const STEPS = 70, PB3_MAX = 2.0;
  const pts = [];
  for (let i=0;i<=STEPS;i++) {
    const pB3 = PB3_MAX * i / STEPS;
    const { gamma, E } = minimizeGamma(pB3, n,R0,delta0,a0,b0);
    pts.push({ pB3, gamma, E });
  }
  const WIN = 4;
  const minima = [];
  for (let i=WIN;i<pts.length-WIN;i++) {
    let isMin = true;
    for (let j=i-WIN;j<=i+WIN;j++) if (j!==i && pts[j].E <= pts[i].E) { isMin=false; break; }
    if (isMin) minima.push(pts[i]);
  }
  if (pts[0].E < pts[WIN].E) minima.unshift(pts[0]);
  if (pts[STEPS].E < pts[STEPS-WIN].E) minima.push(pts[STEPS]);
  const merged = [];
  let lastPb3 = -Infinity;
  for (const m of minima) { if (Math.abs(m.pB3-lastPb3) > 0.04) { merged.push(m); lastPb3 = m.pB3; } }
  return { a0, b0, minima: merged };
}

// ─── Numerical Hessian (stiffness matrix) + mass-normalised Jacobi eigensolve ─
function hessian6(fn, x0, h = 1e-4) {
  const H = Array.from({length:6},()=>new Array(6).fill(0));
  const E0 = fn(x0);
  for (let i=0;i<6;i++) {
    const xp=x0.slice(); xp[i]+=h; const xm=x0.slice(); xm[i]-=h;
    H[i][i] = (fn(xp) - 2*E0 + fn(xm)) / (h*h);
  }
  for (let i=0;i<6;i++) for (let j=i+1;j<6;j++) {
    const xpp=x0.slice(); xpp[i]+=h; xpp[j]+=h;
    const xpm=x0.slice(); xpm[i]+=h; xpm[j]-=h;
    const xmp=x0.slice(); xmp[i]-=h; xmp[j]+=h;
    const xmm=x0.slice(); xmm[i]-=h; xmm[j]-=h;
    const v = (fn(xpp)-fn(xpm)-fn(xmp)+fn(xmm)) / (4*h*h);
    H[i][j]=v; H[j][i]=v;
  }
  return H;
}
function massNormalize(H, M) {
  const A = Array.from({length:6},()=>new Array(6).fill(0));
  for (let i=0;i<6;i++) for (let j=0;j<6;j++) A[i][j] = H[i][j] / Math.sqrt(M[i]*M[j]);
  return A;
}
// Cyclic Jacobi eigenvalue algorithm for a symmetric 6x6 matrix.
function jacobiEigen(Ain, maxIter=120, tol=1e-13) {
  const n = Ain.length;
  const A = Ain.map(r=>r.slice());
  const V = Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j?1:0));
  for (let iter=0; iter<maxIter; iter++) {
    let p=0,q=1,max=0;
    for (let i=0;i<n;i++) for (let j=i+1;j<n;j++) if (Math.abs(A[i][j])>max) { max=Math.abs(A[i][j]); p=i; q=j; }
    if (max < tol) break;
    const app=A[p][p], aqq=A[q][q], apq=A[p][q];
    const phi = 0.5*Math.atan2(2*apq, aqq-app);
    const c=Math.cos(phi), s=Math.sin(phi);
    for (let k=0;k<n;k++) { const akp=A[k][p], akq=A[k][q]; A[k][p]=c*akp-s*akq; A[k][q]=s*akp+c*akq; }
    for (let k=0;k<n;k++) { const apk=A[p][k], aqk=A[q][k]; A[p][k]=c*apk-s*aqk; A[q][k]=s*apk+c*aqk; }
    for (let k=0;k<n;k++) { const vkp=V[k][p], vkq=V[k][q]; V[k][p]=c*vkp-s*vkq; V[k][q]=s*vkp+c*vkq; }
  }
  return { vals: Array.from({length:n},(_,i)=>A[i][i]), vecs: V };
}

// Axial subspace = (pB3,γ) → indices 2,3. Off-axis = (pB1,pB2,β,α) → 0,1,4,5.
function modesAt(x0, fn, M) {
  const H = hessian6(fn, x0);
  const A = massNormalize(H, M);
  const { vals, vecs } = jacobiEigen(A);
  const modes = vals.map((lambda, k) => {
    const col = vecs.map(row => row[k]);
    const axialE = col[2]**2 + col[3]**2;
    const offE   = col[0]**2 + col[1]**2 + col[4]**2 + col[5]**2;
    return { omega: Math.sqrt(Math.max(0, lambda)), type: axialE >= offE ? 'axial' : 'offaxis' };
  });
  modes.sort((a,b) => a.omega - b.omega);
  return {
    axial:   modes.find(m => m.type === 'axial')?.omega   ?? NaN,
    offaxis: modes.find(m => m.type === 'offaxis')?.omega ?? NaN,
  };
}

// ─── Full δ0 sweep for the current n, R0 (memoised) ─────────────────────────
let _lastKey = '', _lastSweep = null;

export function computeModalSweep(p, g) {
  const n = p.n;
  const R0 = g.R / g.floor_h;
  const delta0Cur = 2 * Math.abs(g.dx) / g.R;
  const key = `${n},${R0.toFixed(6)}`;
  if (key === _lastKey) return { ..._lastSweep, degCur: delta0Cur*180/Math.PI };
  _lastKey = key;

  const M = [1,1,1, (R0*R0)/2, (R0*R0)/4, (R0*R0)/4]; // [pB1,pB2,pB3,γ,β,α]
  const DEG_MIN=5, DEG_MAX=89, STEPS=40;
  const results = [];
  for (let i=0;i<=STEPS;i++) {
    const deg = DEG_MIN + (DEG_MAX-DEG_MIN)*i/STEPS;
    const delta0 = deg*Math.PI/180;
    const { a0, b0, minima } = findBranches(n, R0, delta0);
    const fn = x => strainEnergy(x, n, R0, delta0, a0, b0);

    let branchA = minima.reduce((best,m) => (Math.abs(m.pB3-1)<0.05 && (!best || m.pB3<best.pB3 || true)) ? m : best,
      minima.find(m => Math.abs(m.pB3-1) < 0.05));
    if (!branchA) branchA = { pB3:1, gamma:0, E:0 }; // trivially exact (stress-free by construction)
    let branchB = null;
    for (const m of minima) {
      if (Math.abs(m.pB3 - branchA.pB3) > 0.06 && (!branchB || m.E < branchB.E)) branchB = m;
    }

    const point = { deg };
    const mA = modesAt([0,0,branchA.pB3,branchA.gamma,0,0], fn, M);
    point.axialA = mA.axial; point.offA = mA.offaxis;
    if (branchB) {
      const mB = modesAt([0,0,branchB.pB3,branchB.gamma,0,0], fn, M);
      point.axialB = mB.axial; point.offB = mB.offaxis; point.pB3B = branchB.pB3;
    }
    results.push(point);
  }
  _lastSweep = { results, n, R0 };
  return { results, n, R0, degCur: delta0Cur*180/Math.PI };
}

// ─── Chart ────────────────────────────────────────────────────────────────
export function drawModal() {
  const canvas = document.getElementById('canvasModal');
  if (!canvas) return;
  const wrap = canvas.parentElement;
  const W = Math.max(200, Math.round(wrap.clientWidth) || 340);
  const H = Math.max(200, Math.round(wrap.clientHeight) || 300);
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1a1d28'; ctx.fillRect(0, 0, W, H);

  const p = getP(), g = computeGeometry(p);
  if (!(g.R > 0) || !(g.floor_h > 0)) return;
  const { results, degCur, n, R0 } = computeModalSweep(p, g);

  const DEG_MIN = results[0].deg, DEG_MAX = results[results.length-1].deg;
  let maxF = 0.01;
  results.forEach(r => { [r.axialA,r.offA,r.axialB,r.offB].forEach(v => { if (Number.isFinite(v) && v>maxF) maxF=v; }); });
  maxF *= 1.12;

  const PAD = { l:44, r:14, t:34, b:36 };
  const gW = W-PAD.l-PAD.r, gH = H-PAD.t-PAD.b;
  const toX = deg => PAD.l + (deg-DEG_MIN)/(DEG_MAX-DEG_MIN)*gW;
  const toY = f   => PAD.t + gH - Math.min(f,maxF)/maxF*gH;

  ctx.strokeStyle='rgba(59,130,246,0.1)'; ctx.lineWidth=0.5;
  for(let i=0;i<=4;i++){const y=PAD.t+i*(gH/4);ctx.beginPath();ctx.moveTo(PAD.l,y);ctx.lineTo(PAD.l+gW,y);ctx.stroke();}
  for(let i=0;i<=6;i++){const x=PAD.l+i*(gW/6);ctx.beginPath();ctx.moveTo(x,PAD.t);ctx.lineTo(x,PAD.t+gH);ctx.stroke();}
  ctx.strokeStyle='rgba(180,200,255,0.45)'; ctx.lineWidth=1.2;
  ctx.beginPath();ctx.moveTo(PAD.l,PAD.t);ctx.lineTo(PAD.l,PAD.t+gH);ctx.lineTo(PAD.l+gW,PAD.t+gH);ctx.stroke();

  ctx.fillStyle='rgba(139,144,160,0.9)'; ctx.font='9px "JetBrains Mono",monospace'; ctx.textAlign='center';
  ctx.fillText('design: twist \u03b4\u2080 (deg)', PAD.l+gW/2, H-6);
  ctx.save();ctx.translate(10,PAD.t+gH/2);ctx.rotate(-Math.PI/2);ctx.fillText('modal frequency (nondim)',0,0);ctx.restore();
  for(let i=0;i<=6;i++){const d=DEG_MIN+(i/6)*(DEG_MAX-DEG_MIN);ctx.fillStyle='rgba(139,144,160,0.7)';ctx.fillText(d.toFixed(0),toX(d),PAD.t+gH+11);}
  ctx.textAlign='right';
  for(let i=0;i<=4;i++){const f=maxF*(1-i/4);const y=PAD.t+(i/4)*gH;ctx.fillStyle='rgba(139,144,160,0.6)';ctx.fillText(f.toFixed(2),PAD.l-4,y+3);}

  function drawCurve(key, color, dashed) {
    ctx.beginPath(); let started=false;
    for (const r of results) {
      const v = r[key];
      if (!Number.isFinite(v)) { started=false; continue; }
      const x=toX(r.deg), y=toY(v);
      if (!started) { ctx.moveTo(x,y); started=true; } else ctx.lineTo(x,y);
    }
    ctx.strokeStyle=color; ctx.lineWidth=1.8; ctx.setLineDash(dashed?[5,3]:[]); ctx.stroke(); ctx.setLineDash([]);
  }
  drawCurve('axialA', '#e05252', false);
  drawCurve('offA',   '#378ADD', false);
  drawCurve('axialB', '#e05252', true);
  drawCurve('offB',   '#378ADD', true);

  // Current-design marker
  if (degCur >= DEG_MIN && degCur <= DEG_MAX) {
    const x = toX(degCur);
    ctx.beginPath();ctx.moveTo(x,PAD.t);ctx.lineTo(x,PAD.t+gH);
    ctx.strokeStyle='rgba(255,255,255,0.35)';ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle='rgba(255,255,255,0.6)';ctx.font='8px "JetBrains Mono",monospace';ctx.textAlign='center';
    ctx.fillText('current \u03b4\u2080='+degCur.toFixed(1)+'\u00b0', x, PAD.t-4);
  } else {
    ctx.fillStyle='rgba(250,204,21,0.65)';ctx.font='8px "JetBrains Mono",monospace';ctx.textAlign='left';
    ctx.fillText(`current \u03b4\u2080=${degCur.toFixed(1)}\u00b0 (outside ${DEG_MIN}-${DEG_MAX}\u00b0 sweep)`, PAD.l, PAD.t-4);
  }

  // Zero-stiffness annotation (global min of branch-A axial mode, if it dips low)
  let zsIdx = -1, zsVal = Infinity;
  results.forEach((r,i) => { if (Number.isFinite(r.axialA) && r.axialA < zsVal) { zsVal = r.axialA; zsIdx = i; } });
  if (zsIdx > 0 && zsVal < maxF*0.12) {
    const r = results[zsIdx], x=toX(r.deg), y=toY(r.axialA);
    ctx.beginPath();ctx.arc(x,y,3.5,0,Math.PI*2);ctx.fillStyle='#facc15';ctx.fill();
    ctx.fillStyle='#facc15';ctx.font='8px "JetBrains Mono",monospace';ctx.textAlign='center';
    ctx.fillText('zero-stiffness', x, Math.max(PAD.t+8, y-8));
  }

  // Legend
  ctx.textAlign='left'; ctx.font='8px "JetBrains Mono",monospace';
  const leg = [['#e05252','axial \u2014 branch A',false],['#378ADD','off-axis \u2014 branch A',false],
               ['#e05252','axial \u2014 branch B',true], ['#378ADD','off-axis \u2014 branch B',true]];
  leg.forEach(([col,label,dashed],i) => {
    const ly = PAD.t - 20 + (i%2)*9, lx = PAD.l + Math.floor(i/2)*115;
    ctx.beginPath();ctx.moveTo(lx,ly-2);ctx.lineTo(lx+12,ly-2);
    ctx.strokeStyle=col;ctx.lineWidth=1.8;ctx.setLineDash(dashed?[4,2]:[]);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle='rgba(200,210,230,0.8)';ctx.fillText(label, lx+15, ly+1);
  });

  ctx.fillStyle='rgba(139,144,160,0.6)'; ctx.font='8px "JetBrains Mono",monospace'; ctx.textAlign='right';
  ctx.fillText(`n=${n}  R\u2080=${R0.toFixed(3)}  \u00b7  Kidambi & Wang (2020)`, PAD.l+gW, H-6);
}
