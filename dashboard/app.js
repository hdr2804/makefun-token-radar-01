// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail view with the model's own
// inputs and the protocol's farm plan, the live-token comparison, and the model itself.
// No network: every byte it shows is in data.js. Views are hash-routed so each can be captured:
//   #detail=<slug> opens a protocol, #cat=<category> filters, #tab=live|model switches tab.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('app');
  if (!DATA || !app) return;
  app.setAttribute('aria-busy', 'false');

  var state = { q: '', category: 'all', chain: 'all', watchlist: false, tab: 'board', sort: 'rank', dir: 1, selected: null };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
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
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var extra = Math.min(Math.max(row.chains.length - 1, 0), model.breadth_max_chains);
    var breadth = 1 + model.breadth_per_chain * extra;
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * breadth));
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
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  function option(value, label, selected) {
    var o = el('option', { value: value }, label);
    if (selected) o.selected = true;
    return o;
  }

  var categories = [];
  var chains = [];
  DATA.rows.forEach(function (r) {
    if (r.category && categories.indexOf(r.category) < 0) categories.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  categories.sort();
  chains.sort();

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchlist && !r.watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) {
      var k = state.sort, d = state.dir, av, bv;
      if (k === 'rank') { av = a.rank; bv = b.rank; }
      else if (k === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (k === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (k === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      return (av < bv ? -1 : av > bv ? 1 : (a.slug < b.slug ? -1 : 1)) * d;
    });
  }

  function sortHead(label, key) {
    var arrow = state.sort === key ? (state.dir === 1 ? ' ▲' : ' ▼') : '';
    return el('th', { 'class': 'sortable num', onclick: function () {
      if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'rank' ? 1 : -1; }
      render();
    } }, label + arrow);
  }

  function boardTable(rows) {
    var table = el('table');
    var head = el('tr',
      sortHead('Rank', 'rank'),
      el('th', {}, 'Protocol'),
      el('th', {}, 'Category'),
      el('th', {}, 'Chains'),
      sortHead('TVL', 'tvl'),
      sortHead('7d', 'growth'),
      sortHead('Age', 'age'),
      sortHead('Implied value', 'implied'));
    table.appendChild(el('thead', {}, head));
    var body = el('tbody');
    rows.forEach(function (r) {
      var pct = el('td', { 'class': 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg') }, fmtPct(r.change_7d));
      var name = el('td', { 'class': 'name' }, r.name + ' ');
      name.appendChild(el('span', { 'class': 'slug' }, r.slug));
      if (r.watchlist) name.appendChild(el('span', { 'class': 'badge' }, 'WATCHLIST'));
      var tr = el('tr', { 'class': state.selected === r.slug ? 'sel' : '', onclick: function () { state.selected = r.slug; syncHash(); render(); scrollToDetail(); } },
        el('td', { 'class': 'num' }, String(r.rank)),
        name,
        el('td', {}, r.category || '—'),
        el('td', {}, r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '')),
        el('td', { 'class': 'num' }, fmtUsd(r.tvl_usd)),
        pct,
        el('td', { 'class': 'num' }, fmtAge(r.age_days)),
        el('td', { 'class': 'num' }, fmtUsd(r.implied_value_usd)));
      body.appendChild(tr);
    });
    table.appendChild(body);
    if (rows.length === 0) table.appendChild(el('tbody', {}, el('tr', {}, el('td', { 'class': 'empty', colspan: '8' }, 'No protocol matches this filter. Loosen it to see the board again.'))));
    return table;
  }

  function detailPanel() {
    if (!state.selected) return null;
    var r = null;
    DATA.rows.forEach(function (row) { if (row.slug === state.selected) r = row; });
    if (!r) return null;
    var recomputed = impliedOf(r, DATA.model);
    var match = recomputed === r.implied_value_usd ? 'matches the board' : 'differs from the board — check the model';
    var panel = el('section', { 'class': 'detail', id: 'detail' });
    panel.appendChild(el('h2', {}, r.name));
    panel.appendChild(el('p', { 'class': 'meta' },
      'Rank ' + r.rank + ' of ' + DATA.board_size + ' · ' + (r.category || 'no category') + ' · ' + r.chains.join(', ') + ' · tracked ' + fmtAge(r.age_days) + (r.watchlist ? ' · on the house watchlist' : '')));
    panel.appendChild(el('h3', {}, 'Why this value'));
    var grid = el('div', { 'class': 'modelgrid' });
    grid.appendChild(el('div', { 'class': 'mcell' }, el('div', { 'class': 'v' }, fmtUsd(r.tvl_usd)), el('div', { 'class': 'k' }, 'TVL')));
    grid.appendChild(el('div', { 'class': 'mcell' }, el('div', { 'class': 'v' }, fmtUsd(r.base_usd)), el('div', { 'class': 'k' }, 'Base = TVL × ' + DATA.model.base_multiple)));
    grid.appendChild(el('div', { 'class': 'mcell' }, el('div', { 'class': 'v' }, '×' + r.growth_multiplier.toFixed(2)), el('div', { 'class': 'k' }, 'Growth ' + fmtPct(r.change_7d) + ' over 7d')));
    grid.appendChild(el('div', { 'class': 'mcell' }, el('div', { 'class': 'v' }, '×' + r.maturity_multiplier.toFixed(2)), el('div', { 'class': 'k' }, 'Maturity, ' + fmtAge(r.age_days) + ' with no token')));
    grid.appendChild(el('div', { 'class': 'mcell' }, el('div', { 'class': 'v' }, '×' + r.breadth_multiplier.toFixed(2)), el('div', { 'class': 'k' }, 'Breadth, ' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's'))));
    grid.appendChild(el('div', { 'class': 'mcell' }, el('div', { 'class': 'v' }, fmtUsd(r.implied_value_usd)), el('div', { 'class': 'k' }, 'Implied value')));
    panel.appendChild(grid);
    panel.appendChild(el('p', { 'class': 'note' }, 'The page recomputes the value from the same figures — ' + fmtUsd(recomputed) + ' — and it ' + match + '.'));
    panel.appendChild(el('div', { 'class': 'formula' }, 'implied = TVL × ' + DATA.model.base_multiple + ' × growth(' + fmtPct(r.change_7d) + ') × maturity(' + fmtAge(r.age_days) + ') × breadth(' + r.chains.length + ' chains)'));
    panel.appendChild(el('h3', {}, 'How to farm it'));
    var steps = el('ol', { 'class': 'steps' });
    r.farm_steps.forEach(function (s) { steps.appendChild(el('li', {}, s)); });
    panel.appendChild(steps);
    panel.appendChild(el('p', { 'class': 'note' }, '“Records no token” is what the snapshot says — DefiLlama carries no token for this protocol. It is not proof the protocol has none, and this board does not predict whether or when a token is issued.'));
    return panel;
  }

  function liveTable() {
    var table = el('table');
    table.appendChild(el('thead', {}, el('tr',
      el('th', {}, '#'),
      el('th', {}, 'Protocol'),
      el('th', {}, 'Category'),
      el('th', { 'class': 'num' }, 'TVL'),
      el('th', { 'class': 'num' }, 'Market cap'),
      el('th', { 'class': 'num' }, 'MCap / TVL'))));
    var body = el('tbody');
    DATA.live.forEach(function (r, i) {
      var ratio = r.tvl_usd > 0 && r.mcap_usd !== null ? (r.mcap_usd / r.tvl_usd).toFixed(2) + '×' : 'n/a';
      body.appendChild(el('tr', {},
        el('td', { 'class': 'num' }, String(i + 1)),
        el('td', { 'class': 'name' }, r.name + ' ' + el('span', { 'class': 'slug' }, r.slug)),
        el('td', {}, r.category || '—'),
        el('td', { 'class': 'num' }, fmtUsd(r.tvl_usd)),
        el('td', { 'class': 'num' }, fmtUsd(r.mcap_usd)),
        el('td', { 'class': 'num' }, ratio)));
    });
    table.appendChild(body);
    return table;
  }

  function modelSection() {
    var m = DATA.model;
    var s = el('section', { 'class': 'model' });
    s.appendChild(el('h2', {}, 'The model, in full'));
    s.appendChild(el('p', {}, 'Every row is scored by the same function from the snapshot alone — no list of names, no hand-picked favourite.'));
    s.appendChild(el('div', { 'class': 'formula' },
      'base = TVL × ' + m.base_multiple + '\n' +
      'growth = clamp(7d change, ' + m.growth_floor + '%, ' + m.growth_cap + '%) → × (1 + growth × ' + m.growth_weight + ')\n' +
      'maturity = ' + m.maturity_floor + ' + min(age, ' + m.maturity_days + 'd) / ' + m.maturity_days + ' × ' + m.maturity_range + '   (unknown age: ' + m.unknown_age_days + 'd)\n' +
      'breadth = 1 + ' + m.breadth_per_chain + ' × min(chains − 1, ' + m.breadth_max_chains + ')\n' +
      'implied value = round(base × growth × maturity × breadth)'));
    s.appendChild(el('p', {}, 'Why these four inputs: TVL is the size of the bet; the 7-day change is its direction; how long a protocol has run with no token is how much launch value has piled up behind it; and the number of chains its TVL sits on is how broad its footprint is. A protocol that records a token already trades — its market cap is the market’s own answer, shown in the Live tab, never mixed into this ranking.'));
    s.appendChild(el('p', {}, 'The board is the floor, never the ceiling: the house watchlist names ' + DATA.watchlist_size + ' protocols at or above ' + fmtUsd(DATA.floor_usd) + ' of TVL with no token recorded. This board ranks all ' + DATA.board_size + ' rankable pre-token protocols in the snapshot, ' + DATA.early_size + ' of them below the floor — the early ones the radar exists to find.'));
    s.appendChild(el('p', {}, 'Model version: ' + esc(DATA.model_version) + '. Snapshot: ' + esc(DATA.as_of) + ' — ' + esc(DATA.source) + '.'));
    return s;
  }

  function scrollToDetail() {
    var d = document.getElementById('detail');
    if (d) d.scrollIntoView({ block: 'nearest' });
  }

  function syncHash() {
    var parts = [];
    if (state.tab !== 'board') parts.push('tab=' + state.tab);
    if (state.selected) parts.push('detail=' + encodeURIComponent(state.selected));
    if (state.category !== 'all') parts.push('cat=' + encodeURIComponent(state.category));
    if (state.chain !== 'all') parts.push('chain=' + encodeURIComponent(state.chain));
    if (state.watchlist) parts.push('watchlist=1');
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    var h = parts.length ? '#' + parts.join('&') : '';
    if (location.hash !== h) history.replaceState(null, '', h || location.pathname + location.search);
  }

  function readHash() {
    var h = location.hash.replace(/^#/, '');
    if (!h) return;
    h.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      var k = kv[0], v = decodeURIComponent(kv[1] || '');
      if (k === 'tab' && (v === 'live' || v === 'model')) state.tab = v;
      if (k === 'detail') state.selected = v;
      if (k === 'cat') state.category = v;
      if (k === 'chain') state.chain = v;
      if (k === 'watchlist') state.watchlist = v === '1';
      if (k === 'q') state.q = v;
    });
  }

  function render() {
    app.innerHTML = '';
    var wrap = el('div', { 'class': 'wrap' });
    var header = el('header', { 'class': 'top' });
    var title = el('div');
    title.appendChild(el('h1', {}, 'Token ', el('span', { 'class': 'radar' }, 'Radar')));
    title.appendChild(el('p', { 'class': 'sub' }, 'Which pre-token protocol is worth farming next, and what to do about it. ', el('b', {}, DATA.board_size + ' protocols'), ' ranked by what their launch would be worth — from the snapshot alone.'));
    header.appendChild(title);
    var stats = el('div', { 'class': 'stats' });
    stats.appendChild(el('div', { 'class': 'stat' }, el('div', { 'class': 'v' }, String(DATA.board_size)), el('div', { 'class': 'k' }, 'ranked rows')));
    stats.appendChild(el('div', { 'class': 'stat' }, el('div', { 'class': 'v' }, String(DATA.watchlist_size)), el('div', { 'class': 'k' }, 'on watchlist')));
    stats.appendChild(el('div', { 'class': 'stat' }, el('div', { 'class': 'v' }, String(DATA.early_size)), el('div', { 'class': 'k' }, 'early, below floor')));
    stats.appendChild(el('div', { 'class': 'stat' }, el('div', { 'class': 'v' }, DATA.as_of), el('div', { 'class': 'k' }, 'snapshot date')));
    header.appendChild(stats);
    wrap.appendChild(header);

    var tabs = el('div', { 'class': 'tabs' });
    [['board', 'Pre-token board'], ['live', 'Live tokens'], ['model', 'The model']].forEach(function (t) {
      tabs.appendChild(el('button', { 'class': 'tab' + (state.tab === t[0] ? ' on' : ''), onclick: function () { state.tab = t[0]; state.selected = null; syncHash(); render(); } }, t[1]));
    });
    wrap.appendChild(tabs);

    if (state.tab === 'board') {
      var controls = el('div', { 'class': 'controls' });
      var search = el('input', { type: 'search', placeholder: 'Search a protocol…', value: state.q, oninput: function (e) { state.q = e.target.value; syncHash(); render(); } });
      controls.appendChild(search);
      var catSel = el('select', { onchange: function (e) { state.category = e.target.value; syncHash(); render(); } });
      catSel.appendChild(option('all', 'All categories', state.category === 'all'));
      categories.forEach(function (c) { catSel.appendChild(option(c, c, state.category === c)); });
      controls.appendChild(catSel);
      var chainSel = el('select', { onchange: function (e) { state.chain = e.target.value; syncHash(); render(); } });
      chainSel.appendChild(option('all', 'All chains', state.chain === 'all'));
      chains.forEach(function (c) { chainSel.appendChild(option(c, c, state.chain === c)); });
      controls.appendChild(chainSel);
      controls.appendChild(el('label', {}, el('input', { type: 'checkbox', checked: state.watchlist ? true : null, onchange: function (e) { state.watchlist = e.target.checked; syncHash(); render(); } }), ' Watchlist only'));
      var rows = filteredRows();
      controls.appendChild(el('span', { 'class': 'count' }, rows.length + ' of ' + DATA.board_size + ' shown'));
      wrap.appendChild(controls);
      var detail = detailPanel();
      if (detail) wrap.appendChild(detail);
      wrap.appendChild(boardTable(rows));
    } else if (state.tab === 'live') {
      wrap.appendChild(el('p', { 'class': 'note' }, 'These protocols already trade. Their market cap is the market’s own value — shown here for comparison, never mixed into the pre-token ranking. Top ' + DATA.live_size + ' by market cap.'));
      wrap.appendChild(liveTable());
    } else {
      wrap.appendChild(modelSection());
    }

    wrap.appendChild(el('footer', {}, 'Token Radar · model ' + esc(DATA.model_version) + ' · snapshot ' + esc(DATA.as_of) + ' · ' + esc(DATA.source) + ' · Implied values are this board’s own claim, never a prediction that a token will be issued.'));
    app.appendChild(wrap);
    // Keep the search box focused after a keystroke re-render.
    if (state.tab === 'board' && document.activeElement === document.body) {
      var box = app.querySelector('input[type="search"]');
      if (box && state.q) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
    }
  }

  readHash();
  render();
})();
