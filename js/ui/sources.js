// "Help & sources" dialog: how each analysis works (and where it stops being
// right), the keyboard shortcuts, and the literature.
//
//   mountSources(dialogElement) -> { open(), close(), isOpen() }
//   REFERENCES -> [{ id, text, doi?, url? }]   (also used by the tests)
//   METHODS    -> [{ title, body: [paragraphs], limits }]

import { el } from '../app/util.js';
import { SHORTCUTS } from './shortcuts.js';
import { APP_NAME, APP_VERSION } from '../core/params.js';

export const REFERENCES = [
  { id: 'guest1994', doi: '10.1115/1.2901553',
    text: 'Guest, S. D. & Pellegrino, S. (1994). The folding of triangulated cylinders, Part I: Geometric considerations. J. Appl. Mech. 61(4), 773–777.' },
  { id: 'cai2015', doi: '10.1115/1.4030158',
    text: 'Cai, J., Deng, X., Zhou, Y., Feng, J. & Tu, Y. (2015). Bistable behavior of the cylindrical origami structure with Kresling pattern. J. Mech. Des. 137(6), 061406.' },
  { id: 'reid2017', doi: '10.1103/PhysRevE.95.013002',
    text: 'Reid, A., Lechenault, F., Rica, S. & Adda-Bedia, M. (2017). Geometry and design of origami bellows with tunable response. Phys. Rev. E 95, 013002.' },
  { id: 'kidambi2020', doi: '10.1103/PhysRevE.101.063003',
    text: 'Kidambi, N. & Wang, K. W. (2020). Dynamics of Kresling origami deployment. Phys. Rev. E 101, 063003.' },
  { id: 'filipov2015', doi: '10.1073/pnas.1509465112',
    text: 'Filipov, E. T., Tachi, T. & Paulino, G. H. (2015). Origami tubes assembled into stiff, yet reconfigurable structures and metamaterials. PNAS 112(40), 12321–12326.' },
  { id: 'filipov2017', doi: '10.1016/j.ijsolstr.2017.05.028',
    text: 'Filipov, E. T., Liu, K., Tachi, T., Schenk, M. & Paulino, G. H. (2017). Bar and hinge models for scalable analysis of origami. Int. J. Solids Struct. 124, 26–45.' },
  { id: 'schenk2011', doi: '10.1201/b10971-27',
    text: 'Schenk, M. & Guest, S. D. (2011). Origami folding: a structural engineering approach. In Origami 5, pp. 291–304.' },
  { id: 'timoshenko1961',
    text: 'Timoshenko, S. P. & Gere, J. M. (1961). Theory of Elastic Stability, 2nd ed. McGraw-Hill.' },
  { id: 'kapton', url: 'https://www.dupont.com/products/kapton-hn.html',
    text: 'DuPont. Kapton HN polyimide film, technical data sheet (modulus, Poisson ratio, density).' },
];

export const METHODS = [
  {
    title: 'Geometry and the two stable states',
    body: [
      'Every floor is a ring of rigid triangular panels joined by hinges. The polygon edges are exact chords of the design circle, a = 2R·sin(π/n), so the printed panels close into the polygon you asked for. A flat strip with shift s and height h can only fold into shapes in which all creases keep their printed lengths. That leaves exactly two solutions, sin(φ − π/n) = (2s − a)/(2R), whose twists add up to π + 2π/n: the taller one is the deployed state, the shorter one the folded state (Guest & Pellegrino 1994; Cai et al. 2015; Reid et al. 2017).',
      '“Design by folded heights” solves the same equations backwards from the two heights you enter. The window under the folded height shows which values keep both states reachable; in flat-pattern mode the bistable window lists the crease angles that do.',
      'The fabrication tolerance in the summary is how far the folded floor height moves when the printed crease angle is off by one degree (central difference on the exact geometry). It grows quickly near the edges of the bistable window.',
    ],
    limits: 'Limits: the in-between shapes are not rigid; getting from one state to the other needs the panels to stretch or wrinkle, which is what the energy model below describes. A state is rejected when it would need a negative height or a twist of 180° or more.',
  },
  {
    title: 'Mountain and valley assignment',
    body: [
      'Fold directions are measured, not assumed: the app builds the deployed tube in 3-D and takes the signed angle between neighbouring panels across each crease family (ring, long diagonal, short diagonal), seen from the printed side, which becomes the outside of the tube. Left-handed tubes are true mirror images of right-handed ones.',
    ],
    limits: 'Limits: the assignment belongs to the deployed state. The end-ring folds assume each end ring stands upright on its end polygon.',
  },
  {
    title: 'Energy, snap force and strain',
    body: [
      'The elastic energy of one floor is the stretching energy of its panels plus the bending energy of its creases. Panels are constant-strain triangles whose strain follows exactly from the current lengths of their three sides (plane stress, St Venant–Kirchhoff).',
      '“Thin sheet” panels can carry compression only up to their plate-buckling stress; beyond it they wrinkle at constant stress, which is how paper and polymer film behave. “Stiff panels” only stretch: an upper bound that overstates forces by orders of magnitude for thin sheets.',
      'Creases are torsion springs with stiffness per unit length k = E·t³ / (12·(1 − ν²)·w), where w is the effective crease hinge width (Filipov et al. 2015, 2017; Schenk & Guest 2011). Their rest angles lie between the deployed (0 %) and folded (100 %) shapes, set by the crease rest position.',
      'For each floor height the twist is relaxed to its lowest-energy value. The slope of the resulting energy curve is the axial force; the largest compressive force between the deployed well and the energy barrier is the snap force, and the energy barrier is reported from both wells. The peak panel strain along that path is compared with the strain limit of the sheet.',
    ],
    limits: 'Limits: the polygon rings are kept rigid and regular; panel bending, friction, plastic yield and creep of the creases are not modelled, and the hinge width is an effective value worth calibrating with a test fold. Use absolute forces as estimates and comparisons between designs as the reliable part.',
  },
  {
    title: 'Vibration modes',
    body: [
      'One floor is modelled with its bottom ring clamped and its top ring as a rigid body with six degrees of freedom, in the style of Kidambi & Wang (2020). The stiffness matrix is the second derivative of the same panel-and-crease energy at each stable state (at the true equilibrium when the creases shift it). The top ring carries the top mass you enter, as a thin disc, plus half of one floor’s sheet mass as a thin ring. The six natural frequencies and their mode shapes (axial, torsional, lateral, rocking or coupled) follow from the eigenvalue problem, solved in SI units.',
    ],
    limits: 'Limits: one floor only, so a stack of several floors vibrates at lower frequencies; no damping; the rings do not deform; small vibrations about a stable state only.',
  },
  {
    title: 'Buckling',
    body: [
      'The whole stack is checked as a column. Its bending and shear stiffness come from the same energy model: the lateral and rocking flexibility of one floor at the deployed state is fitted to a Timoshenko cantilever. The Euler load Pe = π²·EI/(K·L)² for the chosen end supports (effective length factor K = 2, 1, 0.7 or 0.5) is reduced for shear, Pcr = Pe/(1 + Pe/GA) (Timoshenko & Gere 1961). The safety factor compares Pcr with the snap force: if it is too low, the tube bows sideways before it snaps through.',
    ],
    limits: 'Limits: linear buckling of a perfect, straight column; imperfections, local wrinkling of panels and the stiffness change during compression are not included.',
  },
  {
    title: 'Materials',
    body: [
      'Material presets are typical values. The polyimide preset follows the DuPont Kapton HN data sheet; paper and card properties vary with fibre direction and humidity, so enter measured values when you have them.',
    ],
    limits: '',
  },
];

function referenceItem(r) {
  const link = r.doi
    ? el('a', { href: `https://doi.org/${r.doi}`, target: '_blank', rel: 'noopener', text: `doi:${r.doi}` })
    : r.url ? el('a', { href: r.url, target: '_blank', rel: 'noopener', text: 'dupont.com' }) : null;
  return el('li', { id: `ref-${r.id}` }, r.text, link ? ' ' : null, link);
}

function keyCombo(keys) {
  const out = [];
  keys.forEach((combo, i) => {
    if (i > 0) out.push(combo === '…' || keys[i - 1] === '…' ? ' ' : ' or ');
    if (combo === '…') { out.push('…'); return; }
    combo.split(' ').forEach((k, j) => {
      if (j > 0) out.push(' ');
      out.push(el('kbd', { text: k }));
    });
  });
  return out;
}

/** Fill the dialog and return controls for it. */
export function mountSources(dialog) {
  let opener = null;

  const closeBtn = el('button', { type: 'submit', class: 'icon-btn', value: 'close', 'aria-label': 'Close help' });
  closeBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
  const head = el('form', { method: 'dialog', class: 'src-head' },
    el('h2', { id: 'sources-title', text: 'Help & sources' }), closeBtn);

  const how = el('section', { 'aria-labelledby': 'src-how' },
    el('h3', { id: 'src-how', class: 'section-label', text: 'How the analyses work' }),
    ...METHODS.flatMap((m) => [
      el('h4', { text: m.title }),
      ...m.body.map((p) => el('p', { text: p })),
      m.limits ? el('p', { class: 'src-limits', text: m.limits }) : null,
    ]));

  const keys = el('section', { 'aria-labelledby': 'src-keys' },
    el('h3', { id: 'src-keys', class: 'section-label', text: 'Keyboard shortcuts' }),
    el('dl', { class: 'kv src-keys' },
      ...SHORTCUTS.flatMap((s) => [el('dt', {}, ...keyCombo(s.keys)), el('dd', { text: s.label })])),
    el('p', { class: 'muted src-foot', text: 'Shortcuts are ignored while you type in a field. Units: lengths in mm, forces in N, energies in mJ, frequencies in Hz.' }));

  const refs = el('section', { 'aria-labelledby': 'src-refs' },
    el('h3', { id: 'src-refs', class: 'section-label', text: 'References' }),
    el('ol', { class: 'src-refs' }, ...REFERENCES.map(referenceItem)));

  const nav = el('nav', { class: 'src-nav', 'aria-label': 'Sections' },
    el('a', { href: '#src-how', text: 'How the analyses work' }),
    el('a', { href: '#src-keys', text: 'Keyboard shortcuts' }),
    el('a', { href: '#src-refs', text: 'References' }));

  const body = el('div', { class: 'src-body scroll' }, nav, how, keys, refs,
    el('p', { class: 'muted src-foot', text: `${APP_NAME} ${APP_VERSION}. Runs entirely in this browser; designs are kept in local storage and in the files you save.` }));

  // in-dialog navigation: scroll the body instead of changing the page URL
  nav.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    const target = body.querySelector(a.getAttribute('href'));
    if (target) { e.preventDefault(); target.scrollIntoView({ block: 'start' }); }
  });

  dialog.replaceChildren(head, body);
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });   // backdrop
  dialog.addEventListener('close', () => {
    if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
    opener = null;
  });

  return {
    open() {
      if (dialog.open) return;
      opener = document.activeElement;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      body.scrollTop = 0;
      closeBtn.focus();
    },
    close() { if (dialog.open) dialog.close(); },
    isOpen: () => dialog.open,
  };
}
