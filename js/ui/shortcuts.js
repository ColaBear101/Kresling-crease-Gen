// Global keyboard shortcuts.
//
//   keyAction(event)                -> { type, arg? } | null    pure: maps a key event to an action
//   installShortcuts(app, { fit })  -> uninstall()              wires keyAction to window keydown
//   SHORTCUTS                       -> [{ keys: [...], label }] for the help dialog
//
// Action types: 'undo', 'redo', 'export' (arg 'svg' | 'pdf'), 'fit',
// 'sides' (arg 3..9), 'animate', 'share', 'theme', 'help', 'escape'. Keys typed into text fields,
// selects and editable content are left alone; Space is also left to
// buttons, checkboxes and other controls that use it.

export const SHORTCUTS = [
  { keys: ['Ctrl Z', '⌘ Z'], label: 'Undo' },
  { keys: ['Ctrl Shift Z', 'Ctrl Y', '⌘ Shift Z'], label: 'Redo' },
  { keys: ['S'], label: 'Save the pattern as SVG' },
  { keys: ['P'], label: 'Save the pattern as PDF' },
  { keys: ['F'], label: 'Fit the pattern to one page' },
  { keys: ['3', '…', '9'], label: 'Set the number of sides' },
  { keys: ['Space'], label: 'Start or stop the fold animation' },
  { keys: ['L'], label: 'Copy a link that opens this design' },
  { keys: ['T'], label: 'Switch the theme: system, light, dark' },
  { keys: ['?'], label: 'Open this help' },
  { keys: ['Esc'], label: 'Close this dialog or a menu' },
];

/** Map a keydown event (or a plain object with the same fields) to an action. */
export function keyAction(e) {
  if (!e || e.isComposing || e.keyCode === 229) return null;
  const key = typeof e.key === 'string' ? e.key : '';
  const lower = key.length === 1 ? key.toLowerCase() : key;
  const mod = Boolean(e.ctrlKey || e.metaKey);
  if (mod) {
    if (e.altKey) return null;
    if (lower === 'z') return { type: e.shiftKey ? 'redo' : 'undo' };
    if (lower === 'y' && !e.shiftKey && e.ctrlKey) return { type: 'redo' };
    return null;
  }
  if (e.altKey) return null;
  if (key === 'Escape' || key === 'Esc') return { type: 'escape' };
  if (key === ' ' || key === 'Spacebar') return e.shiftKey ? null : { type: 'animate' };
  if (lower === 's') return { type: 'export', arg: 'svg' };
  if (lower === 'p') return { type: 'export', arg: 'pdf' };
  if (lower === 'f') return { type: 'fit' };
  if (lower === 'l') return { type: 'share' };
  if (lower === 't') return { type: 'theme' };
  if (key === '?') return { type: 'help' };
  if (/^[3-9]$/.test(key)) return { type: 'sides', arg: Number(key) };
  return null;
}

const TEXT_INPUTS = new Set(['', 'text', 'number', 'search', 'email', 'url', 'tel', 'password',
  'date', 'time', 'datetime-local', 'month', 'week']);

/** True while the user is typing into a field (shortcuts must not steal keys). */
export function isTypingTarget(t) {
  if (!t || !t.tagName) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') return TEXT_INPUTS.has((t.getAttribute('type') || '').toLowerCase());
  const role = t.getAttribute && t.getAttribute('role');
  return role === 'textbox' || role === 'combobox' || role === 'spinbutton' || role === 'searchbox';
}

/** True for controls that react to Space themselves (buttons, checkboxes, tabs, links...). */
function usesSpace(t) {
  if (!t || !t.tagName) return false;
  if (isTypingTarget(t)) return true;
  const tag = t.tagName.toLowerCase();
  if (['button', 'a', 'input', 'summary', 'option', 'video', 'audio'].includes(tag)) return true;
  const role = t.getAttribute('role');
  return Boolean(role) && ['button', 'tab', 'checkbox', 'radio', 'switch', 'menuitem', 'option', 'slider', 'link'].includes(role);
}

/**
 * Listen for shortcuts. handlers: fit() fits the pattern to the page (js/ui/actions.js),
 * share() copies a design link, theme() switches the theme, help() opens the help
 * dialog; everything else goes through app.store / app.exportAs.
 */
export function installShortcuts(app, handlers = {}) {
  const { store } = app;
  function onKey(e) {
    if (e.defaultPrevented) return;
    const act = keyAction(e);
    if (!act) return;
    const openDialog = document.querySelector('dialog[open]');
    if (act.type === 'escape') {
      if (openDialog) { openDialog.close(); e.preventDefault(); }
      return;
    }
    if (openDialog) return;                       // the modal dialog owns the keyboard
    if (isTypingTarget(e.target)) return;
    if (act.type === 'animate' && usesSpace(e.target)) return;
    if (e.repeat && act.type !== 'undo' && act.type !== 'redo') { e.preventDefault(); return; }

    switch (act.type) {
      case 'undo': store.undo(); break;
      case 'redo': store.redo(); break;
      case 'export': app.exportAs(act.arg); break;
      case 'fit': if (handlers.fit) handlers.fit(); break;
      case 'share': if (handlers.share) handlers.share(); break;
      case 'theme': if (handlers.theme) handlers.theme(); break;
      case 'help': if (handlers.help) handlers.help(); break;
      case 'sides': store.setParams({ n: act.arg }); break;
      case 'animate': store.setView({ animating: !store.view.animating }); break;
      default: return;
    }
    e.preventDefault();
  }
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
