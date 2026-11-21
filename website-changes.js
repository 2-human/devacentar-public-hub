/* Website changes in the Centar DEVA hub (tasks/todo.md, "makes website changes"). Loaded by hub.config.js `after`.
 *
 *   #/website/preview?c=<id>   the real page with a change applied, in the main column: Before / After, Serbian /
 *                              English, Desktop / Phone, Clean view (default) / Mark changes; the list of what changes above it.
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
  var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'website-changes.css?v=9fd04d0398'; document.head.appendChild(css);

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
  // a draft lives only while its card waits in the chat: Save stores it, Discard drops it, and a reload (which ends the
  // card) forgets it; drafts kept by older versions of this file are cleared
  var drafts = {}, saved = null, you = { role: '' }, publishing = false, poll = null, err = '';
  try { sessionStorage.removeItem('devacentar-hub:site-drafts'); } catch (e) {}
  var keepDrafts = function () {};
  // Discard: the draft goes, and so does its preview: back to the screen the person was on before it opened (the live
  // site if they came straight from the chat), never an empty preview page
  var returnTo = null;
  function drop(id) {
    if (!drafts[id]) return;
    delete drafts[id];
    if (location.hash.indexOf('c=' + encodeURIComponent(id)) > 0) { var to = returnTo || '#/staging'; returnTo = null; location.hash = to; } else redraw();
  }
  function api(path, init) {
    if (!window.HubAssistant || !window.HubAssistant.api) return Promise.reject(new Error('the assistant is not available here'));
    return window.HubAssistant.api(path, init).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'the server answered ' + r.status); return j; }); });
  }
  var listing = null;
  function list() {
    return (listing = api('/changes').then(function (j) {
      saved = j.changes; you = j.you || you; publishing = !!j.publishing; err = '';
      document.dispatchEvent(new CustomEvent('hub-site-changes'));   // the chat's live run cards follow along
      setTimeout(redraw, 0);   // and the open change page, whoever asked for the fresh list
      clearTimeout(poll); if (saved.some(function (c) { return /ing$/.test(c.status); })) poll = setTimeout(function () { list().then(redraw, redraw); }, 8000);
      return saved;
    }, function (e) { err = e.message; throw e; })).then(function (x) { listing = null; return x; }, function (e) { listing = null; throw e; });
  }
  var ensure = function () { if (!saved && !err && !listing) list().then(redraw, redraw); };
  // a code change's page while its run goes on: only the run bar changes, so it is updated in place and the site below is
  // left alone (a full redraw would reload it every few seconds); anything else redraws the screen
  var shapeOf = function (c) { return c ? [c.id, c.status, c.preview && c.preview.sha, (c.runs || []).length, view.mode, view.lang, view.width].join('|') : ''; }, lastShape = '';
  function redraw() {
    var p = location.hash.slice(1);
    if (p.indexOf('/website/preview') === 0) {
      var m = /[?&]c=([^&]+)/.exec(p), c = m && find(decodeURIComponent(m[1])), bar = document.querySelector('#app-main .runbar');
      if (c && c.lane === 'code' && bar && shapeOf(c) === lastShape) { var t = document.createElement('div'); t.innerHTML = runBar(c); if (t.firstChild) bar.replaceWith(t.firstChild); return; }
    }
    if (p.indexOf('/website/changes') === 0 || p.indexOf('/website/preview') === 0 || p.indexOf('/work/tasks') === 0) H.render({ drawer: false });
  }
  function find(id) { return drafts[id] ? { id: id, draft: true, status: 'draft', change: drafts[id] } : (saved || []).filter(function (c) { return c.id === id; })[0]; }
  function validate(change) { return site().then(function (s) { return s.C.validate(s.dict, change); }); }
  function preview(change, id) {
    drafts[id] = change; keepDrafts();
    if (location.hash.indexOf('#/website/preview') !== 0) returnTo = location.hash || null;   // where Discard goes back to
    location.hash = '#/website/preview?c=' + encodeURIComponent(id);
  }
  function save(change, draftId, turn) {   // turn: the chat turn it was asked in (the work log links the change's task to it)
    return api('/changes', { method: 'POST', body: JSON.stringify({ change: change, turn: turn || null }) }).then(function (doc) {
      if (draftId) { delete drafts[draftId]; keepDrafts(); }
      saved = [doc].concat(saved || []); list().then(redraw, redraw);
      if (location.hash.indexOf('c=' + encodeURIComponent(draftId)) > 0) location.hash = '#/website/preview?c=' + doc.id; else redraw();
      return doc;
    });
  }
  // a layout / code change: the coding agent builds it on a branch; its preview appears on the change's page
  function request(code, turn) {
    return api('/changes', { method: 'POST', body: JSON.stringify({ code: code, turn: turn || null }) }).then(function (doc) { saved = [doc].concat(saved || []); location.hash = '#/website/preview?c=' + doc.id; list().then(redraw, redraw); return doc; });
  }
  function revise(id, feedback) {
    return api('/changes/' + id + '/revise', { method: 'POST', body: JSON.stringify({ feedback: feedback }) }).then(function (doc) { return list().then(function () { redraw(); return doc; }); });
  }
  function act(id, what) {
    if (what === 'copydraft') {
      var c = find(id), t = c && c.libraryDraft ? c.libraryDraft.markdown : '';
      return (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { if (H.say) H.say('Copied'); }, function () { window.prompt('Copy the entry:', t); });
    }
    if (what === 'redraft') { if (!window.confirm('Draft the library entry again? It costs about two cents.')) return; requestDraft(id); return redraw(); }
    if (what === 'revise') {
      var f = window.prompt('What should the coding agent change in this version?'); if (!f || !f.trim()) return;
      return revise(id, f.trim()).then(function () {}, function (e) { window.alert(e.message); });
    }
    var q = { approve: 'Publish this change to centardeva.com now?', revert: 'Undo this change on centardeva.com?', discard: 'Discard this proposal?', retry: 'Try this change again? If the agent already made it, only the preview is rebuilt (no cost).', check: 'Run the QA check on this preview? It checks the change against the whole request (a few cents, about two minutes); the agent is not run.' }[what];
    if (!window.confirm(q)) return;
    api('/changes/' + id + '/' + what, { method: 'POST', body: '{}' }).then(function () { H.say ? H.say('Done') : 0; return list(); }).then(redraw, function (e) { window.alert(e.message); });
  }

  /* ─── the preview ─── */
  // the preview opens clean, exactly as the page will look (operator, 21 Nov 2026: a design can't be reviewed with a marker on
  // it); "Mark changes" outlines the changed text when wanted, and the choice is kept for the session
  var view = { lang: 'sr', mode: 'after', width: 'desktop', marks: (function () { try { return sessionStorage.getItem('devacentar-hub:pv-marks') === 'on' ? 'on' : 'off'; } catch (e) { return 'off'; } })() };
  var STATUS = { draft: 'Not saved yet', building: 'The coding agent is working…', proposed: 'Waiting for approval', publishing: 'Publishing…', published: 'Live', failed: 'Failed', reverting: 'Undoing…', reverted: 'Undone', discarded: 'Discarded' };
  function highlight(o) {   // runs inside the preview frame
    var norm = function (s) { return String(s).replace(/\s+/g, ' ').trim(); }, hits = [];
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) { var t = norm(walker.currentNode.nodeValue); if (t && o.marks.indexOf(t) >= 0 && hits.indexOf(walker.currentNode.parentElement) < 0) hits.push(walker.currentNode.parentElement); }
    if (o.social) { var s = document.querySelector(o.after ? '.deva-social' : '.deva-contact'); if (s) hits.push(s); }
    hits.forEach(function (h) { h.classList.add('deva-changed'); if (getComputedStyle(h).position === 'static') h.style.position = 'relative'; });   // the tag sits on it
    if (hits[0]) setTimeout(function () { hits[0].scrollIntoView({ block: 'center' }); }, 60);
  }
  function srcdoc(s, change) {
    var after = view.mode === 'after', d = after ? s.C.apply(s.dict, change) : s.dict;
    var diff = s.C.diff(s.dict, change), lang = view.lang;
    var marks = view.marks === 'off' ? [] : diff.filter(function (x) { return x.lang === lang; }).map(function (x) { return String(after ? x.after : x.before).replace(/\s+/g, ' ').trim(); });
    var add = '<base href="' + SITE + (lang === 'sr' ? 'rs' : 'en') + '/" target="_blank">';
    var hl = '<style>.deva-changed{outline:2px dashed #E0A84A!important;outline-offset:6px}.deva-changed::after{content:\'preview: changes here\';position:absolute;left:-6px;top:calc(-6px - 1.9em);font:600 10px/1.6 system-ui,sans-serif;letter-spacing:.04em;text-transform:none;color:#2D2824;background:#E0A84A;padding:0 6px;border-radius:3px;white-space:nowrap;pointer-events:none;z-index:5}</style><script>(' + highlight.toString() + ')(' + JSON.stringify({ marks: marks, social: view.marks !== 'off' && diff.some(function (x) { return !x.lang; }), after: after }).replace(/</g, '\\u003c') + ');<\/script>';
    return s.doc.html(d, lang, 'home').replace('<head>', '<head>' + add).replace('</body>', hl + '</body>');
  }
  function fill() {
    var f = document.querySelector('#app-main [data-sitepv]'); if (!f) return;
    var c = find(f.getAttribute('data-sitepv')); if (!c) return;
    var k = key() + (c.lane === 'code' && c.preview ? c.preview.sha : '');   // the agent's version appearing refills the frame
    if (f.getAttribute('data-filled') === k) return;
    f.setAttribute('data-filled', k);
    if (c.lane === 'code') { var base = view.mode === 'after' && c.preview ? c.preview.preview.replace(/\/?$/, '/') : SITE; f.src = base + (view.lang === 'sr' ? 'rs' : 'en') + '/'; return; }
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
  var FINISHED = ['published', 'reverted', 'discarded'];
  // a finished change: no preview (its preview address is gone once it is live); the written record instead
  function recordBlock(c) {
    return '<h2>The record</h2>' + (c.record ? '<pre class="sitepv-record">' + esc(c.record) + '</pre>' : '<p class="sitepv-note">' + (c.status === 'discarded' ? 'Discarded: nothing was published.' : 'The record is being written; it appears on the next refresh.') + '</p>') + libraryBlock(c);
  }
  // the same change without this site's context, as a draft entry for the 2-human library (library-draft.mjs on the server):
  // drafted the first time the page is opened, then kept; Copy and Redraft
  var drafting = {};
  function requestDraft(id) {
    drafting[id] = 'busy';
    return api('/changes/' + id + '/draft', { method: 'POST', body: '{}' }).then(function () { delete drafting[id]; return list(); }).then(redraw, function (e) { drafting[id] = 'error: ' + e.message; redraw(); });
  }
  function libraryBlock(c) {
    if (c.status === 'discarded') return '';
    var d = c.libraryDraft, head = '<h2>For the library</h2><p class="sitepv-note">The same change without this site\'s context, so an agent on any other project can recognise a similar situation. It is a draft: review it, then ask Claude in the project to add it to the library (it starts as "proposed").</p>';
    if (!d) {
      if (!drafting[c.id] && c.record) requestDraft(c.id);
      return head + '<p class="sitepv-note">' + (/^error/.test(drafting[c.id] || '') ? 'Not drafted (' + esc(drafting[c.id].slice(7)) + ').' : 'Drafting the entry…') + '</p>';
    }
    if (d.notAMove) return head + '<p>Nothing general to keep: ' + esc(d.markdown.replace(/^NOT A MOVE:\s*/i, '')) + '</p>';
    return head + (d.undone ? '<p class="sitepv-error">This change was undone on the site: reconsider the lesson before using it.</p>' : '') +
      '<pre class="sitepv-record" data-library-draft="' + esc(c.id) + '">' + esc(d.markdown) + '</pre>' +
      '<div class="sitepv-actions" data-pick-pass><button type="button" data-chg="copydraft" data-id="' + esc(c.id) + '">Copy</button><button type="button" data-chg="redraft" data-id="' + esc(c.id) + '"' + (drafting[c.id] === 'busy' ? ' disabled' : '') + '>' + (drafting[c.id] === 'busy' ? 'Redrafting…' : 'Redraft') + '</button></div>' +
      '<p class="sitepv-note">Drafted ' + esc(d.at ? new Date(d.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '') + ' by ' + esc(d.model || '') + (d.costUSD ? ' ($' + esc(d.costUSD.toFixed(3)) + ')' : '') + '.</p>';
  }
  // every attempt of the coding agent on this change (changes.mjs runs[]): what started it, how it went, what came of it;
  // the work log keeps each one as an action, with its outcome as a signal
  var STEP = { build: 'First build', revise: 'Revision', preview: 'Preview again' }, RESULT = { running: 'Working…', shown: 'Preview', failed: 'Failed' };
  var OUT = { revised: 'Revised', accepted: 'Accepted', discarded: 'Discarded', failed: 'Failed' };
  function runsTable(c) {
    var runs = c.runs || []; if (!runs.length) return '';
    return '<details class="sitepv-brief" data-attempts' + (runs.length > 1 ? ' open' : '') + '><summary>Attempts (' + runs.length + ')</summary><table class="sitepv-list"><thead><tr><th scope="col">#</th><th scope="col">Step</th><th scope="col">Started by</th><th scope="col">Result</th><th scope="col">What came of it</th><th scope="col">QA</th><th scope="col">Time</th><th scope="col">Cost</th><th scope="col">Model</th></tr></thead><tbody>' +
      runs.map(function (r) {
        return '<tr><td>' + r.n + '</td><td>' + esc(STEP[r.action] || r.action) + (r.runUrl ? ' · <a href="' + esc(r.runUrl) + '" target="_blank" rel="noopener">run</a>' : '') + '</td><td>' + esc(r.why || '') + '</td><td>' + esc(RESULT[r.result] || r.result) + (r.summary ? '<br><span class="sitepv-note">' + esc(r.summary) + '</span>' : '') + (r.error ? '<br><span class="sitepv-error">' + esc(r.error) + '</span>' : '') +
          '</td><td>' + ((r.outcomes || []).length ? r.outcomes.map(function (o) { return esc(OUT[o.type] || o.type) + (o.type === 'revised' && o.note ? '<br><span class="sitepv-note">' + esc(o.note) + '</span>' : ''); }).join(' → ') : esc(r.result === 'shown' ? 'On show' : '–')) + '</td><td>' + esc(r.qa && r.qa.total ? r.qa.passed + '/' + r.qa.total + (r.qa.failed ? ' (' + r.qa.failed + ' not done)' : '') : '–') + '</td><td>' + esc(r.seconds ? Math.round(r.seconds / 6) / 10 + ' min' : '–') + '</td><td>' + esc(r.cost ? '$' + r.cost.toFixed(2) : '–') + '</td><td>' + esc(r.model || '–') + '</td></tr>';
      }).join('') + '</tbody></table></details>';
  }
  // the run bar (operator, 21 Nov 2026): one line above the site, so the site stays in view while the coding agent works.
  // Working: the phase from the run's jobs (changes.mjs progressOf), a clock, Discard, the attempts and the run. Ready:
  // what the agent did, how long, the cost, and Approve / Ask for changes / Discard. Failed: why, Try again / Discard.
  var PHASES = { build: [['queued', 'Request'], ['editing', 'Editing files'], ['building', 'Building the preview'], ['checking', 'QA check'], ['ready', 'Ready']],
    preview: [['queued', 'Request'], ['building', 'Building the preview'], ['checking', 'QA check'], ['ready', 'Ready']], publish: [['queued', 'Request'], ['publishing', 'Publishing'], ['ready', 'Live']] };
  PHASES.revise = PHASES.build; PHASES.revert = PHASES.publish;
  var clock = function (iso) { var s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  setInterval(function () { document.querySelectorAll('[data-run-clock]').forEach(function (n) { n.textContent = clock(n.getAttribute('data-run-clock')); }); }, 1000);
  function runBar(c) {
    var run = (c.runs || [])[(c.runs || []).length - 1], pr = c.progress, action = (pr && pr.action) || (c.run && c.run.action) || 'build';
    var steps = function (current) {
      var list = PHASES[action] || PHASES.build, at = list.map(function (x) { return x[0]; }).indexOf(current);
      return '<ol class="runbar-steps">' + list.map(function (x, i) { return '<li data-s="' + (i < at ? 'done' : i === at ? 'now' : 'todo') + '">' + esc(x[1]) + '</li>'; }).join('') + '</ol>';
    };
    var links = (c.runs || []).length ? ' <a href="#" data-run-attempts>attempts</a>' : '';
    links += c.runUrl || (pr && pr.runUrl) ? ' · <a href="' + esc(c.runUrl || pr.runUrl) + '" target="_blank" rel="noopener">run ↗</a>' : '';
    if (/ing$/.test(c.status)) {
      var since = (pr && pr.startedAt) || (c.run && c.run.at) || new Date().toISOString();
      var qaBack = run && /^QA:/.test(run.why || '');
      var who = c.status === 'publishing' ? 'Publishing to centardeva.com' : c.status === 'reverting' ? 'Undoing it on centardeva.com' : pr && pr.phase === 'checking' ? 'The QA check is looking at it' : qaBack ? 'QA sent it back: the coding agent is finishing it' : (action === 'revise' ? 'The coding agent is revising it' : action === 'preview' ? 'Building the preview again' : 'The coding agent is working');
      return '<div class="runbar" data-st="working" data-pick-pass><div class="runbar-main"><span class="runbar-dot" aria-hidden="true"></span><strong>' + esc(who) + '</strong> · <span data-run-clock="' + esc(since) + '">' + clock(since) + '</span>' + steps((pr && pr.phase) || 'queued') +
        '</div><div class="runbar-side">' + actions(c) + '<span class="runbar-links">' + links + '</span></div></div>';
    }
    if (c.status === 'proposed' && c.preview) {
      var t = run && run.seconds ? Math.floor(run.seconds / 60) + ':' + String(run.seconds % 60).padStart(2, '0') : '', cost = run && run.cost ? '$' + run.cost.toFixed(2) : c.cost ? '$' + c.cost.toFixed(2) : '';
      var qa = (c.preview && c.preview.qa) || (run && run.qa), qaLine = !qa || !qa.total ? '<span class="runbar-qa" data-qa="none">QA: not checked</span>' + ((you.role === 'admin' || c.by === you.uid) ? ' <button type="button" class="runbar-qa" data-chg="check" data-id="' + esc(c.id) + '">Run QA check</button>' : '') :
        '<button type="button" class="runbar-qa" data-qa="' + (qa.failed ? 'fail' : 'pass') + '" data-qa-toggle aria-expanded="false">QA ' + qa.passed + '/' + qa.total + (qa.failed ? ' · ' + qa.failed + ' not done' : qa.unclear ? ' · ' + qa.unclear + ' unclear' : '') + '</button>';
      var qaList = qa && qa.total ? '<ul class="runbar-qalist" hidden>' + qa.items.map(function (i) { return '<li data-qa="' + esc(i.status) + '"><strong>' + esc({ pass: '✓', fail: '✕', unclear: '?' }[i.status] || '?') + ' ' + esc(i.requirement) + '</strong> — ' + esc(i.evidence) + '</li>'; }).join('') + '</ul>' : '';
      return '<div class="runbar" data-st="' + (qa && qa.failed ? 'qa-fail' : 'ready') + '" data-pick-pass><div class="runbar-main"><span class="runbar-ok" aria-hidden="true">✓</span><strong>Preview ready</strong> · ' + qaLine + (t ? ' · ' + t : '') + (cost ? ' · ' + cost : '') +
        (c.preview.summary ? '<span class="runbar-summary">' + esc(c.preview.summary) + '</span>' : '') + (c.error ? '<span class="runbar-summary sitepv-error">' + esc(c.error) + '</span>' : '') +
        qaList + '</div><div class="runbar-side">' + seg('Version', [['mode', 'before', 'Now'], ['mode', 'after', 'After']]) + actions(c) + '<span class="runbar-links">' + links + '</span></div></div>';
    }
    if (c.status === 'failed') return '<div class="runbar" data-st="failed" data-pick-pass><div class="runbar-main"><span class="runbar-bad" aria-hidden="true">✕</span><strong>It did not work</strong>' + (c.error ? '<span class="runbar-summary">' + esc(c.error) + '</span>' : '') + '</div><div class="runbar-side">' + actions(c) + '<span class="runbar-links">' + links + '</span></div></div>';
    return '';
  }
  function codePage(c) {
    var p = c.preview, finished = FINISHED.indexOf(c.status) >= 0, live = !p || view.mode !== 'after';
    lastShape = shapeOf(c);
    return '<h1>' + esc(c.change.title) + '</h1>' +
      '<p class="sitepv-status"><span class="sitepv-badge" data-st="' + esc(c.status) + '">' + esc(STATUS[c.status] || c.status) + '</span> Layout / code change' + (c.byEmail ? ' · asked by ' + esc(c.byEmail) : '') +
      (c.cost ? ' · agent cost $' + esc(c.cost.toFixed(2)) : '') + (c.commitUrl ? ' · <a href="' + esc(c.commitUrl) + '" target="_blank" rel="noopener">the commit</a>' : '') + '</p>' +
      (finished ? actions(c) + '<details class="sitepv-brief"><summary>What was asked</summary><p>' + esc(c.change.brief) + '</p></details>' + runsTable(c) + recordBlock(c) :
      runBar(c) +
      '<details class="sitepv-brief"><summary>What was asked</summary><p>' + esc(c.change.brief) + '</p>' + (c.change.feedback || []).map(function (f) { return '<p><strong>Feedback</strong> (' + esc(f.by) + '): ' + esc(f.text) + '</p>'; }).join('') + '</details>' +
      runsTable(c) +
      (p ? '<p class="sitepv-note">Preview address (expires in 7 days): <a href="' + esc(p.preview) + '" target="_blank" rel="noopener">' + esc(p.preview.replace(/^https:\/\//, '')) + '</a>' + (you.role === 'admin' ? ' · <a href="' + esc(p.compareUrl) + '" target="_blank" rel="noopener">the code changes</a>' : '') + '</p>' : '') +
      // the site, always: the live one while there is no preview (or with Now), the agent's version with After
      '<div class="sitepv-bar" data-pick-pass>' + (c.status !== 'proposed' && p ? seg('Version', [['mode', 'before', 'Now'], ['mode', 'after', 'After the change']]) : '') + seg('Language', [['lang', 'sr', 'Serbian'], ['lang', 'en', 'English']]) + seg('Width', [['width', 'desktop', 'Desktop'], ['width', 'phone', 'Phone']]) +
        '<span class="sitepv-note">' + (live ? (p ? 'Now: the live site' : 'The live site, until the preview is ready') : 'After: the coding agent\'s version') + '</span></div>' +
      '<div class="sitepv-stage" data-w="' + view.width + '"><iframe class="sitepv-frame" data-sitepv="' + esc(c.id) + '" title="' + esc((live ? 'The live site' : 'Preview: ' + c.change.title) + ' (' + (view.lang === 'sr' ? 'Serbian' : 'English') + ')') + '" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"></iframe></div>');
  }


  H.route('/website/preview', function (rest, query) {
    var id = (query && query.c) || '', c = find(id); ensure();
    if (!c && /^d/.test(id)) return '<h1>Website change</h1><p class="empty">This proposal was discarded, so nothing changed on the site. Ask the assistant for a new one.</p><p><a class="btn" href="#/staging">See the live site</a> <a class="btn" href="#/website/changes">All website changes</a></p>';
    if (!c) { return '<h1>Website change</h1><p class="empty">' + esc(saved ? 'There is no change ' + id + '.' : err || 'Loading…') + '</p>'; }
    if (c.lane === 'code') return codePage(c);
    if (FINISHED.indexOf(c.status) >= 0) return '<h1>' + esc(c.change.title) + '</h1><p class="sitepv-status"><span class="sitepv-badge" data-st="' + esc(c.status) + '">' + esc(STATUS[c.status] || c.status) + '</span> Copy / links change' + (c.byEmail ? ' · asked by ' + esc(c.byEmail) : '') + (c.commitUrl ? ' · <a href="' + esc(c.commitUrl) + '" target="_blank" rel="noopener">the commit</a>' : '') + '</p>' + actions(c) + recordBlock(c);
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
      '<div class="sitepv-bar" data-pick-pass>' + seg('Version', [['mode', 'before', 'Now'], ['mode', 'after', 'After the change']]) + seg('Language', [['lang', 'sr', 'Serbian'], ['lang', 'en', 'English']]) + seg('Width', [['width', 'desktop', 'Desktop'], ['width', 'phone', 'Phone']]) + seg('Outline', [['marks', 'off', 'Clean view'], ['marks', 'on', 'Mark changes']]) + '</div>' +
      '<p class="sitepv-note sitepv-outline-note">' + (view.marks === 'off' ? 'Exactly how the page will look. The table above lists what changes; Mark changes outlines it on the page.' : 'The dashed yellow outline marks what changes. It is only in this preview, never on the site: Clean view shows the page exactly as it will look.') + '</p>' +
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
    var qt = e.target.closest && e.target.closest('#app-main [data-qa-toggle]');
    if (qt) { var ql = document.querySelector('#app-main .runbar-qalist'); if (ql) { ql.hidden = !ql.hidden; qt.setAttribute('aria-expanded', String(!ql.hidden)); } return; }
    var at = e.target.closest && e.target.closest('#app-main [data-run-attempts]');
    if (at) { e.preventDefault(); var d = document.querySelector('#app-main details[data-attempts]'); if (d) { d.open = true; d.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } return; }
    var b = e.target.closest && e.target.closest('#app-main [data-pv], #app-main [data-chg]'); if (!b) return;
    if (b.hasAttribute('data-chg')) return act(b.getAttribute('data-id'), b.getAttribute('data-chg'));
    view[b.getAttribute('data-pv')] = b.getAttribute('data-pv-v');
    if (b.getAttribute('data-pv') === 'marks') try { sessionStorage.setItem('devacentar-hub:pv-marks', view.marks); } catch (e) {}
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

  window.HubSite = { base: SITE, local: LOCAL, get: find, site: site, copy: copy, validate: validate, preview: preview, save: save, drop: drop, list: list, request: request, revise: revise, taskTable: taskTable };
  // this file loads after the hub's first paint: a link straight to one of these pages was drawn by the /website route
  redraw();
})();
