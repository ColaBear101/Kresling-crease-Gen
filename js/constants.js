export const A4_W = 21.0;
export const A4_H = 29.7;

export const paramPairs = [
  ['r-dia','n-dia'],       ['r-height','n-height'],   ['r-n','n-n'],         ['r-floors','n-floors'],
  ['r-angle','n-angle'],   ['r-ext','n-ext'],          ['r-seaml','n-seaml'], ['r-seamr','n-seamr'],
  ['r-extcols','n-extcols'],['r-stack','n-stack'],     ['r-scale','n-scale'], ['r-compress','n-compress'],
  ['r-wallmm','n-wallmm'], ['r-moldbase','n-moldbase'],['r-ridgeh','n-ridgeh'],['r-ridgew','n-ridgew'],
];

export const PRESET_KEYS = [
  'dia','height','n','floors','angle','ext','seaml','seamr','extcols','stack','scale','compress','wallmm',
];

export const PRESETS = {
  bistable6:  {dia:4,   height:16, n:6,  floors:8,  angle:105, ext:1.5, seaml:1.57, seamr:1.57, extcols:1, stack:1, scale:100, compress:0, wallmm:0.8},
  bistable8:  {dia:5,   height:20, n:8,  floors:10, angle:100, ext:2,   seaml:1.96, seamr:1.96, extcols:1, stack:1, scale:100, compress:0, wallmm:0.8},
  monostable: {dia:3,   height:12, n:6,  floors:6,  angle:120, ext:1,   seaml:0,    seamr:0,    extcols:0, stack:1, scale:100, compress:0, wallmm:0.8},
  tower:      {dia:2.5, height:30, n:6,  floors:16, angle:95,  ext:1.5, seaml:1.31, seamr:1.31, extcols:1, stack:2, scale:80,  compress:0, wallmm:0.8},
  flat:       {dia:8,   height:8,  n:12, floors:4,  angle:90,  ext:1,   seaml:0,    seamr:0,    extcols:0, stack:1, scale:60,  compress:0, wallmm:0.8},
  compact:    {dia:3,   height:6,  n:5,  floors:4,  angle:110, ext:1,   seaml:1.88, seamr:1.88, extcols:1, stack:1, scale:100, compress:0, wallmm:0.8},
};
