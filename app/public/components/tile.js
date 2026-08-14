// One number, said once, with the sentence under it that says why it matters.
// A hundred and forty pages agreeing on what a headline figure looks like is
// not a style, it is a contract.

import { $, esc } from '../core/dom.js';

export const tile = (label, big, sub = '', cls = '') => `<div class="panel tile ${cls}"><div class="panel-title">${esc(label)}</div><div class="big">${big}</div><div class="sub">${sub}</div></div>`;


// ===========================================================================
// THE OUTSIDE WORLD — the pages for everything that lets this company touch
// anything that is not itself.
// ===========================================================================
