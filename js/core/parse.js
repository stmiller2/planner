'use strict';
/* Reading what people type: dates (parseDateText) and times of day (parseTime). No DOM. */
/* ---------- typed dates ----------
   "Nov 26", "26 Nov", "11/26", "11/26/27", "2026-11-26", "fri", "next fri", "today", "tomorrow", "+3", "+2w", "26".
   Without a year: this year, unless that's more than two months ago (then next year). '' = no date, null = can't read it. */
const MONTH3 = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'], WD3 = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
function parseDateText(str, base = todayISO()) {
  let s = String(str || '').trim().toLowerCase().replace(/'(\d{2})\b/g, '20$1').replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const t = parseD(base), mk = (y, mo, d) => { const x = new Date(y, mo, d); return x.getDate() === d ? iso(x) : null; };
  const guess = (mo, d) => { const a = mk(t.getFullYear(), mo, d); return a && diffDays(a, base) < -60 ? mk(t.getFullYear() + 1, mo, d) : a; };
  const mon = w => w.length >= 3 ? MONTH3.indexOf(w.slice(0, 3)) : -1;
  let m;
  if (/^(today|tod|now)$/.test(s)) return base;
  if (/^(tomorrow|tmrw?|tom)$/.test(s)) return addDays(base, 1);
  if (s === 'yesterday') return addDays(base, -1);
  if ((m = s.match(/^([+-])\s*(\d+)\s*(d|days?|w|wks?|weeks?)?$/))) { const n = +m[2] * (m[3] && m[3][0] === 'w' ? 7 : 1); return addDays(base, m[1] === '-' ? -n : n); }
  if ((m = s.match(/^(next )?(sun|mon|tue|wed|thu|fri|sat)[a-z]*$/))) { let k = (WD3.indexOf(m[2]) - t.getDay() + 7) % 7; if (m[1]) k += 7; return addDays(base, k); }
  s = s.replace(/^(sun|mon|tue|wed|thu|fri|sat)[a-z]* (?=\S)/, '');   // "Thu Nov 26" reads as "Nov 26"
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return mk(+m[1], +m[2] - 1, +m[3]);
  if ((m = s.match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2}|\d{4}))?$/))) return m[3] ? mk(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1] - 1, +m[2]) : guess(+m[1] - 1, +m[2]);
  if ((m = s.match(/^([a-z]{3,}) ?(\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/)) && mon(m[1]) >= 0) return m[3] ? mk(+m[3], mon(m[1]), +m[2]) : guess(mon(m[1]), +m[2]);
  if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)? ?([a-z]{3,})(?: (\d{4}))?$/)) && mon(m[2]) >= 0) return m[3] ? mk(+m[3], mon(m[2]), +m[1]) : guess(mon(m[2]), +m[1]);
  if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?$/))) { const a = mk(t.getFullYear(), t.getMonth(), +m[1]); return a && a < base ? mk(t.getFullYear(), t.getMonth() + 1, +m[1]) : a; }
  return null;
}
// "9", "9:30", "930", "9.30", "2pm", "2:15 p", "14:00", "noon", "midnight". Without am/pm on a 12-hour clock,
// 1–12 is read as whichever of am/pm is closer to `ref` (the field's current time).
function parseTime(str, ref, isEnd) {
  const s = String(str).trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  if (s === 'noon') return 720;
  if (s === 'midnight') return isEnd ? 1440 : 0;
  const m = s.match(/^(\d{1,2})(?:[:.h]?(\d{2}))?(a|am|p|pm)?$/); if (!m) return NaN;
  let h = +m[1]; const mm = m[2] ? +m[2] : 0, suf = m[3];
  if (mm > 59) return NaN;
  let t;
  if (suf) { if (h < 1 || h > 12) return NaN; t = (h % 12 + (suf[0] === 'p' ? 12 : 0)) * 60 + mm; }
  else if (ui.clock === '12' && h >= 1 && h <= 12 && !/^0/.test(m[1])) {
    const a = (h % 12) * 60 + mm, p = a + 720, r = ref == null ? 720 : ref;
    t = Math.abs(p - r) < Math.abs(a - r) ? p : a;
  } else { if (h > 24) return NaN; t = h * 60 + mm; }
  if (isEnd && t === 0) t = 1440;
  return t > 1440 || (!isEnd && t === 1440) ? NaN : t;
}
