import { A4_W, A4_H } from './constants.js';
import { getP, showToast, infoBoxSVGText } from './ui.js';
import { computeGeometry, buildVerts } from './geometry.js';
import { renderPatternToCtx } from './render-flat.js';

// ─── SVG ─────────────────────────────────────────────────────────────────────
export function exportSVG() {
  const p = getP(), g = computeGeometry(p);
  const { n, floors, extcols, stack, chir, scale } = p;
  const { b, floor_h, dx } = g;
  const CM = 37.795; // px per cm at 96 dpi
  const totalFloors = floors * stack;
  const col_min = -extcols, col_max = n + extcols, total_cols = col_max - col_min + 1;
  const A4pxW = Math.round(A4_W * CM), A4pxH = Math.round(A4_H * CM);

  function toSVG(xcm, ycm) { return [xcm * CM, (A4_H - ycm) * CM]; }

  const { verts, bounds, extS, seamlS, seamrS } = buildVerts(p, g);
  const olIdx = extcols, orIdx = extcols + n;
  const [x0,y0]=verts[0][olIdx], [x1]=verts[0][orIdx];
  const [x2]=verts[totalFloors][olIdx], [x3,y3]=verts[totalFloors][orIdx];
  const topY=y0-extS, botY=y3+extS;
  const seamLX=x0-seamlS, seamRX=x1+seamrS;

  const L = (ax,ay,bx,by,col,sw,dash) => {
    const [x1s,y1s]=toSVG(ax,ay),[x2s,y2s]=toSVG(bx,by);
    return `<line x1="${x1s.toFixed(2)}" y1="${y1s.toFixed(2)}" x2="${x2s.toFixed(2)}" y2="${y2s.toFixed(2)}" stroke="${col}" stroke-width="${sw||1}"${dash?` stroke-dasharray="${dash}"`:''} fill="none"/>`;
  };

  let lines = [];
  lines.push(L(x0,topY,x0,botY,'#6a1fa0',2.5)); lines.push(L(x1,topY,x1,botY,'#6a1fa0',2.5));
  lines.push(L(x0,topY,x1,topY,'#6a1fa0',2.5)); lines.push(L(x2,botY,x3,botY,'#6a1fa0',2.5));
  if(seamlS>0){lines.push(L(seamLX,topY,seamLX,botY,'#3535aa',1.8,'4 3'));[topY,botY,y0,verts[totalFloors][olIdx][1]].forEach(yy=>lines.push(L(seamLX,yy,x0,yy,'#3535aa',1.8,'4 3')));}
  if(seamrS>0){lines.push(L(seamRX,topY,seamRX,botY,'#3535aa',1.8,'4 3'));[topY,botY,verts[0][orIdx][1],verts[totalFloors][orIdx][1]].forEach(yy=>lines.push(L(x1,yy,seamRX,yy,'#3535aa',1.8,'4 3')));}

  for (let ci=1;ci<total_cols-1;ci++) {
    const pts=Array.from({length:totalFloors+1},(_,f)=>verts[f][ci]);
    const [sx,sy]=toSVG(pts[0][0],pts[0][1]);
    let d=`M${sx.toFixed(2)},${sy.toFixed(2)}`;
    for(let f=1;f<=totalFloors;f++){const[lx,ly]=toSVG(pts[f][0],pts[f][1]);d+=` L${lx.toFixed(2)},${ly.toFixed(2)}`;}
    lines.push(`<path d="${d}" stroke="#cc0000" stroke-width="2.0" fill="none"/>`);
  }
  [verts.map((_,f)=>verts[f][orIdx]),verts.map((_,f)=>verts[f][olIdx])].forEach(pts=>{
    const sp=pts.map(([cx,cy])=>{const[sx,sy]=toSVG(cx,cy);return`${sx.toFixed(2)},${sy.toFixed(2)}`;}).join(' ');
    lines.push(`<polyline points="${sp}" stroke="#cc0000" stroke-width="1.6" stroke-dasharray="5 3" fill="none"/>`);
  });
  for(let f=0;f<=totalFloors;f++){
    const yL=verts[f][0][1],[lx,ly]=toSVG(seamLX,yL),[rx,ry]=toSVG(seamRX,yL);
    lines.push(`<line x1="${lx.toFixed(2)}" y1="${ly.toFixed(2)}" x2="${rx.toFixed(2)}" y2="${ry.toFixed(2)}" stroke="#0044cc" stroke-width="2.0" fill="none"/>`);
  }
  for(let f=0;f<totalFloors;f++)
    for(let ci=0;ci<total_cols-1;ci++){
      const v1=verts[f][ci],v2=verts[f+1][ci+1],v3=verts[f][ci+1],v4=verts[f+1][ci];
      const[ax,ay,bxv,byv]=(f*chir)%2===0?[v3[0],v3[1],v4[0],v4[1]]:[v1[0],v1[1],v2[0],v2[1]];
      lines.push(L(ax,ay,bxv,byv,'#007a30',1.5,'6 4'));
    }

  const [olX]=toSVG(x0,0),[orX]=toSVG(x1,0);
  const [,gapTopSVG]=toSVG(0,y0),[,gapBotSVG]=toSVG(0,topY);
  lines.push(infoBoxSVGText(p,g,bounds,CM,olX,orX,null,gapBotSVG,gapTopSVG));

  const svg=`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="${A4pxW}" height="${A4pxH}" viewBox="0 0 ${A4pxW} ${A4pxH}"><rect width="100%" height="100%" fill="white"/>\n${lines.join('\n')}\n</svg>`;
  _download(new Blob([svg],{type:'image/svg+xml'}), `kresling_n${p.n}_f${p.floors}_s${p.stack}.svg`);
}

// ─── PNG ─────────────────────────────────────────────────────────────────────
export function exportPNGA4() {
  const p = getP(), g = computeGeometry(p);
  const DPI = 200, CM_TO_PX = DPI / 2.54;
  const W = Math.round(A4_W * CM_TO_PX), H = Math.round(A4_H * CM_TO_PX);
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const ctx = off.getContext('2d');
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, W, H);
  renderPatternToCtx(ctx, p, g, W, H, CM_TO_PX, 0, 0, true);
  _download(off.toDataURL('image/png'), `kresling_A4_n${p.n}_f${p.floors}.png`, true);
}

// ─── PDF ─────────────────────────────────────────────────────────────────────
export function exportPDF() {
  const p = getP(), g = computeGeometry(p);
  const CM = 96 / 2.54; // SVG 96 dpi
  const A4pxW = Math.round(A4_W * CM), A4pxH = Math.round(A4_H * CM);
  const { n, floors, extcols, stack, chir, scale } = p;
  const totalFloors = floors * stack;
  const col_min = -extcols, col_max = n + extcols, total_cols = col_max - col_min + 1;

  function toSVG(xcm, ycm) { return [xcm * CM, (A4_H - ycm) * CM]; }

  const { verts, bounds, extS, seamlS, seamrS } = buildVerts(p, g);
  const olIdx = extcols, orIdx = extcols + n;
  const [x0,y0]=verts[0][olIdx],[x1]=verts[0][orIdx];
  const [x2]=verts[totalFloors][olIdx],[x3,y3]=verts[totalFloors][orIdx];
  const topY=y0-extS, botY=y3+extS;
  const seamLX=x0-seamlS, seamRX=x1+seamrS;

  const L = (ax,ay,bx,by,col,sw,dash) => {
    const [x1s,y1s]=toSVG(ax,ay),[x2s,y2s]=toSVG(bx,by);
    return `<line x1="${x1s.toFixed(2)}" y1="${y1s.toFixed(2)}" x2="${x2s.toFixed(2)}" y2="${y2s.toFixed(2)}" stroke="${col}" stroke-width="${sw||1}"${dash?` stroke-dasharray="${dash}"`:''} fill="none"/>`;
  };
  let lines = [];
  lines.push(L(x0,topY,x0,botY,'#6a1fa0',2.5));lines.push(L(x1,topY,x1,botY,'#6a1fa0',2.5));
  lines.push(L(x0,topY,x1,topY,'#6a1fa0',2.5));lines.push(L(x2,botY,x3,botY,'#6a1fa0',2.5));
  if(seamlS>0){lines.push(L(seamLX,topY,seamLX,botY,'#3535aa',1.8,'4 3'));[topY,botY,y0,verts[totalFloors][olIdx][1]].forEach(yy=>lines.push(L(seamLX,yy,x0,yy,'#3535aa',1.8,'4 3')));}
  if(seamrS>0){lines.push(L(seamRX,topY,seamRX,botY,'#3535aa',1.8,'4 3'));[topY,botY,verts[0][orIdx][1],verts[totalFloors][orIdx][1]].forEach(yy=>lines.push(L(x1,yy,seamRX,yy,'#3535aa',1.8,'4 3')));}
  for(let ci=1;ci<total_cols-1;ci++){
    const pts=Array.from({length:totalFloors+1},(_,f)=>verts[f][ci]);
    const[sx,sy]=toSVG(pts[0][0],pts[0][1]);let d=`M${sx.toFixed(2)},${sy.toFixed(2)}`;
    for(let f=1;f<=totalFloors;f++){const[lx,ly]=toSVG(pts[f][0],pts[f][1]);d+=` L${lx.toFixed(2)},${ly.toFixed(2)}`;}
    lines.push(`<path d="${d}" stroke="#cc0000" stroke-width="2.0" fill="none"/>`);
  }
  [verts.map((_,f)=>verts[f][orIdx]),verts.map((_,f)=>verts[f][olIdx])].forEach(pts=>{
    const sp=pts.map(([cx,cy])=>{const[sx,sy]=toSVG(cx,cy);return`${sx.toFixed(2)},${sy.toFixed(2)}`;}).join(' ');
    lines.push(`<polyline points="${sp}" stroke="#cc0000" stroke-width="1.6" stroke-dasharray="5 3" fill="none"/>`);
  });
  for(let f=0;f<=totalFloors;f++){
    const yL=verts[f][0][1],[lx,ly]=toSVG(seamLX,yL),[rx,ry]=toSVG(seamRX,yL);
    lines.push(`<line x1="${lx.toFixed(2)}" y1="${ly.toFixed(2)}" x2="${rx.toFixed(2)}" y2="${ry.toFixed(2)}" stroke="#0044cc" stroke-width="2.0" fill="none"/>`);
  }
  for(let f=0;f<totalFloors;f++)
    for(let ci=0;ci<total_cols-1;ci++){
      const v1=verts[f][ci],v2=verts[f+1][ci+1],v3=verts[f][ci+1],v4=verts[f+1][ci];
      const[ax,ay,bxv,byv]=(f*chir)%2===0?[v3[0],v3[1],v4[0],v4[1]]:[v1[0],v1[1],v2[0],v2[1]];
      lines.push(L(ax,ay,bxv,byv,'#007a30',1.5,'6 4'));
    }
  const[olX]=toSVG(x0,0),[orX]=toSVG(x1,0);
  const[,gapTopSVG]=toSVG(0,y0),[,gapBotSVG]=toSVG(0,topY);
  lines.push(infoBoxSVGText(p,g,bounds,CM,olX,orX,null,gapBotSVG,gapTopSVG));

  const svgBody=`<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 ${A4pxW} ${A4pxH}" preserveAspectRatio="none" style="display:block;position:absolute;top:0;left:0;width:210mm;height:297mm"><rect width="100%" height="100%" fill="white"/>\n${lines.join('\n')}\n</svg>`;
  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Kresling n=${p.n} f=${p.floors}</title><style>*{margin:0;padding:0;box-sizing:border-box}@page{size:210mm 297mm;margin:0mm}html,body{width:210mm;height:297mm;margin:0;padding:0;background:white;overflow:hidden;position:relative}svg{display:block;position:absolute;top:0;left:0;width:210mm!important;height:297mm!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}@media print{html,body{width:210mm;height:297mm}}</style></head><body>${svgBody}<script>window.onload=function(){setTimeout(function(){window.print();},500);};<\/script></body></html>`;
  const win = window.open('', '_blank');
  if (!win) { alert('Please allow pop-ups for this page to export PDF.'); return; }
  win.document.write(html); win.document.close();
}

// ─── DXF ─────────────────────────────────────────────────────────────────────
export function exportDXF() {
  const p = getP(), g = computeGeometry(p);
  const { n, floors, extcols, stack, chir, scale } = p;
  const totalFloors = floors * stack;
  const col_min = -extcols, col_max = n + extcols, total_cols = col_max - col_min + 1;
  const { verts, bounds, extS, seamlS, seamrS } = buildVerts(p, g);
  const olIdx=extcols,orIdx=extcols+n;
  const[x0,y0]=verts[0][olIdx],[x1,y1]=verts[0][orIdx];
  const[x2,y2]=verts[totalFloors][olIdx],[x3,y3]=verts[totalFloors][orIdx];
  const topY=y0-extS,botY=y3+extS,seamLX=x0-seamlS,seamRX=x1+seamrS;

  const dL=(x1,y1,x2,y2,layer)=>`0\nLINE\n8\n${layer}\n10\n${x1.toFixed(4)}\n20\n${y1.toFixed(4)}\n30\n0\n11\n${x2.toFixed(4)}\n21\n${y2.toFixed(4)}\n31\n0\n`;
  const entities=[dL(x0,topY,x0,botY,'CUT'),dL(x1,topY,x1,botY,'CUT'),dL(x0,topY,x1,topY,'CUT'),dL(x2,botY,x3,botY,'CUT')];
  for(let ci=1;ci<total_cols-1;ci++)for(let f=0;f<totalFloors;f++)entities.push(dL(verts[f][ci][0],verts[f][ci][1],verts[f+1][ci][0],verts[f+1][ci][1],'MOUNTAIN'));
  for(let f=0;f<=totalFloors;f++)entities.push(dL(seamLX,verts[f][0][1],seamRX,verts[f][0][1],'VALLEY'));
  for(let f=0;f<totalFloors;f++)for(let ci=0;ci<total_cols-1;ci++){
    const v1=verts[f][ci],v2=verts[f+1][ci+1],v3=verts[f][ci+1],v4=verts[f+1][ci];
    entities.push((f*chir)%2===0?dL(v3[0],v3[1],v4[0],v4[1],'VALLEY'):dL(v1[0],v1[1],v2[0],v2[1],'VALLEY'));
  }
  const e=entities.join('');
  const dxf=`0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${e}0\nENDSEC\n0\nEOF\n`;
  _download(new Blob([dxf],{type:'application/dxf'}), `kresling_n${n}_f${floors}_s${stack}.dxf`);
}

// ─── STL (hollow tube) ───────────────────────────────────────────────────────
export function exportSTL() {
  const p = getP(), g = computeGeometry(p);
  const { n, floors, stack, chir, compress } = p;
  const { floor_h, dx, R } = g;
  const totalFloors = floors * stack;
  const eFH  = floor_h * (1 - compress * 0.98);
  const eDx  = dx * (1 - compress * 0.5);
  const wallT = (p.wallmm || 0.8) / 10;
  const Ri    = Math.max(0.01, R - wallT);

  function makeRings(radius) {
    const rings = [];
    for (let f = 0; f <= totalFloors; f++) {
      const row = [];
      const y3d = f * eFH - (totalFloors * eFH / 2);
      const angOuter = (f % 2 === 1) ? (eDx/R)*chir : -(eDx/R)*chir;
      for (let k = 0; k < n; k++) {
        const a = (2*Math.PI*k/n) + angOuter;
        row.push([radius*Math.cos(a), y3d, radius*Math.sin(a)]);
      }
      rings.push(row);
    }
    return rings;
  }

  const outerRings = makeRings(R), innerRings = makeRings(Ri);
  const cross=([ax,ay,az],[bx,by,bz])=>[ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx];
  const sub  =([ax,ay,az],[bx,by,bz])=>[ax-bx,ay-by,az-bz];
  const norm = v=>{const l=Math.hypot(...v)||1;return v.map(x=>x/l);};
  const tri  =(v1,v2,v3)=>{const n=norm(cross(sub(v2,v1),sub(v3,v1)));const f=x=>x.toFixed(6);return `  facet normal ${n.map(f).join(' ')}\n    outer loop\n      vertex ${v1.map(f).join(' ')}\n      vertex ${v2.map(f).join(' ')}\n      vertex ${v3.map(f).join(' ')}\n    endloop\n  endfacet\n`;};
  const quad =(v1,v2,v3,v4)=>tri(v1,v2,v3)+tri(v1,v3,v4);

  const parts = [`solid kresling_hollow_n${n}_f${floors}\n`];
  for(let f=0;f<totalFloors;f++)for(let k=0;k<n;k++){
    const k2=(k+1)%n,v1=outerRings[f][k],v2=outerRings[f][k2],v3=outerRings[f+1][k],v4=outerRings[f+1][k2];
    if((f*chir)%2===0){parts.push(tri(v1,v2,v3),tri(v2,v4,v3));}else{parts.push(tri(v1,v2,v4),tri(v1,v4,v3));}
  }
  for(let f=0;f<totalFloors;f++)for(let k=0;k<n;k++){
    const k2=(k+1)%n,v1=innerRings[f][k],v2=innerRings[f][k2],v3=innerRings[f+1][k],v4=innerRings[f+1][k2];
    if((f*chir)%2===0){parts.push(tri(v3,v2,v1),tri(v3,v4,v2));}else{parts.push(tri(v4,v2,v1),tri(v3,v4,v1));}
  }
  for(let k=0;k<n;k++){const k2=(k+1)%n;parts.push(quad(outerRings[0][k],innerRings[0][k],innerRings[0][k2],outerRings[0][k2]));}
  for(let k=0;k<n;k++){const k2=(k+1)%n;parts.push(quad(outerRings[totalFloors][k2],innerRings[totalFloors][k2],innerRings[totalFloors][k],outerRings[totalFloors][k]));}
  parts.push(`endsolid kresling_hollow_n${n}_f${floors}\n`);
  const stl = parts.join('');
  _download(new Blob([stl],{type:'model/stl'}), `kresling_hollow_n${n}_f${floors}_s${stack}.stl`);
}

// ─── STL (press mold) ────────────────────────────────────────────────────────
export function exportMoldSTL(moldType) {
  const p = getP(), g = computeGeometry(p);
  const { n, floors, extcols, stack, chir, scale } = p;
  const totalFloors = floors * stack;
  const col_min = -extcols, col_max = n + extcols, total_cols = col_max - col_min + 1;
  const baseT  = (p.moldbase || 3)   / 10;
  const ridgeH = (p.ridgeh   || 1.2) / 10;
  const ridgeW = (p.ridgew   || 0.6) / 10;
  const margin = 0.2;

  const { verts, bounds, extS, seamlS, seamrS } = buildVerts(p, g);
  const olIdx=extcols,orIdx=extcols+n;
  const[x0,y0]=verts[0][olIdx],[x1]=verts[0][orIdx];
  const[x2,y2]=verts[totalFloors][olIdx],[x3,y3]=verts[totalFloors][orIdx];
  const topY=y0-extS,botY=y3+extS;
  const seamLX=x0-seamlS,seamRX=x1+seamrS;
  const plateX0=seamLX-margin,plateX1=seamRX+margin,plateY0=topY-margin,plateY1=botY+margin;

  const cross=([ax,ay,az],[bx,by,bz])=>[ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx];
  const sub  =([ax,ay,az],[bx,by,bz])=>[ax-bx,ay-by,az-bz];
  const norm = v=>{const l=Math.hypot(...v)||1;return v.map(c=>c/l);};
  const tri  =(v1,v2,v3)=>{const n=norm(cross(sub(v2,v1),sub(v3,v1)));const f=x=>x.toFixed(6);return `  facet normal ${n.map(f).join(' ')}\n    outer loop\n      vertex ${v1.map(f).join(' ')}\n      vertex ${v2.map(f).join(' ')}\n      vertex ${v3.map(f).join(' ')}\n    endloop\n  endfacet\n`;};
  const quad =(v1,v2,v3,v4)=>tri(v1,v2,v3)+tri(v1,v3,v4);

  const parts = [`solid kresling_${moldType}_mold_n${n}_f${floors}\n`];

  // Base plate
  const zBot=-baseT,zTop=0,bx0=plateX0,bx1=plateX1,by0=plateY0,by1=plateY1;
  parts.push(
    quad([bx0,by0,zBot],[bx1,by0,zBot],[bx1,by1,zBot],[bx0,by1,zBot]),
    quad([bx0,by0,zTop],[bx0,by1,zTop],[bx1,by1,zTop],[bx1,by0,zTop]),
    quad([bx0,by0,zBot],[bx0,by0,zTop],[bx0,by1,zTop],[bx0,by1,zBot]),
    quad([bx1,by0,zTop],[bx1,by0,zBot],[bx1,by1,zBot],[bx1,by1,zTop]),
    quad([bx0,by0,zTop],[bx0,by0,zBot],[bx1,by0,zBot],[bx1,by0,zTop]),
    quad([bx0,by1,zBot],[bx0,by1,zTop],[bx1,by1,zTop],[bx1,by1,zBot]),
  );

  function addRidge(ax,ay,bx_,by_,rH,rW){
    const ddx=bx_-ax,ddy=by_-ay,len=Math.hypot(ddx,ddy);
    if(len<1e-6)return;
    const tx=ddx/len,ty=ddy/len,nx_=-ty,ny_=tx,hw=rW/2;
    const AL=[ax-hw*nx_,ay-hw*ny_,0],AR=[ax+hw*nx_,ay+hw*ny_,0],AP=[ax,ay,rH];
    const BL=[bx_-hw*nx_,by_-hw*ny_,0],BR=[bx_+hw*nx_,by_+hw*ny_,0],BP=[bx_,by_,rH];
    parts.push(tri(AL,AP,AR),tri(BL,BR,BP),quad(AL,BL,BP,AP),quad(AR,AP,BP,BR));
  }

  const mountainSegs=[];
  for(let ci=1;ci<total_cols-1;ci++)for(let f=0;f<totalFloors;f++){const[vx1,vy1]=verts[f][ci],[vx2,vy2]=verts[f+1][ci];mountainSegs.push([vx1,vy1,vx2,vy2]);}
  const valleySegs=[];
  for(let f=0;f<=totalFloors;f++){const yL=verts[f][0][1];valleySegs.push([seamLX,yL,seamRX,yL]);}
  for(let f=0;f<totalFloors;f++)for(let ci=0;ci<total_cols-1;ci++){
    const v1=verts[f][ci],v2=verts[f+1][ci+1],v3=verts[f][ci+1],v4=verts[f+1][ci];
    const[ax_,ay_,bxg,byg]=(f*chir)%2===0?[v3[0],v3[1],v4[0],v4[1]]:[v1[0],v1[1],v2[0],v2[1]];
    valleySegs.push([ax_,ay_,bxg,byg]);
  }

  const segs = moldType === 'mountain' ? mountainSegs : valleySegs;
  for(const[ax_,ay_,bxs,bys] of segs) addRidge(ax_,ay_,bxs,bys,ridgeH,ridgeW);

  // Border registration ridges (half height)
  addRidge(x0,topY,x1,topY,ridgeH*0.5,ridgeW*0.8);
  addRidge(x2,botY,x3,botY,ridgeH*0.5,ridgeW*0.8);
  addRidge(x0,topY,x0,botY,ridgeH*0.5,ridgeW*0.8);
  addRidge(x1,topY,x1,botY,ridgeH*0.5,ridgeW*0.8);

  parts.push(`endsolid kresling_${moldType}_mold_n${n}_f${floors}\n`);
  const stl = parts.join('');
  showToast(`${moldType} mold exported ✓`);
  _download(new Blob([stl],{type:'model/stl'}), `kresling_${moldType}_mold_n${n}_f${floors}_s${stack}.stl`);
}

// ─── Helper ───────────────────────────────────────────────────────────────────
function _download(src, filename, isDataURL = false) {
  const a = document.createElement('a');
  a.href     = isDataURL ? src : URL.createObjectURL(src);
  a.download = filename;
  a.click();
}
