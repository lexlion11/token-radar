// Token Radar's dashboard, radar-2 model. Reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board: a sortable, filterable table of pre-token protocols, a live-token
// strip (already trading, not ranked), a model explainer, and a per-protocol detail page with the
// model's factors and the farm plan. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', minTvl: 0, watchlistOnly: false, sort: 'implied', dir: -1, view: 'board', selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + Math.tanh(growth / model.growth_scale) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var chainCount = Math.max(1, (row.chains || []).length);
    var chainMult = 1 + (Math.min(chainCount, model.chain_cap) - 1) * model.chain_step;
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * (row.category_multiplier || 1) * chainMult));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis') >= 0 || c.indexOf('option') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('nft') >= 0) return 'List or buy $' + capital + ' of one asset on ' + name + ' on ' + chain + ' and keep the position open.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var steps = [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' }
    ];
    if (p.chains && p.chains.length > 1) {
      steps.push({ text: p.name + ' runs on ' + p.chains.length + ' chains: repeat the deposit on ' + (p.chains[1] || chain) + ' as well, so the onchain footprint is not single-chain.', cost: 'about $' + (capital >= 150 ? 8 : 4) + ' of gas on the second chain', time: '10 minutes' });
    }
    steps.push(
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    );
    return steps.map(stepText);
  }

  // ---- hash routing: #detail=<slug> and #filter=key:value&key:value ----
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var detail = hash.match(/^detail=([A-Za-z0-9_.-]+)/);
    if (detail) { state.selected = detail[1]; state.view = 'detail'; return; }
    var filter = hash.match(/^filter=([^&]+)/);
    if (!filter) return;
    var pairs = hash.slice('filter='.length).split('&');
    pairs.forEach(function (pair) {
      var kv = pair.split(':');
      if (kv.length !== 2) return;
      var k = kv[0], v = decodeURIComponent(kv[1]);
      if (k === 'q' || k === 'query') state.q = v;
      else if (k === 'category' || k === 'cat') state.category = v;
      else if (k === 'chain') state.chain = v;
      else if (k === 'minTvl' || k === 'min_tvl') state.minTvl = Number(v) * 1e6;
      else if (k === 'watchlist' || k === 'wl') state.watchlistOnly = v === '1' || v === 'true';
    });
  }
  function writeHash() {
    if (state.view === 'detail' && state.selected) { window.history.replaceState(null, '', '#detail=' + state.selected); return; }
    var pairs = [];
    if (state.q) pairs.push('q:' + encodeURIComponent(state.q));
    if (state.category !== 'all') pairs.push('category:' + encodeURIComponent(state.category));
    if (state.chain !== 'all') pairs.push('chain:' + encodeURIComponent(state.chain));
    if (state.minTvl > 0) pairs.push('minTvl:' + (state.minTvl / 1e6));
    if (state.watchlistOnly) pairs.push('watchlist:1');
    var next = pairs.length ? '#filter=' + pairs.join('&') : window.location.pathname + window.location.search;
    window.history.replaceState(null, '', next);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.minTvl > 0 && r.tvl_usd < state.minTvl) return false;
      if (state.watchlistOnly && !r.watchlist) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  function activeFilterCount() {
    var n = 0;
    if (state.q.trim()) n++;
    if (state.category !== 'all') n++;
    if (state.chain !== 'all') n++;
    if (state.minTvl > 0) n++;
    if (state.watchlistOnly) n++;
    return n;
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { html: 'Snapshot <b>' + DATA.as_of + '</b>' }),
        el('span', { html: 'Model <b>' + DATA.model_version + '</b>' }),
        el('span', { html: 'Board <b>' + DATA.board_size + '</b> rows' }),
        el('span', { html: 'Watchlist <b>' + DATA.watchlist_size + '</b> covered' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, slug, category, chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSel = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      [el('option', { value: 'all', text: 'All categories' })].concat(categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); }))
    );
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); render(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      [el('option', { value: 'all', text: 'All chains' })].concat(chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); }))
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var tvlSel = el('select', { id: 'minTvl', 'aria-label': 'Minimum TVL' },
      [['0', 'Any TVL'], ['10', 'TVL ≥ $10M'], ['50', 'TVL ≥ $50M'], ['100', 'TVL ≥ $100M'], ['500', 'TVL ≥ $500M'], ['1000', 'TVL ≥ $1B']].map(function (o) {
        return el('option', { value: o[0], text: o[1], selected: Number(o[0]) * 1e6 === state.minTvl ? 'selected' : null });
      })
    );
    tvlSel.addEventListener('change', function () { state.minTvl = Number(tvlSel.value) * 1e6; writeHash(); render(); });
    var wlBtn = el('button', { type: 'button', 'aria-pressed': state.watchlistOnly ? 'true' : 'false', text: 'Watchlist only', onclick: function () { state.watchlistOnly = !state.watchlistOnly; writeHash(); render(); } });
    var n = activeFilterCount();
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('label', { for: 'minTvl', text: 'Min TVL' }), tvlSel),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Scope' }), el('div', { class: 'toggle' }, wlBtn)),
      n > 0 ? el('button', { class: 'clear', type: 'button', text: 'Clear filters (' + n + ')', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; state.watchlistOnly = false; writeHash(); render(); } }) : null,
      el('span', { class: 'count', html: '<b>' + rows().length + '</b> of ' + DATA.board_size + ' rows shown' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { class: 'arrow', 'aria-hidden': 'true', text: state.dir < 0 ? ' ↓' : ' ↑' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; state.watchlistOnly = false; writeHash(); render(); } })
      ));
    }
    var max = list.reduce(function (m, r) { return Math.max(m, r.implied_value_usd); }, 1);
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var chainsText = (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') : '—');
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'rank', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', null, r.watchlist ? el('span', { class: 'wl-dot', title: 'On the watchlist' }) : null, document.createTextNode(r.name)),
          el('span', { class: 'sub', text: r.slug })
        )),
        el('td', null, el('span', { class: 'tag', text: r.category || 'Other' })),
        el('td', { class: 'chains-cell', text: chainsText }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        ))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Amber dot = watchlist. Select a row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'Chains' }),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value')
          )),
          tbody
        )
      )
    );
  }

  function liveStrip() {
    var cards = DATA.live.slice(0, 10).map(function (r) {
      return el('div', { class: 'live-card' },
        el('b', { text: r.name }),
        el('span', { class: 'sub', text: (r.category || 'Other') + ' · mcap ' + fmtUsd(r.mcap_usd) }),
        el('span', { class: 'ratio', text: r.ratio !== null ? 'mcap/tvl ' + r.ratio.toFixed(2) + 'x' : 'ratio n/a' })
      );
    });
    return el('section', { class: 'live-strip' },
      el('div', { class: 'head' },
        el('h2', { text: 'Live token — already trading, not ranked' }),
        el('p', { text: "These protocols already have a token, so their market cap is a fact, not a model. They are set aside from the pre-token ranking; their mcap per TVL dollar is the market's own reading of a category." })
      ),
      el('div', { class: 'live-row' }, cards)
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var consts = [
      ['BASE_MULTIPLE', m.base_multiple], ['GROWTH_WEIGHT', m.growth_weight], ['GROWTH_SCALE', m.growth_scale + '%'],
      ['GROWTH_CLAMP', m.growth_floor + '…' + m.growth_cap + '%'], ['MATURITY', m.maturity_floor + '…' + (m.maturity_floor + m.maturity_range)],
      ['MATURITY_DAYS', m.maturity_days], ['CATEGORY_POWER', m.category_power], ['CATEGORY_CLAMP', m.category_floor + '…' + m.category_cap],
      ['CATEGORY_MIN_SAMPLE', m.category_min_sample], ['CHAIN_STEP', m.chain_step], ['CHAIN_CAP', m.chain_cap]
    ];
    var catChips = (DATA.category_multipliers || []).map(function (c) {
      return el('span', { class: 'cat-mult', html: c.category + ' <b>' + c.multiplier.toFixed(2) + 'x</b>' });
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( <span class="k">tvl_usd</span> x ' + m.base_multiple + '\n' +
        '  x (1 + tanh(clamp(<span class="k">change_7d</span>, ' + m.growth_floor + ', ' + m.growth_cap + ') / ' + m.growth_scale + ') x ' + m.growth_weight + ')\n' +
        '  x (' + m.maturity_floor + ' + min(<span class="k">age_days</span>, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ')\n' +
        '  x <span class="k">category_multiplier</span>  x <span class="k">chain_multiplier</span> )'
      ),
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age — the time since the protocol was first listed, with no token on record — is how long it has run pre-token; an unlisted age uses ' + m.unknown_age_days + ' days. The category multiplier is each category\'s median market cap per TVL dollar over its own live-token protocols, against the same median network-wide, powered to ' + m.category_power + ' and clamped. The chain multiplier grows with the number of chains the protocol runs on, up to ' + m.chain_cap + '.' }),
      el('div', { class: 'consts' }, consts.map(function (c) { return el('span', { html: c[0] + '=<b>' + c[1] + '</b>' }); })),
      catChips.length ? el('div', { class: 'cat-mults' }, catChips) : null
    );
  }

  function footer() {
    return el('footer', { class: 'footer' },
      el('span', { text: 'Data: ' + DATA.source + ' · snapshot as of ' + DATA.as_of }),
      el('span', { text: 'Built for make.fun token-radar-01 · ' + DATA.model_version + ' model' })
    );
  }

  function factorRow(name, value, width, note) {
    return el('div', { class: 'factor' },
      el('span', { class: 'fname', text: name }),
      el('div', { class: 'fbar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(2, Math.min(100, Math.round(width * 100))) + '%' })),
      el('span', { class: 'fval' + (note ? ' note' : ''), text: value })
    );
  }

  function detailView() {
    var row = DATA.rows.filter(function (r) { return r.slug === state.selected; })[0];
    if (!row) {
      return el('div', { class: 'detail-page' },
        el('button', { class: 'back', type: 'button', text: '← Back to the board', onclick: function () { state.view = 'board'; state.selected = null; writeHash(); render(); } }),
        el('div', { class: 'panel', style: 'margin-top:24px' }, el('div', { class: 'empty' }, el('h2', { text: 'No such protocol' }), el('p', { text: 'That slug is not on this board.' })))
      );
    }
    var m = DATA.model;
    var recomputed = impliedOf(row, m);
    var steps = farmSteps(row);
    var chains = (row.chains || []).map(function (c) { return el('span', { class: 'tag', text: c }); });
    return el('div', { class: 'detail-page' },
      el('button', { class: 'back', type: 'button', text: '← Back to the board', onclick: function () { state.view = 'board'; state.selected = null; writeHash(); render(); } }),
      el('div', { class: 'detail-head' },
        el('span', { class: 'sub', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' · on the watchlist' : ' · early radar, below the floor') }),
        el('h1', { text: row.name }),
        el('p', { class: 'sub', text: row.slug + ' · ' + (row.category || 'Other') + ' · listed ' + (row.listed_at || 'unknown') + ' · ' + fmtAge(row.age_days) + ' pre-token' })
      ),
      el('div', { class: 'stat-grid' },
        el('div', { class: 'stat implied-stat' }, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) })),
        el('div', { class: 'stat' }, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', { class: 'stat' }, el('span', { text: '7d change' }), el('b', { class: row.change_7d !== null && row.change_7d >= 0 ? 'pos' : 'neg', text: fmtPct(row.change_7d) })),
        el('div', { class: 'stat' }, el('span', { text: 'Age (no token)' }), el('b', { text: fmtAge(row.age_days) })),
        el('div', { class: 'stat' }, el('span', { text: 'Chains' }), el('b', { text: String((row.chains || []).length) }))
      ),
      el('section', { class: 'panel model', style: 'margin-top:24px' },
        el('h2', { text: 'Model breakdown' }),
        el('div', { class: 'factor-list' },
          factorRow('TVL base (x' + m.base_multiple + ')', fmtUsd(row.tvl_usd * m.base_multiple), (row.tvl_usd * m.base_multiple) / (row.implied_value_usd || 1)),
          factorRow('Growth multiplier', row.growth_multiplier.toFixed(3) + 'x', row.growth_multiplier / 1.4),
          factorRow('Maturity (no-token run)', row.maturity_multiplier.toFixed(3) + 'x', row.maturity_multiplier),
          factorRow('Category multiplier', row.category_multiplier.toFixed(3) + 'x', row.category_multiplier / 2),
          factorRow('Chain breadth (x' + (row.chains || []).length + ')', row.chain_multiplier.toFixed(3) + 'x', row.chain_multiplier / 1.3)
        ),
        el('p', { class: 'sub', style: 'margin-top:12px', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
      ),
      el('section', { class: 'panel model', style: 'margin-top:16px' },
        el('h2', { text: 'Farm plan' }),
        el('ol', { class: 'steps' }, steps.map(function (s) {
          var at = s.indexOf(' Cost: ');
          var action = at >= 0 ? s.slice(0, at) : s;
          var cost = '', time = '';
          var tail = at >= 0 ? s.slice(at + ' Cost: '.length) : '';
          var tm = tail.match(/^([^]*?)\.\s*Time:\s*([^]*?)\.$/);
          if (tm) { cost = tm[1]; time = tm[2]; }
          return el('li', null,
            el('div', { class: 'action' },
              el('b', { text: action }),
              el('div', { class: 'badges' },
                cost ? el('span', { class: 'badge cost', text: 'cost: ' + cost }) : null,
                time ? el('span', { class: 'badge time', text: 'time: ' + time }) : null
              )
            )
          );
        }))
      ),
      el('section', { class: 'panel model', style: 'margin-top:16px' },
        el('h2', { text: 'Chains' }),
        chains.length ? el('div', { class: 'chain-list' }, chains) : el('p', { class: 'sub', text: 'The snapshot names no chain for this protocol.' })
      )
    );
  }

  function openDetail(slug) {
    state.selected = slug;
    state.view = 'detail';
    writeHash();
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    app.textContent = '';
    if (state.view === 'detail' && state.selected) {
      app.appendChild(detailView());
      app.setAttribute('aria-busy', 'false');
      return;
    }
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(boardTable());
    shell.appendChild(liveStrip());
    shell.appendChild(modelPanel());
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
  }

  readHash();
  render();
  window.addEventListener('hashchange', function () {
    state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; state.watchlistOnly = false;
    state.view = 'board'; state.selected = null;
    readHash();
    render();
  });
})();
