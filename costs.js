/* Work › Costs in the Centar DEVA hub (operator, 22 Nov 2026): every cost this project made that we know of, from the
 * assistant's server (tools/assistant/costs.mjs): totals, by kind and by month, every cost with how it is known
 * (measured, estimated, entered), what is tracked and what is not yet, and a form to enter one by hand. Admins only.
 * Later: more sources, income, and a Finances section of its own. Loaded by hub.config.js `after`. */
(function () {
  var H = window.Hub; if (!H || window.HubCosts) return;
  var esc = H.esc, data = null, err = '', loading = null, kind = '', adding = false;
  var BASIS = { measured: 'measured', estimated: 'estimated from tokens', entered: 'entered by hand' };
  var STATUS = { tracked: 'Tracked', partial: 'Partly', entered: 'By hand', 'not yet': 'Not yet' };
  function api(path, init) {
    if (!window.HubAssistant || !window.HubAssistant.api) return Promise.reject(new Error('costs come from the hub assistant\'s server, which is not available here'));
    return window.HubAssistant.api(path, init).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'the server answered ' + r.status); return j; }); });
  }
  // tables and tiles in the hub's own classes (sitepv-list, costs-tiles)
  var P = {
    table: function (cols, rows) { return '<table class="sitepv-list"><thead><tr>' + cols.map(function (c) { return '<th scope="col">' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' + (rows.join('') || '<tr><td colspan="' + cols.length + '" class="empty">Nothing here yet.</td></tr>') + '</tbody></table>'; },
    tiles: function (list) { return '<div class="costs-tiles">' + list.map(function (t) { return '<div class="costs-tile"><span>' + esc(t.k) + '</span><b>' + esc(t.v) + '</b></div>'; }).join('') + '</div>'; }
  };
  var on = function () { return location.hash.indexOf('#/work/costs') === 0; };
  var redraw = function () { if (on()) H.render({ drawer: false }); };
  function load() { return loading || (loading = api('/costs').then(function (j) { data = j; err = ''; loading = null; redraw(); }, function (e) { err = e.message; loading = null; redraw(); })); }
  var usd = function (n) { return n == null ? '–' : '$' + (n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)); };
  var units = function (list) { var u = {}; (list || []).forEach(function (x) { u[x.unit] = (u[x.unit] || 0) + x.amount; }); return Object.keys(u).map(function (k) { return u[k] + ' ' + k; }).join(', '); };
  var today = function () { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };   // the person's own date, not UTC's
  var when = function (iso) { return iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; };

  H.route('/work/costs', function () {
    var head = '<h1>Costs</h1><p class="lead">Every cost this project has made that we know of: the hub assistant, the coding agent and its QA checks, lessons, images, services. Each says how it is known. What is not tracked yet is listed at the bottom. Income comes later, with a Finances section of its own.</p>';
    if (!data && !err) load();
    if (err) return head + '<p class="empty">' + esc(err) + '</p>';
    if (!data) return head + '<p class="empty">Loading…</p>';
    var cats = data.categories, items = data.items.filter(function (i) { return !kind || i.category === kind; });
    var tiles = P.tiles([{ k: 'To date', v: usd(data.total) }, { k: 'This month', v: usd(data.thisMonth) }, { k: 'Last 30 days', v: usd(data.last30) }]) +
      (data.unpriced ? '<p class="sitepv-note">' + data.unpriced + ' cost' + (data.unpriced === 1 ? ' has' : 's have') + ' no price in dollars yet (only units, such as credits): not in the totals.</p>' : '');
    var byKind = '<h2>By kind</h2>' + P.table(['Kind', 'Amount', 'Entries', 'Also'], data.byCategory.map(function (c) {
      return '<tr><td><a href="#" data-cost-kind="' + esc(c.key) + '">' + esc(c.name) + '</a></td><td>' + esc(!c.usd && c.units.length === c.count ? '–' : usd(c.usd)) + '</td><td>' + c.count + '</td><td>' + esc(units(c.units)) + '</td></tr>';
    }));
    var byMonth = data.byMonth.length > 1 ? '<h2>By month</h2>' + P.table(['Month', 'Amount'], data.byMonth.map(function (m) { return '<tr><td>' + esc(m.month) + '</td><td>' + esc(usd(m.usd)) + '</td></tr>'; })) : '';
    var filter = '<p class="wl-surfaces" data-pick-pass><button type="button" class="btn" data-cost-kind="" aria-pressed="' + (!kind) + '">All (' + data.items.length + ')</button>' +
      data.byCategory.map(function (c) { return '<button type="button" class="btn" data-cost-kind="' + esc(c.key) + '" aria-pressed="' + (kind === c.key) + '">' + esc(c.name) + ' (' + c.count + ')</button>'; }).join('') + '</p>';
    var every = '<h2>Every cost</h2>' + filter + P.table(['When', 'What', 'Kind', 'Amount', 'How it is known'], items.map(function (i) {
      var link = i.ref && i.ref.change ? ' · <a href="#/website/preview?c=' + esc(encodeURIComponent(i.ref.change)) + '">the change</a>' : i.ref && i.ref.entry ? ' · <a href="#/work/log?e=' + esc(encodeURIComponent(i.ref.entry)) + '">in the log</a>' : '';
      return '<tr><td>' + esc(when(i.at)) + '</td><td>' + esc(i.what) + (i.model ? ' <span class="sitepv-kind">' + esc(i.model) + '</span>' : '') + link + (i.note ? '<br><span class="sitepv-note">' + esc(i.note) + '</span>' : '') + '</td><td>' + esc(cats[i.category] || i.category) + '</td><td>' +
        esc(i.usd != null ? usd(i.usd) : '') + (i.units ? (i.usd != null ? ' · ' : '') + esc(i.units.amount + ' ' + i.units.unit) : '') + '</td><td>' + esc(BASIS[i.basis] || i.basis || '') + '</td></tr>';
    }));
    var sources = '<h2>What is tracked</h2>' + P.table(['Source', 'Status', ''], data.sources.map(function (s) {
      return '<tr><td>' + esc(s.name) + '</td><td><span class="sitepv-badge" data-st="' + esc({ tracked: 'published', partial: 'proposed', entered: 'building', 'not yet': 'failed' }[s.status] || 'proposed') + '">' + esc(STATUS[s.status] || s.status) + '</span></td><td>' + esc(s.note) + '</td></tr>';
    }));
    var form = '<h2>Add a cost</h2>' + (!adding ? '<p><button type="button" class="btn" data-cost-add>Add a cost by hand</button></p>' :
      '<form class="costs-form" data-cost-form><label>What <input name="what" required maxlength="200" placeholder="e.g. Stock photo for the hero"></label>' +
      '<label>Date <input name="at" type="date" value="' + today() + '"></label>' +
      '<label>Kind <select name="category">' + Object.keys(cats).map(function (k) { return '<option value="' + esc(k) + '"' + (k === 'other' ? ' selected' : '') + '>' + esc(cats[k]) + '</option>'; }).join('') + '</select></label>' +
      '<label>Amount in USD <input name="usd" type="number" min="0" step="0.0001" placeholder="leave empty if only units are known"></label>' +
      '<label>Or units <input name="amount" type="number" min="0" step="any" placeholder="e.g. 2"> <input name="unit" maxlength="40" placeholder="e.g. Higgsfield credits"></label>' +
      '<label>Note <input name="note" maxlength="400"></label><p><button type="submit" class="btn sitepv-go">Add</button> <button type="button" class="btn" data-cost-cancel>Cancel</button></p></form>');
    return head + tiles + byKind + byMonth + every + sources + form;
  });

  document.addEventListener('click', function (e) {
    var k = e.target.closest && e.target.closest('#app-main [data-cost-kind]');
    if (k) { e.preventDefault(); kind = k.getAttribute('data-cost-kind'); return redraw(); }
    if (e.target.closest && e.target.closest('#app-main [data-cost-add]')) { adding = true; return redraw(); }
    if (e.target.closest && e.target.closest('#app-main [data-cost-cancel]')) { adding = false; return redraw(); }
  });
  document.addEventListener('submit', function (e) {
    var f = e.target.closest && e.target.closest('#app-main [data-cost-form]'); if (!f) return;
    e.preventDefault();
    var v = function (n) { return f.elements[n].value.trim(); };
    var cost = { what: v('what'), at: v('at') ? new Date(v('at') + 'T12:00:00Z').toISOString() : null, category: v('category'), usd: v('usd') === '' ? null : Number(v('usd')), units: v('amount') ? { amount: Number(v('amount')), unit: v('unit') || 'units' } : null, note: v('note') || null };
    api('/costs', { method: 'POST', body: JSON.stringify({ cost: cost }) }).then(function () { adding = false; data = null; if (H.say) H.say('Added'); load(); }, function (x) { window.alert(x.message); });
  });
  window.HubCosts = { reload: function () { data = null; return load(); } };
  if (on()) load();
})();
