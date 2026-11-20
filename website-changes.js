/* Website changes in the Centar DEVA hub (tasks/todo.md, "makes website changes"). Loaded by hub.config.js `after`.
 *
 *   #/website/preview?c=<id>   the real page with a change applied, in the main column: Before / After, Serbian /
 *                              English, Desktop / Phone, the changed text outlined; the list of what changes above it.
 *   #/website/changes          every change request: status, who, when; Approve (publishes) / Discard / Revert.
 *
 * The page is drawn by the site's own code (render.js + document.js from the site, the same files the build uses) from
 * the live copy (i18n.js) with the change set applied (site-changes.js), inside a sandboxed frame. Requests go to the
 * assistant's server (window.HubAssistant.api: the signed-in member's token on the published hub).
 * window.HubSite = { site(), copy(section), validate(change), preview(change, id), save(change), list() } for assistant.js. */
(function () {
  var H = window.Hub; if (!H || window.HubSite) return;
  var esc = H.esc, LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname), HC = (window.HUB_CONFIG || {}).assistant || {};
  var SITE = HC.site || (LOCAL ? 'http://localhost:8786/' : 'https://centardeva.com/');
  // The frame is sandboxed with no origin of its own. Chrome stops such a frame from loading anything from localhost
  // (private network access), so on a local preview only it gets the hub's origin; the published hub keeps the strict one.
  var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'website-changes.css?v=0109e25653'; document.head.appendChild(css);

  /* the requests are listed on Work › Tasks (views.js calls taskTable); #/website/changes stays for old links */

  /* ─── the site's own code and live copy ─── */
  var loading = null;
  function script(src) { return new Promise(function (ok, no) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = function () { s.remove(); no(new Error('could not load ' + src)); }; document.head.appendChild(s); }); }
  function site(fresh) {
    if (loading && !fresh) return loading;
    var code = window.DEVA_DOCUMENT && window.DEVA_CHANGES ? Promise.resolve()
      : script(SITE + 'assets/render.js').then(function () { return script(SITE + 'assets/document.js'); }).then(function () { return script(SITE + 'assets/site-changes.js'); });
    loading = code.then(function () { return script(SITE + 'assets/i18n.js?ts=' + Date.now()); })
      .then(function () { return { dict: JSON.parse(JSON.stringify(window.DEVA_I18N)), C: window.DEVA_CHANGES, doc: window.DEVA_DOCUMENT }; });
    loading.catch(function () { loading = null; });
    return loading;
  }

  /* the copy of one section, path by path, both languages (the assistant's read_site_copy) */
  function copy(section) {
    return site().then(function (s) {
      if (section === 'site') return 'site.social = ' + JSON.stringify((s.dict.site || {}).social || []) + '\n(networks: ' + s.C.NETWORKS.join(', ') + ')';
      var sr = s.dict.sr[section], en = s.dict.en[section]; if (sr == null) throw new Error('no section ' + section + '; sections: ' + Object.keys(s.dict.sr).join(', ') + ', site');
      var out = [];
      (function walk(a, b, path) {
        if (typeof a === 'string') return out.push(path + '\n  sr: ' + a + '\n  en: ' + (typeof b === 'string' ? b : '–'));
        if (a && typeof a === 'object') Object.keys(a).forEach(function (k) { walk(a[k], b && b[k], path + '.' + k); });
      })(sr, en, section);
      return out.join('\n');
    });
  }

  /* ─── change requests: drafts from the chat (this tab) and saved ones (the server) ─── */
  var drafts = {}, saved = null, you = { role: '' }, publishing = false, poll = null, err = '';
  try { drafts = JSON.parse(sessionStorage.getItem('devacentar-hub:site-drafts') || '{}'); } catch (e) {}
  var keepDrafts = function () { try { sessionStorage.setItem('devacentar-hub:site-drafts', JSON.stringify(drafts)); } catch (e) {} };
  function api(path, init) {
    if (!window.HubAssistant || !window.HubAssistant.api) return Promise.reject(new Error('the assistant is not available here'));
    return window.HubAssistant.api(path, init).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'the server answered ' + r.status); return j; }); });
  }
  var listing = null;
  function list() {
    return (listing = api('/changes').then(function (j) {
      saved = j.changes; you = j.you || you; publishing = !!j.publishing; err = '';
      clearTimeout(poll); if (saved.some(function (c) { return /ing$/.test(c.status); })) poll = setTimeout(function () { list().then(redraw, redraw); }, 8000);
      return saved;
    }, function (e) { err = e.message; throw e; })).then(function (x) { listing = null; return x; }, function (e) { listing = null; throw e; });
  }
  var ensure = function () { if (!saved && !err && !listing) list().then(redraw, redraw); };
  function redraw() { var p = location.hash.slice(1); if (p.indexOf('/website/changes') === 0 || p.indexOf('/website/preview') === 0 || p.indexOf('/work/tasks') === 0) H.render({ drawer: false }); }
  function find(id) { return drafts[id] ? { id: id, draft: true, status: 'draft', change: drafts[id] } : (saved || []).filter(function (c) { return c.id === id; })[0]; }
  function validate(change) { return site().then(function (s) { return s.C.validate(s.dict, change); }); }
  function preview(change, id) { drafts[id] = change; keepDrafts(); location.hash = '#/website/preview?c=' + encodeURIComponent(id); }
  function save(change, draftId) {
    return api('/changes', { method: 'POST', body: JSON.stringify({ change: change }) }).then(function (doc) {
      if (draftId) { delete drafts[draftId]; keepDrafts(); }
      saved = [doc].concat(saved || []); list().then(redraw, redraw);
      if (location.hash.indexOf('c=' + encodeURIComponent(draftId)) > 0) location.hash = '#/website/preview?c=' + doc.id; else redraw();
      return doc;
    });
  }
  // a layout / code change: the coding agent builds it on a branch; its preview appears on the change's page
  function request(code) {
    return api('/changes', { method: 'POST', body: JSON.stringify({ code: code }) }).then(function (doc) { saved = [doc].concat(saved || []); location.hash = '#/website/preview?c=' + doc.id; list().then(redraw, redraw); return doc; });
  }
  function revise(id, feedback) {
    return api('/changes/' + id + '/revise', { method: 'POST', body: JSON.stringify({ feedback: feedback }) }).then(function (doc) { return list().then(function () { redraw(); return doc; }); });
  }
  function act(id, what) {
    if (what === 'revise') {
      var f = window.prompt('What should the coding agent change in this version?'); if (!f || !f.trim()) return;
      return revise(id, f.trim()).then(function () {}, function (e) { window.alert(e.message); });
    }
    var q = { approve: 'Publish this change to centardeva.com now?', revert: 'Undo this change on centardeva.com?', discard: 'Discard this proposal?', retry: 'Try this change again? If the agent already made it, only the preview is rebuilt (no cost).' }[what];
    if (!window.confirm(q)) return;
    api('/changes/' + id + '/' + what, { method: 'POST', body: '{}' }).then(function () { H.say ? H.say('Done') : 0; return list(); }).then(redraw, function (e) { window.alert(e.message); });
  }

  /* ─── the preview ─── */
  var view = { lang: 'sr', mode: 'after', width: 'desktop', marks: 'on' };
  var STATUS = { draft: 'Not saved yet', building: 'The coding agent is working…', proposed: 'Waiting for approval', publishing: 'Publishing…', published: 'Live', failed: 'Failed', reverting: 'Undoing…', reverted: 'Undone', discarded: 'Discarded' };
  function highlight(o) {   // runs inside the preview frame
    var norm = function (s) { return String(s).replace(/\s+/g, ' ').trim(); }, hits = [];
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) { var t = norm(walker.currentNode.nodeValue); if (t && o.marks.indexOf(t) >= 0 && hits.indexOf(walker.currentNode.parentElement) < 0) hits.push(walker.currentNode.parentElement); }
    if (o.social) { var s = document.querySelector(o.after ? '.deva-social' : '.deva-contact'); if (s) hits.push(s); }
    hits.forEach(function (h) { h.classList.add('deva-changed'); });
    if (hits[0]) setTimeout(function () { hits[0].scrollIntoView({ block: 'center' }); }, 60);
  }
  function srcdoc(s, change) {
    var after = view.mode === 'after', d = after ? s.C.apply(s.dict, change) : s.dict;
    var diff = s.C.diff(s.dict, change), lang = view.lang;
    var marks = view.marks === 'off' ? [] : diff.filter(function (x) { return x.lang === lang; }).map(function (x) { return String(after ? x.after : x.before).replace(/\s+/g, ' ').trim(); });
    var add = '<base href="' + SITE + (lang === 'sr' ? 'rs' : 'en') + '/" target="_blank">';
    var hl = '<style>.deva-changed{outline:3px solid #E0A84A!important;outline-offset:6px;border-radius:2px}</style><script>(' + highlight.toString() + ')(' + JSON.stringify({ marks: marks, social: view.marks !== 'off' && diff.some(function (x) { return !x.lang; }), after: after }).replace(/</g, '\\u003c') + ');<\/script>';
    return s.doc.html(d, lang, 'home').replace('<head>', '<head>' + add).replace('</body>', hl + '</body>');
  }
  function fill() {
    var f = document.querySelector('#app-main [data-sitepv]'); if (!f || f.getAttribute('data-filled') === key()) return;
    var c = find(f.getAttribute('data-sitepv')); if (!c) return;
    f.setAttribute('data-filled', key());
    if (c.lane === 'code') { var base = view.mode === 'after' && c.preview ? c.preview.preview.replace(/\/?$/, '/') : 'https://centardeva.com/'; f.src = base + (view.lang === 'sr' ? 'rs' : 'en') + '/'; return; }
    site().then(function (s) { f.srcdoc = srcdoc(s, c.change); }, function (e) { f.replaceWith(Object.assign(document.createElement('p'), { className: 'empty', textContent: e.message })); });
  }
  var key = function () { return view.lang + view.mode + view.width + view.marks; };
  function seg(name, opts) {
    return '<div class="sitepv-seg" role="group" aria-label="' + esc(name) + '">' + opts.map(function (o) {
      return '<button type="button" data-pv="' + o[0] + '" data-pv-v="' + o[1] + '" aria-pressed="' + (view[o[0]] === o[1]) + '">' + esc(o[2]) + '</button>';
    }).join('') + '</div>';
  }
  function actions(c) {
    if (c.draft) return '<p class="sitepv-note">Save or discard it in the chat.</p>';
    var a = [], admin = you.role === 'admin';
    if (admin && ['proposed', 'failed'].indexOf(c.status) >= 0 && (c.lane !== 'code' || c.preview)) a.push('<button type="button" class="sitepv-go" data-chg="approve" data-id="' + esc(c.id) + '"' + (publishing ? '' : ' disabled title="Publishing is not set up yet"') + '>Approve and publish</button>');
    if (['proposed', 'failed'].concat(c.lane === 'code' ? ['building'] : []).indexOf(c.status) >= 0 && (admin || c.by === you.uid)) a.push('<button type="button" data-chg="discard" data-id="' + esc(c.id) + '">Discard</button>');
    if (admin && c.status === 'published') a.push('<button type="button" data-chg="revert" data-id="' + esc(c.id) + '">Undo on the site</button>');
    if (c.lane === 'code' && c.status === 'failed' && (admin || c.by === you.uid)) a.push('<button type="button" class="sitepv-go" data-chg="retry" data-id="' + esc(c.id) + '">Try again</button>');
    if (c.lane === 'code' && ['proposed', 'failed'].indexOf(c.status) >= 0) a.push('<button type="button" data-chg="revise" data-id="' + esc(c.id) + '">Ask for changes</button>');
    return a.length ? '<div class="sitepv-actions" data-pick-pass>' + a.join('') + '</div>' : '';
  }
  function codePage(c) {
    var p = c.preview, building = c.status === 'building', mins = c.run ? Math.max(0, Math.round((Date.now() - Date.parse(c.run.at)) / 60000)) : 0;
    return '<h1>' + esc(c.change.title) + '</h1>' +
      '<p class="sitepv-status"><span class="sitepv-badge" data-st="' + esc(c.status) + '">' + esc(STATUS[c.status] || c.status) + '</span> Layout / code change' + (c.byEmail ? ' · asked by ' + esc(c.byEmail) : '') +
      (c.cost ? ' · agent cost $' + esc(c.cost.toFixed(2)) : '') + (c.runUrl ? ' · <a href="' + esc(c.runUrl) + '" target="_blank" rel="noopener">the run</a>' : '') + (c.commitUrl ? ' · <a href="' + esc(c.commitUrl) + '" target="_blank" rel="noopener">the commit</a>' : '') + '</p>' +
      (c.error ? '<p class="sitepv-error">' + esc(c.error) + '</p>' : '') +
      '<details class="sitepv-brief"><summary>What was asked</summary><p>' + esc(c.change.brief) + '</p>' + (c.change.feedback || []).map(function (f) { return '<p><strong>Feedback</strong> (' + esc(f.by) + '): ' + esc(f.text) + '</p>'; }).join('') + '</details>' +
      (building ? '<p class="sitepv-note">The coding agent is making this on a copy of the site (started ' + (mins ? mins + ' min ago' : 'just now') + '; usually 3 to 8 minutes). You can keep working; this page updates by itself.</p>' : '') +
      (p && p.summary ? '<p><strong>What the agent did:</strong> ' + esc(p.summary) + '</p>' : '') +
      (p ? '<p class="sitepv-note">Preview address (expires in 7 days): <a href="' + esc(p.preview) + '" target="_blank" rel="noopener">' + esc(p.preview.replace(/^https:\/\//, '')) + '</a>' + (you.role === 'admin' ? ' · <a href="' + esc(p.compareUrl) + '" target="_blank" rel="noopener">the code changes</a>' : '') + '</p>' : '') +
      actions(c) +
      (p ? '<div class="sitepv-bar" data-pick-pass>' + seg('Version', [['mode', 'before', 'Now'], ['mode', 'after', 'After the change']]) + seg('Language', [['lang', 'sr', 'Serbian'], ['lang', 'en', 'English']]) + seg('Width', [['width', 'desktop', 'Desktop'], ['width', 'phone', 'Phone']]) + '</div>' +
        '<div class="sitepv-stage" data-w="' + view.width + '"><iframe class="sitepv-frame" data-sitepv="' + esc(c.id) + '" title="' + esc('Preview: ' + c.change.title + ' (' + (view.mode === 'after' ? 'after the change' : 'now') + ', ' + (view.lang === 'sr' ? 'Serbian' : 'English') + ')') + '" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"></iframe></div>' : '');
  }

  H.route('/website/preview', function (rest, query) {
    var id = (query && query.c) || '', c = find(id); ensure();
    if (!c) { return '<h1>Website change</h1><p class="empty">' + esc(saved ? 'There is no change ' + id + '.' : err || 'Loading…') + '</p>'; }
    if (c.lane === 'code') return codePage(c);
    var rows = (window.DEVA_CHANGES && window.DEVA_I18N) ? window.DEVA_CHANGES.diff(window.DEVA_I18N, c.change) : null;
    if (!rows) site().then(redraw);
    return '<h1>' + esc(c.change.title) + '</h1>' +
      '<p class="sitepv-status"><span class="sitepv-badge" data-st="' + esc(c.status) + '">' + esc(STATUS[c.status] || c.status) + '</span>' +
      (c.byEmail ? ' Proposed by ' + esc(c.byEmail) : '') + (c.commitUrl ? ' · <a href="' + esc(c.commitUrl) + '" target="_blank" rel="noopener">the commit</a>' : '') + (c.runUrl && c.status !== 'published' ? ' · <a href="' + esc(c.runUrl) + '" target="_blank" rel="noopener">the publishing run</a>' : '') + '</p>' +
      (c.error ? '<p class="sitepv-error">' + esc(c.error) + '</p>' : '') +
      (c.change.summary ? '<p>' + esc(c.change.summary) + '</p>' : '') +
      (rows ? '<table class="sitepv-diff"><thead><tr><th scope="col">What</th><th scope="col">Language</th><th scope="col">Now</th><th scope="col">After</th></tr></thead><tbody>' + rows.map(function (r) {
        return '<tr><td><code>' + esc(r.path) + '</code></td><td>' + esc(r.lang ? (r.lang === 'sr' ? 'Serbian' : 'English') : 'both') + '</td><td>' + esc(r.before == null ? '–' : r.before) + '</td><td>' + esc(r.after) + '</td></tr>';
      }).join('') + '</tbody></table>' : '') +
      actions(c) +
      '<div class="sitepv-bar" data-pick-pass>' + seg('Version', [['mode', 'before', 'Now'], ['mode', 'after', 'After the change']]) + seg('Language', [['lang', 'sr', 'Serbian'], ['lang', 'en', 'English']]) + seg('Width', [['width', 'desktop', 'Desktop'], ['width', 'phone', 'Phone']]) + seg('Outline', [['marks', 'on', 'Outline changes'], ['marks', 'off', 'Hide outline']]) + '</div>' +
      '<p class="sitepv-note sitepv-outline-note">' + (view.marks === 'off' ? 'Outline hidden: this is exactly how the page will look.' : 'Outlined in yellow: what changes. The outline is only in this preview, never on the site.') + '</p>' +
      '<div class="sitepv-stage" data-w="' + view.width + '"><iframe class="sitepv-frame" data-sitepv="' + esc(c.id) + '" title="' + esc('Preview: ' + c.change.title + ' (' + (view.mode === 'after' ? 'after the change' : 'now') + ', ' + (view.lang === 'sr' ? 'Serbian' : 'English') + ')') + '" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox' + (LOCAL ? ' allow-same-origin' : '') + '"></iframe></div>';
  });

  /* ─── the list ─── */
  H.route('/website/changes', function () {
    ensure();
    var head = '<h1>Website changes</h1><p class="lede">What the assistant proposed for centardeva.com. Open one to see the page with the change; an admin approves it, which publishes it about two minutes later.</p>';
    if (err) return head + '<p class="empty">' + esc(err) + '</p>';
    if (!saved) return head + '<p class="empty">Loading…</p>';
    var all = Object.keys(drafts).map(find).concat(saved);
    if (!all.length) return head + '<p class="empty">Nothing yet. Ask the assistant for a change to the website.</p>';
    return head + (publishing ? '' : '<p class="sitepv-note">Publishing is not set up yet (the server has no GitHub token); proposals can be made and previewed.</p>') +
      '<table class="sitepv-list"><thead><tr><th scope="col">Change</th><th scope="col">Status</th><th scope="col">Proposed by</th><th scope="col">When</th></tr></thead><tbody>' + all.map(function (c) {
        return '<tr><td><a href="#/website/preview?c=' + esc(encodeURIComponent(c.id)) + '">' + esc(c.change.title) + '</a>' + (c.lane === 'code' ? ' <span class="sitepv-kind">layout / code</span>' : '') + '</td><td><span class="sitepv-badge" data-st="' + esc(c.status) + '">' + esc(STATUS[c.status] || c.status) + '</span></td><td>' + esc(c.byEmail || (c.draft ? 'you (in the chat)' : '–')) + '</td><td>' + esc(c.at ? new Date(c.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '') + '</td></tr>';
      }).join('') + '</tbody></table>';
  });

  /* ─── wiring ─── */
  H.onRender(fill);
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('#app-main [data-pv], #app-main [data-chg]'); if (!b) return;
    if (b.hasAttribute('data-chg')) return act(b.getAttribute('data-id'), b.getAttribute('data-chg'));
    view[b.getAttribute('data-pv')] = b.getAttribute('data-pv-v');
    var keep = b.getAttribute('data-pv') + b.getAttribute('data-pv-v');
    H.render({ drawer: false });
    var again = document.querySelector('#app-main [data-pv="' + keep.replace(/(before|after|sr|en|desktop|phone|on|off)$/, '') + '"][data-pv-v="' + b.getAttribute('data-pv-v') + '"]'); if (again) again.focus();
  });

  /* Work › Tasks: the website change requests, each opening its page in the main column */
  var WITH = { draft: 'You (in the chat)', building: 'Coding agent', proposed: 'Admin (to approve)', failed: 'Admin (to retry or discard)', publishing: '2human (publishing)', reverting: '2human (undoing)', published: '2human', reverted: '2human', discarded: '–' };
  function taskTable() {
    ensure();
    var all = Object.keys(drafts).map(find).concat(saved || []).filter(function (c) { return c.status !== 'discarded'; });
    var head = '<h2>Website changes from the hub assistant</h2>';
    if (err) return head + '<p class="empty">' + esc(err) + '</p>';
    if (!saved) return head + '<p class="empty">Loading…</p>';
    if (!all.length) return head + '<p class="empty">None yet. Ask the hub assistant for a change to the website.</p>';
    return head + '<table class="sitepv-list"><thead><tr><th scope="col">Task</th><th scope="col">Status</th><th scope="col">With</th><th scope="col">Asked</th></tr></thead><tbody>' + all.map(function (c) {
      return '<tr><td><a href="#/website/preview?c=' + esc(encodeURIComponent(c.id)) + '">' + esc(c.change.title) + '</a>' + (c.lane === 'code' ? ' <span class="sitepv-kind">layout / code</span>' : ' <span class="sitepv-kind">copy / links</span>') + '</td><td><span class="sitepv-badge" data-st="' + esc(c.status) + '">' + esc(STATUS[c.status] || c.status) + '</span></td><td>' + esc(WITH[c.status] || '–') + '</td><td>' + esc(c.at ? new Date(c.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '') + (c.byEmail ? ' · ' + esc(c.byEmail) : '') + '</td></tr>';
    }).join('') + '</tbody></table>';
  }

  window.HubSite = { site: site, copy: copy, validate: validate, preview: preview, save: save, list: list, request: request, revise: revise, taskTable: taskTable };
  // this file loads after the hub's first paint: a link straight to one of these pages was drawn by the /website route
  redraw();
})();
