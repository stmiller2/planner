'use strict';
/* The Timeline view (button in the header; the code calls it "admire"): opening / closing, drawing (renderAdmire:
   the daily wave, conflicts, project ribbons and thread lanes with dots, the list beside it), hover lists, folding,
   and resizing the list / wave. Its data comes from timeline-data.js; its styles from css/timeline.css. */
let admOpen = false, admAnimate = false, admRange = 'all';   // open? animate the next draw? range shown ('all' or weeks)
const admCollapsed = new Set();
function openAdmire() {
  if (admOpen) return;
  admOpen = true; admAnimate = true;
  closeMenu(); hideTip(); closeTimePop(false);
  $('#app').classList.add('admon');
  renderHeader(); renderAdmire();
  $('#admire').scrollTop = 0;
}
function closeAdmire() {
  admOpen = false; admHideTip(true);
  $('#app').classList.remove('admon');
  $('#admire').innerHTML = '';
  if (calStale) render(); else renderHeader();
}

function basisPath(pts) {   // smooth B-spline through control points (stays between neighbouring values: no overshoot)
  let out = '', p = 0, x0, y0, x1, y1;
  const seg = (x, y) => { out += `C${((2 * x0 + x1) / 3).toFixed(1)},${((2 * y0 + y1) / 3).toFixed(1)} ${((x0 + 2 * x1) / 3).toFixed(1)},${((y0 + 2 * y1) / 3).toFixed(1)} ${((x0 + 4 * x1 + x) / 6).toFixed(1)},${((y0 + 4 * y1 + y) / 6).toFixed(1)}`; };
  pts.forEach(([x, y]) => {
    if (p === 0) { p = 1; out += `M${x.toFixed(1)},${y.toFixed(1)}`; }
    else if (p === 1) p = 2;
    else { if (p === 2) { p = 3; out += `L${((5 * x0 + x1) / 6).toFixed(1)},${((5 * y0 + y1) / 6).toFixed(1)}`; } seg(x, y); }
    x0 = x1; x1 = x; y0 = y1; y1 = y;
  });
  if (p === 3) { seg(x1, y1); out += `L${x1.toFixed(1)},${y1.toFixed(1)}`; }
  else if (p === 2) out += `L${x1.toFixed(1)},${y1.toFixed(1)}`;
  return out;
}

let admD = null;
function renderAdmire() {
  const el = $('#admire'); if (!admOpen || !el) return;
  const anim = admAnimate; admAnimate = false;
  const keepTop = el.scrollTop;
  admHideTip(true);
  const D = admD = admireDataFor(`${admRange}|${ui.admPlanned}|${todayISO()}`);
  // a lane inside a folded one (in the list or the timeline)
  const inFolded = L => { for (const x of laneUp(L, D.lanes, false)) if (admCollapsed.has(x.key)) return true; return false; };
  el.classList.toggle('still', !anim);
  // accent colors for the page: the biggest projects' colors
  const pc = (D.projs || []).slice().sort((a, b) => (b.n + b.np) - (a.n + a.np)).map(p => p.color).filter(Boolean);
  const g = [pc[0] || 'var(--accent)', pc[1] || (pc[0] ? shade(pc[0], 2) : '#8e5bd6'), pc[2] || (pc[0] ? shade(pc[0], 1) : '#d0578f')];
  el.style.setProperty('--g1', g[0]); el.style.setProperty('--g2', g[1]); el.style.setProperty('--g3', g[2]);
  const top = `<div class="adm-top"><div class="adm-ctl"><label class="switch"><input type="checkbox" id="admPlan" ${ui.admPlanned ? 'checked' : ''}><span class="track"></span><span>Future tasks</span></label>
    <div class="seg" id="admRange">${[['all', 'All time'], [12, '12 weeks'], [4, '4 weeks']].map(([v, l]) => `<button data-v="${v}" class="${String(admRange) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div></div></div>`;
  const foot = D.undated ? `<p class="adm-foot">+${plural(D.undated, 'finished task')} without a date</p>` : '';
  if (!D.total && !D.planned) {
    el.innerHTML = `<div class="adm-wrap">${top}<div class="adm-empty">${D.everTotal ? 'Nothing finished in this stretch. Try a longer range.' : 'Nothing finished yet. Tick off a task and it will show up here, on its day.'}</div>${foot}</div>`;
    return;
  }
  el.innerHTML = `<div class="adm-wrap">${top}<div class="adm-tl"></div>${foot}</div>`;
  const tl = $('.adm-tl', el), cs = getComputedStyle(tl);
  const W = tl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const LW = Math.round(ui.admSide ? clamp(ui.admSide, 120, Math.max(160, W * .5)) : clamp(W * .19, 150, 240)), GAP = 16, avail = Math.max(140, W - LW - GAP);
  const N = diffDays(D.R1, D.R0) + 1, weeksTotal = N / 7, MIN_DW = 26, MAX_DW = 92;
  const wpr = Math.max(1, Math.min(weeksTotal, Math.floor(avail / (7 * MIN_DW))));
  const nRows = Math.ceil(weeksTotal / wpr), dpr = wpr * 7;
  const DW = Math.min(MAX_DW, avail / dpr);
  tl.style.setProperty('--side', LW + 'px'); tl.style.setProperty('--gap', GAP + 'px');
  const dotSize = n => Math.min(n > 1 ? 18 : 10, DW - 3);
  const panelHex = getComputedStyle(el).getPropertyValue('--panel').trim() || '#ffffff';   // one size for a single task, one for a day with several
  const today = todayISO(), pad = Math.min(DW / 2 - 1, 11);
  // the wave: one layer per thread (finished first, then planned on top), smoothed; scaled so its peak fills the lane
  const dayTot = d => { const c = D.days.get(d); return c ? c.done + c.plan : 0; };
  let smMax = 0;
  for (let i = 0; i < N; i++) { const d = addDays(D.R0, i); smMax = Math.max(smMax, (dayTot(addDays(d, -1)) + 4 * dayTot(d) + dayTot(addDays(d, 1))) / 6); }
  const PH = clamp(ui.admWave || ADM_PULSE, 30, 260), PTOP = 15, PBASE = PH - 5, yScale = (PBASE - PTOP) / Math.max(smMax, .5);
  const allLanes = D.projs.flatMap(p => p.lanes);
  const layerDefs = [...allLanes.filter(L => L.n).map(L => [L, 'done']), ...allLanes.filter(L => L.np).map(L => [L, 'plan'])];
  const rowsHTML = [];
  for (let r = 0; r < nRows; r++) {
    const r0 = addDays(D.R0, r * dpr), n = Math.min(dpr, N - r * dpr), rEnd = addDays(r0, n - 1), tw = n * DW;
    const ix = d => diffDays(d, r0), xc = i => (i + .5) * DW;
    const rowDelay = anim ? Math.min(r, 3) * 0.22 : 0;
    const dl = (i, base, spread) => anim ? (base + rowDelay + (i / Math.max(1, n)) * spread).toFixed(2) : 0;
    // axis + background columns
    let axis = '', cols = '';
    for (let i = 0; i < n; i++) {
      const d = addDays(r0, i), dt = parseD(d), wd = dt.getDay(), we = wd === 0 || wd === 6;
      if (i === 0 || dt.getDate() === 1) axis += `<div class="adm-mon" style="left:${i * DW}px">${MON[dt.getMonth()]}${i === 0 || dt.getMonth() === 0 ? `<span>${dt.getFullYear()}</span>` : ''}</div>`;
      axis += `<div class="adm-day ${we ? 'we' : ''} ${d === today ? 'today' : ''}" style="left:${i * DW}px;width:${DW}px">${DW >= 30 ? `<i>${DOW[wd][0]}</i>` : ''}${dt.getDate()}</div>`;
      if (we) cols += `<div class="we" style="left:${i * DW + 1}px;width:${DW - 2}px"></div>`;
      if (i > 0 && wd === ui.weekStart) cols += `<div class="wk" style="left:${i * DW}px"></div>`;
      if (d === today) cols += `<div class="td" style="left:${xc(i)}px"></div>`;
    }
    // wave layers
    const val = (L, kind, i) => { const d = addDays(r0, i); if (d < D.R0 || d > D.R1) return 0; const o = L.own.get(d); return o ? o[kind].length : 0; };
    const xsI = []; for (let i = -1; i <= n; i++) xsI.push(i);
    let cum = xsI.map(() => 0), layers = '', defs = '';
    layerDefs.forEach(([L, kind], li) => {
      const top = xsI.map((i, j) => cum[j] + val(L, kind, i));
      if (top.every((v, j) => v === cum[j])) return;
      const up = basisPath(xsI.map((i, j) => [xc(i), PBASE - top[j] * yScale]));
      const dn = basisPath(xsI.slice().reverse().map((i, j) => [xc(i), PBASE - cum[xsI.length - 1 - j] * yScale])).replace(/^M/, 'L');
      const pl = kind === 'plan';
      defs += `<linearGradient id="admg${r}_${li}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${L.color}" stop-opacity="${pl ? .4 : .95}"/><stop offset="1" stop-color="${L.color}" stop-opacity="${pl ? .12 : .3}"/></linearGradient>`;
      layers += `<path d="${up}${dn}Z" fill="url(#admg${r}_${li})"/>`;
      if (!pl) layers += `<path d="${up}" fill="none" stroke="${L.color}" stroke-width="1" stroke-opacity=".55"/>`;   // seams between finished layers; planned ones only get the outline
      cum = top;
    });
    // outline along the very top: solid over what's done, dashed where planned tasks sit on top of it
    const doneTop = xsI.map(i => allLanes.reduce((a, L) => a + val(L, 'done', i), 0));
    const outline = (vs, dash) => vs.some(v => v) ? `<path d="${basisPath(xsI.map((i, j) => [xc(i), PBASE - vs[j] * yScale]))}" fill="none" stroke="var(--ink)" stroke-width="1.3" stroke-opacity="${dash ? .6 : .85}" stroke-linejoin="round" ${dash ? 'stroke-dasharray="4 3"' : ''}/>` : '';
    if (cum.some((v, j) => v !== doneTop[j])) layers += outline(cum, true);
    layers += outline(doneTop, false);
    let labels = '', hits = '', nInRow = 0, pInRow = 0;
    for (let i = 0; i < n; i++) {
      const d = addDays(r0, i), c = D.days.get(d), t = dayTot(d);
      if (c) { nInRow += c.done; pInRow += c.plan; }
      if (t) {
        const sm = (dayTot(addDays(d, -1)) + 4 * t + dayTot(addDays(d, 1))) / 6;
        labels += `<text class="${c.done ? '' : 'pl'}" x="${xc(i).toFixed(1)}" y="${(PBASE - sm * yScale - 6).toFixed(1)}">${t}</text>`;
      }
      hits += `<div class="adm-hit ${t ? 'has' : ''}" style="left:${i * DW}px;width:${DW}px" ${t ? `data-tip="day|${d}"` : ''}></div>`;
    }
    const pulse = `<div class="adm-g adm-pulse" style="height:${PH}px"><div></div>
      <div class="adm-trk" style="--tw:${tw}px"><svg width="${tw}" height="${PH}" style="--d:${anim ? (0.15 + rowDelay).toFixed(2) : 0}s"><defs>${defs}<clipPath id="admc${r}"><rect x="0" y="-30" width="${tw}" height="${PH + 60}"/></clipPath></defs>
        <line x1="0" x2="${tw}" y1="${PBASE}" y2="${PBASE}" stroke="var(--line)"/><g clip-path="url(#admc${r})">${layers}</g>${labels}</svg>${hits}<div class="adm-wres"></div></div></div>`;
    // conflicts in this row: gray bars with whiskers at their real ends, named in black; packed into as few lines as fit
    let cfLane = '';
    const rc = confs().filter(c => c.start && c.start <= rEnd && c.end >= r0 && c.end >= D.R0 && c.start <= D.R1).sort((a, b) => a.start < b.start ? -1 : 1);
    if (rc.length) {
      const lines = [], free = (occ, [a0, a1]) => occ.every(([b0, b1]) => a1 <= b0 || a0 >= b1);
      const its = rc.map(c => {
        const st = c.start >= r0, en = c.end <= rEnd, x0 = st ? xc(ix(c.start)) - pad : 0, x1 = en ? xc(ix(c.end)) + pad : tw, w = Math.min(220, c.title.length * 6 + 10);
        const opts = [];
        if (en && tw - (x1 + 8) >= w) opts.push(['r', x1 - x0 + 8, [x0 - 6, x1 + 14 + w]]);
        if (st && x0 - 8 >= w) opts.push(['l', -8, [x0 - 14 - w, x1 + 6]]);
        opts.push(['t', 4, [x0 - 6, Math.max(x1, x0 + 4 + w) + 6]]);
        let k = -1, o = null;
        for (let j = 0; j < lines.length && k < 0; j++) { const f = opts.find(op => free(lines[j], op[2])); if (f) { k = j; o = f; } }
        if (k < 0) { lines.push([]); k = lines.length - 1; o = opts[0]; }
        lines[k].push(o[2]);
        return { c, st, en, x0, x1, k, o };
      });
      cfLane = `<div class="adm-g adm-cfs" style="height:${lines.length * 22 + 4}px"><div></div><div class="adm-trk" style="--tw:${tw}px">${its.map(it =>
        `<div class="adm-cfw" style="top:${it.k * 22 + 2}px;left:${it.x0.toFixed(1)}px;width:${(it.x1 - it.x0).toFixed(1)}px" title="${cfTip(it.c)}">
          <div class="adm-cf ${it.st ? 's' : ''} ${it.en ? 'e' : ''}" style="--d:${dl(it.x0 / DW, .2, .6)}s"><i></i></div><span class="adm-tag cft" data-side="${it.o[0]}" style="left:${it.o[1].toFixed(1)}px;--d:${dl(it.x0 / DW, .6, .6)}s">${esc(it.c.title)}</span></div>`).join('')}</div></div>`;
    }
    // project blocks
    const clipX = (s, e) => (!s || e < r0 || s > rEnd) ? null : [s < r0 ? 0 : xc(ix(s)) - pad, e > rEnd ? tw : xc(ix(e)) + pad, s < r0, e > rEnd];
    // a lane / ribbon: a faint bar over everything shown, a solid one over what's finished
    // segments of a lane's / ribbon's bar in this row: [x0, x1, planned?, flat left?, flat right?]
    // ... plus, for a planned stretch right next to a finished one, which side it fades in from ('head' / 'tail')
    const segsOf = o => {
      const all = clipX(o.s, o.e), fin = clipX(o.ds, o.de); if (!all) return [];
      if (!fin) return [[all[0], all[1], true, all[2], all[3], null]];
      const out = [];
      if (all[0] < fin[0] - .5) out.push([all[0], fin[0], true, all[2], true, 'head']);
      out.push([fin[0], fin[1], false, fin[2] || all[0] < fin[0] - .5, fin[3] || fin[1] < all[1] - .5, null]);
      if (fin[1] < all[1] - .5) out.push([fin[1], all[1], true, true, all[3], 'tail']);
      return out;
    };
    // finished → planned isn't a step: the planned stretch fades over about a day and a half from the finished bar's look
    const rampW = (x0, x1) => Math.min(x1 - x0, Math.max(30, DW * 1.5));
    const rampStyle = (o, x0, x1, side) => {
      const w = rampW(x0, x1).toFixed(1), M = a => `color-mix(in srgb,var(--c) ${a},var(--bgc))`;
      if (o.lanes) return `background-image:${side === 'tail' ? `linear-gradient(90deg,transparent,var(--ov) ${w}px)` : `linear-gradient(90deg,var(--ov) calc(100% - ${w}px),transparent)`},var(--rib);`;
      return side === 'tail' ? `background:linear-gradient(90deg,${M('var(--a1)')},${M('calc(var(--a1) * var(--pf))')} ${w}px);`
        : `background:linear-gradient(90deg,${M('calc(var(--a0) * var(--pf))')} calc(100% - ${w}px),${M('var(--a0)')});`;
    };
    const bars = (o, cls, extra, delay, joinL, sqBL) => {
      const sg = segsOf(o); if (!sg.length) return '';
      const X0 = sg[0][0], X1 = sg[sg.length - 1][1];   // the pieces sit in one wrapper that wipes in left to right, as one stroke
      return `<div class="adm-bg" style="left:${X0.toFixed(1)}px;width:${(X1 - X0).toFixed(1)}px;--d:${delay([X0, X1])}s">` + sg.map(([x0, x1, pl, fl, fr, side], i) =>
        `<div class="adm-bar ${pl ? 'plan' : ''} ${side ? 'ramp' : ''} ${cls} ${fl || (i === 0 && joinL) ? 'cl' : ''} ${i === 0 && sqBL ? 'cbl' : ''} ${fr ? 'cr' : ''}" style="left:${(x0 - X0).toFixed(1)}px;width:${(x1 - x0).toFixed(1)}px;${extra([x0, x1])}${side ? rampStyle(o, x0, x1, side) : ''}"></div>`).join('') + '</div>';
    };
    // what a bar looks like at x: [color, opacity] (lanes fade in left to right; ribbons carry their color gradient)
    const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)), toHex = v => '#' + v.map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
    const ribColor = (p, f) => { const st = p.ribStops; if (f <= st[0][1]) return st[0][0]; for (let i = 1; i < st.length; i++) if (f <= st[i][1]) { const t = (f - st[i - 1][1]) / Math.max(1e-6, st[i][1] - st[i - 1][1]), a = hex(st[i - 1][0]), b = hex(st[i][0]); return toHex(a.map((v, k) => v + (b[k] - v) * t)); } return st[st.length - 1][0]; };
    // the exact (solid) color of a bar at x, as drawn on the panel; hl: as drawn while picked out
    const mixBg = (c, a) => { const p_ = hex(c), q_ = hex(panelHex); return toHex(p_.map((v, k) => v * a + q_[k] * (1 - a))); };
    const barAt = (o, x, isRib, hl) => {
      const A0 = hl ? .72 : ADM_A0, A1 = hl ? .96 : ADM_A1, PF = hl ? .62 : ADM_PLAN;
      const sg = segsOf(o).find(([x0, x1]) => x >= x0 - .5 && x <= x1 + .5) || segsOf(o)[0];
      if (!sg) return mixBg(o.color, .5);
      const f = clamp((x - sg[0]) / Math.max(1, sg[1] - sg[0]), 0, 1);
      const col = isRib ? ribColor(o, clamp((x - (xc(diffDays(o.s, r0)) - pad)) / Math.max(1, diffDays(o.e, o.s) * DW + 2 * pad), 0, 1)) : o.color;
      let a;
      if (sg[5]) {   // a fading planned stretch
        const w = rampW(sg[0], sg[1]), t = sg[5] === 'tail' ? clamp((x - sg[0]) / w, 0, 1) : clamp((sg[1] - x) / w, 0, 1);
        a = (isRib ? 1 : sg[5] === 'tail' ? A1 : A0) * (1 + (PF - 1) * t);
      } else a = (isRib ? 1 : A0 + (A1 - A0) * f) * (sg[2] ? PF : 1);
      return mixBg(col, a);
    };
    const inkOn = c => { const [r_, g_, b_] = hex(c).map(v => v / 255); return .2126 * r_ + .7152 * g_ + .0722 * b_ > .62 ? 'rgba(0,0,0,.72)' : '#fff'; };
    const dotHTML = (tip, color, c, q, i, pie) => {
      const sz = dotSize(c + q), cls = [c ? '' : 'plan', pie ? 'pie' : ''].join(' ');
      return `<div class="adm-dot ${cls}" data-tip="${tip}" style="--c:${color};--tc:${inkOn(color)};${pie ? `--pie:${pie};` : ''}left:${xc(i)}px;--s:${sz.toFixed(1)}px;--d:${dl(i, .4, .9)}s">${c + q > 1 && sz >= 15 ? `<span>${c + q}</span>` : ''}</div>`;
    };
    let blocks = '';
    D.projs.forEach(p => {
      if (p.e < r0 || p.s > rEnd) return;
      const folded = admCollapsed.has(p.key);
      const hasKids = new Set(p.lanes.map(L => L.parentKey).filter(Boolean));
      const vis = folded ? [] : p.lanes.filter(L => !(L.e < r0 || L.s > rEnd) && !inFolded(L));
      // each lane's dots in this row (a folded lane carries everything under it), and where its name could go
      const G = new Map();
      vis.forEach(L => {
        const lf = hasKids.has(L.key) && admCollapsed.has(L.key);
        const parts = lf ? p.lanes.filter(x => laneUnder(x, L.key, D.lanes)) : [L];
        const cells = new Map();   // day -> { done, plan }
        parts.forEach(x => x.own.forEach((o, d) => { if (d < r0 || d > rEnd) return; const c = cells.get(d) || { done: 0, plan: 0 }; c.done += o.done.length; c.plan += o.plan.length; cells.set(d, c); }));
        const half = d => { const c = cells.get(d); return c ? dotSize(c.done + c.plan) / 2 : 0; };
        const ext = clipX(L.s, L.e), estW = Math.min(220, L.name.length * 5.4 + 10);
        const rEdge = ext[3] ? tw : Math.max(ext[1], xc(ix(L.e)) + half(L.e)), lEdge = ext[2] ? 0 : Math.min(ext[0], xc(ix(L.s)) - half(L.s));
        const xr = rEdge + 7, xl = lEdge - 7, room = ext[2] ? lEdge : lEdge - 14;   // 14: the bend of its connector
        // name options, best first: [side, x, the stretch of the row this lane then takes up]
        const opts = [];
        if (!ext[3] && tw - xr >= estW) opts.push(['r', xr, [room, xr + estW + 6]]);
        if (!ext[2] && xl >= estW) opts.push(['l', xl, [xl - estW - 6, rEdge + 6]]);
        opts.push(['t', ext[0] + 4, [room, Math.max(rEdge, ext[0] + 4 + estW) + 6]]);
        G.set(L.key, { lf, parts, cells, ext, opts });
      });
      // rows: a sub-thread shares a row with earlier lanes of the same branch (below its parent) when it fits
      const rows = [], rowOf = new Map(), tagOf = new Map();
      const free = (row, [a0, a1]) => row.occ.every(([b0, b1]) => a1 <= b0 || a0 >= b1);
      vis.forEach(L => {
        const g = G.get(L.key), pr = L.parentKey && rowOf.has(L.parentKey) ? rowOf.get(L.parentKey) : null;
        let at = null;
        if (pr !== null) for (let k = pr + 1; k < rows.length && !at; k++) {
          if (!rows[k].lanes.every(x => laneUnder(x, L.parentKey, D.lanes, false))) continue;
          const o = g.opts.find(o => o[0] !== 't' && free(rows[k], o[2])); if (o) at = [k, o];   // sharing a row: its name must fit beside it
        }
        if (!at) { rows.push({ lanes: [], occ: [] }); at = [rows.length - 1, g.opts[0]]; }
        rows[at[0]].lanes.push(L); rows[at[0]].occ.push(at[1][2]); rowOf.set(L.key, at[0]); tagOf.set(L.key, at[1]);
      });
      const yOf = new Map([[null, ADM_PROJ / 2]]);
      vis.forEach(L => yOf.set(L.key, ADM_PROJ + rowOf.get(L.key) * ADM_LANE + ADM_LANE / 2));
      // how each lane joins its parent (or the ribbon): a pipe as thick as its bar, from the parent's underside into its left end
      const joinOf = L => {
          const a = clipX(L.s, L.e); if (!a || a[2]) return null;   // starts in an earlier row: nothing to join here
          const par = L.parentKey && vis.find(x => x.key === L.parentKey) ? L.parentKey : null;
          const pL = par ? D.lanes.get(par) : p, pc = clipX(pL.s, pL.e); if (!pc) return null;
          // a thin line from the flat underside of the parent's bar (clear of its rounded end) to this bar's left tip
          const ch = (L.depth ? ADM_BAR.sub : ADM_BAR.top) / 2, ph = par ? (pL.depth ? ADM_BAR.sub : ADM_BAR.top) / 2 : ADM_BAR.rib / 2;
          const y0 = yOf.get(par) + ph, yC = yOf.get(L.key), R = Math.min(8, yC - y0 - 1), pMin = pc[0] + ph + 1;
          let d, side, xv, x1, y1;
          if (a[0] - R >= pMin) {                      // room to bend: down from the parent, curve into the bar's left end
            xv = a[0] - R; side = true; x1 = a[0]; y1 = yC;
            d = `M${xv.toFixed(1)},${y0.toFixed(1)} L${xv.toFixed(1)},${(yC - R).toFixed(1)} Q${xv.toFixed(1)},${yC} ${(xv + R).toFixed(1)},${yC} L${(a[0] + .5).toFixed(1)},${yC}`;
          } else {                                     // starts with its parent: straight down onto the flat top of the bar
            xv = Math.max(a[0] + ch + 1, pMin); side = false; x1 = xv; y1 = yC - ch + .5;
            d = `M${xv.toFixed(1)},${y0.toFixed(1)} L${xv.toFixed(1)},${y1.toFixed(1)}`;
          }
          const id = `admj${r}_${L.key.replace(/[^\w-]/g, '')}`;
          const grad = (gid, hl) => `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${xv.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}">
              <stop offset="0" stop-color="${barAt(pL, xv, !par, hl)}"/><stop offset="1" stop-color="${barAt(L, a[0] + .5, false, hl)}"/></linearGradient>`;
          return { side, par, svg: grad(id, false) + grad(id + 'h', true) +
            `<path pathLength="1" data-lk="${esc(L.key)}" data-pk="${esc(p.key)}" stroke="url(#${id})" stroke-width="1.5" style="--d:${dl(ix(L.s), .2, .5)}s;--sh:url(#${id}h)" d="${d}"/>` };
      };
      const joins = new Map(), squareBL = new Set();   // parents (null = ribbon) a join drops straight down from: square that corner
      vis.forEach(L => { const j = joinOf(L); if (j) joins.set(L.key, j); });
      // ribbon: one gradient across the project's whole span, so it carries on across rows
      const fullL = xc(diffDays(p.s, r0)) - pad, fullW = diffDays(p.e, p.s) * DW + 2 * pad;
      const rib = bars(p, '', x => `--rib:${p.rib};--rbs:${fullW.toFixed(1)}px;--rbp:${(fullL - x[0]).toFixed(1)}px;`, x => dl(x[0] / DW, .1, .5), false, squareBL.has(null));
      let pdots = '';
      if (folded) p.days.forEach((cnt, d) => {
        if (d < r0 || d > rEnd) return;
        const parts = p.lanes.filter(L => L.own.has(d)), tot = cnt.done + cnt.plan;
        pdots += dotHTML(`proj|${p.key}|${d}`, parts[0].color, cnt.done, cnt.plan, ix(d), pieOf(parts, d, tot));
      });
      let lanesH = '', links = '';
      // the timeline: packed rows
      rows.forEach(row => {
        let trk = '';
        row.lanes.forEach(L => {
          const { lf, parts, cells, ext } = G.get(L.key), [side, tx] = tagOf.get(L.key), kids = hasKids.has(L.key);
          let dots = '';
          cells.forEach((c, d) => {
            const ps = parts.filter(x => x.own.has(d)), tot = c.done + c.plan;
            dots += dotHTML(`${lf ? 'fold' : 'lane'}|${L.key}|${d}`, ps[0].color, c.done, c.plan, ix(d), pieOf(ps, d, tot));
          });
          // its name, quietly, beside its line
          dots += `<span class="adm-tag" data-side="${side}" style="left:${tx.toFixed(1)}px;--d:${dl(ext[0] / DW, .6, .6)}s">${esc(L.name)}</span>`;
          trk += `<div class="adm-sl ${L.sub ? '' : 'planonly'} ${kids ? 'par' : ''}" data-lk="${esc(L.key)}" data-pk="${esc(p.key)}" style="--c:${L.color}">${bars(L, L.depth ? 'sub' : '', () => '', x => dl(x[0] / DW, .15, .55), false, false)}${dots}</div>`;
          const jn = joins.get(L.key); if (jn) links += jn.svg;
        });
        lanesH += `<div class="adm-trk adm-row1" style="--tw:${tw}px">${trk}</div>`;
      });
      const h = ADM_PROJ + rows.length * ADM_LANE;
      // the project's name beside its ribbon: after it if there's room, else before, else just above
      const pe = clipX(p.s, p.e), pw = Math.min(260, p.name.length * 6.4 + 10);
      const pr_ = (pe[3] ? tw : pe[1]) + 8, pl_ = (pe[2] ? 0 : pe[0]) - 8;
      const [ps_, px_] = !pe[3] && tw - pr_ >= pw ? ['r', pr_] : !pe[2] && pl_ >= pw ? ['l', pl_] : ['t', pe[0] + 4];
      const ptag = `<span class="adm-tag pjt" data-side="${ps_}" style="left:${px_.toFixed(1)}px;--d:${dl(pe[0] / DW, .5, .5)}s">${esc(p.name)}</span>`;
      blocks += `<div class="adm-blk" style="height:${h}px">
        <svg class="adm-links" width="${tw}" height="${h}" style="--tw:${tw}px">${links}</svg>
        <div class="adm-g adm-lane pj ${p.n ? '' : 'planonly'}" data-lk="${esc(p.key)}" data-pk="${esc(p.key)}" style="--c:${p.color}"><div></div>
          <div class="adm-trk" style="--tw:${tw}px">${rib}${pdots}${ptag}</div></div>
        ${lanesH}</div>`;
    });
    rowsHTML.push(`<section class="adm-row" style="--tw:${tw}px;--ct:34px">
      <div class="adm-cols">${cols}</div>
      <div class="adm-g adm-axis"><div></div><div class="adm-trk" style="--tw:${tw}px">${axis}</div></div>
      ${pulse}${cfLane}${blocks}</section>`);
  }
  const list = D.projs.map(p => {
    const folded = admCollapsed.has(p.key), hasKids = new Set(p.lanes.map(L => L.parentKey).filter(Boolean));
    const head = `<div class="adm-lab adm-li pj ${p.n ? '' : 'planonly'}" data-lk="${esc(p.key)}" data-pk="${esc(p.key)}" data-admfold="${esc(p.key)}">
      <span class="tw">${folded ? '▶' : '▼'}</span><span class="nm">${esc(p.name)}</span><span class="cnt">${p.n || ''}${p.np ? `<em>+${p.np}</em>` : ''}</span></div>`;
    return head + (folded ? '' : p.lanes.filter(L => !inFolded(L)).map(L => {
      const kids = hasKids.has(L.key), lf = kids && admCollapsed.has(L.key);
      return `<div class="adm-lab adm-li ${L.arch && !p.arch ? 'arch' : ''} ${L.sub ? '' : 'planonly'} ${kids ? 'par' : ''}" data-lk="${esc(L.key)}" data-pk="${esc(p.key)}" style="--c:${L.color}" title="${esc(L.path.join(' › '))}" ${kids ? `data-admfold="${esc(L.key)}"` : ''}>
        <span class="ind" style="width:${10 + L.depth * 12}px"></span><span class="tw">${kids ? (lf ? '▶' : '▼') : ''}</span><span class="sw"></span><span class="nm">${esc(L.name)}</span><span class="cnt">${L.sub || ''}${L.subp ? `<em>+${L.subp}</em>` : ''}</span></div>`;
    }).join(''));
  }).join('');
  const sum = [D.total ? `${D.total} done` : '', D.planned ? `${D.planned} planned` : ''].filter(Boolean).join(' · ');
  tl.innerHTML = `<div class="adm-side"><div class="adm-list">${list}</div><div class="adm-sum">${sum}</div></div><div class="adm-main" style="--lw:0px">${rowsHTML.join('')}</div>
    <div class="adm-sres" style="left:${(parseFloat(cs.paddingLeft) + LW + GAP / 2 - 4.5).toFixed(1)}px"></div>`;
  // the list never runs taller than the timeline beside it (or the window); past that it scrolls
  const side = $('.adm-side', tl), main = $('.adm-main', tl);
  side.style.maxHeight = Math.max(120, Math.min(main.offsetHeight, el.clientHeight - 24)) + 'px';
  el.scrollTop = anim ? 0 : keepTop;
}

/* the list that drops down from a dot (or a day in the wave), after hovering a moment */
const admTip = $('#admtip');
let admTipFor = null, admTipWant = null, admTipTimer = null, admTipHide = null;
function admTipHTML(spec) {
  const [kind, a, b] = spec.split('|'), D = admD; if (!D) return '';
  let groups = [], day;
  const grpOf = (L, withProj) => { const o = L.own.get(day) || { done: [], plan: [] };
    return { name: L.name, up: (withProj ? [(D.projs.find(p => p.key === L.pkey) || {}).name] : []).concat(L.path.slice(0, -1)).join(' › '), color: L.color, done: o.done, plan: o.plan }; };
  if (kind === 'lane') { day = b; const L = D.lanes.get(a); if (L) groups = [grpOf(L, true)]; }
  else if (kind === 'proj') { day = b; const p = D.projs.find(x => x.key === a); if (p) groups = p.lanes.filter(L => L.own.has(day)).map(L => grpOf(L, false)); }
  else if (kind === 'fold') { day = b; const R = D.lanes.get(a), p = R && D.projs.find(x => x.key === R.pkey);
    if (p) groups = p.lanes.filter(L => laneUnder(L, a, D.lanes) && L.own.has(day)).map(L => grpOf(L, true)); }
  else { day = a; D.projs.forEach(p => p.lanes.filter(L => L.own.has(day)).forEach(L => groups.push(grpOf(L, true)))); }
  const nd = groups.reduce((s, g) => s + g.done.length, 0), np = groups.reduce((s, g) => s + g.plan.length, 0); if (!nd && !np) return '';
  const head = kind === 'proj' ? `<div class="at-g" style="--c:${groups[0].color};padding-top:2px"><span class="nm">${esc((D.projs.find(x => x.key === a) || {}).name || '')}</span></div>` : '';
  const item = (g, k, pl) => `<div class="at-i ${pl ? 'pl' : ''}" style="--c:${g.color}"><span class="ck">${pl ? '' : '✓'}</span><span>${esc(k.title || '(untitled)')}</span></div>`;
  return `<div class="at-h"><b>${fmtLong(day)}</b><span>${[nd ? nd + ' done' : '', np ? np + ' planned' : ''].filter(Boolean).join(' · ')}</span></div>${head}` + groups.map(g => `
    <div class="at-g" style="--c:${g.color}"><span class="sw"></span><span class="nm">${esc(g.name)}</span>${g.up ? `<span class="up">${esc(g.up)}</span>` : ''}</div>
    ${g.done.map(k => item(g, k, false)).join('')}${g.plan.map(k => item(g, k, true)).join('')}`).join('');
}
function admPlaceTip(anchor) {
  const html = admTipHTML(anchor.dataset.tip); if (!html) return admHideTip(true);
  $$('#admire .tipon').forEach(x => x.classList.remove('tipon'));
  admTipFor = anchor; anchor.classList.add('tipon');
  admTip.innerHTML = html; admTip.classList.remove('up');
  admTip.style.display = 'block'; admTip.style.animation = 'none'; void admTip.offsetWidth; admTip.style.animation = '';
  const r = anchor.getBoundingClientRect(), w = admTip.offsetWidth, h = admTip.offsetHeight;
  const cx = r.left + r.width / 2, left = clamp(cx - w / 2, 8, innerWidth - w - 8);
  const below = r.bottom + 8 + h < innerHeight - 8 || r.top - 8 - h < 8;
  const top = below ? Math.min(r.bottom + 8, innerHeight - h - 8) : r.top - h - 8;
  if (!below) admTip.classList.add('up');
  admTip.style.left = left + 'px'; admTip.style.top = Math.max(8, top) + 'px';
  admTip.style.setProperty('--ax', (cx - left) + 'px');
}
function admShowTip(anchor) {
  clearTimeout(admTipHide);
  if (anchor === admTipFor || anchor === admTipWant) return;
  if (admTipFor) admHideTip(true);
  clearTimeout(admTipTimer); admTipWant = anchor;
  admTipTimer = setTimeout(() => { admTipWant = null; if (anchor.isConnected && admOpen) admPlaceTip(anchor); }, ADM_TIP_DELAY);
}
function admHideTip(now) {
  clearTimeout(admTipHide);
  const go = () => { clearTimeout(admTipTimer); admTipWant = null; admTipFor = null; admTip.style.display = 'none'; $$('#admire .tipon').forEach(x => x.classList.remove('tipon')); };
  if (now) go(); else { clearTimeout(admTipTimer); admTipWant = null; admTipHide = setTimeout(go, 160); }
}
$('#admire').addEventListener('mouseover', e => { const a = e.target.closest('[data-tip]'); if (a) admShowTip(a); });
$('#admire').addEventListener('mouseout', e => {
  const a = e.target.closest('[data-tip]'); if (!a) return;
  const to = e.relatedTarget; if (to && (a.contains(to) || admTip.contains(to))) return;
  admHideTip(false);
});
admTip.addEventListener('mouseenter', () => clearTimeout(admTipHide));
admTip.addEventListener('mouseleave', e => { const to = e.relatedTarget; if (to && admTipFor && admTipFor.contains(to)) return; admHideTip(false); });
$('#admire').addEventListener('scroll', () => admHideTip(true));
$('#admire').addEventListener('mouseover', e => {
  const t = e.target.closest('.adm-li[data-lk], .adm-dot, .adm-bar, .adm-tag'), host = t && (t.dataset.lk ? t : t.closest('[data-lk]')), k = host && host.dataset.lk;
  const tl = $('#admire .adm-tl'); if (!tl || tl.dataset.spot === (k || '')) return;
  tl.dataset.spot = k || '';
  const proj = host && host.classList.contains('adm-li') && host.classList.contains('pj');
  $$('.hl, .hl2', tl).forEach(x => x.classList.remove('hl', 'hl2'));
  if (k) $$(`[data-lk="${CSS.escape(k)}"]`, tl).forEach(x => x.classList.add('hl'));
  if (k && proj) $$(`[data-pk="${CSS.escape(k)}"]:not(.hl)`, tl).forEach(x => x.classList.add('hl2'));   // a project: all of it
});
$('#admire').addEventListener('click', e => {
  const f = e.target.closest('[data-admfold]');
  if (f) { const k = f.dataset.admfold; admCollapsed.has(k) ? admCollapsed.delete(k) : admCollapsed.add(k); renderAdmire(); return; }
  const b = e.target.closest('#admRange button');
  if (b) { admRange = b.dataset.v === 'all' ? 'all' : +b.dataset.v; admAnimate = true; renderAdmire(); }
});
$('#admire').addEventListener('change', e => { if (e.target.id === 'admPlan') { ui.admPlanned = e.target.checked; saveUI(); admAnimate = true; renderAdmire(); } });
// dragging the list's edge (width) or the wave's bottom (height); the view redraws as you drag, and remembers it
let admDrag = null;
$('#admire').addEventListener('mousedown', e => {
  const x = e.target.closest('.adm-sres'), y = e.target.closest('.adm-wres'); if (!x && !y) return;
  e.preventDefault(); admHideTip(true);
  const side = $('#admire .adm-side'), wave = e.target.closest('.adm-pulse');
  admDrag = x ? { ax: 'x', p0: e.clientX, v0: side.offsetWidth } : { ax: 'y', p0: e.clientY, v0: wave.offsetHeight };
  document.body.classList.add(x ? 'adm-rs-x' : 'adm-rs-y');
});
let admDragRaf = 0;
document.addEventListener('mousemove', e => {
  if (!admDrag) return;
  const v = admDrag.v0 + (admDrag.ax === 'x' ? e.clientX : e.clientY) - admDrag.p0;
  if (admDrag.ax === 'x') ui.admSide = clamp(Math.round(v), 120, 520); else ui.admWave = clamp(Math.round(v), 30, 260);
  if (!admDragRaf) admDragRaf = requestAnimationFrame(() => { admDragRaf = 0; renderAdmire(); });
});
document.addEventListener('mouseup', () => {
  if (!admDrag) return;
  admDrag = null; document.body.classList.remove('adm-rs-x', 'adm-rs-y'); saveUI();
});
let admResize = null;
window.addEventListener('resize', () => { if (!admOpen) return; clearTimeout(admResize); admResize = setTimeout(renderAdmire, 120); });
