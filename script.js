const A4_W=21.0, A4_H=29.7;
let currentPanelTab='3d';
let panelMaximized=false;

// ── 3D state (pure canvas, no Three.js) ──
let rotX=0.4, rotY=0.3;
let isDragging=false, lastMouse={x:0,y:0};
let cam3dDist=null; // null = auto-fit

// Flat canvas pan/zoom state
let flatZoom=1, flatPanX=0, flatPanY=0;
let flatDragging=false, flatLastMouse={x:0,y:0};

const paramPairs=[
  ['r-dia','n-dia'],['r-height','n-height'],['r-n','n-n'],['r-floors','n-floors'],
  ['r-angle','n-angle'],['r-ext','n-ext'],['r-seaml','n-seaml'],['r-seamr','n-seamr'],
  ['r-extcols','n-extcols'],['r-stack','n-stack'],['r-scale','n-scale'],['r-compress','n-compress'],
  ['r-wallmm','n-wallmm'],['r-moldbase','n-moldbase'],['r-ridgeh','n-ridgeh'],['r-ridgew','n-ridgew'],
];

// ─── RIGHT PANEL RESIZE ───
function initRightPanelResize(){
  const handle=document.getElementById('rightPanelResize');
  const panel=document.getElementById('rightPanel');
  let dragging=false,startX=0,startW=0;
  handle.addEventListener('pointerdown',e=>{
    dragging=true;startX=e.clientX;startW=panel.offsetWidth;
    handle.classList.add('dragging');handle.setPointerCapture(e.pointerId);e.preventDefault();
  });
  handle.addEventListener('pointermove',e=>{
    if(!dragging)return;
    const w=Math.max(180,Math.min(600,startW-(e.clientX-startX)));
    panel.style.width=w+'px';drawPanel();
  });
  handle.addEventListener('pointerup',()=>{dragging=false;handle.classList.remove('dragging');});
}

// ─── PRESETS ───
const PRESETS={
  bistable6: {dia:4,height:16,n:6,floors:8,angle:105,ext:1.5,seaml:1.57,seamr:1.57,extcols:1,stack:1,scale:100,compress:0,wallmm:0.8},
  bistable8: {dia:5,height:20,n:8,floors:10,angle:100,ext:2,seaml:1.96,seamr:1.96,extcols:1,stack:1,scale:100,compress:0,wallmm:0.8},
  monostable:{dia:3,height:12,n:6,floors:6,angle:120,ext:1,seaml:0,seamr:0,extcols:0,stack:1,scale:100,compress:0,wallmm:0.8},
  tower:     {dia:2.5,height:30,n:6,floors:16,angle:95,ext:1.5,seaml:1.31,seamr:1.31,extcols:1,stack:2,scale:80,compress:0,wallmm:0.8},
  flat:      {dia:8,height:8,n:12,floors:4,angle:90,ext:1,seaml:0,seamr:0,extcols:0,stack:1,scale:60,compress:0,wallmm:0.8},
  compact:   {dia:3,height:6,n:5,floors:4,angle:110,ext:1,seaml:1.88,seamr:1.88,extcols:1,stack:1,scale:100,compress:0,wallmm:0.8},
};

function loadPreset(key){
  if(!key)return;
  const pv=PRESETS[key];if(!pv)return;
  Object.entries(pv).forEach(([k,v])=>{
    const r=document.getElementById('r-'+k),n=document.getElementById('n-'+k);
    if(r)r.value=v;if(n)n.value=v;
  });
  seamAutoMode=false;
  const cb=document.getElementById('seam-auto-cb');if(cb)cb.checked=false;
  document.getElementById('preset-select').value='';
  draw();
  showToast(`Preset loaded ✓`,1400);
}

// ─── TOAST ───
let toastTimer=null;
function showToast(msg,ms=2200){
  const t=document.getElementById('toast');
  t.textContent=msg;t.classList.add('show');
  if(toastTimer)clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>t.classList.remove('show'),ms);
}

// ─── PRESET IMPORT / EXPORT ───
const PRESET_KEYS=['dia','height','n','floors','angle','ext','seaml','seamr','extcols','stack','scale','compress','wallmm'];

function exportPreset(){
  const data={};
  PRESET_KEYS.forEach(k=>{const el=document.getElementById('n-'+k);if(el)data[k]=parseFloat(el.value);});
  data.chir=parseInt(document.getElementById('chir').value);
  data.seamAuto=document.getElementById('seam-auto-cb').checked;
  data._version=1;
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`kresling_preset_n${data.n}_f${data.floors}.json`;
  a.click();
  showToast('Preset exported ✓');
}

function importPreset(){
  document.getElementById('preset-file-input').click();
}

function handlePresetFile(input){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const data=JSON.parse(e.target.result);
      PRESET_KEYS.forEach(k=>{
        if(data[k]===undefined)return;
        const r=document.getElementById('r-'+k),n=document.getElementById('n-'+k);
        if(r)r.value=data[k];if(n)n.value=data[k];
      });
      if(data.chir!==undefined)document.getElementById('chir').value=data.chir;
      if(data.seamAuto!==undefined){
        seamAutoMode=!!data.seamAuto;
        document.getElementById('seam-auto-cb').checked=seamAutoMode;
      }
      if(!seamAutoMode)applyAutoSeam();
      draw();
      showToast(`Preset loaded: n=${data.n||'?'} floors=${data.floors||'?'} ✓`);
    }catch(err){showToast('⚠ Invalid preset file');}
    input.value='';
  };
  reader.readAsText(file);
}

let autoRotate=false, autoRotateFrame=null, _lastRotateTime=0;
function toggleAutoRotate(){
  autoRotate=!autoRotate;
  const btn=document.getElementById('anim-btn');
  if(btn){
    btn.style.color=autoRotate?'var(--accent2)':'';
    btn.style.borderColor=autoRotate?'var(--accent)':'';
    btn.title=autoRotate?'Stop rotation [A]':'Auto-rotate [A]';
  }
  if(autoRotate){_lastRotateTime=performance.now();stepAutoRotate();}
  else if(autoRotateFrame){cancelAnimationFrame(autoRotateFrame);autoRotateFrame=null;}
  showToast(autoRotate?'Auto-rotate on':'Auto-rotate off',1400);
}
function stepAutoRotate(){
  if(!autoRotate)return;
  const now=performance.now();
  const dt=Math.min((now-_lastRotateTime)/1000, 0.1); // cap at 100ms
  _lastRotateTime=now;
  const speed=0.5; // radians per second
  rotY+=speed*dt;
  draw3d();
  if(currentCenterTab==='mold'){moldRotY+=speed*dt;drawMold3d();}
  autoRotateFrame=requestAnimationFrame(stepAutoRotate);
}

// ─── KEYBOARD SHORTCUTS ───
document.addEventListener('keydown',e=>{
  // Ctrl+Z = undo, Ctrl+Y or Ctrl+Shift+Z = redo (works in any focus)
  if((e.ctrlKey||e.metaKey)&&e.key==='z'&&!e.shiftKey){e.preventDefault();undo();return;}
  if((e.ctrlKey||e.metaKey)&&(e.key==='y'||(e.key==='z'&&e.shiftKey))){e.preventDefault();redo();return;}

  const tag=document.activeElement.tagName;
  if(tag==='INPUT'||tag==='SELECT'||tag==='TEXTAREA')return;
  switch(e.key.toLowerCase()){
    case 's': e.preventDefault(); exportSVG(); showToast('SVG exported'); break;
    case 'p': e.preventDefault(); exportPDF(); showToast('PDF print dialog…'); break;
    case 'f': e.preventDefault(); autoFitA4(); showToast('Auto-fit A4'); break;
    case 'r': e.preventDefault(); resetDefaults(); showToast('Reset to defaults'); break;
    case 'a': e.preventDefault(); toggleAutoRotate(); break;
    case 'z': flatZoom=Math.min(flatZoom*1.2,20);drawFlat(); break;
    case 'x': flatZoom=Math.max(flatZoom/1.2,1);if(flatZoom<=1){flatZoom=1;flatPanX=0;flatPanY=0;}drawFlat(); break;
    case 'arrowleft': {
      const el=document.getElementById('r-compress');
      el.value=Math.max(0,parseFloat(el.value)-5);
      document.getElementById('n-compress').value=el.value;
      draw3d(); break;
    }
    case 'arrowright': {
      const el=document.getElementById('r-compress');
      el.value=Math.min(95,parseFloat(el.value)+5);
      document.getElementById('n-compress').value=el.value;
      draw3d(); break;
    }
  }
  const num=parseInt(e.key);
  if(num>=3&&num<=9&&!e.ctrlKey&&!e.metaKey){
    document.getElementById('r-n').value=num;
    document.getElementById('n-n').value=num;
    applyAutoSeam();draw();captureState();
    showToast(`Sides = ${num}`,1200);
  }
});
// When extra cols = N, the outermost green diagonal on each side starts at
// vertex col = -(extcols) floor 0  →  x_raw = -extcols*b ± dx
// The seam line should sit at the leftmost x of that vertex.
// Left seam covers from main pattern left edge (col=0, f=0: x=-dx) to
// outermost extra vertex (col=-extcols, f=0: x=-extcols*b - dx) → width = extcols*b
// Right seam: same by symmetry = extcols*b
// The green diagonals in the extra cols span one side (b) each, so total seam = extcols*b
let seamAutoMode=true;

function computeAutoSeam(p,g){
  const ec=p.extcols, b=g.b;
  if(ec===0)return{seaml:0,seamr:0};
  const val=parseFloat((ec*b).toFixed(3));
  return{seaml:val,seamr:val};
}

function applyAutoSeam(){
  if(!seamAutoMode)return;
  const p=getP(),g=computeGeometry(p);
  const{seaml,seamr}=computeAutoSeam(p,g);
  const setV=(id,v)=>{
    const r=document.getElementById('r-'+id),n=document.getElementById('n-'+id);
    if(r){r.max=Math.max(parseFloat(r.max),v);r.value=v;}
    if(n){n.value=v;}
  };
  setV('seaml',seaml);setV('seamr',seamr);
}

// ─── UNDO / REDO ───
const MAX_HISTORY = 60;
let history = [], historyIdx = -1, _suppressHistory = false;

function captureState(){
  if(_suppressHistory) return;
  const state = {};
  paramPairs.forEach(([,nid])=>{ const el=document.getElementById(nid); if(el) state[nid]=el.value; });
  state['chir'] = document.getElementById('chir').value;
  state['seam-auto-cb'] = document.getElementById('seam-auto-cb').checked;
  // Trim forward history
  history = history.slice(0, historyIdx+1);
  history.push(state);
  if(history.length > MAX_HISTORY) history.shift();
  historyIdx = history.length - 1;
}

function restoreState(state){
  _suppressHistory = true;
  paramPairs.forEach(([rid,nid])=>{
    if(state[nid]===undefined) return;
    const r=document.getElementById(rid), n=document.getElementById(nid);
    if(r) r.value=state[nid]; if(n) n.value=state[nid];
  });
  if(state['chir']!==undefined) document.getElementById('chir').value=state['chir'];
  if(state['seam-auto-cb']!==undefined){
    seamAutoMode=state['seam-auto-cb'];
    document.getElementById('seam-auto-cb').checked=seamAutoMode;
  }
  _suppressHistory = false;
  draw();
}

function undo(){
  if(historyIdx <= 0){ showToast('Nothing to undo',1200); return; }
  historyIdx--;
  restoreState(history[historyIdx]);
  showToast('Undo ✓', 1000);
}

function redo(){
  if(historyIdx >= history.length-1){ showToast('Nothing to redo',1200); return; }
  historyIdx++;
  restoreState(history[historyIdx]);
  showToast('Redo ✓', 1000);
}

// ─── DEBOUNCE for expensive recomputes (energy graph) ───
function debounce(fn, ms){
  let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
}
const drawEnergyDebounced = debounce(()=>drawEnergy(), 120);

// ─── MEMOISED patternBounds ───
let _lastBoundsKey='', _lastBounds=null;
function patternBounds(p,g){
  const key=`${p.n},${p.floors},${p.ext},${p.seaml},${p.seamr},${p.extcols},${p.stack},${p.chir},${p.scale},${g.b},${g.floor_h},${g.dx}`;
  if(key===_lastBoundsKey) return _lastBounds;
  _lastBoundsKey=key;
  const{n,floors,ext,seaml,seamr,extcols,stack}=p;
  const{b,floor_h,dx}=g;
  const totalFloors=floors*stack;
  const col_min=-extcols,col_max=n+extcols;
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(let f=0;f<=totalFloors;f++){
    for(let col=col_min;col<=col_max;col++){
      let x=col*b,y=f*floor_h;
      if(f%2===1)x+=dx*p.chir;else x-=dx*p.chir;
      if(x<minX)minX=x;if(x>maxX)maxX=x;
      if(y<minY)minY=y;if(y>maxY)maxY=y;
    }
  }
  minX-=seaml;maxX+=seamr;minY-=ext;maxY+=ext;
  _lastBounds={minX,maxX,minY,maxY,w:maxX-minX,h:maxY-minY};
  return _lastBounds;
}

// ─── FLAT CANVAS HOVER (crease type highlight) ───
let flatHoverPx=null; // {x,y} canvas pixels

function getNearestCrease(px,py,verts,p,g,toC){
  // Check all crease segments, return {type,dist}
  const{n,floors,ext,seaml,seamr,extcols,stack,chir,scale}=p;
  const{b,floor_h,dx}=g;
  const col_min=-extcols,col_max=n+extcols,total_cols=col_max-col_min+1;
  const totalFloors=floors*stack;
  const olIdx=extcols,orIdx=extcols+n;
  const[x0,y0]=verts[0][olIdx],[x1]=verts[0][orIdx];
  const[,y3]=verts[totalFloors][orIdx];
  const seamlS=seaml*scale,seamrS=seamr*scale;
  const seamLX=x0-seamlS,seamRX=x1+seamrS;

  function distPtSeg(px,py,ax,ay,bx,by){
    const dx=bx-ax,dy=by-ay,l2=dx*dx+dy*dy;
    if(l2===0)return Math.hypot(px-ax,py-ay);
    const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/l2));
    return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));
  }

  const THRESH=12; // px
  let best={type:null,dist:Infinity,label:''};

  function check(ax,ay,bx,by,type,label){
    const[cax,cay]=toC(ax,ay),[cbx,cby]=toC(bx,by);
    const d=distPtSeg(px,py,cax,cay,cbx,cby);
    if(d<THRESH&&d<best.dist){best={type,dist:d,label};}
  }

  // Blue horizontals
  for(let f=0;f<=totalFloors;f++){
    const yL=verts[f][0][1];
    check(seamLX,yL,seamRX,yL,'blue','Valley (horizontal)');
  }
  // Red mountain
  for(let ci=1;ci<total_cols-1;ci++){
    for(let f=0;f<totalFloors;f++) check(verts[f][ci][0],verts[f][ci][1],verts[f+1][ci][0],verts[f+1][ci][1],'red','Mountain');
  }
  // Green diagonal
  for(let f=0;f<totalFloors;f++){
    for(let ci=0;ci<total_cols-1;ci++){
      const v1=verts[f][ci],v2=verts[f+1][ci+1],v3=verts[f][ci+1],v4=verts[f+1][ci];
      const[ax,ay,bxv,byv]=(f*chir)%2===0?[v3[0],v3[1],v4[0],v4[1]]:[v1[0],v1[1],v2[0],v2[1]];
      check(ax,ay,bxv,byv,'green','Valley (diagonal)');
    }
  }
  return best;
}

function bindPairs(){
  paramPairs.forEach(([rid,nid])=>{
    const r=document.getElementById(rid),n=document.getElementById(nid);
    r.addEventListener('input',()=>{n.value=parseFloat(r.value);applyAutoSeam();draw();drawEnergyDebounced();});
    r.addEventListener('change',()=>captureState());
    n.addEventListener('input',()=>{
      let v=parseFloat(n.value);
      const mn=parseFloat(r.min),mx=parseFloat(r.max);
      if(!isNaN(mn)&&v<mn)v=mn; if(!isNaN(mx)&&v>mx)v=mx;
      r.value=v;n.value=v;applyAutoSeam();draw();drawEnergyDebounced();
    });
    n.addEventListener('change',()=>captureState());
    n.addEventListener('keydown',e=>{if(e.key==='Enter'){n.blur();captureState();}});
  });
  // Manual seam touch → disable auto
  ['r-seaml','n-seaml','r-seamr','n-seamr'].forEach(id=>{
    const el=document.getElementById(id);if(!el)return;
    el.addEventListener('pointerdown',()=>{seamAutoMode=false;const cb=document.getElementById('seam-auto-cb');if(cb)cb.checked=false;});
  });
  document.getElementById('seam-auto-cb').addEventListener('change',e=>{
    seamAutoMode=e.target.checked;if(seamAutoMode){applyAutoSeam();draw();}captureState();
  });
  ['showmv','showA4','showGrid'].forEach(id=>document.getElementById(id).addEventListener('change',draw));
  document.getElementById('chir').addEventListener('change',()=>{draw();captureState();});
}

// ─── SIDEBAR RESIZE ───
function initSidebarResize(){
  const handle=document.getElementById('sidebarResize');
  const sidebar=document.getElementById('sidebar');
  let dragging=false,startX=0,startW=0;
  handle.addEventListener('pointerdown',e=>{
    dragging=true;startX=e.clientX;startW=sidebar.offsetWidth;
    handle.classList.add('dragging');handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener('pointermove',e=>{
    if(!dragging)return;
    const w=Math.max(140,Math.min(480,startW+(e.clientX-startX)));
    sidebar.style.setProperty('--sidebar-w',w+'px');
    sidebar.style.width=w+'px';
    drawFlat();// reflow flat canvas
  });
  handle.addEventListener('pointerup',()=>{dragging=false;handle.classList.remove('dragging');});
}

function getV(id){return parseFloat(document.getElementById('n-'+id).value);}
function getBool(id){return document.getElementById(id).checked;}
function getP(){
  return{
    dia:getV('dia'),height:getV('height'),n:Math.round(getV('n')),
    floors:Math.round(getV('floors')),angle:getV('angle'),
    ext:getV('ext'),seaml:getV('seaml'),seamr:getV('seamr'),
    extcols:Math.round(getV('extcols')),stack:Math.round(getV('stack')),
    scale:getV('scale')/100,compress:getV('compress')/100,
    wallmm:getV('wallmm'),
    moldbase:getV('moldbase'), ridgeh:getV('ridgeh'), ridgew:getV('ridgew'),
    showmv:getBool('showmv'),chir:parseInt(document.getElementById('chir').value),
    showA4:getBool('showA4'),showGrid:getBool('showGrid'),
  };
}

function computeGeometry(p){
  const{dia,height,n,floors,angle}=p, R=dia/2;
  const b=(dia*Math.PI)/n, floor_h=height/floors;
  const theta=angle*Math.PI/180, dx=floor_h/Math.tan(theta);
  const red_len=Math.hypot(dx,floor_h);
  const green_dx=b+2*dx, green_len=Math.hypot(green_dx,floor_h);
  const vg=[green_dx,floor_h],vr=[dx,floor_h];
  const gr_angle=Math.acos(Math.max(-1,Math.min(1,(vg[0]*vr[0]+vg[1]*vr[1])/(Math.hypot(...vg)*Math.hypot(...vr)))))*180/Math.PI;
  const h0r=floor_h/R;
  const bistable=(h0r>0&&h0r<2*Math.sin(Math.PI/n)&&dx>0&&dx<b);
  const valid=dx<b&&floor_h>0&&b>0;
  return{b,floor_h,dx,red_len,green_len,gr_angle,h0r,bistable,valid,R,green_dx};
}

function patternBounds(p,g){
  const{n,floors,ext,seaml,seamr,extcols,stack,xoff=0,yoff=0}=p;
  const{b,floor_h,dx}=g;
  const totalFloors=floors*stack;
  const col_min=-extcols,col_max=n+extcols;
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(let f=0;f<=totalFloors;f++){
    for(let col=col_min;col<=col_max;col++){
      let x=col*b,y=f*floor_h;
      if(f%2===1)x+=dx*p.chir;else x-=dx*p.chir;
      if(x<minX)minX=x;if(x>maxX)maxX=x;
      if(y<minY)minY=y;if(y>maxY)maxY=y;
    }
  }
  minX-=seaml;maxX+=seamr;minY-=ext;maxY+=ext;
  return{minX,maxX,minY,maxY,w:maxX-minX,h:maxY-minY};
}

function updateStats(p,g){
  const bounds=patternBounds(p,g);
  const sW=bounds.w*p.scale,sH=bounds.h*p.scale;
  const fitW=(sW/A4_W*100).toFixed(1),fitH=(sH/A4_H*100).toFixed(1);
  const fits=sW<=A4_W&&sH<=A4_H;
  document.getElementById('s-fh').textContent=g.floor_h.toFixed(3)+' cm';
  document.getElementById('s-b').textContent=g.b.toFixed(3)+' cm';
  document.getElementById('s-red').textContent=g.red_len.toFixed(3)+' cm';
  document.getElementById('s-green').textContent=g.green_len.toFixed(3)+' cm';
  document.getElementById('s-pw').textContent=bounds.w.toFixed(2)+' cm';
  document.getElementById('s-ph').textContent=bounds.h.toFixed(2)+' cm';
  document.getElementById('s-h0r').textContent=g.h0r.toFixed(4);
  document.getElementById('s-bi').textContent=g.bistable?'✓ Yes':'✗ No';
  document.getElementById('s-scale').textContent=(p.scale*100).toFixed(0)+'%';
  document.getElementById('s-fit').textContent=fits?`✓ ${fitW}%W ${fitH}%H`:`✗ ${fitW}%W ${fitH}%H`;
  document.getElementById('s-fit').style.color=fits?'#4ade80':'#f87171';
  const badge=document.getElementById('validity-badge'),warn=document.getElementById('warn-bar');
  if(!g.valid){badge.className='badge bad';badge.textContent='Invalid';warn.style.display='block';warn.textContent='⚠ dx ≥ side length — angle too shallow.';}
  else if(g.h0r>1.8){badge.className='badge warn';badge.textContent='Marginal';warn.style.display='block';warn.textContent='⚠ h₀/R high — may not fold cleanly.';}
  else{badge.className='badge ok';badge.textContent='Foldable';warn.style.display='none';}
}

function autoFitA4(){
  const p=getP(),g=computeGeometry(p),bounds=patternBounds(p,g);
  const labelMarginCm=1.2;
  const usableW=A4_W-labelMarginCm*2;
  const usableH=A4_H-labelMarginCm*2;
  const ms=Math.min(usableW/bounds.w, usableH/bounds.h)*100;
  const cl=Math.min(200,Math.max(10,Math.floor(ms)));
  document.getElementById('r-scale').value=cl;document.getElementById('n-scale').value=cl;draw();
}
function resetDefaults(){
  const defs={dia:3,height:20,n:6,floors:10,angle:100,ext:2,seaml:1.4,seamr:0,extcols:1,stack:1,scale:100,compress:0,wallmm:0.8};
  Object.entries(defs).forEach(([k,v])=>{const r=document.getElementById('r-'+k),n=document.getElementById('n-'+k);if(r)r.value=v;if(n)n.value=v;});
  seamAutoMode=true;const cb=document.getElementById('seam-auto-cb');if(cb)cb.checked=true;
  applyAutoSeam();draw();
}

// ─── BUILD VERTICES (shared by flat draw and exports) ───
function buildVerts(p,g,forExport){
  const{n,floors,ext,seaml,seamr,extcols,stack,scale,chir}=p;
  const{b,floor_h,dx}=g;
  const col_min=-extcols,col_max=n+extcols;
  const totalFloors=floors*stack;
  const bounds=patternBounds(p,g);
  const scaledW=bounds.w*scale,scaledH=bounds.h*scale;
  const patOriginX=(A4_W-scaledW)/2;
  const patOriginY=(A4_H-scaledH)/2;
  const verts=[];
  for(let f=0;f<=totalFloors;f++){
    const row=[];
    for(let col=col_min;col<=col_max;col++){
      let x=col*b,y=f*floor_h;
      if(f%2===1)x+=dx*chir;else x-=dx*chir;
      const nx=(x-bounds.minX)*scale+patOriginX;
      const ny=(y-bounds.minY)*scale+patOriginY;
      row.push([nx,ny]);
    }
    verts.push(row);
  }
  return{verts,patOriginX,patOriginY,scaledW,scaledH,bounds,extS:ext*scale,seamlS:seaml*scale,seamrS:seamr*scale};
}

// ─── DRAW FLAT ───
function drawFlat(){
  const p=getP(),g=computeGeometry(p);
  updateStats(p,g);
  const canvas=document.getElementById('flatCanvas');
  const wrap=canvas.parentElement;
  const W=wrap.clientWidth||700,H=wrap.clientHeight||500;
  canvas.width=W;canvas.height=H;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#1a1d28';ctx.fillRect(0,0,W,H);

  const{n,floors,ext,seaml,seamr,extcols,stack,showmv,chir,scale,showA4,showGrid}=p;
  const{b,floor_h,dx}=g;
  const col_min=-extcols,col_max=n+extcols,total_cols=col_max-col_min+1;
  const totalFloors=floors*stack;
  const bounds=patternBounds(p,g);
  const scaledPatW=bounds.w*scale,scaledPatH=bounds.h*scale;

  const margin_cm=1.5;
  const sceneW=A4_W+margin_cm*2,sceneH=A4_H+margin_cm*2;
  const sc0=Math.min((W-20)/sceneW,(H-20)/sceneH);
  const sc=sc0*flatZoom;
  const ox0=W/2-sceneW*sc0/2, oy0=H/2-sceneH*sc0/2;
  const ox=ox0*flatZoom+flatPanX, oy=oy0*flatZoom+flatPanY;

  function toC(xcm,ycm){return[ox+(xcm+margin_cm)*sc, oy+(sceneH-ycm-margin_cm)*sc];}

  if(showGrid){
    ctx.save();ctx.strokeStyle='rgba(59,130,246,0.07)';ctx.lineWidth=0.5;
    for(let x=0;x<=A4_W;x++){const[cx,cy]=toC(x,0),[cx2,cy2]=toC(x,A4_H);ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx2,cy2);ctx.stroke();}
    for(let y=0;y<=A4_H;y++){const[cx,cy]=toC(0,y),[cx2,cy2]=toC(A4_W,y);ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx2,cy2);ctx.stroke();}
    ctx.restore();
  }

  const[a4x,a4y]=toC(0,A4_H),[a4x2,a4y2]=toC(A4_W,0);
  ctx.fillStyle='rgba(0,0,0,0.25)';
  ctx.fillRect(0,0,W,a4y);ctx.fillRect(0,a4y2,W,H-a4y2);
  ctx.fillRect(0,a4y,a4x,a4y2-a4y);ctx.fillRect(a4x2,a4y,W-a4x2,a4y2-a4y);
  if(showA4){
    ctx.save();ctx.strokeStyle='rgba(200,200,220,0.5)';ctx.lineWidth=1.2;ctx.setLineDash([6,4]);
    ctx.strokeRect(a4x,a4y,a4x2-a4x,a4y2-a4y);ctx.setLineDash([]);
    ctx.fillStyle='rgba(200,200,220,0.4)';ctx.font='10px "JetBrains Mono",monospace';
    ctx.fillText('A4  21×29.7 cm',a4x+4,a4y+12);ctx.restore();
  }

  ctx.save();ctx.fillStyle='rgba(200,210,255,0.45)';ctx.strokeStyle='rgba(200,210,255,0.35)';ctx.lineWidth=0.7;ctx.font='7px "JetBrains Mono",monospace';ctx.textAlign='center';
  for(let x=0;x<=A4_W;x++){
    const[rx,ry]=toC(x,0);
    const major=x%5===0;const tickH=major?8:4;
    ctx.beginPath();ctx.moveTo(rx,ry);ctx.lineTo(rx,ry+tickH);ctx.stroke();
    if(major&&x>0){ctx.fillText(x+'cm',rx,ry+18);}
  }
  ctx.textAlign='right';
  for(let y=0;y<=A4_H;y++){
    const[rx,ry]=toC(0,y);
    const major=y%5===0;const tickW=major?8:4;
    ctx.beginPath();ctx.moveTo(rx,ry);ctx.lineTo(rx-tickW,ry);ctx.stroke();
    if(major&&y>0){ctx.fillText(y+'cm',rx-10,ry+3);}
  }
  ctx.restore();
  const verts=[];
  const patOriginX=(A4_W-scaledPatW)/2;
  const patOriginY=(A4_H-scaledPatH)/2;
  for(let f=0;f<=totalFloors;f++){
    const row=[];
    for(let col=col_min;col<=col_max;col++){
      let x=col*b,y=f*floor_h;
      if(f%2===1)x+=dx*chir;else x-=dx*chir;
      const nx=(x-bounds.minX)*scale+patOriginX;
      const ny=(y-bounds.minY)*scale+patOriginY;
      row.push([nx,ny]);
    }
    verts.push(row);
  }

  const olIdx=extcols,orIdx=extcols+n;
  const[x0,y0]=verts[0][olIdx],[x1,y1]=verts[0][orIdx];
  const[x2,y2]=verts[totalFloors][olIdx],[x3,y3]=verts[totalFloors][orIdx];
  const extS=ext*scale,seamlS=seaml*scale,seamrS=seamr*scale;
  const topY=y0-extS,botY=y3+extS;
  const seamLX=x0-seamlS,seamRX=x1+seamrS;

  function line(ax,ay,bx,by,col,lw,dash){
    const[cx1,cy1]=toC(ax,ay),[cx2,cy2]=toC(bx,by);
    ctx.beginPath();ctx.moveTo(cx1,cy1);ctx.lineTo(cx2,cy2);
    ctx.strokeStyle=col;ctx.lineWidth=lw||1.2;ctx.setLineDash(dash||[]);ctx.stroke();ctx.setLineDash([]);
  }

  const purp='#9f6fdf';
  line(x0,topY,x0,botY,purp,1.8);line(x1,topY,x1,botY,purp,1.8);
  line(x0,topY,x1,topY,purp,1.8);line(x2,botY,x3,botY,purp,1.8);
  if(seamlS>0){line(seamLX,topY,seamLX,botY,'slateblue',1.2,[4,3]);[topY,botY,y0,y2].forEach(yy=>line(seamLX,yy,x0,yy,'slateblue',1.2,[4,3]));}
  if(seamrS>0){line(seamRX,topY,seamRX,botY,'slateblue',1.2,[4,3]);[topY,botY,y1,y3].forEach(yy=>line(x1,yy,seamRX,yy,'slateblue',1.2,[4,3]));}

  drawInfoBoxCanvas(ctx, toC, sc, x0, x1, y0, topY, p, g, bounds);

  for(let ci=1;ci<total_cols-1;ci++){
    ctx.beginPath();
    for(let f=0;f<=totalFloors;f++){const[vx,vy]=verts[f][ci],[cx,cy]=toC(vx,vy);f===0?ctx.moveTo(cx,cy):ctx.lineTo(cx,cy);}
    ctx.strokeStyle='#e05252';ctx.lineWidth=1.2;ctx.setLineDash([]);ctx.stroke();
  }
  const rPts=Array.from({length:totalFloors+1},(_,f)=>verts[f][orIdx]);
  ctx.beginPath();rPts.forEach(([vx,vy],i)=>{const[cx,cy]=toC(vx,vy);i===0?ctx.moveTo(cx,cy):ctx.lineTo(cx,cy);});
  ctx.strokeStyle='#e05252';ctx.lineWidth=1.1;ctx.setLineDash([4,3]);ctx.stroke();ctx.setLineDash([]);
  const lPts=Array.from({length:totalFloors+1},(_,f)=>verts[f][olIdx]);
  ctx.beginPath();lPts.forEach(([vx,vy],i)=>{const[cx,cy]=toC(vx,vy);i===0?ctx.moveTo(cx,cy):ctx.lineTo(cx,cy);});
  ctx.strokeStyle='#e05252';ctx.lineWidth=1.1;ctx.setLineDash([4,3]);ctx.stroke();ctx.setLineDash([]);

  for(let f=0;f<=totalFloors;f++){
    const yL=verts[f][0][1];
    const[lx,ly]=toC(seamLX,yL),[rx,ry]=toC(seamRX,yL);
    ctx.beginPath();ctx.moveTo(lx,ly);ctx.lineTo(rx,ry);ctx.strokeStyle='#378ADD';ctx.lineWidth=1.3;ctx.setLineDash([]);ctx.stroke();
  }

  ctx.strokeStyle='#3dba6e';ctx.lineWidth=1.0;ctx.setLineDash([5,4]);
  for(let f=0;f<totalFloors;f++){
    for(let ci=0;ci<total_cols-1;ci++){
      const v1=verts[f][ci],v2=verts[f+1][ci+1],v3=verts[f][ci+1],v4=verts[f+1][ci];
      const[ax2,ay2,bx2,by2]=(f*chir)%2===0?[v3[0],v3[1],v4[0],v4[1]]:[v1[0],v1[1],v2[0],v2[1]];
      const[px1,py1]=toC(ax2,ay2),[px2,py2]=toC(bx2,by2);
      ctx.beginPath();ctx.moveTo(px1,py1);ctx.lineTo(px2,py2);ctx.stroke();
    }
  }
  ctx.setLineDash([]);

  ctx.save();ctx.fillStyle='rgba(180,220,255,0.55)';ctx.font='9px "JetBrains Mono",monospace';
  const[lx0,ly0]=toC(x0-seamlS,topY-0.3),[rx0]=toC(x1+seamrS,topY-0.3);
  ctx.fillText(`W=${(bounds.w*scale).toFixed(1)}cm`,(lx0+rx0)/2-18,ly0-3);
  const[hx0,hy0]=toC(x1+seamrS+0.25,botY),[,hy1]=toC(x1+seamrS+0.25,topY);
  ctx.fillText(`H=${(bounds.h*scale).toFixed(1)}cm`,hx0+3,(hy0+hy1)/2);ctx.restore();

  if(flatHoverPx){
    const{x:hpx,y:hpy}=flatHoverPx;
    const hcm_x=(hpx-ox)/sc - margin_cm;
    const hcm_y=sceneH - (hpy-oy)/sc - margin_cm;

    ctx.save();
    ctx.strokeStyle='rgba(255,255,255,0.18)';ctx.lineWidth=0.8;ctx.setLineDash([4,4]);
    ctx.beginPath();ctx.moveTo(hpx,0);ctx.lineTo(hpx,H);ctx.stroke();
    ctx.beginPath();ctx.moveTo(0,hpy);ctx.lineTo(W,hpy);ctx.stroke();
    ctx.setLineDash([]);

    const nc=getNearestCrease(hpx,hpy,verts,p,g,toC);
    const creaseColors={blue:'#60c8ff',red:'#ff8080',green:'#80ffb0'};
    if(nc.type){
      ctx.strokeStyle=creaseColors[nc.type]||'#fff';
      ctx.lineWidth=2.5;ctx.globalAlpha=0.85;
    }

    const lines=[`x = ${hcm_x.toFixed(2)} cm`, `y = ${hcm_y.toFixed(2)} cm`];
    if(nc.type) lines.push(nc.label);
    const tfs=9,tlh=12,tPad=5,tW=130,tH=lines.length*tlh+tPad*2;
    let tx=hpx+10,ty=hpy-tH-6;
    if(tx+tW>W-4)tx=hpx-tW-10;
    if(ty<4)ty=hpy+10;
    ctx.globalAlpha=1;
    ctx.fillStyle='rgba(15,18,30,0.88)';ctx.strokeStyle='rgba(255,255,255,0.18)';ctx.lineWidth=0.8;
    ctx.beginPath();
    if(ctx.roundRect)ctx.roundRect(tx,ty,tW,tH,4);else ctx.rect(tx,ty,tW,tH);
    ctx.fill();ctx.stroke();
    ctx.fillStyle='rgba(220,235,255,0.9)';ctx.font=`${tfs}px "JetBrains Mono",monospace`;
    ctx.textAlign='left';ctx.textBaseline='top';
    lines.forEach((l,i)=>{
      if(i===2)ctx.fillStyle=creaseColors[nc.type]||'rgba(220,235,255,0.9)';
      ctx.fillText(l,tx+tPad,ty+tPad+i*tlh);
    });
    ctx.textBaseline='alphabetic';
    ctx.restore();
  }
}

// ─── FLAT CANVAS MOUSE/WHEEL EVENTS ───
function initFlatCanvasEvents(){
  const canvas=document.getElementById('flatCanvas');

  canvas.addEventListener('wheel',e=>{
    e.preventDefault();
    const rect=canvas.getBoundingClientRect();
    const mx=e.clientX-rect.left, my=e.clientY-rect.top;
    const delta=e.deltaY<0?1.12:1/1.12;
    const newZoom=flatZoom*delta;
    if(newZoom<=1.0){
      flatZoom=1; flatPanX=0; flatPanY=0;
    } else {
      flatPanX=(flatPanX-mx)*delta+mx;
      flatPanY=(flatPanY-my)*delta+my;
      flatZoom=Math.min(newZoom,20);
    }
    drawFlat();
  },{passive:false});

  canvas.addEventListener('mousedown',e=>{
    if(e.button===0){flatDragging=true;flatLastMouse={x:e.clientX,y:e.clientY};canvas.style.cursor='grabbing';}
  });
  window.addEventListener('mouseup',()=>{flatDragging=false;document.getElementById('flatCanvas').style.cursor='crosshair';});
  canvas.addEventListener('mousemove',e=>{
    if(!flatDragging)return;
    flatPanX+=e.clientX-flatLastMouse.x;
    flatPanY+=e.clientY-flatLastMouse.y;
    flatLastMouse={x:e.clientX,y:e.clientY};
    drawFlat();
  });
  canvas.addEventListener('dblclick',()=>{flatZoom=1;flatPanX=0;flatPanY=0;drawFlat();});

  canvas.addEventListener('mousemove',e=>{
    const rect=canvas.getBoundingClientRect();
    flatHoverPx={x:(e.clientX-rect.left)*(canvas.width/rect.width), y:(e.clientY-rect.top)*(canvas.height/rect.height)};
    if(!flatDragging) drawFlat();
  });
  canvas.addEventListener('mouseleave',()=>{flatHoverPx=null;drawFlat();});
}

// ─── CENTER TAB SYSTEM (Crease Pattern | Mold Preview) ───
let currentCenterTab='crease';
let currentMoldTab='mountain';

function switchCenterTab(tab){
  currentCenterTab=tab;
  document.getElementById('ctab-crease').classList.toggle('active',tab==='crease');
  document.getElementById('ctab-mold').classList.toggle('active',tab==='mold');
  document.getElementById('center-pane-crease').style.display=tab==='crease'?'flex':'none';
  document.getElementById('center-pane-mold').style.display=tab==='mold'?'flex':'none';
  document.getElementById('mold-sub-tabs').style.display=tab==='mold'?'flex':'none';
  if(tab==='crease') drawFlat();
  else { initMold3d(); drawMold3d(); }
}

function switchMoldTab(tab){
  currentMoldTab=tab;
  ['mountain','valley','both'].forEach(t=>document.getElementById('mtab-'+t).classList.toggle('active',t===tab));
  drawMold3d();
}

// ─── RIGHT PANEL: 3D Tube + Energy sub-panels ───
function toggleSubPanel(which){
  const sp=document.getElementById(which==='3d'?'sp3d':'spEnergy');
  const btn=document.getElementById(which==='3d'?'btn-tog-3d':'btn-tog-energy');
  const collapsed=sp.classList.toggle('collapsed');
  btn.textContent=collapsed?'▶':'▼';
  if(!collapsed){if(which==='3d'){init3d();draw3d();}else drawEnergy();}
}

function expandSubPanel(which){
  const sp=document.getElementById(which==='3d'?'sp3d':'spEnergy');
  const btn=document.getElementById(which==='3d'?'btn-exp-3d':'btn-exp-energy');
  const fsEl=document.fullscreenElement||document.webkitFullscreenElement;
  if(fsEl===sp){const exit=document.exitFullscreen||document.webkitExitFullscreen;if(exit)exit.call(document);return;}
  const req=sp.requestFullscreen||sp.webkitRequestFullscreen;
  if(!req)return;
  req.call(sp).then(()=>{
    btn.textContent='✕';
    const wrap=document.getElementById(which==='3d'?'wrap3d':'wrapEnergy');
    const ro=new ResizeObserver(()=>{ro.disconnect();if(which==='3d'){init3d();draw3d();}else drawEnergy();});
    ro.observe(wrap);
  }).catch(()=>{});
}

document.addEventListener('fullscreenchange',_fsChange);
document.addEventListener('webkitfullscreenchange',_fsChange);
function _fsChange(){
  if(!document.fullscreenElement&&!document.webkitFullscreenElement){
    const b3=document.getElementById('btn-exp-3d'),be=document.getElementById('btn-exp-energy');
    if(b3)b3.textContent='⛶'; if(be)be.textContent='⛶';
    setTimeout(()=>{init3d();draw3d();drawEnergy();},80);
  }
}

function drawPanel(){draw3d();drawEnergy();}

// ─── MOLD 3D PREVIEW ───
let moldRotX=0.3, moldRotY=0.5, moldDragging=false, moldLastMouse={x:0,y:0}, moldCamDist=null;

function initMold3d(){
  const canvas=document.getElementById('canvasMold');
  if(!canvas)return;
  const wrap=document.getElementById('center-pane-mold');
  const rect=wrap.getBoundingClientRect();
  const W=Math.max(100,Math.round(rect.width)||700);
  const H=Math.max(100,Math.round(rect.height)||500);
  canvas.width=W; canvas.height=H;
  canvas.onpointerdown=e=>{moldDragging=true;moldLastMouse={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);};
  canvas.onpointerup=canvas.onpointercancel=()=>moldDragging=false;
  canvas.onpointermove=e=>{
    if(!moldDragging)return;
    moldRotY+=(e.clientX-moldLastMouse.x)*0.012;
    moldRotX+=(e.clientY-moldLastMouse.y)*0.012;
    moldRotX=Math.max(-Math.PI/2,Math.min(Math.PI/2,moldRotX));
    moldLastMouse={x:e.clientX,y:e.clientY};
    drawMold3d();
  };
  canvas.addEventListener('wheel',e=>{
    e.preventDefault();
    const cur=moldCamDist||12;
    moldCamDist=e.deltaY>0?Math.min(cur*1.15,60):Math.max(cur*0.87,1);
    drawMold3d();
  },{passive:false});
  canvas.addEventListener('dblclick',()=>{moldCamDist=null;drawMold3d();});
}

function drawMold3d(){
  const canvas=document.getElementById('canvasMold');
  if(!canvas)return;
  const wrap=document.getElementById('center-pane-mold');
  if(wrap){
    const rect=wrap.getBoundingClientRect();
    const W2=Math.max(100,Math.round(rect.width)||700);
    const H2=Math.max(100,Math.round(rect.height)||500);
    if(canvas.width!==W2||canvas.height!==H2){canvas.width=W2;canvas.height=H2;}
  }
  const W=canvas.width||700, H=canvas.height||500;
  const ctx=canvas.getContext('2d');
  if(!ctx)return;
  ctx.fillStyle='#13151e'; ctx.fillRect(0,0,W,H);

  const p=getP(), g=computeGeometry(p);
  const{n,floors,ext,seaml,seamr,extcols,stack,chir,scale}=p;
  const{b,floor_h,dx}=g;
  const totalFloors=floors*stack;
  const col_min=-extcols, col_max=n+extcols, total_cols=col_max-col_min+1;
  const bounds=patternBounds(p,g);
  const scaledW=bounds.w*scale, scaledH=bounds.h*scale;
  const patOriginX=(A4_W-scaledW)/2, patOriginY=(A4_H-scaledH)/2;
  const baseT=(p.moldbase||3)/10;
  const ridgeH=(p.ridgeh||1.2)/10;
  const margin=0.2;

  const verts=[];
  for(let f=0;f<=totalFloors;f++){
    const row=[];
    for(let col=col_min;col<=col_max;col++){
      let x=col*b, y=f*floor_h;
      if(f%2===1) x+=dx*chir; else x-=dx*chir;
      row.push([(x-bounds.minX)*scale+patOriginX,(y-bounds.minY)*scale+patOriginY]);
    }
    verts.push(row);
  }
  const olIdx=extcols, orIdx=extcols+n;
  const[x0,y0]=verts[0][olIdx],[x1]=verts[0][orIdx];
  const[,y3]=verts[totalFloors][orIdx];
  const extS=ext*scale, seamlS=seaml*scale, seamrS=seamr*scale;
  const topY=y0-extS, botY=y3+extS;
  const seamLX=x0-seamlS, seamRX=x1+seamrS;

  const pw=seamRX-seamLX+margin*2, ph=botY-topY+margin*2;
  const px0=seamLX-margin, pz0=topY-margin;
  const cx_=px0+pw/2, cz_=pz0+ph/2;
  const moldGap=currentMoldTab==='both'?baseT*2+0.3:0;

  const cxr=Math.cos(moldRotX),sxr=Math.sin(moldRotX);
  const cyr=Math.cos(moldRotY),syr=Math.sin(moldRotY);
  function rotate([x,y,z]){
    const x1=x*cyr+z*syr, z1=-x*syr+z*cyr;
    const y2=y*cxr-z1*sxr, z2=y*sxr+z1*cxr;
    return[x1,y2,z2];
  }
  const modelDiag=Math.hypot(pw,ph,baseT+ridgeH)*0.8;
  const dist=moldCamDist||modelDiag*2.2+2;
  const fovScale=Math.min(W,H)/(1.6*dist);
  const cxc=W/2, cyc=H/2;
  function project([x,y,z]){
    const[rx,ry,rz]=rotate([x-cx_,y,z-cz_]);
    const zd=rz+dist;
    if(zd<=0.01)return null;
    const sc=fovScale*(dist/zd);
    return[cxc+rx*sc, cyc-ry*sc, zd];
  }

  const drawCalls=[];

  function addFace(pts3d, color, alpha){
    const pp=pts3d.map(project);
    if(pp.some(v=>!v))return;
    const avgZ=pp.reduce((a,v)=>a+v[2],0)/pp.length;
    drawCalls.push({type:'face',pp,color,alpha,z:avgZ});
  }
  function addLine(a3d,b3d,color,lw=1,dash=[]){
    const pa=project(a3d),pb=project(b3d);
    if(!pa||!pb)return;
    const z=(pa[2]+pb[2])/2;
    drawCalls.push({type:'line',pa,pb,color,lw,dash,z});
  }

  function drawMold(yOff, ridgeSegs, plateCol, ridgeCol, label){
    const yBot=yOff-baseT, yTop=yOff;
    const bx0=seamLX-margin, bx1=seamRX+margin;
    const bz0=topY-margin, bz1=botY+margin;

    const corners={
      tl0:[bx0,yBot,bz0],tr0:[bx1,yBot,bz0],tl1:[bx0,yBot,bz1],tr1:[bx1,yBot,bz1],
      bl0:[bx0,yTop,bz0],br0:[bx1,yTop,bz0],bl1:[bx0,yTop,bz1],br1:[bx1,yTop,bz1],
    };
    addFace([corners.bl0,corners.br0,corners.br1,corners.bl1],plateCol,0.82);
    addFace([corners.tl0,corners.tl1,corners.tr1,corners.tr0],plateCol,0.45);
    addFace([corners.tl0,corners.bl0,corners.bl1,corners.tl1],plateCol,0.55);
    addFace([corners.tr0,corners.tr1,corners.br1,corners.br0],plateCol,0.55);
    addFace([corners.tl0,corners.tr0,corners.br0,corners.bl0],plateCol,0.60);
    addFace([corners.tl1,corners.bl1,corners.br1,corners.tr1],plateCol,0.60);

    [[corners.bl0,corners.br0],[corners.br0,corners.br1],[corners.br1,corners.bl1],[corners.bl1,corners.bl0]].forEach(([a,b])=>addLine(a,b,'rgba(255,255,255,0.15)',0.8));

    for(const[[ax,ay],[bx_,by_]] of ridgeSegs){
      const a3=[ax,yTop,ay], b3=[bx_,yTop,by_];
      const ap=[ax,yTop+ridgeH,ay], bp=[bx_,yTop+ridgeH,by_];
      addFace([a3,b3,bp,ap],ridgeCol,0.85);
      addLine(ap,bp,ridgeCol,2);
      addLine(a3,ap,ridgeCol,1.2);
      addLine(b3,bp,ridgeCol,1.2);
    }

    const labelPt=project([cx_,yTop+ridgeH+0.2,cz_]);
    if(labelPt) drawCalls.push({type:'label',pt:labelPt,text:label,z:labelPt[2]});
  }

  const mountainSegs=[];
  for(let ci=1;ci<total_cols-1;ci++)
    for(let f=0;f<totalFloors;f++)
      mountainSegs.push([verts[f][ci],verts[f+1][ci]]);

  const valleySegs=[];
  for(let f=0;f<=totalFloors;f++) valleySegs.push([[seamLX,verts[f][0][1]],[seamRX,verts[f][0][1]]]);
  for(let f=0;f<totalFloors;f++)
    for(let ci=0;ci<total_cols-1;ci++){
      const v1=verts[f][ci],v2=verts[f+1][ci+1],v3=verts[f][ci+1],v4=verts[f+1][ci];
      const[a,bv]=(f*chir)%2===0?[v3,v4]:[v1,v2];
      valleySegs.push([a,bv]);
    }

  const plateBase='#2a3050', mtnRidge='#e05252', valRidge='#378ADD';

  if(currentMoldTab==='mountain'){
    drawMold(0, mountainSegs, plateBase, mtnRidge, 'Mountain mold');
  } else if(currentMoldTab==='valley'){
    drawMold(0, valleySegs, plateBase, valRidge, 'Valley mold');
  } else {
    drawMold(moldGap+baseT, mountainSegs, '#253040', mtnRidge, 'Mountain mold (top)');
    const py=moldGap/2;
    const paperAlpha=0.22;
    addFace([[seamLX-margin,py,topY-margin],[seamRX+margin,py,topY-margin],[seamRX+margin,py,botY+margin],[seamLX-margin,py,botY+margin]],'#ffffff',paperAlpha);
    addLine([seamLX-margin,py,topY-margin],[seamRX+margin,py,topY-margin],'rgba(255,255,255,0.3)',0.8);
    addLine([seamRX+margin,py,topY-margin],[seamRX+margin,py,botY+margin],'rgba(255,255,255,0.3)',0.8);
    addLine([seamRX+margin,py,botY+margin],[seamLX-margin,py,botY+margin],'rgba(255,255,255,0.3)',0.8);
    addLine([seamLX-margin,py,botY+margin],[seamLX-margin,py,topY-margin],'rgba(255,255,255,0.3)',0.8);
    const ppPt=project([cx_,py,cz_]);
    if(ppPt) drawCalls.push({type:'label',pt:ppPt,text:'paper',z:ppPt[2]});
    drawMold(0, valleySegs, '#253040', valRidge, 'Valley mold (bottom)');
  }

  drawCalls.sort((a,b)=>b.z-a.z);
  for(const dc of drawCalls){
    if(dc.type==='face'){
      ctx.beginPath();
      ctx.moveTo(dc.pp[0][0],dc.pp[0][1]);
      for(let i=1;i<dc.pp.length;i++) ctx.lineTo(dc.pp[i][0],dc.pp[i][1]);
      ctx.closePath();
      ctx.globalAlpha=dc.alpha;
      ctx.fillStyle=dc.color; ctx.fill();
      ctx.globalAlpha=1;
    } else if(dc.type==='line'){
      ctx.beginPath();
      ctx.moveTo(dc.pa[0],dc.pa[1]); ctx.lineTo(dc.pb[0],dc.pb[1]);
      ctx.strokeStyle=dc.color; ctx.lineWidth=dc.lw;
      ctx.setLineDash(dc.dash||[]); ctx.stroke(); ctx.setLineDash([]);
    } else if(dc.type==='label'){
      ctx.fillStyle='rgba(220,230,255,0.7)';
      ctx.font='10px "JetBrains Mono",monospace';
      ctx.textAlign='center'; ctx.textBaseline='bottom';
      ctx.fillText(dc.text,dc.pt[0],dc.pt[1]);
    }
  }

  ctx.globalAlpha=1;
  ctx.fillStyle='rgba(139,144,160,0.65)';
  ctx.font='9px "JetBrains Mono",monospace';
  ctx.textAlign='left'; ctx.textBaseline='alphabetic';
  ctx.fillText(`base=${p.moldbase}mm  ridge h=${p.ridgeh}mm  w=${p.ridgew}mm`,8,H-10);
  ctx.textAlign='right';
  ctx.fillText('drag=rotate  scroll=zoom  dbl=reset',W-8,H-10);
}

// ─── 3D PURE CANVAS RENDERER ───
function init3d(){
  const canvas=document.getElementById('canvas3d');
  if(!canvas)return;
  const wrap=document.getElementById('wrap3d');
  const rect=wrap.getBoundingClientRect();
  const W=Math.max(100,Math.round(rect.width)||wrap.offsetWidth||340);
  const H=Math.max(100,Math.round(rect.height)||wrap.offsetHeight||300);
  canvas.width=W; canvas.height=H;

  canvas.onpointerdown=e=>{isDragging=true;lastMouse={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);};
  canvas.onpointerup=canvas.onpointercancel=()=>isDragging=false;
  canvas.onpointermove=e=>{
    if(!isDragging)return;
    rotY+=(e.clientX-lastMouse.x)*0.012;
    rotX+=(e.clientY-lastMouse.y)*0.012;
    rotX=Math.max(-Math.PI/2,Math.min(Math.PI/2,rotX));
    lastMouse={x:e.clientX,y:e.clientY};
    draw3d();
  };
  canvas.addEventListener('wheel',e=>{
    e.preventDefault();
    const cur=cam3dDist||8;
    cam3dDist=e.deltaY>0?Math.min(cur*1.15,60):Math.max(cur*0.87,0.5);
    draw3d();
  },{passive:false});
  canvas.addEventListener('dblclick',()=>{cam3dDist=null;draw3d();});
}

function draw3d(){
  const canvas=document.getElementById('canvas3d');
  if(!canvas)return;
  const W=canvas.width||340, H=canvas.height||300;
  const ctx=canvas.getContext('2d');
  if(!ctx)return;
  ctx.fillStyle='#13151e'; ctx.fillRect(0,0,W,H);

  const p=getP(), g=computeGeometry(p);
  const{n,floors,stack,chir,compress}=p, {floor_h,dx,R}=g;
  const totalFloors=floors*stack;
  const eFH=floor_h*(1-compress*0.98);
  const eDx=dx*(1-compress*0.5);

  const rings=[];
  for(let f=0;f<=totalFloors;f++){
    const row=[];
    const y3d=f*eFH-(totalFloors*eFH/2);
    const ang=(f%2===1)?(eDx/R)*chir:-(eDx/R)*chir;
    for(let k=0;k<n;k++){
      const a=(2*Math.PI*k/n)+ang;
      row.push([R*Math.cos(a), y3d, R*Math.sin(a)]);
    }
    rings.push(row);
  }

  const cx=Math.cos(rotX),sx=Math.sin(rotX);
  const cy=Math.cos(rotY),sy=Math.sin(rotY);
  function rotate([x,y,z]){
    const x1=x*cy+z*sy, z1=-x*sy+z*cy;
    const y2=y*cx-z1*sx, z2=y*sx+z1*cx;
    return [x1,y2,z2];
  }

  const modelH=totalFloors*eFH;
  const modelSpan=Math.max(R*2,modelH)*1.8;
  const dist=cam3dDist||modelSpan+2;

  const fov=0.8;
  const cx2=W/2, cy2=H/2;
  const scale=Math.min(W,H)/(2*fov*dist);

  function project(pt){
    const[x,y,z]=rotate(pt);
    const zd=z+dist;
    if(zd<=0.01)return null;
    const sc=scale*(dist/zd);
    return[cx2+x*sc, cy2-y*sc, zd];
  }

  const segs=[];

  for(let f=0;f<totalFloors;f++){
    for(let k=0;k<n;k++){
      const k2=(k+1)%n;
      const v1=rings[f][k], v2=rings[f][k2];
      const v3=rings[f+1][k], v4=rings[f+1][k2];

      segs.push({type:'blue', pts:[v1,v2]});
      segs.push({type:'red', pts:[v1,v3]});
      const gv=(f*chir)%2===0?[v2,v3]:[v1,v4];
      segs.push({type:'green', pts:gv});
      segs.push({type:'face', pts:[v1,v2,v4,v3]});
    }
  }
  for(let k=0;k<n;k++) segs.push({type:'blue', pts:[rings[totalFloors][k],rings[totalFloors][(k+1)%n]]});

  const projected=segs.map(s=>{
    const pp=s.pts.map(project);
    if(pp.some(x=>!x))return null;
    const avgZ=pp.reduce((a,p)=>a+p[2],0)/pp.length;
    return{...s,pp,avgZ};
  }).filter(Boolean);

  projected.sort((a,b)=>b.avgZ-a.avgZ);

  for(const seg of projected){
    const{type,pp}=seg;
    ctx.beginPath();
    if(type==='face'){
      ctx.moveTo(pp[0][0],pp[0][1]);
      for(let i=1;i<pp.length;i++) ctx.lineTo(pp[i][0],pp[i][1]);
      ctx.closePath();
      ctx.fillStyle='rgba(40,80,180,0.10)';
      ctx.fill();
      continue;
    }
    ctx.moveTo(pp[0][0],pp[0][1]);
    for(let i=1;i<pp.length;i++) ctx.lineTo(pp[i][0],pp[i][1]);
    if(type==='blue'){ctx.strokeStyle='#378ADD';ctx.lineWidth=1.3;ctx.setLineDash([]);}
    else if(type==='red'){ctx.strokeStyle='#e05252';ctx.lineWidth=1.2;ctx.setLineDash([]);}
    else{ctx.strokeStyle='#3dba6e';ctx.lineWidth=1.0;ctx.setLineDash([4,3]);}
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.fillStyle='rgba(139,144,160,0.7)';
  ctx.font='10px "JetBrains Mono",monospace';
  ctx.textAlign='left';
  ctx.fillText(`n=${n}  f=${totalFloors}  ⌀${(R*2).toFixed(1)}cm  h=${(totalFloors*eFH).toFixed(1)}cm`,8,H-10);
  ctx.textAlign='right';
  ctx.fillText('drag=rotate  scroll=zoom  dbl=reset',W-8,H-10);
}

// ─── ENERGY GRAPH ───
function drawEnergy(){
  const canvas=document.getElementById('canvasEnergy');
  const wrap=canvas.parentElement;
  const rect=wrap.getBoundingClientRect();
  const W=Math.max(200,Math.round(rect.width)||340);
  const H=Math.max(200,Math.round(rect.height)||400);
  canvas.width=W;canvas.height=H;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#1a1d28';ctx.fillRect(0,0,W,H);

  const p=getP(),g=computeGeometry(p);
  const{n,floors,stack,angle}=p;
  const{floor_h,R,b,dx}=g;
  const totalFloors=floors*stack;

  const L_g0 = g.green_len;
  const L_r0 = g.red_len;

  const h_max = L_r0 * 0.999;
  const h_min = L_r0 * 0.02;

  const STEPS = 400;
  const energyPoints=[], heightPoints=[];

  function getDihedral(h){
    if(h<=0||h>=L_r0)return null;
    const dxH=Math.sqrt(Math.max(0,L_r0*L_r0-h*h));
    const L_g_check=Math.sqrt((b+2*dxH)*(b+2*dxH)+h*h);
    const phi=dxH/R;
    const alpha=Math.PI/n;

    const vsub=([ax,ay,az],[bx,by,bz])=>[ax-bx,ay-by,az-bz];
    const vcross=([ax,ay,az],[bx,by,bz])=>[ay*bz-az*by, az*bx-ax*bz, ax*by-ay*bx];
    const vdot=([ax,ay,az],[bx,by,bz])=>ax*bx+ay*by+az*bz;
    const vnorm=v=>{const l=Math.hypot(...v)||1;return v.map(x=>x/l);};

    const A=[R, 0, 0];
    const B=[R*Math.cos(2*alpha), R*Math.sin(2*alpha), 0];
    const C=[R*Math.cos(phi)*Math.cos(alpha)-R*Math.sin(phi)*Math.sin(alpha),
             R*Math.cos(phi)*Math.sin(alpha)+R*Math.sin(phi)*Math.cos(alpha), h];
    const D=[R*Math.cos(phi+2*alpha), R*Math.sin(phi+2*alpha), h];

    const n1=vnorm(vcross(vsub(B,A),vsub(C,A)));
    const n2=vnorm(vcross(vsub(C,A),vsub(D,A)));
    const psi_m=Math.acos(Math.max(-1,Math.min(1,vdot(n1,n2))));
    const n3=vnorm(vcross(vsub(C,B),vsub(A,B)));
    const psi_v=Math.acos(Math.max(-1,Math.min(1,-vdot(n1,n3))));
    return{psi_m,psi_v,dxH,L_g:L_g_check};
  }

  const restAngles=getDihedral(floor_h);
  if(!restAngles){ctx.fillStyle='#f87171';ctx.font='12px monospace';ctx.fillText('Cannot compute energy: invalid geometry',20,H/2);return;}
  const{psi_m:psi_m0,psi_v:psi_v0}=restAngles;

  const k_m=2.0,k_v=1.0;
  let minE=Infinity,maxE=-Infinity;

  for(let i=0;i<=STEPS;i++){
    const h=h_min+(i/STEPS)*(h_max-h_min);
    const angles=getDihedral(h);
    if(!angles){energyPoints.push(0);heightPoints.push(h*totalFloors);continue;}
    const{psi_m,psi_v}=angles;
    const dm=psi_m-psi_m0,dv=psi_v-psi_v0;
    const E=(k_m*dm*dm+k_v*dv*dv)*n*totalFloors;
    energyPoints.push(E);
    heightPoints.push(h*totalFloors);
    if(E<minE)minE=E;if(E>maxE)maxE=E;
  }

  const localMinima=[];
  const WINDOW=8;
  for(let i=WINDOW;i<energyPoints.length-WINDOW;i++){
    let isMin=true;
    for(let j=i-WINDOW;j<=i+WINDOW;j++){if(j!==i&&energyPoints[j]<=energyPoints[i]){isMin=false;break;}}
    if(isMin)localMinima.push({idx:i,h:heightPoints[i],E:energyPoints[i]});
  }
  const mergedMinima=[];
  let lastH=-Infinity;
  for(const m of localMinima){
    if(m.h-lastH>(h_max-h_min)*totalFloors*0.05){mergedMinima.push(m);lastH=m.h;}
  }

  const endpointMinima=[];
  if(energyPoints[0]<energyPoints[WINDOW])endpointMinima.push({idx:0,h:heightPoints[0],E:energyPoints[0],label:'Collapsed'});
  if(energyPoints[STEPS]<energyPoints[STEPS-WINDOW])endpointMinima.push({idx:STEPS,h:heightPoints[STEPS],E:energyPoints[STEPS],label:'Extended'});

  const allMinima=[...endpointMinima,...mergedMinima];
  const trulBistable=mergedMinima.length>=1&&(endpointMinima.length>=1||mergedMinima.length>=2);
  const geomBistable=g.bistable;
  const isBistable=trulBistable&&geomBistable;

  const PAD={l:52,r:16,t:36,b:48};
  const gW=W-PAD.l-PAD.r,gH=H-PAD.t-PAD.b;
  const totalH_max=heightPoints[STEPS],totalH_min=heightPoints[0];
  function toX(h){return PAD.l+(h-totalH_min)/(totalH_max-totalH_min+1e-9)*gW;}
  function toY(E){return PAD.t+gH-((E-minE)/(maxE-minE+1e-9))*gH;}

  ctx.strokeStyle='rgba(59,130,246,0.1)';ctx.lineWidth=0.5;
  for(let i=0;i<=4;i++){const y=PAD.t+i*(gH/4);ctx.beginPath();ctx.moveTo(PAD.l,y);ctx.lineTo(PAD.l+gW,y);ctx.stroke();}
  for(let i=0;i<=5;i++){const x=PAD.l+i*(gW/5);ctx.beginPath();ctx.moveTo(x,PAD.t);ctx.lineTo(x,PAD.t+gH);ctx.stroke();}

  ctx.strokeStyle='rgba(180,200,255,0.45)';ctx.lineWidth=1.2;
  ctx.beginPath();ctx.moveTo(PAD.l,PAD.t);ctx.lineTo(PAD.l,PAD.t+gH);ctx.lineTo(PAD.l+gW,PAD.t+gH);ctx.stroke();

  ctx.fillStyle='rgba(139,144,160,0.9)';ctx.font='10px "JetBrains Mono",monospace';ctx.textAlign='center';
  ctx.fillText('Total height (cm)',PAD.l+gW/2,H-6);
  ctx.save();ctx.translate(11,PAD.t+gH/2);ctx.rotate(-Math.PI/2);ctx.fillText('Energy (a.u.)',0,0);ctx.restore();
  ctx.textAlign='center';ctx.font='9px "JetBrains Mono",monospace';
  for(let i=0;i<=5;i++){const h=totalH_min+(i/5)*(totalH_max-totalH_min);ctx.fillStyle='rgba(139,144,160,0.7)';ctx.fillText(h.toFixed(1),toX(h),PAD.t+gH+13);}
  ctx.textAlign='right';
  for(let i=0;i<=4;i++){const E=minE+(1-i/4)*(maxE-minE);const y=PAD.t+(i/4)*gH;ctx.fillStyle='rgba(139,144,160,0.6)';ctx.fillText(E.toFixed(3),PAD.l-4,y+3);}

  ctx.beginPath();ctx.moveTo(toX(heightPoints[0]),PAD.t+gH);
  for(let i=0;i<=STEPS;i++)ctx.lineTo(toX(heightPoints[i]),toY(energyPoints[i]));
  ctx.lineTo(toX(heightPoints[STEPS]),PAD.t+gH);ctx.closePath();
  ctx.fillStyle='rgba(59,130,246,0.07)';ctx.fill();

  ctx.beginPath();
  for(let i=0;i<=STEPS;i++){const x=toX(heightPoints[i]),y=toY(energyPoints[i]);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);}
  ctx.strokeStyle='#378ADD';ctx.lineWidth=2;ctx.setLineDash([]);ctx.stroke();

  const designedH=floor_h*totalFloors;
  const dX=toX(designedH);
  ctx.beginPath();ctx.moveTo(dX,PAD.t);ctx.lineTo(dX,PAD.t+gH);
  ctx.strokeStyle='rgba(160,160,200,0.3)';ctx.lineWidth=1;ctx.setLineDash([4,3]);ctx.stroke();ctx.setLineDash([]);

  const eqColors=['#4ade80','#fbbf24','#a78bfa','#f87171'];
  allMinima.forEach((eq,idx)=>{
    const x=toX(eq.h),y=toY(eq.E);
    ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);
    ctx.fillStyle=eqColors[idx%eqColors.length];ctx.fill();
    ctx.strokeStyle='#1a1d28';ctx.lineWidth=1.5;ctx.stroke();
    ctx.beginPath();ctx.moveTo(x,y+5);ctx.lineTo(x,PAD.t+gH);
    ctx.strokeStyle=eqColors[idx%eqColors.length];ctx.lineWidth=0.7;ctx.setLineDash([2,3]);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle=eqColors[idx%eqColors.length];ctx.font='9px "JetBrains Mono",monospace';ctx.textAlign='center';
    const lbl=eq.label||(idx===0?'Eq.A':'Eq.B');
    ctx.fillText(lbl,x,y-8);ctx.fillText(eq.h.toFixed(1)+'cm',x,y-18);
  });

  const curH=(1-p.compress)*(designedH-h_min*totalFloors)+h_min*totalFloors;
  const curIdx=Math.round((curH-totalH_min)/(totalH_max-totalH_min)*STEPS);
  const curE=energyPoints[Math.max(0,Math.min(STEPS,curIdx))];
  const cx2=toX(curH),cy2=toY(curE);
  ctx.beginPath();ctx.arc(cx2,cy2,6,0,Math.PI*2);ctx.fillStyle='#ef4444';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();
  ctx.fillStyle='#f87171';ctx.font='9px "JetBrains Mono",monospace';ctx.textAlign='left';
  if(cx2+80>W-PAD.r)ctx.textAlign='right';
  ctx.fillText(`h=${curH.toFixed(2)}`,cx2+(cx2+80>W-PAD.r?-8:8),cy2-3);
  ctx.fillText(`E=${curE.toFixed(4)}`,cx2+(cx2+80>W-PAD.r?-8:8),cy2+9);

  ctx.fillStyle='rgba(224,234,240,0.8)';ctx.font='10px "JetBrains Mono",monospace';ctx.textAlign='left';
  ctx.fillText(`n=${n}  floors=${floors}×${stack}  dia=${p.dia}cm`,PAD.l,PAD.t-18);
  if(isBistable){
    ctx.fillStyle='#4ade80';ctx.font='9px "JetBrains Mono",monospace';ctx.textAlign='right';
    ctx.fillText('BISTABLE — two energy wells',PAD.l+gW,PAD.t-18);
  } else {
    ctx.fillStyle='rgba(139,144,160,0.7)';ctx.font='9px "JetBrains Mono",monospace';ctx.textAlign='right';
    ctx.fillText('monostable',PAD.l+gW,PAD.t-18);
  }

  if(energyHoverX !== null){
    const hx = energyHoverX;
    if(hx >= PAD.l && hx <= PAD.l+gW){
      const hoverH = totalH_min + ((hx-PAD.l)/gW)*(totalH_max-totalH_min);
      const hoverIdx = Math.round((hoverH-totalH_min)/(totalH_max-totalH_min+1e-9)*STEPS);
      const clampIdx = Math.max(0,Math.min(STEPS,hoverIdx));
      const hoverE = energyPoints[clampIdx];
      const hoverHActual = heightPoints[clampIdx];
      const hy = toY(hoverE);

      ctx.save();
      ctx.beginPath();ctx.moveTo(hx,PAD.t);ctx.lineTo(hx,PAD.t+gH);
      ctx.strokeStyle='rgba(255,255,255,0.35)';ctx.lineWidth=1;ctx.setLineDash([4,3]);ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();ctx.moveTo(PAD.l,hy);ctx.lineTo(PAD.l+gW,hy);
      ctx.strokeStyle='rgba(255,255,255,0.2)';ctx.lineWidth=0.8;ctx.setLineDash([4,3]);ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();ctx.arc(hx,hy,4,0,Math.PI*2);
      ctx.fillStyle='#facc15';ctx.fill();
      ctx.strokeStyle='#1a1d28';ctx.lineWidth=1.5;ctx.stroke();

      const lines=[
        `h = ${hoverHActual.toFixed(3)} cm`,
        `E = ${hoverE.toFixed(5)}`,
        `h/H = ${(hoverHActual/(floor_h*totalFloors)).toFixed(3)}`,
      ];
      const tfs=9, tlh=tfs+3, tPad=6;
      const tW=120, tH=lines.length*tlh+tPad*2;
      let tx=hx+10, ty=hy-tH/2;
      if(tx+tW>PAD.l+gW) tx=hx-tW-10;
      if(ty<PAD.t) ty=PAD.t;
      if(ty+tH>PAD.t+gH) ty=PAD.t+gH-tH;

      ctx.fillStyle='rgba(20,22,35,0.92)';
      ctx.strokeStyle='rgba(250,204,21,0.6)';
      ctx.lineWidth=1;
      ctx.beginPath();
      ctx.roundRect?ctx.roundRect(tx,ty,tW,tH,4):ctx.rect(tx,ty,tW,tH);
      ctx.fill();ctx.stroke();

      ctx.fillStyle='#facc15';
      ctx.font=`${tfs}px "JetBrains Mono",monospace`;
      ctx.textAlign='left';ctx.textBaseline='top';
      lines.forEach((l,i)=>ctx.fillText(l, tx+tPad, ty+tPad+i*tlh));
      ctx.textBaseline='alphabetic';
      ctx.restore();
    }
  }
}

function draw(){
  if(currentCenterTab==='crease') drawFlat();
  else { if(document.getElementById('center-pane-mold').offsetParent!==null) drawMold3d(); }
  drawPanel();
}

// ─── ENERGY HOVER STATE ───
let energyHoverX = null;

// ─── INFO BOX HELPERS ───
function infoBoxLines(p, g, bounds){
  const patW=(bounds.w*p.scale).toFixed(2);
  const patH=(bounds.h*p.scale).toFixed(2);
  const totalLen=(p.dia*Math.PI).toFixed(3);
  const left=[
    `Floor height: ${g.floor_h.toFixed(2)} cm`,
    `One side: ${g.b.toFixed(3)} cm`,
    `Red line: ${g.red_len.toFixed(2)} cm`,
    `Blue-Red Angle: ${p.angle.toFixed(1)}\u00b0`,
    `Green-Red angle: ${g.gr_angle.toFixed(2)}\u00b0`,
    `h0/R: ${g.h0r.toFixed(4)}`,
    `Bistable: ${g.bistable?'yes':'no'}`,
  ];
  const right=[
    `Diameter: ${p.dia.toFixed(2)} cm`,
    `Height: ${p.height.toFixed(2)} cm`,
    `Total length ${totalLen} cm`,
    `Floors: ${p.floors}`,
    `Sides: ${p.n}`,
    `Stack: \u00d7${p.stack}`,
    `Scale: ${(p.scale*100).toFixed(0)}%`,
  ];
  return{left,right};
}

function drawInfoBoxCanvas(ctx, toC, sc, x0, x1, gapHiCm, gapLoCm, p, g, bounds, forPrint){
  const{left,right}=infoBoxLines(p,g,bounds);
  const lineCount=Math.max(left.length,right.length);

  const[px0, cy_hi]=toC(x0, gapHiCm);
  const[px1, cy_lo]=toC(x1, gapLoCm);
  const rectTop=Math.min(cy_hi, cy_lo);
  const rectBot=Math.max(cy_hi, cy_lo);
  const gapH=rectBot-rectTop;
  const gapW=px1-px0;
  if(gapH<4||gapW<20)return;

  const padPx=Math.max(2, Math.round(gapH*0.06));
  const availH=gapH-padPx*2;
  let fs=Math.floor(availH/lineCount)-2;
  fs=Math.max(5, Math.min(11, fs));
  const lh=Math.floor(availH/lineCount);
  const totalTextH=lineCount*lh;
  const startY=rectTop+padPx+Math.floor((availH-totalTextH)/2)+fs;

  ctx.save();
  ctx.font=`${fs}px "Courier New",Courier,monospace`;
  ctx.textBaseline='alphabetic';
  ctx.fillStyle=forPrint?'#111111':'rgba(200,220,255,0.85)';
  ctx.textAlign='left';
  left.forEach((t,i)=>ctx.fillText(t, px0+padPx+2, startY+i*lh));
  ctx.textAlign='right';
  right.forEach((t,i)=>ctx.fillText(t, px1-padPx-2, startY+i*lh));
  ctx.textAlign='left';
  ctx.restore();
}

function infoBoxSVGText(p, g, bounds, CM, olX, orX, topYsvg, botYsvg, lastCreaseYsvg){
  const{left,right}=infoBoxLines(p,g,bounds);
  const lineCount=Math.max(left.length,right.length);
  const gapTop=lastCreaseYsvg;
  const gapBot=botYsvg;
  const gapH=gapBot-gapTop;
  const gapW=orX-olX;
  if(gapH<4||gapW<20)return '';
  const padPx=Math.max(2, Math.round(gapH*0.06));
  const availH=gapH-padPx*2;
  let fs=Math.floor(availH/lineCount)-2;
  fs=Math.max(5, Math.min(11, fs));
  const lh=Math.floor(availH/lineCount);
  const totalH=lineCount*lh;
  const startY=gapTop+padPx+Math.floor((availH-totalH)/2)+fs;

  let out='';
  out+=`<g font-family="'Courier New',Courier,monospace" font-size="${fs}" fill="#111111">\n`;
  left.forEach((t,i)=>{
    out+=`<text x="${(olX+padPx+2).toFixed(1)}" y="${(startY+i*lh).toFixed(1)}">${escSVG(t)}</text>\n`;
  });
  right.forEach((t,i)=>{
    out+=`<text x="${(orX-padPx-2).toFixed(1)}" y="${(startY+i*lh).toFixed(1)}" text-anchor="end">${escSVG(t)}</text>\n`;
  });
  out+=`</g>\n`;
  return out;
}
function escSVG(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

// ─── SHARED RENDER TO CANVAS ───
function renderPatternToCtx(ctx, p, g, W, H, sc, ox, oy, forPrint){
  const{n,floors,ext,seaml,seamr,extcols,stack,showmv,chir,scale,showA4,showGrid}=p;
  const{b,floor_h,dx}=g;
  const col_min=-extcols,col_max=n+extcols,total_cols=col_max-col_min+1;
  const totalFloors=floors*stack;
  const bounds=patternBounds(p,g);
  const scaledPatW=bounds.w*scale,scaledPatH=bounds.h*scale;
  const patOriginX=(A4_W-scaledPatW)/2;
  const patOriginY=(A4_H-scaledPatH)/2;

  function toC(xcm,ycm){return[ox+xcm*sc, oy+(A4_H-ycm)*sc];}

  if(!forPrint){
    const[a4x,a4y]=toC(0,A4_H),[a4x2,a4y2]=toC(A4_W,0);
    if(showGrid){
      ctx.save();ctx.strokeStyle='rgba(59,130,246,0.07)';ctx.lineWidth=0.5;
      for(let x=0;x<=A4_W;x++){const[cx,cy]=toC(x,0),[cx2,cy2]=toC(x,A4_H);ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx2,cy2);ctx.stroke();}
      for(let y=0;y<=A4_H;y++){const[cx,cy]=toC(0,y),[cx2,cy2]=toC(A4_W,y);ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx2,cy2);ctx.stroke();}
      ctx.restore();
    }
    ctx.fillStyle='rgba(0,0,0,0.25)';
    ctx.fillRect(0,0,W,a4y);ctx.fillRect(0,a4y2,W,H-a4y2);
    ctx.fillRect(0,a4y,a4x,a4y2-a4y);ctx.fillRect(a4x2,a4y,W-a4x2,a4y2-a4y);
    if(showA4){
      ctx.save();ctx.strokeStyle='rgba(200,200,220,0.5)';ctx.lineWidth=1.2;ctx.setLineDash([6,4]);
      ctx.strokeRect(a4x,a4y,a4x2-a4x,a4y2-a4y);ctx.setLineDash([]);
      ctx.fillStyle='rgba(200,200,220,0.4)';ctx.font='10px "JetBrains Mono",monospace';
      ctx.fillText('A4  21×29.7 cm',a4x+4,a4y+12);ctx.restore();
    }
  }

  const verts=[];
  for(let f=0;f<=totalFloors;f++){
    const row=[];
    for(let col=col_min;col<=col_max;col++){
      let x=col*b,y=f*floor_h;
      if(f%2===1)x+=dx*chir;else x-=dx*chir;
      const nx=(x-bounds.minX)*scale+patOriginX;
      const ny=(y-bounds.minY)*scale+patOriginY;
      row.push([nx,ny]);
    }
    verts.push(row);
  }

  const olIdx=extcols,orIdx=extcols+n;
  const[x0,y0]=verts[0][olIdx],[x1]=verts[0][orIdx];
  const[x2]=verts[totalFloors][olIdx],[x3,y3]=verts[totalFloors][orIdx];
  const extS=ext*scale,seamlS=seaml*scale,seamrS=seamr*scale;
  const topY=y0-extS,botY=y3+extS;
  const seamLX=x0-seamlS,seamRX=x1+seamrS;

  const lw=forPrint?sc/37.795:1;

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
  const rPts=Array.from({length:totalFloors+1},(_,f)=>verts[f][orIdx]);
  ctx.beginPath();rPts.forEach(([vx,vy],i)=>{const[cx,cy]=toC(vx,vy);i===0?ctx.moveTo(cx,cy):ctx.lineTo(cx,cy);});
  ctx.strokeStyle=redCol;ctx.lineWidth=(forPrint?1.6:1.1)*lw;ctx.setLineDash([5*lw,3*lw]);ctx.stroke();ctx.setLineDash([]);
  const lPts=Array.from({length:totalFloors+1},(_,f)=>verts[f][olIdx]);
  ctx.beginPath();lPts.forEach(([vx,vy],i)=>{const[cx,cy]=toC(vx,vy);i===0?ctx.moveTo(cx,cy):ctx.lineTo(cx,cy);});
  ctx.strokeStyle=redCol;ctx.lineWidth=(forPrint?1.6:1.1)*lw;ctx.setLineDash([5*lw,3*lw]);ctx.stroke();ctx.setLineDash([]);

  const blueCol=forPrint?'#0044cc':'#378ADD';
  for(let f=0;f<=totalFloors;f++){
    const yL=verts[f][0][1];
    const[lx,ly]=toC(seamLX,yL),[rx,ry]=toC(seamRX,yL);
    ctx.beginPath();ctx.moveTo(lx,ly);ctx.lineTo(rx,ry);ctx.strokeStyle=blueCol;ctx.lineWidth=(forPrint?2.0:1.3)*lw;ctx.setLineDash([]);ctx.stroke();
  }

  const greenCol=forPrint?'#007a30':'#3dba6e';
  ctx.strokeStyle=greenCol;ctx.lineWidth=(forPrint?1.5:1.0)*lw;ctx.setLineDash([5*lw,4*lw]);
  for(let f=0;f<totalFloors;f++){
    for(let ci=0;ci<total_cols-1;ci++){
      const v1=verts[f][ci],v2=verts[f+1][ci+1],v3=verts[f][ci+1],v4=verts[f+1][ci];
      const[ax2,ay2,bx2,by2]=(f*chir)%2===0?[v3[0],v3[1],v4[0],v4[1]]:[v1[0],v1[1],v2[0],v2[1]];
      const[px1c,py1c]=toC(ax2,ay2),[px2c,py2c]=toC(bx2,by2);
      ctx.beginPath();ctx.moveTo(px1c,py1c);ctx.lineTo(px2c,py2c);ctx.stroke();
    }
  }
  ctx.setLineDash([]);

  if(!forPrint){
    ctx.save();ctx.fillStyle='rgba(180,220,255,0.55)';ctx.font='9px "JetBrains Mono",monospace';
    const[lx0,ly0]=toC(x0-seamlS,topY-0.3),[rx0]=toC(x1+seamrS,topY-0.3);
    ctx.fillText(`W=${(bounds.w*scale).toFixed(1)}cm`,(lx0+rx0)/2-18,ly0-3);
    const[hx0,hy0]=toC(x1+seamrS+0.25,botY),[,hy1]=toC(x1+seamrS+0.25,topY);
    ctx.fillText(`H=${(bounds.h*scale).toFixed(1)}cm`,hx0+3,(hy0+hy1)/2);ctx.restore();
  }
}

// ─── EXPORTS ───
function exportSVG(){
  const p=getP(),g=computeGeometry(p);
  const{n,floors,ext,seaml,seamr,extcols,stack,chir,scale}=p;
  const{b,floor_h,dx}=g;
  const CM=37.795;
  const totalFloors=floors*stack;
  const col_min=-extcols,col_max=n+extcols,total_cols=col_max-col_min+1;
  const bounds=patternBounds(p,g);
  const scaledW=bounds.w*scale,scaledH=bounds.h*scale;
  const patOriginX=(A4_W-scaledW)/2,patOriginY=(A4_H-scaledH)/2;
  const A4pxW=Math.round(A4_W*CM),A4pxH=Math.round(A4_H*CM);

  function toSVG(xcm,ycm){return[xcm*CM,(A4_H-ycm)*CM];}

  const verts=[];
  for(let f=0;f<=totalFloors;f++){
    const row=[];
    for(let col=col_min;col<=col_max;col++){
      let x=col*b,y=f*floor_h;
      if(f%2===1)x+=dx*chir;else x-=dx*chir;
      row.push([(x-bounds.minX)*scale+patOriginX,(y-bounds.minY)*scale+patOriginY]);
    }
    verts.push(row);
  }

  const olIdx=extcols,orIdx=extcols+n;
  const[x0,y0]=verts[0][olIdx],[x1]=verts[0][orIdx];
  const[x2]=verts[totalFloors][olIdx],[x3,y3]=verts[totalFloors][orIdx];
  const extS=ext*scale,seamlS=seaml*scale,seamrS=seamr*scale;
  const topY=y0-extS,botY=y3+extS;
  const seamLX=x0-seamlS,seamRX=x1+seamrS;

  const L=(ax,ay,bx,by,col,sw,dash)=>{
    const[x1s,y1s]=toSVG(ax,ay),[x2s,y2s]=toSVG(bx,by);
    return `<line x1="${x1s.toFixed(2)}" y1="${y1s.toFixed(2)}" x2="${x2s.toFixed(2)}" y2="${y2s.toFixed(2)}" stroke="${col}" stroke-width="${sw||1}"${dash?` stroke-dasharray="${dash}"`:''} fill="none"/>`;
  };
  let lines=[];
  lines.push(L(x0,topY,x0,botY,'#6a1fa0',2.5));lines.push(L(x1,topY,x1,botY,'#6a1fa0',2.5));
  lines.push(L(x0,topY,x1,topY,'#6a1fa0',2.5));lines.push(L(x2,botY,x3,botY,'#6a1fa0',2.5));
  if(seamlS>0){lines.push(L(seamLX,topY,seamLX,botY,'#3535aa',1.8,'4 3'));[topY,botY,y0,verts[totalFloors][olIdx][1]].forEach(yy=>lines.push(L(seamLX,yy,x0,yy,'#3535aa',1.8,'4 3')));}
  if(seamrS>0){lines.push(L(seamRX,topY,seamRX,botY,'#3535aa',1.8,'4 3'));[topY,botY,verts[0][orIdx][1],verts[totalFloors][orIdx][1]].forEach(yy=>lines.push(L(x1,yy,seamRX,yy,'#3535aa',1.8,'4 3')));}
  for(let ci=1;ci<total_cols-1;ci++){
    const pts=Array.from({length:totalFloors+1},(_,f)=>verts[f][ci]);
    const[sx,sy]=toSVG(pts[0][0],pts[0][1]);
    let d=`M${sx.toFixed(2)},${sy.toFixed(2)}`;
    for(let f=1;f<=totalFloors;f++){const[lx,ly]=toSVG(pts[f][0],pts[f][1]);d+=` L${lx.toFixed(2)},${ly.toFixed(2)}`;}
    lines.push(`<path d="${d}" stroke="#cc0000" stroke-width="2.0" fill="none"/>`);
  }
  [verts.map((_,f)=>verts[f][orIdx]),verts.map((_,f)=>verts[f][olIdx])].forEach(pts=>{
    const svgPts=pts.map(([cx,cy])=>{const[sx,sy]=toSVG(cx,cy);return`${sx.toFixed(2)},${sy.toFixed(2)}`;}).join(' ');
    lines.push(`<polyline points="${svgPts}" stroke="#cc0000" stroke-width="1.6" stroke-dasharray="5 3" fill="none"/>`);
  });
  for(let f=0;f<=totalFloors;f++){
    const yL=verts[f][0][1];
    const[lx,ly]=toSVG(seamLX,yL),[rx,ry]=toSVG(seamRX,yL);
    lines.push(`<line x1="${lx.toFixed(2)}" y1="${ly.toFixed(2)}" x2="${rx.toFixed(2)}" y2="${ry.toFixed(2)}" stroke="#0044cc" stroke-width="2.0" fill="none"/>`);
  }
  for(let f=0;f<totalFloors;f++){
    for(let ci=0;ci<total_cols-1;ci++){
      const v1=verts[f][ci],v2=verts[f+1][ci+1],v3=verts[f][ci+1],v4=verts[f+1][ci];
      const[ax,ay,bxv,byv]=(f*chir)%2===0?[v3[0],v3[1],v4[0],v4[1]]:[v1[0],v1[1],v2[0],v2[1]];
      lines.push(L(ax,ay,bxv,byv,'#007a30',1.5,'6 4'));
    }
  }
  const[olX]=toSVG(x0,0),[orX]=toSVG(x1,0);
  const[,gapTopSVG]=toSVG(0,y0);
  const[,gapBotSVG]=toSVG(0,topY);
  lines.push(infoBoxSVGText(p,g,bounds,CM,olX,orX,null,gapBotSVG,gapTopSVG));

  const svg=`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="${A4pxW}" height="${A4pxH}" viewBox="0 0 ${A4pxW} ${A4pxH}"><rect width="100%" height="100%" fill="white"/>\n${lines.join('\n')}\n</svg>`;
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
  a.download=`kresling_n${p.n}_f${p.floors}_s${p.stack}.svg`;a.click();
}

function exportPNGA4(){
  const p=getP(),g=computeGeometry(p);
  const DPI=200,CM_TO_PX=DPI/2.54;
  const W=Math.round(A4_W*CM_TO_PX),H=Math.round(A4_H*CM_TO_PX);
  const off=document.createElement('canvas');off.width=W;off.height=H;
  const ctx=off.getContext('2d');
  ctx.fillStyle='white';ctx.fillRect(0,0,W,H);
  renderPatternToCtx(ctx, p, g, W, H, CM_TO_PX, 0, 0, true);
  const a=document.createElement('a');a.href=off.toDataURL('image/png');
  a.download=`kresling_A4_n${p.n}_f${p.floors}.png`;a.click();
}

function exportPDF(){
  const p=getP(),g=computeGeometry(p);
  const DPI=96,CM=DPI/2.54;
  const A4pxW=Math.round(A4_W*CM),A4pxH=Math.round(A4_H*CM);
  const{n,floors,ext,seaml,seamr,extcols,stack,chir,scale}=p;
  const{b,floor_h,dx}=g;
  const totalFloors=floors*stack;
  const col_min=-extcols,col_max=n+extcols,total_cols=col_max-col_min+1;
  const bounds=patternBounds(p,g);
  const scaledW=bounds.w*scale,scaledH=bounds.h*scale;
  const patOriginX=(A4_W-scaledW)/2,patOriginY=(A4_H-scaledH)/2;

  function toSVG(xcm,ycm){return[xcm*CM,(A4_H-ycm)*CM];}

  const verts=[];
  for(let f=0;f<=totalFloors;f++){
    const row=[];
    for(let col=col_min;col<=col_max;col++){
      let x=col*b,y=f*floor_h;
      if(f%2===1)x+=dx*chir;else x-=dx*chir;
      row.push([(x-bounds.minX)*scale+patOriginX,(y-bounds.minY)*scale+patOriginY]);
    }
    verts.push(row);
  }

  const olIdx=extcols,orIdx=extcols+n;
  const[x0,y0]=verts[0][olIdx],[x1]=verts[0][orIdx];
  const[x2]=verts[totalFloors][olIdx],[x3,y3]=verts[totalFloors][orIdx];
  const extS=ext*scale,seamlS=seaml*scale,seamrS=seamr*scale;
  const topY=y0-extS,botY=y3+extS;
  const seamLX=x0-seamlS,seamRX=x1+seamrS;

  const L=(ax,ay,bx,by,col,sw,dash)=>{
    const[x1s,y1s]=toSVG(ax,ay),[x2s,y2s]=toSVG(bx,by);
    return `<line x1="${x1s.toFixed(2)}" y1="${y1s.toFixed(2)}" x2="${x2s.toFixed(2)}" y2="${y2s.toFixed(2)}" stroke="${col}" stroke-width="${sw||1}"${dash?` stroke-dasharray="${dash}"`:''} fill="none"/>`;
  };
  let lines=[];
  lines.push(L(x0,topY,x0,botY,'#6a1fa0',2.5));lines.push(L(x1,topY,x1,botY,'#6a1fa0',2.5));
  lines.push(L(x0,topY,x1,topY,'#6a1fa0',2.5));lines.push(L(x2,botY,x3,botY,'#6a1fa0',2.5));
  if(seamlS>0){lines.push(L(seamLX,topY,seamLX,botY,'#3535aa',1.8,'4 3'));[topY,botY,y0,verts[totalFloors][olIdx][1]].forEach(yy=>lines.push(L(seamLX,yy,x0,yy,'#3535aa',1.8,'4 3')));}
  if(seamrS>0){lines.push(L(seamRX,topY,seamRX,botY,'#3535aa',1.8,'4 3'));[topY,botY,verts[0][orIdx][1],verts[totalFloors][orIdx][1]].forEach(yy=>lines.push(L(x1,yy,seamRX,yy,'#3535aa',1.8,'4 3')));}
  for(let ci=1;ci<total_cols-1;ci++){
    const pts=Array.from({length:totalFloors+1},(_,f)=>verts[f][ci]);
    const[sx,sy]=toSVG(pts[0][0],pts[0][1]);
    let d=`M${sx.toFixed(2)},${sy.toFixed(2)}`;
    for(let f=1;f<=totalFloors;f++){const[lx,ly]=toSVG(pts[f][0],pts[f][1]);d+=` L${lx.toFixed(2)},${ly.toFixed(2)}`;}
    lines.push(`<path d="${d}" stroke="#cc0000" stroke-width="2.0" fill="none"/>`);
  }
  [verts.map((_,f)=>verts[f][orIdx]),verts.map((_,f)=>verts[f][olIdx])].forEach(pts=>{
    const svgPts=pts.map(([cx,cy])=>{const[sx,sy]=toSVG(cx,cy);return`${sx.toFixed(2)},${sy.toFixed(2)}`;}).join(' ');
    lines.push(`<polyline points="${svgPts}" stroke="#cc0000" stroke-width="1.6" stroke-dasharray="5 3" fill="none"/>`);
  });
  for(let f=0;f<=totalFloors;f++){
    const yL=verts[f][0][1];
    const[lx,ly]=toSVG(seamLX,yL),[rx,ry]=toSVG(seamRX,yL);
    lines.push(`<line x1="${lx.toFixed(2)}" y1="${ly.toFixed(2)}" x2="${rx.toFixed(2)}" y2="${ry.toFixed(2)}" stroke="#0044cc" stroke-width="2.0" fill="none"/>`);
  }
  for(let f=0;f<totalFloors;f++){
    for(let ci=0;ci<total_cols-1;ci++){
      const v1=verts[f][ci],v2=verts[f+1][ci+1],v3=verts[f][ci+1],v4=verts[f+1][ci];
      const[ax,ay,bxv,byv]=(f*chir)%2===0?[v3[0],v3[1],v4[0],v4[1]]:[v1[0],v1[1],v2[0],v2[1]];
      lines.push(L(ax,ay,bxv,byv,'#007a30',1.5,'6 4'));
    }
  }
  const[olX]=toSVG(x0,0),[orX]=toSVG(x1,0);
  const[,gapTopSVG]=toSVG(0,y0);
  const[,gapBotSVG]=toSVG(0,topY);
  lines.push(infoBoxSVGText(p,g,bounds,CM,olX,orX,null,gapBotSVG,gapTopSVG));

  const svgBody=`<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 ${A4pxW} ${A4pxH}" preserveAspectRatio="none" style="display:block;position:absolute;top:0;left:0;width:210mm;height:297mm"><rect width="100%" height="100%" fill="white"/>\n${lines.join('\n')}\n</svg>`;
  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Kresling n=${p.n} f=${p.floors}</title><style>*{margin:0;padding:0;box-sizing:border-box}@page{size:210mm 297mm;margin:0mm}html,body{width:210mm;height:297mm;margin:0;padding:0;background:white;overflow:hidden;position:relative}svg{display:block;position:absolute;top:0;left:0;width:210mm!important;height:297mm!important;-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact}@media print{html,body{width:210mm;height:297mm}svg{width:210mm!important;height:297mm!important}}<\/style><\/head><body>${svgBody}<script>window.onload=function(){setTimeout(function(){window.print();},500);};<\/script><\/body><\/html>`;
  const win=window.open('','_blank');
  if(!win){alert('Please allow pop-ups for this page to export PDF.');return;}
  win.document.write(html);win.document.close();
}

function exportDXF(){
  const p=getP(),g=computeGeometry(p);
  const{n,floors,ext,seaml,seamr,extcols,stack,chir,scale}=p;
  const{b,floor_h,dx}=g;
  const totalFloors=floors*stack;
  const col_min=-extcols,col_max=n+extcols,total_cols=col_max-col_min+1;
  const bounds=patternBounds(p,g);
  const scaledW=bounds.w*scale,scaledH=bounds.h*scale;
  const patOriginX=(A4_W-scaledW)/2,patOriginY=(A4_H-scaledH)/2;
  const verts=[];
  for(let f=0;f<=totalFloors;f++){
    const row=[];
    for(let col=col_min;col<=col_max;col++){
      let x=col*b,y=f*floor_h;
      if(f%2===1)x+=dx*chir;else x-=dx*chir;
      row.push([(x-bounds.minX)*scale+patOriginX,(y-bounds.minY)*scale+patOriginY]);
    }
    verts.push(row);
  }
  function dL(x1,y1,x2,y2,layer){return `0\nLINE\n8\n${layer}\n10\n${x1.toFixed(4)}\n20\n${y1.toFixed(4)}\n30\n0\n11\n${x2.toFixed(4)}\n21\n${y2.toFixed(4)}\n31\n0\n`;}
  const olIdx=extcols,orIdx=extcols+n;
  const[x0,y0]=verts[0][olIdx],[x1,y1]=verts[0][orIdx];
  const[x2,y2]=verts[totalFloors][olIdx],[x3,y3]=verts[totalFloors][orIdx];
  const extS=ext*scale,seamlS=seaml*scale,seamrS=seamr*scale;
  const topY=y0-extS,botY=y3+extS,seamLX=x0-seamlS,seamRX=x1+seamrS;
  let e=dL(x0,topY,x0,botY,'CUT')+dL(x1,topY,x1,botY,'CUT')+dL(x0,topY,x1,topY,'CUT')+dL(x2,botY,x3,botY,'CUT');
  for(let ci=1;ci<total_cols-1;ci++)for(let f=0;f<totalFloors;f++)e+=dL(verts[f][ci][0],verts[f][ci][1],verts[f+1][ci][0],verts[f+1][ci][1],'MOUNTAIN');
  for(let f=0;f<=totalFloors;f++)e+=dL(seamLX,verts[f][0][1],seamRX,verts[f][0][1],'VALLEY');
  for(let f=0;f<totalFloors;f++)for(let ci=0;ci<total_cols-1;ci++){
    const v1=verts[f][ci],v2=verts[f+1][ci+1],v3=verts[f][ci+1],v4=verts[f+1][ci];
    if((f*chir)%2===0)e+=dL(v3[0],v3[1],v4[0],v4[1],'VALLEY');else e+=dL(v1[0],v1[1],v2[0],v2[1],'VALLEY');
  }
  const dxf=`0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${e}0\nENDSEC\n0\nEOF\n`;
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([dxf],{type:'application/dxf'}));
  a.download=`kresling_n${n}_f${floors}_s${stack}.dxf`;a.click();
}

function exportSTL(){
  const p=getP(),g=computeGeometry(p);
  const{n,floors,stack,chir,compress}=p;
  const{floor_h,dx,R}=g;
  const totalFloors=floors*stack;
  const eFH=floor_h*(1-compress*0.98);
  const eDx=dx*(1-compress*0.5);
  const wallT=(p.wallmm||0.8)/10;
  const Ri=Math.max(0.01,R-wallT);

  function makeRings(radius){
    const rings=[];
    for(let f=0;f<=totalFloors;f++){
      const row=[];
      const y3d=f*eFH-(totalFloors*eFH/2);
      const angOuter=(f%2===1)?(eDx/R)*chir:-(eDx/R)*chir;
      for(let k=0;k<n;k++){
        const a=(2*Math.PI*k/n)+angOuter;
        row.push([radius*Math.cos(a),y3d,radius*Math.sin(a)]);
      }
      rings.push(row);
    }
    return rings;
  }

  const outerRings=makeRings(R);
  const innerRings=makeRings(Ri);

  function cross([ax,ay,az],[bx,by,bz]){return[ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx];}
  function sub([ax,ay,az],[bx,by,bz]){return[ax-bx,ay-by,az-bz];}
  function norm(v){const l=Math.hypot(...v)||1;return v.map(x=>x/l);}

  function tri(v1,v2,v3){
    const n=norm(cross(sub(v2,v1),sub(v3,v1)));
    const fmt=x=>x.toFixed(6);
    return `  facet normal ${n.map(fmt).join(' ')}\n    outer loop\n`+
      `      vertex ${v1.map(fmt).join(' ')}\n`+
      `      vertex ${v2.map(fmt).join(' ')}\n`+
      `      vertex ${v3.map(fmt).join(' ')}\n`+
      `    endloop\n  endfacet\n`;
  }

  function quad(v1,v2,v3,v4){return tri(v1,v2,v3)+tri(v1,v3,v4);}

  let stl=`solid kresling_hollow_n${n}_f${floors}\n`;

  for(let f=0;f<totalFloors;f++){
    for(let k=0;k<n;k++){
      const k2=(k+1)%n;
      const v1=outerRings[f][k],v2=outerRings[f][k2];
      const v3=outerRings[f+1][k],v4=outerRings[f+1][k2];
      if((f*chir)%2===0){stl+=tri(v1,v2,v3);stl+=tri(v2,v4,v3);}
      else{stl+=tri(v1,v2,v4);stl+=tri(v1,v4,v3);}
    }
  }

  for(let f=0;f<totalFloors;f++){
    for(let k=0;k<n;k++){
      const k2=(k+1)%n;
      const v1=innerRings[f][k],v2=innerRings[f][k2];
      const v3=innerRings[f+1][k],v4=innerRings[f+1][k2];
      if((f*chir)%2===0){stl+=tri(v3,v2,v1);stl+=tri(v3,v4,v2);}
      else{stl+=tri(v4,v2,v1);stl+=tri(v3,v4,v1);}
    }
  }

  for(let k=0;k<n;k++){
    const k2=(k+1)%n;
    stl+=quad(outerRings[0][k],innerRings[0][k],innerRings[0][k2],outerRings[0][k2]);
  }

  const tf=totalFloors;
  for(let k=0;k<n;k++){
    const k2=(k+1)%n;
    stl+=quad(outerRings[tf][k2],innerRings[tf][k2],innerRings[tf][k],outerRings[tf][k]);
  }

  stl+=`endsolid kresling_hollow_n${n}_f${floors}\n`;

  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([stl],{type:'model/stl'}));
  a.download=`kresling_hollow_n${n}_f${floors}_s${stack}.stl`;
  a.click();
}

function exportMoldSTL(moldType){
  const p=getP(), g=computeGeometry(p);
  const{n,floors,ext,seaml,seamr,extcols,stack,chir,scale}=p;
  const{b,floor_h,dx}=g;
  const totalFloors=floors*stack;
  const col_min=-extcols, col_max=n+extcols, total_cols=col_max-col_min+1;
  const bounds=patternBounds(p,g);
  const scaledW=bounds.w*scale, scaledH=bounds.h*scale;

  const baseT=(p.moldbase||3)/10;
  const ridgeH=(p.ridgeh||1.2)/10;
  const ridgeW=(p.ridgew||0.6)/10;

  const patOriginX=(A4_W-scaledW)/2;
  const patOriginY=(A4_H-scaledH)/2;

  function makeVerts(){
    const verts=[];
    for(let f=0;f<=totalFloors;f++){
      const row=[];
      for(let col=col_min;col<=col_max;col++){
        let x=col*b, y=f*floor_h;
        if(f%2===1) x+=dx*chir; else x-=dx*chir;
        const nx=(x-bounds.minX)*scale+patOriginX;
        const ny=(y-bounds.minY)*scale+patOriginY;
        row.push([nx,ny]);
      }
      verts.push(row);
    }
    return verts;
  }
  const verts=makeVerts();
  const olIdx=extcols, orIdx=extcols+n;
  const extS=ext*scale, seamlS=seaml*scale, seamrS=seamr*scale;
  const [x0,y0]=verts[0][olIdx], [x1]=verts[0][orIdx];
  const [x2,y2]=verts[totalFloors][olIdx], [x3,y3]=verts[totalFloors][orIdx];
  const topY=y0-extS, botY=y3+extS;
  const seamLX=x0-seamlS, seamRX=x1+seamrS;

  const margin=0.2;
  const plateX0=seamLX-margin, plateX1=seamRX+margin;
  const plateY0=topY-margin, plateY1=botY+margin;

  function cross([ax,ay,az],[bx,by,bz]){return[ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx];}
  function sub([ax,ay,az],[bx,by,bz]){return[ax-bx,ay-by,az-bz];}
  function norm(v){const l=Math.hypot(...v)||1;return v.map(c=>c/l);}
  function tri(v1,v2,v3){
    const n=norm(cross(sub(v2,v1),sub(v3,v1)));
    const f=x=>x.toFixed(6);
    return `  facet normal ${n.map(f).join(' ')}\n    outer loop\n`
      +`      vertex ${v1.map(f).join(' ')}\n`
      +`      vertex ${v2.map(f).join(' ')}\n`
      +`      vertex ${v3.map(f).join(' ')}\n`
      +`    endloop\n  endfacet\n`;
  }
  function quad(v1,v2,v3,v4){return tri(v1,v2,v3)+tri(v1,v3,v4);}

  let stl=`solid kresling_${moldType}_mold_n${n}_f${floors}\n`;

  const zBot=-baseT, zTop=0;
  const bx0=plateX0, bx1=plateX1, by0=plateY0, by1=plateY1;
  stl+=quad([bx0,by0,zBot],[bx1,by0,zBot],[bx1,by1,zBot],[bx0,by1,zBot]);
  stl+=quad([bx0,by0,zTop],[bx0,by1,zTop],[bx1,by1,zTop],[bx1,by0,zTop]);
  stl+=quad([bx0,by0,zBot],[bx0,by0,zTop],[bx0,by1,zTop],[bx0,by1,zBot]);
  stl+=quad([bx1,by0,zTop],[bx1,by0,zBot],[bx1,by1,zBot],[bx1,by1,zTop]);
  stl+=quad([bx0,by0,zTop],[bx0,by0,zBot],[bx1,by0,zBot],[bx1,by0,zTop]);
  stl+=quad([bx0,by1,zBot],[bx0,by1,zTop],[bx1,by1,zTop],[bx1,by1,zBot]);

  function addRidge(ax,ay,bx_,by_){
    const dx_=bx_-ax, dy_=by_-ay;
    const len=Math.hypot(dx_,dy_);
    if(len<1e-6)return;
    const tx=dx_/len, ty=dy_/len;
    const nx_=-ty, ny_=tx;
    const hw=ridgeW/2;

    const AL=[ax-hw*nx_,  ay-hw*ny_,  0];
    const AR=[ax+hw*nx_,  ay+hw*ny_,  0];
    const AP=[ax,         ay,         ridgeH];
    const BL=[bx_-hw*nx_, by_-hw*ny_, 0];
    const BR=[bx_+hw*nx_, by_+hw*ny_, 0];
    const BP=[bx_,        by_,        ridgeH];

    stl+=tri(AL,AP,AR);
    stl+=tri(BL,BR,BP);
    stl+=quad(AL,BL,BP,AP);
    stl+=quad(AR,AP,BP,BR);
  }

  const mountainSegs=[];
  const valleySegs=[];

  for(let ci=1;ci<total_cols-1;ci++){
    for(let f=0;f<totalFloors;f++){
      const [vx1,vy1]=verts[f][ci];
      const [vx2,vy2]=verts[f+1][ci];
      mountainSegs.push([vx1,vy1,vx2,vy2]);
    }
  }

  for(let f=0;f<=totalFloors;f++){
    const yL=verts[f][0][1];
    valleySegs.push([seamLX,yL,seamRX,yL]);
  }

  for(let f=0;f<totalFloors;f++){
    for(let ci=0;ci<total_cols-1;ci++){
      const v1=verts[f][ci], v2=verts[f+1][ci+1];
      const v3=verts[f][ci+1], v4=verts[f+1][ci];
      const [ax_,ay_,bxg,byg]=(f*chir)%2===0
        ?[v3[0],v3[1],v4[0],v4[1]]
        :[v1[0],v1[1],v2[0],v2[1]];
      valleySegs.push([ax_,ay_,bxg,byg]);
    }
  }

  const segsToRidge = moldType==='mountain' ? mountainSegs : valleySegs;
  for(const [ax_,ay_,bxs,bys] of segsToRidge){
    addRidge(ax_,ay_,bxs,bys);
  }

  const borderRidgeH=ridgeH*0.5;
  function addBorderRidge(ax,ay,bx_,by_){
    const dx_=bx_-ax, dy_=by_-ay;
    const len=Math.hypot(dx_,dy_);
    if(len<1e-6)return;
    const tx=dx_/len, ty=dy_/len;
    const nx_=-ty, ny_=tx;
    const hw=ridgeW*0.4;
    const AL=[ax-hw*nx_,ay-hw*ny_,0]; const AR=[ax+hw*nx_,ay+hw*ny_,0]; const AP=[ax,ay,borderRidgeH];
    const BL=[bx_-hw*nx_,by_-hw*ny_,0]; const BR=[bx_+hw*nx_,by_+hw*ny_,0]; const BP=[bx_,by_,borderRidgeH];
    stl+=tri(AL,AP,AR);stl+=tri(BL,BR,BP);
    stl+=quad(AL,BL,BP,AP);stl+=quad(AR,AP,BP,BR);
  }
  addBorderRidge(x0,topY,x1,topY);
  addBorderRidge(x2,botY,x3,botY);
  addBorderRidge(x0,topY,x0,botY);
  addBorderRidge(x1,topY,x1,botY);

  stl+=`endsolid kresling_${moldType}_mold_n${n}_f${floors}\n`;

  showToast(`${moldType} mold STL generating…`,1000);
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([stl],{type:'model/stl'}));
  a.download=`kresling_${moldType}_mold_n${n}_f${floors}_s${stack}.stl`;
  a.click();
  showToast(`${moldType} mold exported ✓`);
}
(function(){
  const ec=document.getElementById('canvasEnergy');
  ec.addEventListener('mousemove',e=>{
    const r=ec.getBoundingClientRect();
    energyHoverX=(e.clientX-r.left)*(ec.width/r.width);
    drawEnergy();
  });
  ec.addEventListener('mouseleave',()=>{energyHoverX=null;drawEnergy();});
  ec.style.cursor='crosshair';
})();

window.addEventListener('resize',()=>{
  if(currentCenterTab==='crease') drawFlat();
  else { initMold3d(); drawMold3d(); }
  init3d(); draw3d(); drawEnergy();
});
bindPairs();
initSidebarResize();
initRightPanelResize();
applyAutoSeam();
initFlatCanvasEvents();
init3d();
captureState(); // initial state for undo
draw();