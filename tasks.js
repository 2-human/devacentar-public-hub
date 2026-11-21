/* Tasks added in the Centar DEVA hub (Work › Tasks), shared by the whole team through the assistant's server
 * (tools/assistant/tasks.mjs; Firestore hubTasks on the published hub). Loaded by hub.config.js `after`.
 * The project's own tasks (data/core.js D.next) are drawn by views.js; this file adds the hub's tasks to the same table
 * (rows(), newest first, after the project's), a details panel for each (task:<id>) with its history and status
 * buttons, and window.HubTasks = { list, create, update, rows, openCount, note } for views.js and assistant.js. */
(function () {
  var H = window.Hub; if (!H || window.HubTasks) return;
  var esc = H.esc, P = H.parts, all = null, err = '', loading = null, STATUSES = ['Open', 'In progress', 'To decide', 'Later', 'Done'];

  function api(path, init) {
    if (!window.HubAssistant || !window.HubAssistant.api) return Promise.reject(new Error('tasks need the hub assistant, which is not available here'));
    return window.HubAssistant.api(path, init).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'the server answered ' + r.status); return j; }); });
  }
  function onTasks() { return location.hash.indexOf('#/work/tasks') === 0; }
  function redraw() { if (onTasks()) H.render({ drawer: true }); }
  function list() {
    return loading || (loading = api('/tasks').then(function (j) { all = j.tasks; err = ''; loading = null; redraw(); return all; }, function (e) { err = e.message; loading = null; redraw(); throw e; }));
  }
  function ensure() { if (!all && !err && !loading) list().catch(function () {}); }
  function create(t, turn) { return api('/tasks', { method: 'POST', body: JSON.stringify({ task: t, turn: turn || null }) }).then(function (doc) { all = [doc].concat(all || []); redraw(); return doc; }); }
  function update(id, u) { return api('/tasks/' + encodeURIComponent(id), { method: 'POST', body: JSON.stringify(u) }).then(function (doc) { all = (all || []).map(function (x) { return x.id === doc.id ? doc : x; }); redraw(); return doc; }); }
  var find = function (id) { return (all || []).filter(function (t) { return t.id === id; })[0]; };
  var when = function (iso) { return iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : ''; };

  /* rows for the Tasks table (views.js), and a line under it while loading or when the server can't be reached */
  function rows() {
    ensure();
    return (all || []).map(function (t) {
      return '<tr' + P.ref('task', t.id) + '><td>' + esc(t.title) + ' <span class="sitepv-kind">added in the hub</span></td><td>' + esc(t.status) + '</td><td>' + esc(t.owner) + '</td></tr>';
    });
  }
  function note() { return err ? '<p class="empty">Tasks added in the hub could not be loaded: ' + esc(err) + '</p>' : (!all ? '<p class="empty">Loading the tasks added in the hub…</p>' : ''); }
  function openCount() { return (all || []).filter(function (t) { return t.status !== 'Done'; }).length; }

  H.drawer('task', function (id) {
    var t = find(id); if (!t) { ensure(); return null; }
    return { title: t.title, sub: esc(t.status), tabs: [['about', 'Task', function () {
      return P.kv([['Status', esc(t.status)], ['With', esc(t.owner)], ['Added', esc(when(t.at) + (t.byEmail ? ' by ' + t.byEmail : ''))]]) +
        (t.detail ? '<p>' + esc(t.detail) + '</p>' : '') +
        '<div class="sitepv-actions" data-pick-pass role="group" aria-label="Set the status">' + STATUSES.map(function (s) {
          return '<button type="button" data-task-status="' + esc(s) + '" data-task-id="' + esc(t.id) + '" aria-pressed="' + (s === t.status) + '"' + (s === t.status ? ' disabled' : '') + '>' + esc(s) + '</button>';
        }).join('') + '</div>' +
        '<h3>History</h3><ul class="task-history">' + (t.history || []).slice().reverse().map(function (h) {
          return '<li>' + esc(when(h.at)) + ' · ' + esc(h.by || '') + ' · ' + esc(h.status) + (h.note && h.note !== 'created' ? ': ' + esc(h.note) : h.note === 'created' ? ' (created)' : '') + '</li>';
        }).join('') + '</ul>';
    }]] };
  });

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-task-status]'); if (!b) return;
    b.disabled = true;
    update(b.getAttribute('data-task-id'), { status: b.getAttribute('data-task-status') }).catch(function (x) { b.disabled = false; window.alert(x.message); });
  });

  window.HubTasks = { list: list, create: create, update: update, rows: rows, note: note, openCount: openCount, statuses: STATUSES };
  if (onTasks()) list().catch(function () {});   // this file loads after the first paint
})();
