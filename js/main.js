// Entry point. Loaded via <script type="module" src="js/main.js"> from index.html.
//
// index.html still uses inline onclick="..." attributes (loadPreset(), exportSVG(), etc.)
// for simplicity — exposeGlobals() attaches the relevant functions to window so those
// attributes keep working without rewriting the markup to addEventListener calls.
import { initApp, exposeGlobals } from './app.js';

exposeGlobals();
initApp();
