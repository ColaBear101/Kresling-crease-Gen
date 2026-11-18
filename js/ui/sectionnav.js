// Section bar for phones: on narrow screens the four areas of the app sit one
// under the other, so a bar fixed to the bottom jumps between them and marks
// the one in view.
//
//   mountSectionNav(container) -> { update(), resize(), setActive() }
//
// The bar is always in the DOM; css/app.css shows it below 760 px only. Scrolling
// is smooth unless the user asks for reduced motion.

import { el, rafThrottle } from '../app/util.js';

const SECTIONS = [
  { id: 'sidebar', label: 'Design', icon: '<path d="M3 4.5h10M3 8h10M3 11.5h10"/><circle cx="6" cy="4.5" r="1.4" fill="currentColor"/><circle cx="10.5" cy="8" r="1.4" fill="currentColor"/><circle cx="7.5" cy="11.5" r="1.4" fill="currentColor"/>' },
  { id: 'center', label: 'Pattern', icon: '<rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="M2.5 8h11M5 2.5l3 5.5M8 2.5l3 5.5M5 8l3 5.5M8 8l3 5.5"/>' },
  { id: 'pane-3d', label: '3-D', icon: '<path d="M8 1.8 13.5 5v6L8 14.2 2.5 11V5z"/><path d="M2.5 5 8 8.2 13.5 5M8 8.2v6"/>' },
  { id: 'pane-analysis', label: 'Analysis', icon: '<path d="M2.5 13.5h11"/><path d="M3 11c2-6 3.5-6 5-2.5S11 9 13 3.5"/>' },
];

function smooth() {
  return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

export function mountSectionNav(container) {
  container.replaceChildren();
  const buttons = SECTIONS.map((s) => {
    const b = el('button', { type: 'button', class: 'snav-btn', 'data-target': s.id });
    b.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${s.icon}</svg>`;
    b.append(el('span', { text: s.label }));
    b.addEventListener('click', () => {
      const target = document.getElementById(s.id);
      if (!target) return;
      const from = window.scrollY;
      const top = Math.max(0, from + target.getBoundingClientRect().top - 12);
      if (!smooth()) { window.scrollTo(0, top); mark(s.id); return; }
      window.scrollTo({ top, behavior: 'smooth' });
      // some embedded browsers ignore smooth scrolling: jump if it has not started
      setTimeout(() => { if (Math.abs(window.scrollY - from) < 1 && Math.abs(top - from) > 1) window.scrollTo(0, top); }, 250);
      mark(s.id);
    });
    return b;
  });
  container.append(...buttons);

  function mark(id) {
    for (const b of buttons) {
      if (b.dataset.target === id) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    }
  }

  // The current section is the one under the middle of the screen; at the very
  // top or bottom of the page, the first or last one.
  function current() {
    if (getComputedStyle(container).display === 'none') return;   // bar hidden (wide screen)
    // on phones the sections are not in DOM order (the pattern comes first)
    const boxes = SECTIONS.map((s) => {
      const target = document.getElementById(s.id);
      return target ? { id: s.id, r: target.getBoundingClientRect() } : null;
    }).filter(Boolean).sort((a, b) => a.r.top - b.r.top);
    if (!boxes.length) return;
    const doc = document.documentElement;
    if (window.scrollY + window.innerHeight >= doc.scrollHeight - 2) { mark(boxes[boxes.length - 1].id); return; }
    const mid = window.innerHeight / 2;
    let best = boxes[0].id;
    for (const b of boxes) if (b.r.top <= mid) best = b.id;     // the last one that starts above the middle
    mark(best);
  }
  const onScroll = rafThrottle(current);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  current();

  return { update() {}, resize() { onScroll(); }, setActive() {} };
}
