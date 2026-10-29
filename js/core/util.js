'use strict';
/* Small shared helpers with no DOM and no planner state: escaping, ids, date strings (YYYY-MM-DD, local time),
   date / time formatting, colors. (Formatting reads a couple of display settings from `ui`, see prefs.js.) */
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const PALETTE = ['#2f6fed','#d9534f','#2e9e6b','#c98a12','#8e5bd6','#d0578f','#1c9bb0','#6b7a33','#e0702a','#5a6b8c'];

/* ---------- dates (local, YYYY-MM-DD strings) ---------- */
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { if (!n) return s; const d = parseD(s); d.setDate(d.getDate() + n); return iso(d); };
const diffDays = (a, b) => Math.round((parseD(a) - parseD(b)) / 86400000);
const todayISO = () => iso(new Date());
function weekStartOf(s) { const d = parseD(s); d.setDate(d.getDate() - (d.getDay() - ui.weekStart + 7) % 7); return iso(d); }
function fmtShort(s) { const d = parseD(s); let r = MON[d.getMonth()] + ' ' + d.getDate(); if (d.getFullYear() !== new Date().getFullYear()) r += " '" + String(d.getFullYear()).slice(2); return r; }
// sidebar date label: "Today", weekday within the next 6 days, "Next <weekday>" 7–13 days out, otherwise the date
const DOW_SHORT = ['Sun', 'Mon', 'Tues', 'Wed', 'Thurs', 'Fri', 'Sat'];
function fmtRelative(s) {
  if (ui.dateLabels === 'absolute') return fmtShort(s);
  const n = diffDays(s, todayISO()), wd = DOW_SHORT[parseD(s).getDay()];
  if (n === 0) return 'Today';
  if (n >= 1 && n <= 6) return wd;
  if (n >= 7 && n <= 13) return 'Next ' + wd;
  return fmtShort(s);
}
function fmtLong(s) { const d = parseD(s); return `${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; }

/* colors: top-level threads have their own color; sub-threads default (color: null) to a shade of their parent */
function hexToHsl(hex) {
  let r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) { const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
  return [h, s, l];
}
function hslToHex(h, s, l) {
  const f = n => { const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(c * 255).toString(16).padStart(2, '0'); };
  return '#' + f(0) + f(8) + f(4);
}
const SHADES = [.13, -.11, .22, -.19, .29, -.25];
function shade(hex, i) { const [h, s, l] = hexToHsl(hex); return hslToHex(h, s, Math.max(.2, Math.min(.8, l + SHADES[i % SHADES.length]))); }
// thread id -> color for a list of threads and everything under them (the colors the planner shows)
function colorTree(threads, parentColor, out) {
  (threads || []).forEach((t, i) => { const c = t.color || (parentColor ? shade(parentColor, i) : PALETTE[i % PALETTE.length]); out.set(t.id, c); colorTree(t.threads, c, out); });
  return out;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/* times of day: minutes from midnight */
function fmtTime(m) {
  m = ((m % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60), mm = m % 60, h12 = h % 12 || 12;
  if (ui.clock === '24') return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  return h12 + (mm ? ':' + String(mm).padStart(2, '0') : '') + (h < 12 ? 'am' : 'pm');
}
const fmtSpan = (s, d) => `${fmtTime(s)}–${fmtTime(s + d)}`;
const fmtH = h => ui.clock === '24' ? (h === 24 ? '24:00' : fmtTime(h * 60)) : (h === 0 || h === 24) ? '12am' : fmtTime(h * 60);
const fmtEnd = m => m === 1440 ? fmtH(24) : fmtTime(m);
function fmtDur(d) { const h = Math.floor(d / 60), m = d % 60; return (h ? h + ' h' : '') + (h && m ? ' ' : '') + (m ? m + ' min' : '') || '0 min'; }
