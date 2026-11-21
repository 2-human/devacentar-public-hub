/* Work › Log in the Centar DEVA hub (tasks/todo.md, "Work memory"). Loaded by hub.config.js `after`.
 *
 *   #/work/log          the work as threads (tools/assistant/worklog.mjs: conversation → task → action): every task with
 *                       its status, who assigned it to whom, how many conversations and actions; then conversations with
 *                       no task (their decisions still count) and actions with no task (flagged)
 *   #/work/log?e=<id>   a task: where it came from (its conversations, their decisions), what was done (actions with their
 *                       commits / changes), and its lesson for the 2-human library (drafted when the task is done; Copy,
 *                       Redraft; an admin marks it added or rejected); a conversation: its decisions and its tasks; an
 *                       action: its evidence and its task
 *
 * Data from the assistant's server (tools/assistant/worklog.mjs) through window.HubAssistant.api (the signed-in member).
 * window.HubWork = { list, logPasted, suggest, outcome } for assistant.js (read_work_log, log_conversation, suggest_tasks). */
(function () {
  var H = window.Hub; if (!H || window.HubWork) return;
  var esc = H.esc, entries = null, err = '', loading = null, drafting = {};

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

  /* the graph: tasks with the conversations they came from and the actions that did them */
  var CHANNEL = { 'hub-chat': 'Hub chat', 'claude-session': 'Claude session', 'coding-agent': 'Coding agent', pasted: 'Shared on purpose' };
  var ACT = { commit: 'Commit', 'site-copy': 'Website copy', 'site-code': 'Website code', publish: 'Publish', deploy: 'Deploy', asset: 'Files', setting: 'Setting' };
  var REPO = 'https://github.com/2-human/devacentar-private/commit/';
  var kindOf = function (e) { return { 'site-change': 'action', session: 'conversation' }[e.kind] || e.kind; };
  var GOOD = ['approved', 'up', 'praise'], BAD = ['rejected', 'correction', 'problem', 'changes-requested', 'down', 'discarded', 'reverted'];
  var SIG = { approved: 'Approved', up: '👍', praise: 'Praise', rejected: 'Rejected', correction: 'Correction', problem: 'Problem', 'changes-requested': 'Changes requested', down: '👎', discarded: 'Discarded', reverted: 'Undone', note: 'Note', metric: 'Data' };
  var SRC = { chatbot: 'chat rating', person: 'a person', data: 'data' };
  var RESULT = { live: 'Live', done: 'Done', approved: 'Approved', undone: 'Undone', dropped: 'Dropped', waiting: 'Waiting', open: 'Open' };
  function graph() {
    var all = entries || [], by = {}, acts = {}, convTasks = {}, sigs = {}, decTasks = {}, convDecs = {}, replaces = {};
    all.forEach(function (e) { by[e.id] = e; });
    all.forEach(function (e) {
      var k = kindOf(e);
      if (k === 'action' && e.task) (acts[e.task] = acts[e.task] || []).push(e);
      if (k === 'task') {
        (e.conversations || []).forEach(function (c) { (convTasks[c] = convTasks[c] || []).push(e); });
        (e.decisions || []).forEach(function (d) { (decTasks[d] = decTasks[d] || []).push(e); });
      }
      if (k === 'decision') {
        if (e.conversation) (convDecs[e.conversation] = convDecs[e.conversation] || []).push(e);
        (e.relations || []).forEach(function (r) { (replaces[r.to] = replaces[r.to] || []).push({ type: r.type, from: e, reason: r.reason, changed: r.changed }); });   // incoming: who revised / diverged from / confirmed it
      }
      if (k === 'signal' && e.type !== 'withdrawn' && e.about) (sigs[e.about] = sigs[e.about] || []).push(e);
    });
    // every signal that bears on a decision: about it, its tasks and their actions
    var decSignals = function (d) {
      var ids = [d.id].concat((decTasks[d.id] || []).map(function (t) { return t.id; }));
      (decTasks[d.id] || []).forEach(function (t) { (acts[t.id] || []).forEach(function (a) { ids.push(a.id); }); });
      return ids.reduce(function (out, id) { return out.concat(sigs[id] || []); }, []);
    };
    var last = function (t) { return (acts[t.id] || []).reduce(function (m, a) { return a.at > m ? a.at : m; }, t.done || t.at || ''); };   // when it last moved: its latest action, done or assigned (never the import time)
    return {
      by: by, acts: acts, convTasks: convTasks, last: last,
      sigs: sigs, decTasks: decTasks, convDecs: convDecs, replaces: replaces, decSignals: decSignals,
      decisions: all.filter(function (e) { return kindOf(e) === 'decision'; }).sort(function (a, b) { return a.at < b.at ? 1 : -1; }),
      tasks: all.filter(function (e) { return kindOf(e) === 'task'; }).sort(function (a, b) { return last(a) < last(b) ? 1 : -1; }),
      lonelyConv: all.filter(function (e) { return kindOf(e) === 'conversation' && !convTasks[e.id]; }),
      lonelyActs: all.filter(function (e) { return kindOf(e) === 'action' && !(e.task && by[e.task]); })
    };
  }
  var who = function (x) { return x ? x.who + (x.type === 'agent' ? ' (agent)' : '') : '–'; };
  var link = function (e, text) { return '<a href="#/work/log?e=' + esc(encodeURIComponent(e.id)) + '">' + esc(text || e.title) + '</a>'; };
  var badge = function (st) { return '<span class="sitepv-badge" data-st="' + esc({ Done: 'published', Open: 'failed', 'In progress': 'building', 'To decide': 'proposed', Later: 'reverted', Dropped: 'discarded' }[st] || 'proposed') + '">' + esc(st || '–') + '</span>'; };
  function evidence(a) {
    var ev = a.evidence || {}, out = [];
    if (ev.commit) out.push('<a href="' + esc(REPO + ev.commit) + '" target="_blank" rel="noopener"><code>' + esc(String(ev.commit).slice(0, 7)) + '</code></a>');
    if (ev.change) out.push('<a href="#/website/preview?c=' + esc(encodeURIComponent(ev.change)) + '">the change</a>');
    if (ev.url && !ev.commit) out.push('<a href="' + esc(ev.url) + '" target="_blank" rel="noopener">link</a>');
    return out.join(' · ');
  }
  function tally(list) {
    var g = list.filter(function (x) { return GOOD.indexOf(x.type) >= 0; }).length, b = list.filter(function (x) { return BAD.indexOf(x.type) >= 0; }).length;
    return g || b ? '<span class="wl-tally"><span class="wl-good">+' + g + '</span> <span class="wl-bad">−' + b + '</span></span>' : '<span class="sitepv-note">–</span>';
  }
  function sigTable(list, g) {
    if (!list.length) return '<p class="sitepv-note">No feedback yet.</p>';
    return '<table class="sitepv-list"><thead><tr><th scope="col">Feedback</th><th scope="col">From</th><th scope="col">About</th><th scope="col">When</th></tr></thead><tbody>' + list.slice().sort(function (a, b) { return a.at < b.at ? 1 : -1; }).map(function (x) {
      var about = g.by[x.about];
      return '<tr><td><span class="wl-sig" data-tone="' + (GOOD.indexOf(x.type) >= 0 ? 'good' : BAD.indexOf(x.type) >= 0 ? 'bad' : 'note') + '">' + esc(SIG[x.type] || x.type) + '</span> ' + esc(x.note || '') + '</td><td>' + esc((x.by && x.by.who) || SRC[x.source] || x.source) + (x.source === 'chatbot' ? ' <span class="sitepv-kind">chat</span>' : x.source === 'data' ? ' <span class="sitepv-kind">data</span>' : '') + '</td><td>' + (about ? link(about) : esc(x.about)) + '</td><td>' + esc(when(x.at)) + '</td></tr>';
    }).join('') + '</tbody></table>';
  }
  // a decision holds in its context: its state is how others relate to it, never true or false
  var REL = { revises: 'Revises', diverges: 'Diverges from', confirms: 'Confirms' }, BACK = { revises: 'Revised by', diverges: 'Another choice in a different context', confirms: 'Confirmed by' };
  var decState = function (d, g) {
    var inc = (g && g.replaces[d.id]) || [], t = function (x) { return inc.filter(function (r) { return r.type === x; }).length; };
    return t('revises') ? '<span class="sitepv-badge" data-st="proposed">Revised later</span>' : t('diverges') ? '<span class="sitepv-badge" data-st="building">Context-dependent</span>' : '<span class="sitepv-badge" data-st="published">Current</span>';
  };
  var ctxLine = function (e) { var c = e.context; if (!c) return ''; var f = c.facets || {};
    return '<div class="wl-ctx"><p class="wl-dec-h">Context</p><p>' + esc(c.statement || '') + '</p>' + (Object.keys(f).length ? '<p class="wl-facets">' + Object.keys(f).map(function (k) { return '<span>' + esc(k) + ': ' + esc([].concat(f[k]).join(', ')) + '</span>'; }).join('') + '</p>' : '') + '</div>'; };
  var outcome = function (t) { var o = t.outcome; return o ? esc(RESULT[o.result] || o.result) + (o.note ? ': ' + esc(o.note) : '') : '–'; };
  var FILTER = { all: 'All', open: 'Not done', done: 'Done' }, filter = 'all', tab = 'tasks', surface = '', near = {};
  H.route('/work/log', function (rest, query) {
    if (query && query.e) return detail(query.e);
    ensure();
    var head = '<h1>Work log</h1><p class="lead">Everything on this project as threads: the conversation where something was asked or decided, the task it became (who assigned it, to whom), and the actions that did it, with their evidence. Each finished task has a lesson written so an agent on any other project can use it.</p>';
    if (err) return head + '<p class="empty">' + esc(err) + '</p>';
    if (!entries) return head + '<p class="empty">Loading…</p>';
    if (!entries.length) return head + '<p class="empty">Nothing yet.</p>';
    var g = graph(), tasks = g.tasks.filter(function (t) { return filter === 'all' || (filter === 'done' ? /^(Done|Dropped)$/.test(t.status) : !/^(Done|Dropped)$/.test(t.status)); });
    var tabs = '<div class="sitepv-bar" data-pick-pass><span class="pf-seg" role="group" aria-label="View">' + [['tasks', 'Tasks'], ['decisions', 'Decisions']].map(function (k) { return '<button type="button" class="btn" data-wlt="' + k[0] + '" aria-pressed="' + (tab === k[0]) + '">' + k[1] + '</button>'; }).join('') + '</span>' +
      (tab === 'tasks' ? '<span class="pf-seg" role="group" aria-label="Tasks">' + Object.keys(FILTER).map(function (k) { return '<button type="button" class="btn" data-wlf="' + k + '" aria-pressed="' + (filter === k) + '">' + esc(FILTER[k]) + '</button>'; }).join('') + '</span>' : '') + '</div>';
    if (tab === 'decisions') return head + tabs + decisionsList(g);
    var rows = tasks.map(function (t) {
      var n = (g.acts[t.id] || []).length, c = (t.conversations || []).filter(function (id) { return g.by[id]; }).length;
      var sg = [t.id].concat((g.acts[t.id] || []).map(function (a) { return a.id; })).reduce(function (o, id) { return o.concat(g.sigs[id] || []); }, []);
      return '<tr><td>' + link(t) + '</td><td>' + badge(t.status) + '</td><td>' + esc(who(t.assignedBy)) + ' → ' + esc(who(t.assignee)) + '</td><td>' + c + '</td><td>' + n + '</td><td>' + tally(sg) + '</td><td>' + esc(when(g.last(t))) + '</td></tr>';
    }).join('');
    var convs = g.lonelyConv.length ? '<h2>Conversations with no task</h2><p class="sitepv-note">Questions, or decisions that did not need work. Their decisions still guide what comes next.</p><table class="sitepv-list"><thead><tr><th scope="col">Conversation</th><th scope="col">Where</th><th scope="col">Decisions</th><th scope="col">When</th></tr></thead><tbody>' +
      g.lonelyConv.map(function (e) { return '<tr><td>' + link(e) + '</td><td>' + esc(CHANNEL[e.channel] || 'Conversation') + '</td><td>' + ((e.decisions || []).length || '–') + '</td><td>' + esc(when(e.at)) + '</td></tr>'; }).join('') + '</tbody></table>' : '';
    var orphans = g.lonelyActs.length ? '<h2>Actions with no task</h2><p class="sitepv-error">Work done without a task: give each one the task it served.</p><table class="sitepv-list"><tbody>' +
      g.lonelyActs.map(function (e) { return '<tr><td>' + link(e) + '</td><td>' + esc(ACT[e.type] || 'Action') + '</td><td>' + evidence(e) + '</td><td>' + esc(when(e.at)) + '</td></tr>'; }).join('') + '</tbody></table>' : '';
    return head + tabs + '<table class="sitepv-list wl-tasks"><thead><tr><th scope="col">Task</th><th scope="col">Status</th><th scope="col">Assigned by → to</th><th scope="col">Conversations</th><th scope="col">Actions</th><th scope="col">Feedback</th><th scope="col">Last</th></tr></thead><tbody>' + (rows || '<tr><td colspan="7" class="empty">No tasks here.</td></tr>') + '</tbody></table>' + convs + orphans;
  });
  function decisionsList(g) {
    if (!g.decisions.length) return '<p class="empty">No decisions logged yet.</p>';
    var surf = function (d) { return (d.context && d.context.facets && d.context.facets.surface) || 'other'; };
    var all = {}; g.decisions.forEach(function (d) { all[surf(d)] = (all[surf(d)] || 0) + 1; });
    var list = g.decisions.filter(function (d) { return !surface || surf(d) === surface; });
    var rel = function (d) { var out = (d.relations || []).length, inc = (g.replaces[d.id] || []).length; return out || inc ? (out ? out + ' out' : '') + (out && inc ? ' · ' : '') + (inc ? inc + ' in' : '') : '–'; };
    return '<p class="sitepv-note">Every decision made in a conversation, in its context. A decision is not right or wrong on its own: it holds where its context fits. Relations say how decisions bear on each other (revised in the same context, a different choice in a different context, confirmed); the last column is how the decision and its work turned out (+ good, − bad feedback).</p>' +
      '<p class="wl-surfaces" data-pick-pass>' + ['<button type="button" class="btn" data-wls="" aria-pressed="' + (!surface) + '">All (' + g.decisions.length + ')</button>'].concat(Object.keys(all).sort().map(function (k) { return '<button type="button" class="btn" data-wls="' + esc(k) + '" aria-pressed="' + (surface === k) + '">' + esc(k) + ' (' + all[k] + ')</button>'; })).join('') + '</p>' +
      '<table class="sitepv-list wl-decisions"><thead><tr><th scope="col">Decision</th><th scope="col">Where it holds</th><th scope="col">State</th><th scope="col">Relations</th><th scope="col">Tasks</th><th scope="col">How it turned out</th><th scope="col">When</th></tr></thead><tbody>' + list.map(function (d) {
        var ts = g.decTasks[d.id] || [];
        return '<tr><td>' + link(d) + '</td><td>' + esc(surf(d)) + '</td><td>' + decState(d, g) + '</td><td>' + esc(rel(d)) + '</td><td>' + (ts.length || '–') + '</td><td>' + tally(g.decSignals(d)) + '</td><td>' + esc(when(d.at)) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  H.count('/work/log', function () { return entries ? graph().tasks.length : 0; });

  /* one entry: a task's thread (with its lesson), a conversation and what came of it, an action and its task */
  function requestDraft(id) {
    drafting[id] = 'busy';
    return post('/worklog/' + encodeURIComponent(id) + '/draft').then(function (doc) { delete drafting[id]; put(doc); }, function (e) { drafting[id] = 'error: ' + e.message; redraw(); });
  }
  function convBlock(e, g) {
    return '<div class="wl-conv"><p><strong>' + link(e) + '</strong> <span class="sitepv-kind">' + esc(CHANNEL[e.channel] || 'Conversation') + '</span> <span class="sitepv-note">' + esc(when(e.at)) + (e.participants && e.participants.length ? ' · ' + esc(e.participants.join(', ')) : '') + '</span></p>' +
      (e.summary || e.record ? '<p>' + esc(e.summary || e.record) + '</p>' : '') +
      ((g.convDecs[e.id] || []).length ? '<p class="wl-dec-h">Decided</p><ul class="wl-dec">' + g.convDecs[e.id].map(function (d) { return '<li>' + link(d) + ' ' + decState(d, g) + '</li>'; }).join('') + '</ul>'
        : (e.decisions || []).length ? '<p class="wl-dec-h">Decided</p><ul class="wl-dec">' + e.decisions.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>' : '') + '</div>';
  }
  function actTable(list) {
    return '<table class="sitepv-list"><thead><tr><th scope="col">What was done</th><th scope="col">Kind</th><th scope="col">By</th><th scope="col">Evidence</th><th scope="col">When</th></tr></thead><tbody>' + list.slice().sort(function (a, b) { return a.at < b.at ? -1 : 1; }).map(function (a) {
      return '<tr><td>' + link(a) + '</td><td>' + esc(ACT[a.type] || 'Action') + '</td><td>' + esc(who(a.by)) + '</td><td>' + evidence(a) + '</td><td>' + esc(when(a.at)) + '</td></tr>';
    }).join('') + '</tbody></table>';
  }
  function lessonBlock(e) {
    var l = e.lesson, admin = window.HubAuth && window.HubAuth.user ? window.HubAuth.user.role === 'admin' : true;   // the server checks it again
    if (!l && !drafting[e.id] && e.status === 'Done') requestDraft(e.id);
    var lesson = '<h2>The lesson, for the library</h2><p class="sitepv-note">The same work without this project\'s context, so an agent on any other project can recognise a similar situation. A draft until it is reviewed and added to the 2-human library.</p>';
    if (!l) lesson += '<p class="sitepv-note">' + (e.status !== 'Done' ? 'Drafted when the task is done.' : /^error/.test(drafting[e.id] || '') ? 'Not drafted (' + esc(drafting[e.id].slice(7)) + ').' : 'Drafting the lesson…') + '</p>';
    else if (l.notAMove) lesson += '<p>Nothing general to keep: ' + esc(l.markdown.replace(/^NOT A MOVE:\s*/i, '')) + '</p>';
    else lesson += (l.stale ? '<p class="sitepv-error">The record changed after this was drafted: redraft it.</p>' : '') +
      '<p class="sitepv-status"><span class="sitepv-badge" data-st="' + esc(l.review === 'added' ? 'published' : l.review === 'rejected' ? 'failed' : 'proposed') + '">' + esc(lessonState(e)) + '</span></p>' +
      '<pre class="sitepv-record" data-lesson="' + esc(e.id) + '">' + esc(l.markdown) + '</pre>';
    var acts = '<div class="sitepv-actions" data-pick-pass>' + (l && !l.notAMove ? '<button type="button" data-wl="copy" data-id="' + esc(e.id) + '">Copy</button>' : '') +
      (l ? '<button type="button" data-wl="redraft" data-id="' + esc(e.id) + '"' + (drafting[e.id] === 'busy' ? ' disabled' : '') + '>' + (drafting[e.id] === 'busy' ? 'Redrafting…' : 'Redraft') + '</button>' : '') +
      (admin && l && !l.notAMove && l.review !== 'added' ? '<button type="button" data-wl="added" data-id="' + esc(e.id) + '">Added to the library</button>' : '') +
      (admin && l && !l.notAMove && l.review !== 'rejected' ? '<button type="button" data-wl="rejected" data-id="' + esc(e.id) + '">Reject</button>' : '') + '</div>';
    return lesson + acts + (l && l.at ? '<p class="sitepv-note">Drafted ' + esc(when(l.at)) + ' by ' + esc(l.model || '') + (l.costUSD ? ' ($' + esc(l.costUSD.toFixed(3)) + ')' : '') + '.</p>' : '');
  }
  function detail(id) {
    ensure();
    var e = find(id), back = '<p><a href="#/work/log">← Work log</a></p>';
    if (!e) return '<h1>Work log</h1><p class="empty">' + esc(err || (entries ? 'There is no entry ' + id + '.' : 'Loading…')) + '</p>';
    var g = graph(), k = kindOf(e);
    if (k === 'task') {
      var convs = (e.conversations || []).map(function (c) { return g.by[c]; }).filter(Boolean), acts = g.acts[e.id] || [];
      return back + '<h1>' + esc(e.title) + '</h1><p class="sitepv-status">' + badge(e.status) + ' Task · assigned by ' + esc(who(e.assignedBy)) + ' to ' + esc(who(e.assignee)) + ' · ' + esc(when(e.at)) + (e.done ? ' · done ' + esc(when(e.done)) : '') + '</p>' +
        (e.record ? '<p>' + esc(e.record).replace(/\n/g, '<br>') + '</p>' : '') +
        '<p><strong>Outcome:</strong> ' + outcome(e) + '</p>' + ctxLine(e) +
        '<h2>Where it came from</h2>' + (convs.length ? convs.map(function (c) { return convBlock(c, g); }).join('') : '<p class="sitepv-error">No conversation is linked to this task yet.</p>') +
        ((e.decisions || []).length ? '<h2>Decisions behind it</h2><ul class="wl-dec">' + e.decisions.map(function (id) { var d = g.by[id]; return d ? '<li>' + link(d) + ' ' + decState(d, g) + '</li>' : ''; }).join('') + '</ul>' : '') +
        '<h2>What was done</h2>' + (acts.length ? actTable(acts) : '<p class="sitepv-note">Nothing yet.</p>') +
        '<h2>Feedback</h2>' + sigTable([e.id].concat(acts.map(function (a) { return a.id; })).reduce(function (o, id) { return o.concat(g.sigs[id] || []); }, []), g) + lessonBlock(e);
    }
    if (k === 'conversation') {
      var made = g.convTasks[e.id] || [];
      return back + '<h1>' + esc(e.title) + '</h1>' + convBlock(e, g).replace(/^<div class="wl-conv"><p><strong>[\s\S]*?<\/p>/, '<div class="wl-conv"><p class="sitepv-status">' + esc(CHANNEL[e.channel] || 'Conversation') + ' · ' + esc(when(e.at)) + (e.until ? ' – ' + esc(when(e.until)) : '') + (e.participants && e.participants.length ? ' · ' + esc(e.participants.join(', ')) : '') + '</p>') +
        '<h2>Feedback on it</h2>' + sigTable(g.sigs[e.id] || [], g) +
        '<h2>Tasks from it</h2>' + (made.length ? '<table class="sitepv-list"><tbody>' + made.map(function (t) { return '<tr><td>' + link(t) + '</td><td>' + badge(t.status) + '</td><td>' + esc(who(t.assignee)) + '</td></tr>'; }).join('') + '</tbody></table>' : '<p class="sitepv-note">None: a question, or decisions that did not need work.</p>');
    }
    if (k === 'decision') {
      var conv = g.by[e.conversation], led = g.decTasks[e.id] || [], inc = g.replaces[e.id] || [], said = g.decSignals(e);
      var relRow = function (label, d, r) { return '<li><strong>' + esc(label) + '</strong> ' + (d ? link(d) : esc(r.to || '')) + (r.reason ? '<br><span class="sitepv-note">Why: ' + esc(r.reason) + '</span>' : '') + (r.changed ? '<br><span class="sitepv-note">Context: ' + esc(r.changed) + '</span>' : '') + '</li>'; };
      var rels = (e.relations || []).map(function (r) { return relRow(REL[r.type] || r.type, g.by[r.to], r); }).concat(inc.map(function (r) { return relRow(BACK[r.type] || r.type, r.from, r); }));
      if (near[e.id] === undefined) { near[e.id] = null; HubWork.cluster({ id: e.id, k: 8 }).then(function (r) { near[e.id] = r; redraw(); }, function (x) { near[e.id] = { error: x.message }; redraw(); }); }
      var nb = near[e.id], nearBlock = '<h2>Decisions in nearby contexts</h2>' + (!nb ? '<p class="sitepv-note">Finding them…</p>' : nb.error ? '<p class="sitepv-error">' + esc(nb.error) + '</p>' :
        '<p class="sitepv-note">The decisions whose situations are closest to this one (by ' + esc(nb.matching) + '), whatever their age: check this one against them.</p><table class="sitepv-list"><thead><tr><th scope="col">Decision</th><th scope="col">Where it holds</th><th scope="col">Closeness</th><th scope="col">How it turned out</th></tr></thead><tbody>' +
        nb.items.map(function (x) { var d = g.by[x.decision.id] || x.decision; return '<tr><td>' + link(d) + '</td><td>' + esc((d.context && d.context.facets && d.context.facets.surface) || '–') + '</td><td>' + esc(Math.round(x.score * 100) + '%') + '</td><td>' + tally(x.signals) + '</td></tr>'; }).join('') + '</tbody></table>');
      return back + '<p class="label">Decision</p><h1>' + esc(e.title) + '</h1><p class="sitepv-status">' + decState(e, g) + ' made by ' + esc(who(e.by)) + ' · ' + esc(when(e.at)) + '</p>' + ctxLine(e) +
        (rels.length ? '<h2>How it relates to other decisions</h2><ul class="wl-rel">' + rels.join('') + '</ul>' : '') +
        '<h2>How it turned out</h2><p>' + tally(said) + ' across the decision, ' + led.length + ' task' + (led.length === 1 ? '' : 's') + ' and their actions.</p>' +
        (led.length ? '<table class="sitepv-list"><thead><tr><th scope="col">What it led to</th><th scope="col">Status</th><th scope="col">Outcome</th></tr></thead><tbody>' + led.map(function (t) { return '<tr><td>' + link(t) + '</td><td>' + badge(t.status) + '</td><td>' + outcome(t) + '</td></tr>'; }).join('') + '</tbody></table>' : '<p class="sitepv-note">No task came of it: a rule or a preference to follow.</p>') +
        '<h2>Feedback and data</h2>' + sigTable(said, g) +
        nearBlock + '<h2>Where it was made</h2>' + (conv ? convBlock(conv, g) : '<p class="sitepv-note">–</p>');
    }
    if (k === 'signal') {
      var ab = g.by[e.about];
      return back + '<p class="label">Feedback</p><h1>' + esc(SIG[e.type] || e.type) + '</h1><p class="sitepv-status">' + esc((e.by && e.by.who) || SRC[e.source] || '') + ' · ' + esc(when(e.at)) + '</p><p>' + esc(e.note || '') + '</p><p>About: ' + (ab ? link(ab) : esc(e.about)) + '</p>';
    }
    var task = e.task && g.by[e.task];
    return back + '<h1>' + esc(e.title) + '</h1><p class="sitepv-status">' + esc(ACT[e.type] || 'Action') + ' · by ' + esc(who(e.by)) + ' · ' + esc(when(e.at)) + (evidence(e) ? ' · ' + evidence(e) : '') + '</p>' +
      '<p>For the task: ' + (task ? link(task) + ' ' + badge(task.status) : '<span class="sitepv-error">none yet</span>') + '</p>' + (e.record ? '<h2>The record</h2><pre class="sitepv-record">' + esc(e.record) + '</pre>' : '') +
      ((g.sigs[e.id] || []).length ? '<h2>Feedback</h2>' + sigTable(g.sigs[e.id], g) : '');
  }
  document.addEventListener('click', function (ev) {
    var f = ev.target.closest && ev.target.closest('#app-main [data-wlf]'); if (f) { filter = f.getAttribute('data-wlf'); return redraw(); }
    var tb = ev.target.closest && ev.target.closest('#app-main [data-wlt]'); if (tb) { tab = tb.getAttribute('data-wlt'); return redraw(); }
    var sb = ev.target.closest && ev.target.closest('#app-main [data-wls]'); if (sb) { surface = sb.getAttribute('data-wls'); return redraw(); }
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
    cluster: function (q) { return post('/worklog/cluster', q); },   // the decisions nearest a situation (text) or an entry (id)
    outcome: function (batch, n, o) { return post('/suggestions/' + encodeURIComponent(batch) + '/' + n, o); }
  };
  if (onLog()) list().catch(function () {});   // this file loads after the first paint
})();
