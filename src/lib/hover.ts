// src/lib/hover.ts
//
// True only on devices with a real hover pointer (mouse/trackpad).
// Touch browsers emulate mouse events on tap — onMouseEnter fires and
// the matching onMouseLeave may never come, so JS hover styling sticks
// and buttons look pressed. Gate inline hover handlers with this.
export const canHover =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(hover: hover)').matches
