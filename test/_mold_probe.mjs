// Minimal DOM shim so we can import & execute the REAL exports.js/ui.js
// unmodified in Node, and capture whatever STL text exportMoldSTL() produces.
import { writeFileSync } from 'node:fs';

const BASE_PRESETS = {
  bistable6:  {dia:4,  height:16, n:6,  floors:8,  angle:105, ext:1.5, seaml:1.57, seamr:1.57, extcols:1, stack:1},
  bistable8:  {dia:5,  height:20, n:8,  floors:10, angle:100, ext:2,   seaml:1.96, seamr:1.96, extcols:1, stack:1},
  monostable: {dia:3,  height:12, n:6,  floors:6,  angle:120, ext:1,   seaml:0,    seamr:0,    extcols:0, stack:1},
  tower:      {dia:2.5,height:30, n:6,  floors:16, angle:95,  ext:1.5, seaml:1.31, seamr:1.31, extcols:1, stack:2},
  compact:    {dia:3,  height:6,  n:5,  floors:4,  angle:110, ext:1,   seaml:1.88, seamr:1.88, extcols:1, stack:1},
};
const COMMON = { scale:100, compress:0, wallmm:0.8, moldbase:3, ridgeh:1.2, ridgew:0.6, material:'kapton', thick:25,
  showmv:true, showA4:true, showGrid:true, showMountain:true, showValley:true, showDiagonal:true };

let PRESET = {};
function fakeEl(id) {
  const v = id.startsWith('n-') ? PRESET[id.slice(2)] : PRESET[id];
  return {
    id, value: v !== undefined ? String(v) : '0', checked: !!v,
    style: {}, classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} },
    addEventListener(){}, removeEventListener(){}, appendChild(){}, click(){},
    getContext(){ return fake2DCtx(); },
    getBoundingClientRect(){ return {width:400,height:400,left:0,top:0}; },
    parentElement: { clientWidth:400, clientHeight:400 },
    offsetWidth: 400, offsetHeight: 400,
  };
}
function fake2DCtx(){
  return new Proxy({}, { get(){ return function(){ return {}; }; } });
}

let capturedSTL = null;
global.document = {
  getElementById(id){ return fakeEl(id); },
  createElement(tag){
    if (tag === 'canvas') return fakeEl('canvas');
    if (tag === 'a') return { click(){}, set href(v){}, get href(){return '';}, download:'' };
    return fakeEl(tag);
  },
  addEventListener(){},
};
global.window = global;
global.URL = { createObjectURL(blob){ capturedSTL = blob.parts[0]; return 'blob:fake'; } };
global.Blob = class { constructor(parts, opts){ this.parts = parts; this.type = opts && opts.type; } };
global.performance = { now: () => Date.now() };

const { exportMoldSTL } = await import('../js/exports.js');

let allOK = true;
for (const [presetName, preset] of Object.entries(BASE_PRESETS)) {
  for (const chir of [1, -1]) {
    for (const moldType of ['mountain', 'valley']) {
      PRESET = { ...preset, ...COMMON, chir };
      capturedSTL = null;
      exportMoldSTL(moldType);
      const tag = `${presetName} chir=${chir > 0 ? 'R' : 'L'} ${moldType}`;
      if (!capturedSTL) { console.log(`[${tag}] NO OUTPUT CAPTURED`); allOK = false; continue; }

      const nums = capturedSTL.match(/-?\d+\.\d+(e[+-]\d+)?/gi) || [];
      const bad = nums.filter(x => !isFinite(parseFloat(x))).length;

      const facetBlocks = capturedSTL.split('facet normal').slice(1);
      const edgeCount = new Map();
      let vol = 0;
      for (const block of facetBlocks) {
        const vs = [...block.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].map(m => [m[1], m[2], m[3]]);
        if (vs.length !== 3) continue;
        for (let i = 0; i < 3; i++) {
          const a = vs[i].join(','), b = vs[(i+1)%3].join(',');
          const k = a + '|' + b;
          edgeCount.set(k, (edgeCount.get(k)||0) + 1);
        }
        const [v1,v2,v3] = vs.map(p => p.map(Number));
        const cx=v2[1]*v3[2]-v2[2]*v3[1], cy=v2[2]*v3[0]-v2[0]*v3[2], cz=v2[0]*v3[1]-v2[1]*v3[0];
        vol += (v1[0]*cx + v1[1]*cy + v1[2]*cz) / 6;
      }
      let boundary = 0, dup = 0;
      for (const [k, c] of edgeCount) {
        const [a,b] = k.split('|');
        const rev = edgeCount.get(b+'|'+a) || 0;
        if (c > 1) dup++;
        if (c === 1 && rev === 0) boundary++;
      }
      const ok = bad===0 && boundary===0 && dup===0 && vol>0;
      if (!ok) allOK = false;
      console.log(`[${tag}] facets=${facetBlocks.length} NaN=${bad} boundary=${boundary} dup=${dup} vol=${vol.toFixed(3)}cm3 ${ok ? 'OK' : '*** FAIL ***'}`);
    }
  }
}
console.log(allOK ? '\n=== ALL CONFIGS PASS ===' : '\n=== SOME CONFIGS FAILED ===');
