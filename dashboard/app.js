// Token Radar dashboard — vanilla JS, no framework, no network.
// Reads window.RADAR (written beside this page as data.js by main.ts) and renders the board,
// the filters, a per-protocol detail view, the live-token strip and the model explainer.
'use strict';

const R = window.RADAR || {};
const M = R.model || {};
const ROWS = Array.isArray(R.rows) ? R.rows : [];
const LIVE = Array.isArray(R.live) ? R.live : [];
const WLSET = new Set(ROWS.filter((r) => r.tvl_usd >= (R.floor_usd || 0)).map((r) => r.slug));

const $ = (id) => document.getElementById(id);

const fmtUsd = (n) => {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
  return '$' + n;
};
const fmtPct = (n) => (n === null || n === undefined || !isFinite(n)) ? '—' : (n > 0 ? '+' : '') + n.toFixed(1) + '%';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- filters ----------
const F = { q: '', cat: '', chain: '', minTvl: 0, wl: false };

function readHash() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (h.startsWith('detail=')) { renderDetail(h.slice(7)); return true; }
  if (h.startsWith('filter=')) {
    for (const part of h.slice(7).split('&')) {
      const i = part.indexOf(':');
      if (i < 0) continue;
      const k = part.slice(0, i).toLowerCase(), v = part.slice(i + 1);
      if (k === 'q' || k === 'search') F.q = v;
      else if (k === 'cat' || k === 'category') F.cat = v;
      else if (k === 'chain') F.chain = v;
      else if (k === 'mintvl') F.minTvl = Math.max(0, Math.min(250, Number(v) || 0));
      else if (k === 'wl' || k === 'watchlist') F.wl = v === '1' || v === 'true';
    }
  }
  return false;
}

function filtered() {
  const q = F.q.trim().toLowerCase();
  const min = F.minTvl * 1e6;
  return ROWS.filter((r) => {
    if (F.wl && !WLSET.has(r.slug)) return false;
    if (F.cat && (r.category || 'Uncategorized') !== F.cat) return false;
    if (F.chain && !r.chains.includes(F.chain)) return false;
    if (r.tvl_usd < min) return false;
    if (q && !(r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q))) return false;
    return true;
  });
}

function activeCount() {
  let n = 0;
  if (F.q.trim()) n++;
  if (F.cat) n++;
  if (F.chain) n++;
  if (F.minTvl > 0) n++;
  if (F.wl) n++;
  return n;
}

// ---------- sorting ----------
// sortDir flips in place when the same column is clicked twice; a new column always starts ascending.
let sortKey = 'rank', sortDir = 1;
const SORTERS = {
  rank: (a, b) => a.rank - b.rank,
  name: (a, b) => a.name.localeCompare(b.name),
  category: (a, b) => (a.category || 'Uncategorized').localeCompare(b.category || 'Uncategorized'),
  tvl: (a, b) => a.tvl_usd - b.tvl_usd,
  change: (a, b) => (a.change_7d === null ? -1e9 : a.change_7d) - (b.change_7d === null ? -1e9 : b.change_7d),
  implied: (a, b) => a.implied_value_usd - b.implied_value_usd,
};

// ---------- rendering ----------
function renderMeta() {
  $('modelVer').textContent = R.model_version || 'radar-2';
  $('meta').innerHTML =
    `<span>as of <b>${esc(R.as_of || '?')}</b></span>` +
    `<span>watchlist <b>${R.watchlist_size ?? 0}</b></span>` +
    `<span>early <b>${R.early_size ?? 0}</b></span>` +
    `<span>board <b>${R.board_size ?? ROWS.length}</b></span>` +
    `<span>live <b>${R.live_size ?? LIVE.length}</b></span>`;
  $('lede').innerHTML = `Pre-token protocols ranked by implied value — what a token would be worth if the record stayed as it is. ` +
    `<b>${R.watchlist_size ?? 0}</b> watchlist protocols above the ${fmtUsd(R.floor_usd || 0)} floor, <b>${R.early_size ?? 0}</b> early finds below it. Not a prediction of a launch.`;
}

function renderLive() {
  const note = `<span class="note">already trading — market values, not ranked, not implied</span>`;
  const chips = LIVE.slice(0, 12).map((p) => {
    const ratio = p.mcap_usd !== null && p.tvl_usd > 0 ? (p.mcap_usd / p.tvl_usd) : null;
    return `<div class="chip" title="${esc(p.category || 'Uncategorized')}"><span class="n">${esc(p.name)}</span>` +
      `<span class="v">mcap <b>${fmtUsd(p.mcap_usd)}</b>${ratio === null ? '' : ' · mcap/tvl ' + ratio.toFixed(2)}</span></div>`;
  }).join('');
  $('liveStrip').innerHTML = `<span class="lbl">LIVE TOKENS</span>${chips}${note}`;
}

function chainsCell(r) {
  const c = r.chains || [];
  const head = c.slice(0, 2).map(esc).join(', ');
  const more = c.length > 2 ? `<span class="more"> +${c.length - 2}</span>` : '';
  return head + more;
}

function renderBoard() {
  const rows = filtered().slice().sort((a, b) => sortDir * SORTERS[sortKey](a, b));
  const arrow = (k) => sortKey === k ? `<span class="arr">${sortDir > 0 ? '▲' : '▼'}</span>` : '';
  const head =
    `<thead><tr>` +
    `<th data-k="rank" class="num">rank${arrow('rank')}</th>` +
    `<th data-k="name">protocol${arrow('name')}</th>` +
    `<th data-k="category">category${arrow('category')}</th>` +
    `<th>chains</th>` +
    `<th data-k="tvl" class="num">tvl${arrow('tvl')}</th>` +
    `<th data-k="change" class="num">7d${arrow('change')}</th>` +
    `<th data-k="implied" class="num">implied value${arrow('implied')}</th>` +
    `</tr></thead>`;
  const body = rows.map((r) => {
    const ch = r.change_7d;
    const cls = ch === null || ch === undefined ? 'flat' : ch > 0.05 ? 'up' : ch < -0.05 ? 'down' : 'flat';
    return `<tr data-slug="${esc(r.slug)}" class="${WLSET.has(r.slug) ? 'wl' : ''}">` +
      `<td class="rank num${r.rank <= 3 ? ' top' : ''}">${r.rank}</td>` +
      `<td><div class="pname">${esc(r.name)}</div><div class="pslug">${esc(r.slug)}</div></td>` +
      `<td><span class="tag">${esc(r.category || 'Uncategorized')}</span></td>` +
      `<td class="chains">${chainsCell(r)}</td>` +
      `<td class="num">${fmtUsd(r.tvl_usd)}</td>` +
      `<td class="num ${cls}">${fmtPct(ch)}</td>` +
      `<td class="num iv">${fmtUsd(r.implied_value_usd)}</td></tr>`;
  }).join('');
  $('view').innerHTML = rows.length === 0
    ? `<div class="empty">no protocols match the current filters</div>`
    : `<table class="board" aria-label="Pre-token protocols ranked by implied value">${head}<tbody>${body}</tbody></table>`;
  $('view').querySelectorAll('th[data-k]').forEach((th) => {
    th.addEventListener('click', () => {
      const k = th.dataset.k;
      if (sortKey === k) sortDir = -sortDir;
      else { sortKey = k; sortDir = 1; }
      renderBoard();
    });
  });
  $('view').querySelectorAll('tbody tr').forEach((tr) => {
    tr.addEventListener('click', () => { location.hash = '#detail=' + tr.dataset.slug; });
  });
}

function factorRow(label, value, lo, hi) {
  const pct = Math.max(2, Math.min(100, ((value - lo) / (hi - lo)) * 100));
  const cls = value >= 1.15 ? 'hi' : value <= 0.85 ? 'lo' : '';
  return `<div class="frow"><span class="fk">${label}</span><span class="fbar"><i style="width:${pct}%"></i></span><span class="fv ${cls}">×${value.toFixed(3)}</span></div>`;
}

function renderDetail(slug) {
  const r = ROWS.find((x) => x.slug === slug);
  if (!r) {
    $('view').innerHTML = `<div class="empty">no protocol named ${esc(slug)} — <a href="#board">back to the board</a></div>`;
    return;
  }
  const age = r.age_days;
  const listed = r.listed_at || 'unknown';
  const steps = (r.farm_steps || []).map((s) => {
    const m = /^(.*?)\s*Cost:\s*(.*?)\.\s*Time:\s*(.*?)\.?$/s.exec(s);
    const text = m ? m[1] : s;
    const cost = m ? m[2] : '';
    const time = m ? m[3] : '';
    return `<li><div class="stext">${esc(text)}</div><div class="badges">` +
      (cost ? `<span class="badge cost">cost ${esc(cost)}</span>` : '') +
      (time ? `<span class="badge time">time ${esc(time)}</span>` : '') + `</div></li>`;
  }).join('');
  const base = r.tvl_usd * (M.base_multiple || 0.25);
  $('view').innerHTML = `<section class="detail">` +
    `<button class="back" id="dBack">← board</button>` +
    `<div class="dhead"><h2>${esc(r.name)}</h2><span class="dsl">${esc(r.slug)} · rank #${r.rank} · ${WLSET.has(r.slug) ? 'watchlist' : 'early find'}</span></div>` +
    `<div class="dgrid">` +
    `<div class="card"><h3>Record</h3><div class="stats">` +
    `<div class="stat"><div class="k">implied value</div><div class="v" style="color:var(--acc)">${fmtUsd(r.implied_value_usd)}</div></div>` +
    `<div class="stat"><div class="k">tvl</div><div class="v">${fmtUsd(r.tvl_usd)}</div></div>` +
    `<div class="stat"><div class="k">7d tvl change</div><div class="v">${fmtPct(r.change_7d)}</div></div>` +
    `<div class="stat"><div class="k">category</div><div class="v">${esc(r.category || 'Uncategorized')}</div></div>` +
    `<div class="stat"><div class="k">listed</div><div class="v">${esc(listed)}</div></div>` +
    `<div class="stat"><div class="k">no token for</div><div class="v">${age === null || age === undefined ? 'unknown' : age + ' days'}</div></div>` +
    `</div>` +
    `<h3 style="margin:14px 0 8px">Chains (${(r.chains || []).length})</h3>` +
    `<div class="dchains">${(r.chains || []).map((c) => `<span>${esc(c)}</span>`).join('') || '<span>none recorded</span>'}</div>` +
    `</div>` +
    `<div class="card"><h3>Model breakdown — ${esc(R.model_version || 'radar-2')}</h3>` +
    `<div class="factors">` +
    `<div class="frow"><span class="fk">base (tvl × ${(M.base_multiple || 0.25)})</span><span class="fbar"><i style="width:${Math.max(2, Math.min(100, (base / Math.max(base, r.implied_value_usd)) * 100))}%"></i></span><span class="fv">${fmtUsd(base)}</span></div>` +
    factorRow('growth (7d, tanh)', r.growth_multiplier || 1, 0.4, 1.6) +
    factorRow('no-token duration', r.maturity_multiplier || 1, 0.5, 1.05) +
    factorRow('category multiple', r.category_multiplier || 1, 0.5, 2.6) +
    factorRow('chain breadth', r.chain_multiplier || 1, 0.98, 1.2) +
    `</div>` +
    `<p style="margin:10px 0 0;font-size:12px;color:var(--ink-faint)">implied = base × growth × duration × category × chain breadth. Every input is the snapshot's own figure; no name is special-cased.</p>` +
    `</div>` +
    `<div class="card" style="grid-column:1/-1"><h3>Farm plan — ${esc(r.name)}</h3>` +
    `<ol class="steps">${steps}</ol></div>` +
    `</div></section>`;
  $('dBack').addEventListener('click', () => { location.hash = activeCount() ? '#filter=' + hashParts() : '#board'; });
}

function hashParts() {
  const parts = [];
  if (F.q) parts.push('q:' + F.q);
  if (F.cat) parts.push('category:' + F.cat);
  if (F.chain) parts.push('chain:' + F.chain);
  if (F.minTvl > 0) parts.push('minTvl:' + F.minTvl);
  if (F.wl) parts.push('wl:1');
  return parts.join('&');
}

function renderModelPanel() {
  const c = M || {};
  $('modelPanel').innerHTML = `<h3>Model — ${esc(R.model_version || 'radar-2')}</h3>` +
    `<p><code>implied = tvl × ${c.base_multiple} × growth × duration × category × chain</code></p>` +
    `<p><b style="color:var(--ink)">growth</b> = 1 + ${c.growth_weight} × tanh(clamp(7d change %, ±${c.growth_clamp}) / ${c.growth_scale}) — a smooth, saturating transform: one wild week moves the number but cannot dominate it.</p>` +
    `<p><b style="color:var(--ink)">duration</b> = ${c.maturity_floor} + min(age, ${c.maturity_days}) / ${c.maturity_days} × ${c.maturity_range} — how long the protocol has run with no token (unknown age assumes ${c.unknown_age_days} days).</p>` +
    `<p><b style="color:var(--ink)">category</b> = clamp(1 + ${c.category_weight} × log2(1 + median mcap/tvl of the category's live-token protocols / ${c.category_ref_ratio}), ${c.category_min}, ${c.category_max}) — the market's own valuation of the category, with the whole live set's median as fallback.</p>` +
    `<p><b style="color:var(--ink)">chain</b> = 1 + ${c.chain_weight} × min(chains, ${c.chain_cap}) / ${c.chain_cap} — deployment breadth.</p>` +
    `<p>Every constant is the same for every row; the model reads only the snapshot's fields and never special-cases a protocol name.</p>` +
    `<div class="consts">${Object.keys(c).sort().map((k) => `<span>${k}=${c[k]}</span>`).join('')}</div>`;
}

// ---------- wiring ----------
function fillSelects() {
  const cats = [...new Set(ROWS.map((r) => r.category || 'Uncategorized'))].sort();
  const chains = [...new Set(ROWS.flatMap((r) => r.chains || []))].sort();
  $('fCat').innerHTML = `<option value="">all categories</option>` + cats.map((c) => `<option>${esc(c)}</option>`).join('');
  $('fChain').innerHTML = `<option value="">all chains</option>` + chains.map((c) => `<option>${esc(c)}</option>`).join('');
}

function syncControls() {
  $('fSearch').value = F.q;
  $('fCat').value = F.cat;
  $('fChain').value = F.chain;
  $('fTvl').value = F.minTvl;
  $('fTvlOut').textContent = F.minTvl > 0 ? '$' + F.minTvl + 'M' : '$0';
  $('fWl').checked = F.wl;
  const n = activeCount();
  $('fCount').textContent = n > 0 ? `(${n})` : '';
}

function refresh() {
  syncControls();
  renderBoard();
}

function init() {
  fillSelects();
  renderMeta();
  renderLive();
  renderModelPanel();
  $('foot').innerHTML = `<span class="src">data: ${esc(R.source || 'unknown')}</span>` +
    `<span>implied values are this board's own claim, never make.fun's · built for make.fun token-radar-01</span>`;

  $('fSearch').addEventListener('input', (e) => { F.q = e.target.value; refresh(); });
  $('fCat').addEventListener('change', (e) => { F.cat = e.target.value; refresh(); });
  $('fChain').addEventListener('change', (e) => { F.chain = e.target.value; refresh(); });
  $('fTvl').addEventListener('input', (e) => { F.minTvl = Number(e.target.value); refresh(); });
  $('fWl').addEventListener('change', (e) => { F.wl = e.target.checked; refresh(); });
  $('fClear').addEventListener('click', () => {
    F.q = ''; F.cat = ''; F.chain = ''; F.minTvl = 0; F.wl = false;
    location.hash = '#board'; refresh();
  });
  $('modelBtn').addEventListener('click', () => {
    const p = $('modelPanel');
    p.hidden = !p.hidden;
    $('modelBtn').setAttribute('aria-expanded', String(!p.hidden));
  });

  const route = () => {
    const h = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (h.startsWith('detail=')) renderDetail(h.slice(7));
    else { readHash(); refresh(); }
  };
  window.addEventListener('hashchange', route);
  route();
}

init();
