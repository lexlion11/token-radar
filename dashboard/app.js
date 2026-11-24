// Token Radar dashboard controller: reads window.RADAR (written beside this page as data.js by
// main.ts), renders the ranked board, filters, a per-protocol detail view, the live-token strip
// and the model explainer. No framework, no network, one hash router for deep links.
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) return;

  var M = R.model;
  var watch = {};
  // The watchlist membership is not shipped per row; the board's early rows are everything the
  // watchlist does not name, so derive the flag from the counts the snapshot carries.
  var watchlistSlugs = {};
  (function () {
    // rows are ranked; the first watchlist_size rows are not necessarily the watchlist — instead
    // mark rows whose rank is within the watchlist count only when the snapshot says so. We cannot
    // know per row, so we use the floor: watchlist rows hold tvl >= floor_usd.
    for (var i = 0; i < R.rows.length; i++) {
      var r = R.rows[i];
      watchlistSlugs[r.slug] = r.tvl_usd >= R.floor_usd;
    }
  })();

  var state = { q: '', cat: '', chain: '', min: 0, wl: false, sortKey: 'implied_value_usd', sortDir: -1 };

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

  // ---------- header + stats ----------
  $('asof').textContent = R.as_of;
  $('modelver').textContent = R.model_version;
  var stats = [
    ['WATCHLIST', R.watchlist_size, 'g'], ['EARLY RADAR', R.early_size, 'a'],
    ['ON THE BOARD', R.board_size, ''], ['LIVE SET ASIDE', R.live_size, 'c'],
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
    if (state.min > 0) n++;
    if (state.wl) n++;
    return n;
  }
  function syncControls() {
    $('f-q').value = state.q;
    $('f-cat').value = state.cat;
    $('f-chain').value = state.chain;
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
      if (r.tvl_usd < state.min * 1e6) return false;
      if (state.wl && !watchlistSlugs[r.slug]) return false;
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

  // ---------- board table ----------
  function renderTable() {
    var rows = filtered();
    var head = document.querySelectorAll('#board thead th');
    head.forEach(function (th) {
      var k = th.dataset.k;
      var dir = k === state.sortKey ? '<span class="dir">' + (state.sortDir > 0 ? '▲' : '▼') + '</span>' : '';
      th.innerHTML = th.textContent.replace(/[▲▼]/g, '') + ' ' + dir;
    });
    var html = rows.map(function (r) {
      var ch = r.chains.length > 2 ? r.chains.slice(0, 2).join(', ') + ' +' + (r.chains.length - 2) : r.chains.join(', ');
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="rank num">' + r.rank + '</td>' +
        '<td class="name">' + (watchlistSlugs[r.slug] ? '<span class="wl-dot"></span>' : '') + esc(r.name) + '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + (r.category ? '<span class="tag">' + esc(r.category) + '</span>' : '—') + '</td>' +
        '<td class="chips">' + esc(ch) + '</td>' +
        '<td class="num">' + fmtM(r.tvl_usd) + '</td>' +
        '<td class="num ' + cls(r.change_7d) + '">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num implied">' + fmtM(r.implied_value_usd) + '</td></tr>';
    }).join('');
    $('rows').innerHTML = html;
    $('rowcount').textContent = rows.length + ' of ' + R.rows.length + ' protocols shown · ranked by implied value under ' + R.model_version;
  }

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
    var cells = [
      ['TVL', fmtM(r.tvl_usd)], ['7D TVL CHANGE', '<span class="' + cls(r.change_7d) + '">' + fmtPct(r.change_7d) + '</span>'],
      ['IMPLIED VALUE', '<span style="color:var(--amber)">' + fmtM(r.implied_value_usd) + '</span>'],
      ['RANK', '#' + r.rank + ' of ' + R.board_size],
      ['LISTED', r.listed_at || 'unknown'], ['AGE', r.age_days == null ? 'unknown' : r.age_days + ' days, no token'],
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
    $('detailview').innerHTML =
      '<button class="ghost back" id="back">← Back to board</button>' +
      '<div class="detail-head"><h2>' + esc(r.name) + '</h2><span class="detail-meta">' + esc(r.slug) + ' · pre-token · ' + (watchlistSlugs[r.slug] ? 'on the watchlist' : 'early radar') + '</span></div>' +
      '<div class="detail-grid">' + cells.map(function (c) { return '<div class="dcell"><span class="k">' + c[0] + '</span><div class="v num">' + c[1] + '</div></div>'; }).join('') + '</div>' +
      '<h2>Implied value breakdown — ' + fmtM(r.tvl_usd) + ' TVL × ' + m.base_multiple + ' base, then five multipliers</h2>' +
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
      '<div class="farm"><ol>' + r.farm_steps.map(function (s) {
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
      'catMedian = median mcap/TVL of live-token protocols in this category (overall median below ' + M.category_min_samples + ' samples)</div>' +
      rows.map(function (r) { return '<div class="mrow"><span class="mk">' + r[0] + '</span><span class="mv">' + r[1] + '</span></div>'; }).join('') +
      '<div class="mrow"><span class="mk">MODEL_VERSION</span><span class="mv">' + R.model_version + '</span></div>';
  }

  // ---------- routing ----------
  function show(id) {
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
      state = { q: '', cat: '', chain: '', min: 0, wl: false, sortKey: state.sortKey, sortDir: state.sortDir };
      parts.forEach(function (p) {
        var kv = p.split(':');
        if (kv.length !== 2) return;
        if (kv[0] === 'q') state.q = kv[1];
        if (kv[0] === 'cat') state.cat = kv[1];
        if (kv[0] === 'chain') state.chain = kv[1];
        if (kv[0] === 'min') state.min = parseInt(kv[1], 10) || 0;
        if (kv[0] === 'wl') state.wl = kv[1] === '1';
      });
      syncControls();
      renderTable();
      show('boardview');
      return;
    }
    show('boardview');
    renderTable();
  }

  // ---------- events ----------
  $('f-q').addEventListener('input', function () { state.q = $('f-q').value; renderTable(); });
  $('f-cat').addEventListener('change', function () { state.cat = $('f-cat').value; renderTable(); });
  $('f-chain').addEventListener('change', function () { state.chain = $('f-chain').value; renderTable(); });
  $('f-min').addEventListener('input', function () {
    state.min = parseInt($('f-min').value, 10);
    $('f-min-label').textContent = fmtM(state.min * 1e6);
    renderTable();
  });
  $('f-wl').addEventListener('change', function () { state.wl = $('f-wl').checked; renderTable(); });
  $('f-clear').addEventListener('click', function () {
    state.q = ''; state.cat = ''; state.chain = ''; state.min = 0; state.wl = false;
    syncControls(); renderTable();
  });
  $('f-model').addEventListener('click', function () { renderModel(); show('modelpanel'); });
  document.querySelectorAll('#board thead th').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.dataset.k;
      if (state.sortKey === k) state.sortDir = -state.sortDir;
      else { state.sortKey = k; state.sortDir = k === 'rank' || k === 'name' ? 1 : -1; }
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
  syncControls();
  route();
})();
