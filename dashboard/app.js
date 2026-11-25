// Token Radar dashboard controller, radar-6: reads window.RADAR (written beside this page as
// data.js by main.ts), renders the ranked board with a spotlight rail, filters with chips, a
// per-protocol detail view with a factor-contribution chart, the live-token strip, the model
// explainer, keyboard navigation and CSV export. No framework, no network, one hash router.
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) return;

  var M = R.model;
  // Factor palette, shared by the spotlight rail and the detail view's contribution chart.
  var FC = { base: '#8fa3b8', growth: '#4ade80', maturity: '#67e8f9', duration: '#c4b5fd', category: '#fbbf24', chain: '#60a5fa' };
  var FACTORS = [
    ['growth', 'Momentum', 'growth_multiplier'],
    ['maturity', 'Maturity', 'maturity_multiplier'],
    ['duration', 'No-token duration', 'duration_multiplier'],
    ['category', 'Category multiple', 'category_multiplier'],
    ['chain', 'Chain breadth', 'chain_multiplier'],
  ];

  var state = { q: '', cat: '', chain: '', status: '', min: 0, wl: false, sortKey: 'implied_value_usd', sortDir: -1 };
  var selIdx = -1;
  var currentView = 'boardview';

  var $ = function (id) { return document.getElementById(id); };
  var fmtM = function (usd) {
    if (usd == null) return '—';
    if (usd >= 1e12) return '$' + (usd / 1e12).toFixed(2) + 'T';
    if (usd >= 1e9) return '$' + (usd / 1e9).toFixed(2) + 'B';
    if (usd >= 1e6) return '$' + (usd / 1e6).toFixed(1) + 'M';
    if (usd >= 1e3) return '$' + (usd / 1e3).toFixed(0) + 'K';
    return '$' + usd;
  };
  var fmtPct = function (p) { return p == null ? '—' : (p > 0 ? '+' : '') + p.toFixed(1) + '%'; };
  var cls = function (p) { return p == null ? 'flat' : p > 0.05 ? 'up' : p < -0.05 ? 'down' : 'flat'; };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  // A category's own hue, hashed from its name: every category keeps one color across the page.
  function catColor(cat) {
    if (!cat) return 'var(--ink-faint)';
    var h = 0;
    for (var i = 0; i < cat.length; i++) h = (h * 31 + cat.charCodeAt(i)) % 360;
    return 'hsl(' + h + ',42%,52%)';
  }

  // ---------- header + stats ----------
  $('asof').textContent = R.as_of;
  $('modelver').textContent = R.model_version;
  var stats = [
    ['WATCHLIST', R.watchlist_size, 'g'], ['EARLY RADAR', R.early_size, 'a'],
    ['ON THE BOARD', R.board_size, ''],
    ['LIVE SET ASIDE', R.live_size, ''],
  ];
  $('stats').innerHTML = stats.map(function (s) {
    return '<div class="stat"><span class="k">' + s[0] + '</span><span class="v ' + s[2] + ' num">' + s[1] + '</span></div>';
  }).join('');

  // ---------- filter controls ----------
  var cats = {}, chains = {};
  R.rows.forEach(function (r) {
    if (r.category) cats[r.category] = 1;
    r.chains.forEach(function (c) { chains[c] = 1; });
  });
  var opt = function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; };
  $('f-cat').innerHTML = '<option value="">All categories</option>' + Object.keys(cats).sort().map(opt).join('');
  $('f-chain').innerHTML = '<option value="">All chains</option>' + Object.keys(chains).sort().map(opt).join('');

  function activeCount() {
    var n = 0;
    if (state.q) n++;
    if (state.cat) n++;
    if (state.chain) n++;
    if (state.status) n++;
    if (state.min > 0) n++;
    if (state.wl) n++;
    return n;
  }
  function syncControls() {
    $('f-q').value = state.q;
    $('f-cat').value = state.cat;
    $('f-chain').value = state.chain;
    $('f-status').value = state.status;
    $('f-min').value = state.min;
    $('f-min-label').textContent = fmtM(state.min * 1e6);
    $('f-wl').checked = state.wl;
    var n = activeCount();
    $('f-count').textContent = n ? '(' + n + ')' : '';
  }

  function filtered() {
    var q = state.q.toLowerCase();
    var out = R.rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.status && r.token_status !== state.status) return false;
      if (r.tvl_usd < state.min * 1e6) return false;
      if (state.wl && !r.watchlist) return false;
      return true;
    });
    var k = state.sortKey, d = state.sortDir;
    out.sort(function (a, b) {
      var x = a[k], y = b[k];
      if (typeof x === 'string') return x < y ? -d : x > y ? d : 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (x - y) * d;
    });
    return out;
  }

  // ---------- filter chips ----------
  function renderChips() {
    var c = [];
    if (state.q) c.push(['q', 'search "' + state.q + '"']);
    if (state.cat) c.push(['cat', 'category ' + state.cat]);
    if (state.chain) c.push(['chain', 'chain ' + state.chain]);
    if (state.status) c.push(['status', state.status + ' only']);
    if (state.min > 0) c.push(['min', 'min TVL ' + fmtM(state.min * 1e6)]);
    if (state.wl) c.push(['wl', 'watchlist only']);
    $('chips').innerHTML = c.map(function (x) {
      return '<span class="chip"><b>' + esc(x[1]) + '</b><button data-k="' + x[0] + '" aria-label="remove filter">×</button></span>';
    }).join('');
  }
  $('chips').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-k]');
    if (!b) return;
    var k = b.dataset.k;
    if (k === 'q') state.q = '';
    if (k === 'cat') state.cat = '';
    if (k === 'chain') state.chain = '';
    if (k === 'status') state.status = '';
    if (k === 'min') state.min = 0;
    if (k === 'wl') state.wl = false;
    selIdx = -1;
    syncControls(); renderChips(); renderTable();
  });

  // ---------- board table ----------
  var maxImplied = R.rows.length ? R.rows[0].implied_value_usd : 1;

  // The board's own observed ranges, so the per-row factor mini-bar reads each factor's strength
  // against the range the board itself spans: base is TVL against the largest TVL, each
  // multiplier against its own observed maximum, maturity against its model range.
  var RANGES = { tvl: 1, growth: 1, maturity: 1, duration: 1, category: 1, chain: 1 };
  R.rows.forEach(function (r) {
    RANGES.tvl = Math.max(RANGES.tvl, r.tvl_usd);
    RANGES.growth = Math.max(RANGES.growth, r.growth_multiplier);
    RANGES.duration = Math.max(RANGES.duration, r.duration_multiplier);
    RANGES.category = Math.max(RANGES.category, r.category_multiplier);
    RANGES.chain = Math.max(RANGES.chain, r.chain_multiplier);
  });
  var MIX = [
    ['base', 'TVL base', function (r) { return r.tvl_usd / RANGES.tvl; }, FC.base],
    ['growth', 'Momentum', function (r) { return (r.growth_multiplier - 1) / Math.max(1e-6, RANGES.growth - 1); }, FC.growth],
    ['maturity', 'Maturity', function (r) { return (r.maturity_multiplier - M.maturity_floor) / Math.max(1e-6, M.maturity_range); }, FC.maturity],
    ['duration', 'No-token duration', function (r) { return (r.duration_multiplier - 1) / Math.max(1e-6, RANGES.duration - 1); }, FC.duration],
    ['category', 'Category multiple', function (r) { return (r.category_multiplier - 1) / Math.max(1e-6, RANGES.category - 1); }, FC.category],
    ['chain', 'Chain breadth', function (r) { return (r.chain_multiplier - 1) / Math.max(1e-6, RANGES.chain - 1); }, FC.chain],
  ];

  /** One row's six-factor mini-bar: a colored segment per factor, its width the factor's strength
   *  against the board's own range, with a floor so thin segments stay visible. */
  function factorMix(r) {
    var segs = MIX.map(function (f) {
      var v = Math.max(0, Math.min(1, f[2](r)));
      return '<i style="width:' + Math.max(4, v * 100).toFixed(0) + '%;background:' + f[3] + '" data-l="' + f[1] + ': ' + (v * 100).toFixed(0) + '% of the board range"></i>';
    });
    return '<span class="fseg mini" title="factor mix — each segment is that factor\'s strength against the board\'s own range">' + segs.join('') + '</span>';
  }

  function renderTable() {
    var rows = filtered();
    var head = document.querySelectorAll('#board thead th');
    head.forEach(function (th) {
      var k = th.dataset.k;
      if (!k) return;
      var dir = k === state.sortKey ? '<span class="dir">' + (state.sortDir > 0 ? '▲' : '▼') + '</span>' : '';
      th.innerHTML = th.textContent.replace(/[▲▼]/g, '').trim() + ' ' + dir;
    });
    var html = rows.map(function (r, i) {
      var ch = r.chains.length > 2 ? r.chains.slice(0, 2).join(', ') + ' +' + (r.chains.length - 2) : r.chains.join(', ');
      var cc = catColor(r.category);
      var bar = Math.max(3, Math.round((r.implied_value_usd / maxImplied) * 88));
      var dot = r.watchlist ? '<span class="wl-dot" title="on the watchlist"></span>' : '';
      var trClass = (r.rank <= 3 ? 'r' + r.rank + ' ' : '') + (i === selIdx ? 'sel ' : '');
      return '<tr data-slug="' + esc(r.slug) + '"' + (trClass ? ' class="' + trClass.trim() + '"' : '') + '>' +
        '<td class="rank num">' + r.rank + '</td>' +
        '<td class="name">' + dot + esc(r.name) + '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + (r.category ? '<span class="tag" style="border-color:' + cc + ';color:' + cc + '">' + esc(r.category) + '</span>' : '—') + '</td>' +
        '<td class="chips-cell">' + esc(ch) + '</td>' +
        '<td class="num">' + fmtM(r.tvl_usd) + '</td>' +
        '<td class="num ' + cls(r.change_7d) + '">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="mix">' + factorMix(r) + '</td>' +
        '<td class="num implied">' + fmtM(r.implied_value_usd) + '<span class="ibar" style="width:' + bar + 'px"></span></td></tr>';
    }).join('');
    $('rows').innerHTML = html;
    $('rowcount').textContent = rows.length + ' of ' + R.rows.length + ' protocols shown · ranked by implied value under ' + R.model_version +
      ' · j/k move · enter open · esc back · / search';
  }

  // ---------- spotlight rail ----------
  function factorSegments(r) {
    // Each multiplier's share of the total lift over 1.0: how much of the protocol's edge each
    // factor contributes. Widths are proportional, with a floor so thin segments stay visible.
    var lifts = FACTORS.map(function (f) { return Math.max(0, r[f[2]] - 1); });
    var sum = lifts.reduce(function (a, b) { return a + b; }, 0);
    if (sum <= 0) return FACTORS.map(function () { return 14; });
    return lifts.map(function (l) { return Math.max(6, Math.round((l / sum) * 100)); });
  }

  function renderSpotlight() {
    var top = R.rows.slice(0, 5);
    $('spotlight').innerHTML = top.map(function (r) {
      var segs = factorSegments(r);
      var bars = FACTORS.map(function (f, i) {
        return '<i style="width:' + segs[i] + '%;background:' + FC[f[0]] + '"></i>';
      }).join('');
      var cc = catColor(r.category);
      return '<div class="spot" data-slug="' + esc(r.slug) + '">' +
        '<div class="sp-head"><span class="sp-name">' + esc(r.name) + '</span><span class="sp-rank">#' + r.rank + '</span></div>' +
        '<div class="sp-val">' + fmtM(r.implied_value_usd) + ' <span style="color:' + cc + ';font-size:10px">' + esc(r.category || '') + '</span></div>' +
        '<div class="fseg" title="factor mix: each multiplier\'s share of the lift over 1.0">' + bars + '</div></div>';
    }).join('');
    $('raillegend').innerHTML = FACTORS.map(function (f) {
      return '<span><i style="background:' + FC[f[0]] + '"></i>' + f[1] + '</span>';
    }).join('');
  }
  $('spotlight').addEventListener('click', function (e) {
    var s = e.target.closest('.spot');
    if (s) location.hash = '#detail=' + s.dataset.slug;
  });

  // ---------- detail view ----------
  function factorBar(label, value, max, note) {
    var pct = Math.max(2, Math.min(100, (value / max) * 100));
    return '<div class="fbar"><span class="fk">' + label + '</span>' +
      '<span class="track"><span class="fill" style="width:' + pct + '%"></span></span>' +
      '<span class="fv">' + value.toFixed(3) + '×</span></div>' +
      (note ? '<div class="fbar note"><span class="fk"></span><span>' + note + '</span></div>' : '');
  }

  function renderDetail(slug) {
    var r = null;
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === slug) { r = R.rows[i]; break; }
    if (!r) { location.hash = ''; show('boardview'); return; }
    var m = M;
    var statusWord = 'pre-token — no token, no gecko id and no symbol on record';
    var cells = [
      ['TVL', fmtM(r.tvl_usd)], ['7D TVL CHANGE', '<span class="' + cls(r.change_7d) + '">' + fmtPct(r.change_7d) + '</span>'],
      ['IMPLIED VALUE', '<span style="color:var(--amber)">' + fmtM(r.implied_value_usd) + '</span>'],
      ['RANK', '#' + r.rank + ' of ' + R.board_size],
      ['LISTED', r.listed_at || 'unknown'], ['AGE', r.age_days == null ? 'unknown' : r.age_days + ' days, no token'],
      ['FARM CAPITAL', '$' + r.farm_capital_usd + ' of position'], ['HOLD WINDOW', r.farm_hold_days + ' days'],
      ['CATEGORY', r.category || '—'], ['CHAIN BREADTH', r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's')],
    ];
    var factors = [
      ['base', 'Base (TVL × ' + m.base_multiple + ')', r.tvl_usd * m.base_multiple, r.tvl_usd * m.base_multiple],
      ['growth', 'Momentum', r.growth_multiplier, 1.8],
      ['maturity', 'Maturity', r.maturity_multiplier, 1.05],
      ['duration', 'No-token duration', r.duration_multiplier, 1.4],
      ['category', 'Category multiple', r.category_multiplier, 1.7],
      ['chain', 'Chain breadth', r.chain_multiplier, 1.35],
    ];
    // The contribution chart: one stacked bar on a log scale. The base is the TVL itself; each
    // multiplier's segment is its log-share, so the bar reads as "the TVL, then five lifts".
    var base = r.tvl_usd * m.base_multiple;
    var segs = [
      ['base', 'TVL × ' + m.base_multiple, base, FC.base, fmtM(base)],
      ['growth', 'momentum', r.growth_multiplier, FC.growth, '×' + r.growth_multiplier.toFixed(3)],
      ['maturity', 'maturity', r.maturity_multiplier, FC.maturity, '×' + r.maturity_multiplier.toFixed(3)],
      ['duration', 'duration', r.duration_multiplier, FC.duration, '×' + r.duration_multiplier.toFixed(3)],
      ['category', 'category', r.category_multiplier, FC.category, '×' + r.category_multiplier.toFixed(3)],
      ['chain', 'chain', r.chain_multiplier, FC.chain, '×' + r.chain_multiplier.toFixed(3)],
    ];
    var logs = segs.map(function (s) { return Math.log(Math.max(s[2], 1.0001)); });
    var total = logs.reduce(function (a, b) { return a + b; }, 0);
    var cbar = segs.map(function (s, i) {
      var w = Math.max(1.2, (logs[i] / total) * 100);
      return '<i style="width:' + w.toFixed(2) + '%;background:' + s[3] + '" data-l="' + s[1] + ' ' + s[4] + '"></i>';
    }).join('');
    var clegend = segs.map(function (s) {
      return '<span><i style="background:' + s[3] + '"></i>' + s[1] + ' <b style="color:var(--ink)">' + s[4] + '</b></span>';
    }).join('');

    $('detailview').innerHTML =
      '<button class="ghost back" id="back">← Back to board</button>' +
      '<div class="detail-head"><h2>' + esc(r.name) + '</h2><span class="detail-meta">' + esc(r.slug) + ' · ' + statusWord + ' · ' + (r.watchlist ? 'on the watchlist' : 'early radar') + '</span></div>' +
      '<div class="detail-grid">' + cells.map(function (c) { return '<div class="dcell"><span class="k">' + c[0] + '</span><div class="v num">' + c[1] + '</div></div>'; }).join('') + '</div>' +
      '<h2>Implied value breakdown — ' + fmtM(r.tvl_usd) + ' TVL × ' + m.base_multiple + ' base, then five multipliers (log scale)</h2>' +
      '<div class="contrib"><div class="cbar">' + cbar + '</div><div class="clegend">' + clegend + '</div>' +
      '</div>' +
      '<h2>Factor multipliers</h2>' +
      '<div class="factor-bars">' + factors.map(function (f) {
        var note = '';
        if (f[0] === 'growth') note = 'clamped to ' + m.growth_floor + '…' + m.growth_cap + '%, then tanh-squashed by ' + m.growth_squash;
        if (f[0] === 'duration') note = '1 + ' + m.duration_weight + ' × (1 − e^(−age/' + m.duration_lambda + '))';
        if (f[0] === 'category') note = 'category median mcap/TVL ' + r.category_median_ratio.toFixed(2) + '× (live tokens in ' + (r.category || 'the whole market') + ')';
        if (f[0] === 'chain') note = 'log1p of chain count, capped at ' + m.chain_max;
        return factorBar(f[1], f[2], f[3], note);
      }).join('') + '</div>' +
      '<h2>Chains securing TVL</h2><div class="chainlist">' + r.chains.map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('') + '</div>' +
      '<h2>Farm plan — ' + esc(r.name) + '</h2>' +
      '<div class="farm"><span class="farm-sum">' + esc(r.farm_summary) + '</span>' +
      '<ol>' + r.farm_steps.map(function (s) {
        var cut = s.split(' Cost: ');
        var rest = cut.length > 1 ? cut[1].split('. Time: ') : [];
        return '<li><span class="ftext">' + esc(cut[0]) + '</span><span class="badges">' +
          '<span class="badge cost">cost ' + esc(rest[0] || '—') + '</span>' +
          '<span class="badge time">' + esc((rest[1] || '').replace(/\.$/, '')) + '</span></span></li>';
      }).join('') + '</ol></div>';
    $('back').addEventListener('click', function () { location.hash = ''; });
    show('detailview');
  }

  // ---------- live strip ----------
  function renderLive() {
    $('live').innerHTML = R.live.map(function (l) {
      var ratio = l.mcap_usd && l.tvl_usd ? (l.mcap_usd / l.tvl_usd).toFixed(2) + '×' : '—';
      return '<div class="lcard"><div class="nm">' + esc(l.name) + '</div>' +
        '<div class="row"><span>mcap ' + fmtM(l.mcap_usd) + '</span><span class="ratio">mcap/TVL ' + ratio + '</span></div>' +
        '<div class="row"><span>TVL ' + fmtM(l.tvl_usd) + '</span><span class="' + cls(l.change_7d) + '">' + fmtPct(l.change_7d) + '</span></div></div>';
    }).join('');
  }

  // ---------- model panel ----------
  function renderModel() {
    var rows = [
      ['base_multiple', 'TVL → base: base = tvl × base_multiple'],
      ['growth_weight', 'momentum weight: 1 + w × tanh(g/squash)'],
      ['growth_floor / growth_cap', '7d change clamped to [floor, cap] %'],
      ['growth_squash', 'tanh denominator: smooths wild weeks'],
      ['maturity_floor / maturity_range', 'maturity = floor + min(age,1095)/1095 × range'],
      ['maturity_days', 'age at which maturity saturates'],
      ['duration_weight', 'no-token duration weight'],
      ['duration_lambda', 'duration diminishing-returns scale (days)'],
      ['category_weight', 'category multiple weight'],
      ['category_ratio_cap', 'category median mcap/TVL capped at'],
      ['category_min_samples', 'live ratios needed per category'],
      ['chain_weight', 'chain breadth weight'],
      ['chain_max', 'chain count saturates at'],
      ['unknown_age_days', 'age assumed when listed_at is null'],
    ];
    function val(k) {
      var parts = k.split(' / ');
      if (parts.length === 2) return M[parts[0]] + ' / ' + M[parts[1]];
      return M[k];
    }
    $('modelbody').innerHTML =
      '<div class="formula">implied = max(1, round( tvl × ' + M.base_multiple + ' × momentum × maturity × duration × category × chain ))<br>' +
      'momentum = 1 + ' + M.growth_weight + ' × tanh(clamp(7d, ' + M.growth_floor + '…' + M.growth_cap + ') / ' + M.growth_squash + ')<br>' +
      'maturity = ' + M.maturity_floor + ' + min(age, ' + M.maturity_days + ') / ' + M.maturity_days + ' × ' + M.maturity_range + '<br>' +
      'duration = 1 + ' + M.duration_weight + ' × (1 − e^(−age / ' + M.duration_lambda + '))<br>' +
      'category = 1 + ' + M.category_weight + ' × log1p(min(catMedian, ' + M.category_ratio_cap + ')) / log1p(' + M.category_ratio_cap + ')<br>' +
      'chain = 1 + ' + M.chain_weight + ' × log1p(min(chains, ' + M.chain_max + ')) / log1p(' + M.chain_max + ')<br>' +
      'catMedian = median mcap/TVL of live-token protocols in this category (overall median below ' + M.category_min_samples + ' samples)<br>' +
      'the board ranks protocols that record no token at all — no market cap, no gecko id, no symbol — and that stand on their own rather than as a wrapped, staked or bridged product of a token that trades; protocols with a token are shown apart, in the live strip, at the market\'s own value and never ranked</div>' +
      rows.map(function (r) { return '<div class="mrow"><span class="mk">' + r[0] + '</span><span class="mv">' + r[1] + '</span></div>'; }).join('') +
      '<div class="mrow"><span class="mk">MODEL_VERSION</span><span class="mv">' + R.model_version + '</span></div>';
  }

  // ---------- routing ----------
  function show(id) {
    currentView = id;
    ['boardview', 'detailview', 'modelpanel'].forEach(function (v) {
      $(v).hidden = v !== id;
    });
    $('liveview').hidden = id !== 'boardview';
  }
  function route() {
    var h = location.hash;
    if (h.indexOf('#detail=') === 0) { renderDetail(decodeURIComponent(h.slice(8))); return; }
    if (h.indexOf('#filter=') === 0) {
      var parts = decodeURIComponent(h.slice(8)).split(';');
      state = { q: '', cat: '', chain: '', status: '', min: 0, wl: false, sortKey: state.sortKey, sortDir: state.sortDir };
      parts.forEach(function (p) {
        var kv = p.split(':');
        if (kv.length !== 2) return;
        if (kv[0] === 'q') state.q = kv[1];
        if (kv[0] === 'cat') state.cat = kv[1];
        if (kv[0] === 'chain') state.chain = kv[1];
        if (kv[0] === 'status') state.status = kv[1];
        if (kv[0] === 'min') state.min = parseInt(kv[1], 10) || 0;
        if (kv[0] === 'wl') state.wl = kv[1] === '1';
      });
      selIdx = -1;
      syncControls(); renderChips(); renderTable();
      show('boardview');
      return;
    }
    show('boardview');
    renderTable();
  }

  // ---------- CSV export ----------
  function exportCSV() {
    var rows = filtered();
    var head = ['rank', 'slug', 'name', 'category', 'chains', 'tvl_usd', 'change_7d', 'age_days', 'implied_value_usd', 'watchlist', 'token_status', 'farm_capital_usd', 'farm_hold_days', 'growth_multiplier', 'maturity_multiplier', 'duration_multiplier', 'category_multiplier', 'chain_multiplier'];
    function csv(v) {
      v = String(v == null ? '' : v);
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    }
    var lines = [head.join(',')].concat(rows.map(function (r) {
      return [r.rank, r.slug, r.name, r.category || '', r.chains.join('|'), r.tvl_usd, r.change_7d, r.age_days, r.implied_value_usd, r.watchlist ? 1 : 0, r.token_status, r.farm_capital_usd, r.farm_hold_days, r.growth_multiplier, r.maturity_multiplier, r.duration_multiplier, r.category_multiplier, r.chain_multiplier].map(csv).join(',');
    }));
    var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    var url = URL.createObjectURL(blob);
    a.href = url;
    a.download = 'token-radar-board.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  // ---------- keyboard navigation ----------
  function scrollSel() {
    var tr = $('rows').querySelector('tr.sel');
    if (tr) tr.scrollIntoView({ block: 'nearest' });
  }
  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (currentView !== 'boardview') {
      if (e.key === 'Escape') location.hash = '';
      return;
    }
    if (e.key === '/') { e.preventDefault(); $('f-q').focus(); return; }
    var rows = filtered();
    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault();
      selIdx = Math.min(rows.length - 1, selIdx + 1);
      renderTable(); scrollSel();
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      selIdx = Math.max(0, selIdx - 1);
      renderTable(); scrollSel();
    } else if (e.key === 'Enter') {
      var r = rows[selIdx];
      if (r) location.hash = '#detail=' + r.slug;
    } else if (e.key === 'Escape') {
      selIdx = -1;
      renderTable();
    }
  });

  // ---------- events ----------
  $('f-q').addEventListener('input', function () { state.q = $('f-q').value; selIdx = -1; renderChips(); renderTable(); });
  $('f-cat').addEventListener('change', function () { state.cat = $('f-cat').value; selIdx = -1; renderChips(); renderTable(); });
  $('f-chain').addEventListener('change', function () { state.chain = $('f-chain').value; selIdx = -1; renderChips(); renderTable(); });
  $('f-status').addEventListener('change', function () { state.status = $('f-status').value; selIdx = -1; renderChips(); renderTable(); });
  $('f-min').addEventListener('input', function () {
    state.min = parseInt($('f-min').value, 10);
    $('f-min-label').textContent = fmtM(state.min * 1e6);
    selIdx = -1; renderChips(); renderTable();
  });
  $('f-wl').addEventListener('change', function () { state.wl = $('f-wl').checked; selIdx = -1; renderChips(); renderTable(); });
  $('f-clear').addEventListener('click', function () {
    state.q = ''; state.cat = ''; state.chain = ''; state.status = ''; state.min = 0; state.wl = false;
    selIdx = -1; syncControls(); renderChips(); renderTable();
  });
  $('f-csv').addEventListener('click', exportCSV);
  $('f-model').addEventListener('click', function () { renderModel(); show('modelpanel'); });
  document.querySelectorAll('#board thead th').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.dataset.k;
      if (state.sortKey === k) state.sortDir = -state.sortDir;
      else { state.sortKey = k; state.sortDir = k === 'rank' || k === 'name' ? 1 : -1; }
      selIdx = -1;
      renderTable();
    });
  });
  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr');
    if (tr) location.hash = '#detail=' + tr.dataset.slug;
  });
  window.addEventListener('hashchange', route);

  // ---------- first paint ----------
  $('datasource').textContent = 'Data: ' + R.source;
  renderLive();
  renderSpotlight();
  syncControls();
  renderChips();
  route();
})();
