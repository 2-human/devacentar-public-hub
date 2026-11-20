/* Work › Log in the Centar DEVA hub (tasks/todo.md, "Work memory"). Loaded by hub.config.js `after`.
 *
 *   #/work/log          everything finished, newest first: website changes, completed tasks, conversations that decided
 *                       something, Claude's working sessions; each with the state of its lesson
 *   #/work/log?e=<id>   one entry in the main column: its record, and its lesson for the 2-human library (drafted the
 *                       first time it is opened; Copy, Redraft; an admin marks it added to the library or rejected)
 *
 * Data from the assistant's server (tools/assistant/worklog.mjs) through window.HubAssistant.api (the signed-in member).
 * window.HubWork = { list, logPasted, suggest, outcome } for assistant.js (read_work_log, log_conversation, suggest_tasks). */
(function () {
  var H = window.Hub; if (!H || window.HubWork) return;
  var esc = H.esc, entries = null, err = '', loading = null, drafting = {};
  var KIND = { 'site-change': 'Website change', task: 'Task', conversation: 'Conversation', session: 'Claude session' };
  var SOURCE = { hub: 'in the hub', project: 'in the project', pasted: 'shared on purpose' };

  function api(path, init) {
    if (!window.HubAssistant || !window.HubAssistant.api) return Promise.reject(new Error('the work log needs the hub assistant, which is not available here'));
    return window.HubAssistant.api(path, init).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'the server answered ' + r.status); return j; }); });
  }
  var post = function (path, body) { return api(path, { method: 'POST', body: JSON.stringify(body || {}) }); };
  function onLog() { return location.hash.indexOf('#/work/log') === 0; }
  function redraw() { if (onLog()) H.render({ drawer: false }); }
  function list() {
    return loading || (loading = api('/worklog').then(function (j) { entries = j.entries; err = ''; loading = null; redraw(); return entries; }, function (e) { err = e.message; loading = null; redraw(); throw e; }));
  }
  function ensure() { if (!entries && !err && !loading) list().catch(function () {}); }
  function put(doc) { entries = [doc].concat((entries || []).filter(function (x) { return x.id !== doc.id; })); entries.sort(function (a, b) { return a.at < b.at ? 1 : -1; }); redraw(); return doc; }
  var when = function (iso) { return iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : ''; };
  var find = function (id) { return (entries || []).filter(function (x) { return x.id === id; })[0]; };
  function lessonState(e) {
    var l = e.lesson; if (!l) return 'not drafted yet';
    if (l.notAMove) return 'nothing general';
    return { added: 'in the library', rejected: 'rejected' }[l.review] || (l.stale ? 'draft (record changed since)' : 'draft, to review');
  }

  /* the list */
  H.route('/work/log', function (rest, query) {
    if (query && query.e) return detail(query.e);
    ensure();
    var head = '<h1>Work log</h1><p class="lead">Everything finished on this project, whoever did it: website changes, completed tasks, conversations that decided something, and Claude\'s working sessions. Each has its record, and a lesson written so an agent on any other project can use it.</p>';
    if (err) return head + '<p class="empty">' + esc(err) + '</p>';
    if (!entries) return head + '<p class="empty">Loading…</p>';
    if (!entries.length) return head + '<p class="empty">Nothing yet.</p>';
    return head + '<table class="sitepv-list"><thead><tr><th scope="col">What</th><th scope="col">Kind</th><th scope="col">When</th><th scope="col">Lesson</th></tr></thead><tbody>' + entries.map(function (e) {
      return '<tr><td><a href="#/work/log?e=' + esc(encodeURIComponent(e.id)) + '">' + esc(e.title) + '</a></td><td>' + esc(KIND[e.kind] || e.kind) + ' <span class="sitepv-kind">' + esc(SOURCE[e.source] || e.source) + '</span></td><td>' + esc(when(e.at)) + '</td><td>' + esc(lessonState(e)) + '</td></tr>';
    }).join('') + '</tbody></table>';
  });

  /* one entry: the record and the lesson */
  function requestDraft(id) {
    drafting[id] = 'busy';
    return post('/worklog/' + encodeURIComponent(id) + '/draft').then(function (doc) { delete drafting[id]; put(doc); }, function (e) { drafting[id] = 'error: ' + e.message; redraw(); });
  }
  function detail(id) {
    ensure();
    var e = find(id);
    if (!e) return '<h1>Work log</h1><p class="empty">' + esc(err || (entries ? 'There is no entry ' + id + '.' : 'Loading…')) + '</p>';
    var l = e.lesson, admin = window.HubAuth && window.HubAuth.user ? window.HubAuth.user.role === 'admin' : true;   // the server checks it again
    if (!l && !drafting[e.id]) requestDraft(e.id);
    var lesson = '<h2>The lesson, for the library</h2><p class="sitepv-note">The same work without this project\'s context, so an agent on any other project can recognise a similar situation. A draft until it is reviewed and added to the 2-human library.</p>';
    if (!l) lesson += '<p class="sitepv-note">' + (/^error/.test(drafting[e.id] || '') ? 'Not drafted (' + esc(drafting[e.id].slice(7)) + ').' : 'Drafting the lesson…') + '</p>';
    else if (l.notAMove) lesson += '<p>Nothing general to keep: ' + esc(l.markdown.replace(/^NOT A MOVE:\s*/i, '')) + '</p>';
    else lesson += (l.stale ? '<p class="sitepv-error">The record changed after this was drafted: redraft it.</p>' : '') +
      '<p class="sitepv-status"><span class="sitepv-badge" data-st="' + esc(l.review === 'added' ? 'published' : l.review === 'rejected' ? 'failed' : 'proposed') + '">' + esc(lessonState(e)) + '</span></p>' +
      '<pre class="sitepv-record" data-lesson="' + esc(e.id) + '">' + esc(l.markdown) + '</pre>';
    var acts = '<div class="sitepv-actions" data-pick-pass>' + (l && !l.notAMove ? '<button type="button" data-wl="copy" data-id="' + esc(e.id) + '">Copy</button>' : '') +
      (l ? '<button type="button" data-wl="redraft" data-id="' + esc(e.id) + '"' + (drafting[e.id] === 'busy' ? ' disabled' : '') + '>' + (drafting[e.id] === 'busy' ? 'Redrafting…' : 'Redraft') + '</button>' : '') +
      (admin && l && !l.notAMove && l.review !== 'added' ? '<button type="button" data-wl="added" data-id="' + esc(e.id) + '">Added to the library</button>' : '') +
      (admin && l && !l.notAMove && l.review !== 'rejected' ? '<button type="button" data-wl="rejected" data-id="' + esc(e.id) + '">Reject</button>' : '') + '</div>';
    return '<h1>' + esc(e.title) + '</h1><p class="sitepv-status">' + esc(KIND[e.kind] || e.kind) + ' · ' + esc(SOURCE[e.source] || e.source) + ' · ' + esc(when(e.at)) +
      (e.refs && e.refs.change ? ' · <a href="#/website/preview?c=' + esc(encodeURIComponent(e.refs.change)) + '">the change</a>' : '') + '</p>' +
      '<h2>The record</h2><pre class="sitepv-record">' + esc(e.record) + '</pre>' + lesson + acts +
      (l && l.at ? '<p class="sitepv-note">Drafted ' + esc(when(l.at)) + ' by ' + esc(l.model || '') + (l.costUSD ? ' ($' + esc(l.costUSD.toFixed(3)) + ')' : '') + '.</p>' : '');
  }
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('#app-main [data-wl]'); if (!b) return;
    var id = b.getAttribute('data-id'), what = b.getAttribute('data-wl'), e = find(id);
    if (what === 'copy') { var t = e && e.lesson ? e.lesson.markdown : ''; (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { if (H.say) H.say('Copied'); }, function () { window.prompt('Copy the lesson:', t); }); return; }
    if (what === 'redraft') { if (window.confirm('Draft the lesson again? It costs about two cents.')) { requestDraft(id); redraw(); } return; }
    post('/worklog/' + encodeURIComponent(id) + '/review', { status: what }).then(put, function (x) { window.alert(x.message); });
  });

  window.HubWork = {
    list: function () { entries = null; return list(); },
    logPasted: function (entry) { return post('/worklog', { entry: entry }).then(put); },
    suggest: function (context) { return post('/suggest', { context: context }); },
    outcome: function (batch, n, o) { return post('/suggestions/' + encodeURIComponent(batch) + '/' + n, o); }
  };
  if (onLog()) list().catch(function () {});   // this file loads after the first paint
})();
