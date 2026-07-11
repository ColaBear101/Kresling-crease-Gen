// 3D tube camera
export const cam3d = {
  rotX: 0.4, rotY: 0.3,
  isDragging: false, lastMouse: { x: 0, y: 0 },
  dist: null,           // null = auto-fit
};

// Flat canvas pan / zoom / hover
export const flatCam = {
  zoom: 1, panX: 0, panY: 0,
  dragging: false, lastMouse: { x: 0, y: 0 },
  hoverPx: null,        // {x,y} canvas pixels, null when cursor outside
};

// Mold preview camera
export const moldCam = {
  rotX: 0.3, rotY: 0.5,
  dragging: false, lastMouse: { x: 0, y: 0 },
  dist: null,
};

// UI tab selection + energy hover
export const ui = {
  currentCenterTab: 'crease',   // 'crease' | 'mold'
  currentMoldTab:   'mountain', // 'mountain' | 'valley' | 'both'
  energyHoverX:     null,       // canvas pixel x, null = no hover
};

// Auto-rotate animation
export const anim = {
  autoRotate: false,
  frame:      null,   // requestAnimationFrame handle
  lastTime:   0,
};

// Compression "breathing" auto-animate
export const compressAnim = {
  active:    false,
  frame:     null,
  lastTime:  0,
  phase:     0,        // radians, continuous so pause/resume doesn't jump
};
