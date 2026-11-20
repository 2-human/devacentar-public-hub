/* Hub assistant — local prototype (tasks/todo.md, 20 Nov 2026). Loaded by hub.config.js `after`.
 *
 * A round icon bottom-right opens a panel IN PLACE: no URL flag, no reload; closing removes what it attached.
 * While the panel is open, "Pick" lets a click (or Enter on a focused element) make any element the chat's focus;
 * the click's own action is suppressed only in Pick. The model sees the open screen, the open drawer, the focused
 * element and an outline of the screen (<hub_context>), and acts through tools that use the hub's own functions
 * (go_to, open_item, close_item, list_items, focus); writes (add_note, set_status) appear as cards the person
 * confirms before anything is saved. The conversation and the saved notes stay in this browser for the prototype.
 *
 * The model runs behind tools/assistant/server.mjs, which holds the API keys: on this Mac at 127.0.0.1:8790 for a local
 * preview, on Cloud Run for the published hub (hub.config.js `assistant.endpoint`). The published server answers only
 * signed-in hub members: every request carries the account's Firebase ID token (HubAuth, chassis gate-store.js). */
(function () {
  var LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname), HC = (window.HUB_CONFIG || {}).assistant || {};
  var CFG = Object.assign({ endpoint: LOCAL ? 'http://127.0.0.1:8790/chat' : HC.endpoint, enabled: LOCAL || !!HC.endpoint }, window.HUB_ASSISTANT || {});
  if (!CFG.enabled || !CFG.endpoint || !window.Hub || document.getElementById('asst-panel')) return;
  if (window.HubAuth && window.HubAuth.user && !window.HubAuth.canRead()) return;   // signed in without a hub role
  /* headers for the server: the sign-in token when the hub has one (the published hub); none on a local preview */
  function authed(extra) {
    var h = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
    if (!window.HubAuth || !window.HubAuth.firebase) return Promise.resolve(h);
    return window.HubAuth.firebase().then(function (fb) { return fb.auth.currentUser ? fb.auth.currentUser.getIdToken() : null; })
      .then(function (t) { if (t) h.Authorization = 'Bearer ' + t; return h; }, function () { return h; });
  }
  var UNREACHABLE = LOCAL ? 'The assistant server is not running (tools/assistant: npm start).' : 'The assistant could not be reached; try again in a moment.';

  var PREFIX = ((Hub.config.storage || {}).prefix || 'hub') + ':assistant:';
  var MAX_ROUNDS = 8, TEXT_CAP = 1500, DRAWER_CAP = 4000;
  var esc = Hub.esc;
  var ls = { get: function (k, d) { try { var v = localStorage.getItem(PREFIX + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
             set: function (k, v) { try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); } catch (e) {} } };

  /* ─── records store (notes and statuses); a Firestore adapter can replace it later with the same two calls ─── */
  var Store = window.HubAssistantStore || {
    list: function () { return ls.get('records', []); },
    add: function (r) { var all = ls.get('records', []); r.id = 'r' + Date.now().toString(36); r.at = new Date().toISOString(); all.push(r); ls.set('records', all); return Promise.resolve(r); }
  };

  /* ─── styles and markup ─── */
  var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'assistant.css?v=da5445330c'; css.setAttribute('data-asst', ''); document.head.appendChild(css);
  var ICON = {
    chat: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01"/></svg>',
    pick: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 4l7 16 2.5-6.5L20 11z"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    send: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg>'
  };
  var fab = el('button', { type: 'button', class: 'asst-fab', 'aria-label': 'Open the assistant', 'aria-expanded': 'false', 'aria-controls': 'asst-panel', 'data-asst': '' });
  fab.innerHTML = ICON.chat;
  var panel = el('aside', { id: 'asst-panel', class: 'asst', 'aria-label': 'Assistant', hidden: '', 'data-asst': '' });
  panel.innerHTML =
    '<div class="asst-head"><h2 class="asst-title">Assistant</h2>' +
    '<button type="button" class="asst-btn asst-pick" aria-pressed="true" title="Pick: click anything on the page to focus the chat on it">' + ICON.pick + '<span>Pick</span></button>' +
    '<button type="button" class="asst-btn asst-notes-btn" aria-pressed="false"><span>Notes</span> <span class="asst-count">0</span></button>' +
    '<button type="button" class="asst-btn asst-models-btn" aria-pressed="false">Models</button>' +
    '<button type="button" class="asst-btn asst-new">New</button>' +
    '<button type="button" class="asst-icon asst-close" aria-label="Close the assistant">' + ICON.x + '</button></div>' +
    '<div class="asst-log" role="log" aria-live="polite" aria-label="Conversation"></div>' +
    '<div class="asst-notes" hidden><h3>Notes and statuses</h3><ul></ul></div>' +
    '<div class="asst-models" hidden><h3>Models</h3><div class="asst-models-body"></div></div>' +
    '<div class="asst-foot">' +
    '<div class="asst-chip" hidden><span class="asst-chip-k">Focused</span> <span class="asst-chip-v"></span><button type="button" class="asst-icon asst-chip-x" aria-label="Clear the focus">' + ICON.x + '</button></div>' +
    '<div class="asst-route"><label for="asst-model-pick">Model</label> <select id="asst-model-pick" class="asst-model-pick"><option value="">Auto (router)</option></select></div>' +
    '<form class="asst-form"><label class="asst-sr" for="asst-input">Message</label>' +
    '<textarea id="asst-input" rows="2" placeholder="Ask about this page, or click something to focus on it…"></textarea>' +
    '<button type="submit" class="asst-icon asst-send" aria-label="Send">' + ICON.send + '</button></form></div>';
  var hoverBox = el('div', { class: 'asst-outline asst-hover', 'aria-hidden': 'true', 'data-asst': '' });
  var focusBox = el('div', { class: 'asst-outline asst-focused', 'aria-hidden': 'true', 'data-asst': '' });
  document.body.appendChild(fab);

  var q = function (s) { return panel.querySelector(s); };
  var log = q('.asst-log'), input = q('#asst-input'), chip = q('.asst-chip'), pickBtn = q('.asst-pick');

  function el(tag, attrs) { var e = document.createElement(tag); Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); }); return e; }

  /* ─── state ─── */
  var open = false, pick = true, hoverEl = null, focusEl = null, focusInfo = null, busy = null;
  var messages = ls.get('messages', []), shown = ls.get('shown', []);   // API history; what the log shows
  function save() { ls.set('messages', messages); ls.set('shown', shown); }
  var ours = function (t) { return !!(t && t.closest && t.closest('[data-asst]')); };
  /* controls marked data-pick-pass (the main column's back/forward arrows) always keep their own action, even in Pick */
  var passes = function (t) { return !!(t && t.closest && t.closest('[data-pick-pass]')); };

  /* ─── open / close (in place) ─── */
  function openPanel() {
    if (open) return; open = true;
    document.body.appendChild(panel); document.body.appendChild(hoverBox); document.body.appendChild(focusBox);
    panel.hidden = false; document.documentElement.classList.add('asst-open');
    fab.setAttribute('aria-expanded', 'true'); fab.hidden = true;
    setPick(true); redrawLog(); countNotes(); loadModels();
    window.addEventListener('mouseover', onOver, true); window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey, true); window.addEventListener('scroll', place, true); window.addEventListener('resize', place);
    input.focus();
  }
  function closePanel() {
    if (!open) return; open = false;
    if (busy) busy.abort();
    window.removeEventListener('mouseover', onOver, true); window.removeEventListener('click', onClick, true);
    window.removeEventListener('keydown', onKey, true); window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place);
    setFocus(null); hoverEl = null;
    [panel, hoverBox, focusBox].forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
    document.documentElement.classList.remove('asst-open');
    fab.hidden = false; fab.setAttribute('aria-expanded', 'false'); fab.focus();
  }
  fab.addEventListener('click', openPanel);
  q('.asst-close').addEventListener('click', closePanel);
  pickBtn.addEventListener('click', function () { setPick(!pick); });
  q('.asst-chip-x').addEventListener('click', function () { setFocus(null); input.focus(); });
  q('.asst-new').addEventListener('click', function () { if (busy) busy.abort(); messages = []; shown = []; save(); redrawLog(); input.focus(); });
  q('.asst-notes-btn').addEventListener('click', function () { var on = q('.asst-notes').hidden; showNotes(on); });
  q('.asst-models-btn').addEventListener('click', function () { showModels(q('.asst-models').hidden); });

  function setPick(on) {
    pick = on; pickBtn.setAttribute('aria-pressed', String(on));
    document.documentElement.classList.toggle('asst-picking', on);
    if (!on) { hoverEl = null; place(); }
  }

  /* ─── pick: hover outline, click or Enter focuses (only in Pick does a click lose its own action) ─── */
  var PICKABLE = 'tr,li,figure,[data-d],h1,h2,h3,h4,p,dt,dd,img,button,a,.tile,label,blockquote,pre,section,article,iframe';
  function pickable(t) {
    if (!t || t.nodeType !== 1 || ours(t)) return null;
    var root = t.closest('#app-main,#app-drawer,#app-nav,#app-bar'); if (!root) return null;
    var c = t.closest(PICKABLE);
    if (c && c.tagName === 'TD') c = c.closest('tr') || c;
    if (!c || !root.contains(c) || c === root) c = t;
    return c === root ? null : c;
  }
  function onOver(e) { if (!pick || passes(e.target)) return; var p = pickable(e.target); if (p !== hoverEl) { hoverEl = p; place(); } }
  function onClick(e) {
    if (!pick || ours(e.target) || passes(e.target)) return;
    var p = pickable(e.target); if (!p) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    setFocus(p); input.focus({ preventScroll: true });
  }
  function onKey(e) {
    /* Esc: inside the panel it clears the focus, then closes; elsewhere it clears a picked focus and otherwise belongs to
     * the hub (closing its drawer) */
    if (e.key === 'Escape' && open) {
      var inPanel = panel.contains(document.activeElement);
      if (!inPanel && !focusEl) return;
      e.stopPropagation(); e.preventDefault();
      if (focusEl) setFocus(null); else closePanel();
      return;
    }
    if (e.key === 'Enter' && pick && !ours(e.target) && !passes(e.target) && e.target !== document.body) {
      var p = pickable(e.target); if (!p) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      setFocus(p); input.focus({ preventScroll: true });
    }
  }
  function setFocus(node, quiet) {
    focusEl = node || null;
    focusInfo = node ? describe(node) : null;
    chip.hidden = !node; q('.asst-chip-v').textContent = node ? focusInfo.label : '';
    if (node && !quiet) say('Focused on ' + focusInfo.label);
    place();
  }
  function box(b, node) {
    if (!node || !document.contains(node)) { b.style.display = 'none'; return; }
    var r = node.getBoundingClientRect(); if (!r.width && !r.height) { b.style.display = 'none'; return; }
    b.style.display = 'block'; b.style.left = r.left - 3 + 'px'; b.style.top = r.top - 3 + 'px'; b.style.width = r.width + 6 + 'px'; b.style.height = r.height + 6 + 'px';
  }
  var placing = 0;
  function place() { if (placing) return; placing = requestAnimationFrame(function () { placing = 0; box(hoverBox, pick && hoverEl !== focusEl ? hoverEl : null); box(focusBox, focusEl); }); }
  /* a redraw replaces the screen's nodes: find the focused element again by its item reference or its text */
  function refind() {
    if (!focusEl || document.contains(focusEl) || !focusInfo) return place();
    var n = (focusInfo.ref && document.querySelector('[data-d="' + CSS.escape(focusInfo.ref) + '"]')) || byText(focusInfo.text.slice(0, 80));
    if (n) { focusEl = n; } else setFocus(null, true);
    place();
  }
  Hub.onRender(refind); Hub.onDrawer(function () { refind(); });

  /* ─── what the model sees ─── */
  var clean = function (s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return n && s.length > n ? s.slice(0, n) + '…' : s; };
  function headingBefore(node) {
    var root = node.closest('#app-drawer') || document.getElementById('app-main'); if (!root) return '';
    var hs = [].slice.call(root.querySelectorAll('h1,h2,h3')).filter(function (h) { return h === node || (h.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING); });
    return hs.length ? clean(hs[hs.length - 1].textContent, 80) : '';
  }
  function describe(node) {
    var refEl = node.closest('[data-d]'), ref = refEl ? refEl.getAttribute('data-d') : null;
    var text = node.tagName === 'IMG' ? 'image: ' + (node.getAttribute('alt') || '') + ' (' + (node.currentSrc || node.src).split('/').pop() + ')' : clean(node.innerText || node.textContent, TEXT_CAP);
    var where = node.closest('#app-drawer') ? 'drawer' : node.closest('#app-nav') ? 'menu' : node.closest('#app-bar') ? 'top bar' : 'screen';
    var head = headingBefore(node), first = clean(text, 60);
    return { ref: ref, tag: node.tagName.toLowerCase(), where: where, heading: head, text: text, label: (head && head !== first ? head + ' › ' : '') + (first || node.tagName.toLowerCase()) };
  }
  function drawerOpen() { var d = document.getElementById('app-drawer'); return d && d.getAttribute('aria-hidden') === 'false'; }
  function outline() {
    var main = document.getElementById('app-main'); if (!main) return '';
    var lines = [];
    main.querySelectorAll('h1,h2,h3,[data-d]').forEach(function (n) {
      if (lines.length >= 60) return;
      if (/^H[123]$/.test(n.tagName)) lines.push('#'.repeat(+n.tagName[1]) + ' ' + clean(n.textContent, 90));
      else lines.push('- [' + n.getAttribute('data-d') + '] ' + clean(n.innerText || n.textContent, 90));
    });
    return lines.join('\n');
  }
  function context() {
    var c = ['screen: ' + (location.hash.slice(1) || '/') + ' — ' + clean((document.querySelector('#app-main h1') || {}).textContent || document.title, 90)];
    if (drawerOpen()) c.push('open drawer: [' + (Hub.state.d || '') + '] ' + clean(document.getElementById('drawer-title').textContent, 90));
    if (focusInfo) c.push('focused element (in the ' + focusInfo.where + (focusInfo.ref ? ', item [' + focusInfo.ref + ']' : '') + ', <' + focusInfo.tag + '>' + (focusInfo.heading ? ', under "' + focusInfo.heading + '"' : '') + '):\n' + focusInfo.text);
    else c.push('focused element: none');
    c.push('screen outline:\n' + outline());
    return '<hub_context>\n' + c.join('\n') + '\n</hub_context>';
  }

  /* ─── the conversation log ─── */
  function md(s) {   /* a small, safe subset: escape first, then **bold**, `code`, line breaks and "- " lists */
    var h = esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
    return h.split(/\n{2,}/).map(function (p) {
      return /^- /m.test(p) ? '<ul>' + p.split('\n').map(function (l) { return /^- /.test(l) ? '<li>' + l.slice(2) + '</li>' : l; }).join('') + '</ul>' : '<p>' + p.replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }
  function addShown(kind, text, extra) { var m = Object.assign({ kind: kind, text: text }, extra || {}); shown.push(m); save(); log.appendChild(row(m)); log.scrollTop = log.scrollHeight; return m; }
  var money = function (usd) { return !usd ? 'free' : usd < 0.01 ? '$' + usd.toFixed(4) : '$' + usd.toFixed(3); };
  function row(m) {
    var d = el('div', { class: 'asst-msg asst-' + m.kind });
    if (m.kind === 'bot') {
      d.innerHTML = md(m.text);
      if (m.meta) {   /* which model answered, what it cost, and 👍/👎 for the router's learning */
        var f = el('div', { class: 'asst-meta asst-model' });
        f.innerHTML = '<span>' + esc(m.meta.label + ' · ' + (m.meta.free ? 'free' : money(m.meta.cost)) + ' · ' + (m.meta.ms / 1000).toFixed(1) + ' s') + '</span>';
        if (m.meta.turnId) ['up', 'down'].forEach(function (sig) {
          var b = el('button', { type: 'button', class: 'asst-fb', 'data-fb': sig, 'aria-pressed': String(m.meta.fb === sig), 'aria-label': sig === 'up' ? 'Good answer' : 'Bad answer', title: sig === 'up' ? 'Good answer' : 'Bad answer' });
          b.textContent = sig === 'up' ? '👍' : '👎';
          b.addEventListener('click', function () { feedback(m, sig === m.meta.fb ? 'none' : sig, d); });
          f.appendChild(b);
        });
        d.appendChild(f);
      }
    }
    else if (m.kind === 'card') d.innerHTML = '<p>' + esc(m.text) + '</p><p class="asst-meta">' + esc(m.outcome || '') + '</p>';
    else { d.textContent = m.text; if (m.focus) { var f2 = el('div', { class: 'asst-meta' }); f2.textContent = 'about: ' + m.focus; d.appendChild(f2); } }
    return d;
  }
  var base = CFG.endpoint.replace(/\/chat$/, '');
  function feedback(m, sig, node) {
    m.meta.fb = sig === 'none' ? null : sig; save();
    node.querySelectorAll('[data-fb]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-fb') === m.meta.fb)); });
    authed().then(function (h) { return fetch(base + '/feedback', { method: 'POST', headers: h, body: JSON.stringify({ id: m.meta.turnId, signal: sig }) }); }).catch(function () {});
    say(sig === 'up' ? 'Marked as a good answer' : sig === 'down' ? 'Marked as a bad answer' : 'Feedback removed');
  }
  function redrawLog() {
    log.innerHTML = '';
    if (!shown.length) { var e = el('div', { class: 'asst-msg asst-hint' }); e.innerHTML = '<p>Ask about this page. With <strong>Pick</strong> on, click anything to focus the chat on it; turn Pick off to use the hub normally.</p><p>Each answer comes from the cheapest model that has proven good at that kind of question (free local models first); 👍 / 👎 teach it.</p>'; log.appendChild(e); }
    shown.forEach(function (m) { log.appendChild(row(m)); });
    log.scrollTop = log.scrollHeight;
  }
  var announcer = el('div', { class: 'asst-sr', role: 'status', 'aria-live': 'polite', 'data-asst': '' }); document.body.appendChild(announcer);
  function say(t) { announcer.textContent = ''; setTimeout(function () { announcer.textContent = t; }, 30); }

  /* ─── send a message and run the tool loop ─── */
  q('.asst-form').addEventListener('submit', function (e) { e.preventDefault(); var t = input.value.trim(); if (!t || busy) return; input.value = ''; send(t); });
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); q('.asst-form').requestSubmit(); } });

  var lastTurn = ls.get('lastTurn', null);
  function send(text) {
    if (shown.length === 0) log.innerHTML = '';
    addShown('user', text, { focus: focusInfo ? focusInfo.label : null });
    messages.push({ role: 'user', content: [{ type: 'text', text: context() }, { type: 'text', text: text }] });
    save(); loop();
  }

  /* one user turn: same turn id on every request, so the server keeps it on one model (or escalates it) */
  function loop() {
    var ctl = new AbortController(); busy = ctl; panel.setAttribute('aria-busy', 'true'); q('.asst-send').disabled = true;
    var rounds = 0, tid = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    var turnInfo = { id: tid, prevId: lastTurn, pin: q('.asst-model-pick').value || null, toolErrors: 0 };
    lastTurn = tid; ls.set('lastTurn', tid);
    function done() { busy = null; panel.removeAttribute('aria-busy'); q('.asst-send').disabled = false; }
    function turn() {
      var bubble = null, acc = '';
      return stream(ctl.signal, turnInfo, function (delta) {
        acc += delta;
        if (!bubble) { bubble = row({ kind: 'bot', text: '' }); bubble.classList.add('asst-live'); log.appendChild(bubble); }
        bubble.innerHTML = md(acc); log.scrollTop = log.scrollHeight;
      }, function (route) {
        if (bubble) { bubble.remove(); bubble = null; acc = ''; }   // an escalation restarts the answer
        addShown('step', (route.escalated ? '↑ ' : '→ ') + route.label + (route.free ? ' (free)' : '') + ' — ' + route.reason);
      }).then(function (fin) {
        if (bubble) bubble.remove();
        messages.push({ role: 'assistant', content: fin.content }); save();
        var txt = fin.content.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n\n').trim();
        var calls = fin.content.filter(function (b) { return b.type === 'tool_use'; });
        var meta = { label: fin.label, free: fin.free, cost: fin.costUSD, ms: fin.ms, turnId: calls.length ? null : tid };
        if (txt || !calls.length) addShown('bot', txt || '…', { meta: meta });
        if (fin.stop_reason === 'refusal') { addShown('note', 'The model declined to answer that.'); return; }
        if (fin.stop_reason === 'pause_turn') return turn();
        if (!calls.length) return;
        if (++rounds > MAX_ROUNDS) { addShown('note', 'Stopped after ' + MAX_ROUNDS + ' steps.'); return; }
        return calls.reduce(function (p, c) { return p.then(function (acc2) { return run(c).then(function (r) { acc2.push(r); return acc2; }); }); }, Promise.resolve([]))
          .then(function (results) {
            turnInfo.toolErrors = results.every(function (r) { return r.is_error; }) ? turnInfo.toolErrors + results.length : 0;
            messages.push({ role: 'user', content: results }); save(); return turn();
          });
      });
    }
    turn().catch(function (err) {
      if (err && err.name === 'AbortError') return;
      addShown('note', (err && err.message) || 'Something went wrong.');
    }).then(done);
  }

  /* POST the history; read the server-sent events; resolve with the final message */
  function stream(signal, turnInfo, onText, onRoute) {
    return authed().then(function (h) { return fetch(CFG.endpoint, { method: 'POST', headers: h, body: JSON.stringify({ messages: messages, turn: turnInfo }), signal: signal }); })
      .catch(function (e) { if (e.name === 'AbortError') throw e; throw new Error(UNREACHABLE); })
      .then(function (res) {
        if (res.status === 401) throw new Error('Your sign-in has expired: reload the hub (and sign in again if it asks).');
        if (!res.ok || !res.body) throw new Error('The assistant server answered ' + res.status + '.');
        var reader = res.body.getReader(), dec = new TextDecoder(), buf = '', fin = null, fail = null;
        function pump() {
          return reader.read().then(function (r) {
            if (r.done) { if (fail) throw new Error(fail); if (!fin) throw new Error('The reply ended early; try again.'); return fin; }
            buf += dec.decode(r.value, { stream: true });
            var parts = buf.split('\n\n'); buf = parts.pop();
            parts.forEach(function (p) {
              var ev = (/^event: (.*)$/m.exec(p) || [])[1], data = (/^data: (.*)$/m.exec(p) || [])[1]; if (!ev || !data) return;
              var d = JSON.parse(data);
              if (ev === 'text') onText(d.delta); else if (ev === 'route') onRoute(d); else if (ev === 'final') fin = d; else if (ev === 'error') fail = d.message;
            });
            return pump();
          });
        }
        return pump();
      });
  }

  /* ─── models: pin one for testing, or see what the router has learned ─── */
  function loadModels() {
    return authed().then(function (h) { return fetch(base + '/models', { headers: h }); }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (rep) {
      var sel = q('.asst-model-pick'), keep = sel.value;
      sel.innerHTML = '<option value="">Auto (router)</option>' + rep.models.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.label + (m.free ? ' · free' : '')) + '</option>'; }).join('');
      sel.value = keep; return rep;
    }).catch(function () { return null; });
  }
  function showModels(on) {
    var box = q('.asst-models'); box.hidden = !on; log.hidden = on || !q('.asst-notes').hidden; q('.asst-models-btn').setAttribute('aria-pressed', String(on));
    if (on) { q('.asst-notes').hidden = true; q('.asst-notes-btn').setAttribute('aria-pressed', 'false'); }
    if (!on) { log.hidden = false; return; }
    box.querySelector('.asst-models-body').innerHTML = '<p class="asst-meta">Loading…</p>';
    loadModels().then(function (rep) {
      if (!rep) { box.querySelector('.asst-models-body').innerHTML = '<p class="asst-meta">' + esc(UNREACHABLE) + '</p>'; return; }
      var label = {}; rep.models.forEach(function (m) { label[m.id] = m.label + (m.free ? ' (free)' : ''); });
      var html = '<p class="asst-meta">Available, cheapest first: ' + rep.models.map(function (m) { return esc(label[m.id]); }).join(' → ') + '</p>';
      if (rep.dailyCap) html += '<p class="asst-meta">Paid models today: ' + esc(money(rep.spentToday) === 'free' ? '$0' : money(rep.spentToday)) + ' of the $' + esc(rep.dailyCap) + ' daily budget; past it, free models only.</p>';
      if (!rep.tasks.length) html += '<p class="asst-meta">Nothing learned yet: every answer and every 👍 / 👎 adds to this.</p>';
      rep.tasks.forEach(function (t) {
        var parts = t.key.split('|');
        html += '<h4>' + esc(parts[0]) + ' · ' + esc(parts[1] === 'sr' ? 'Serbian' : 'English') + '</h4><table class="asst-table"><thead><tr><th scope="col">Model</th><th scope="col">Good</th><th scope="col">Turns</th><th scope="col">Avg cost</th></tr></thead><tbody>' +
          t.models.map(function (m) { return '<tr><td>' + esc(label[m.id] || m.id) + '</td><td>' + (m.turns ? Math.round(100 * m.ok / m.turns) + '%' : '–') + '</td><td>' + m.turns + '</td><td>' + esc(money(m.avgCost)) + '</td></tr>'; }).join('') + '</tbody></table>';
      });
      box.querySelector('.asst-models-body').innerHTML = html;
    });
  }

  /* ─── tools: the hub's own functions; writes wait for the person's yes ─── */
  var str = function (v, n) { return typeof v === 'string' && v.length > 0 && v.length <= (n || 300); };
  function result(c, text, isError) { return { type: 'tool_result', tool_use_id: c.id, content: text, is_error: !!isError }; }
  function settle() { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(function () { setTimeout(r, 30); }); }); }); }
  function byText(t) {
    if (!t) return null; t = t.toLowerCase();
    var roots = [document.getElementById('app-main')].concat(drawerOpen() ? [document.getElementById('app-drawer')] : []), best = null, len = 1e9;
    roots.forEach(function (root) { if (!root) return; root.querySelectorAll('*').forEach(function (n) {
      if (ours(n)) return; var s = (n.innerText || '').toLowerCase(); if (s.indexOf(t) >= 0 && s.length < len) { best = n; len = s.length; }
    }); });
    return best ? (pickable(best) || best) : null;
  }
  function resolve(target) {
    if (target === 'focus') return focusEl;
    if (/^[\w-]+:\S+$/.test(target)) { var n = document.querySelector('[data-d="' + CSS.escape(target) + '"]'); if (n) return n; }
    return byText(target);
  }
  function label(target, node) { return node ? describe(node).label : target; }

  function run(c) {
    var i = c.input || {};
    try {
      switch (c.name) {
        case 'go_to':
          if (!str(i.route, 120) || i.route[0] !== '/') return Promise.resolve(result(c, 'route must start with /', true));
          if (!Hub.routes().some(function (p) { return i.route === p || i.route.indexOf(p + '/') === 0 || i.route.indexOf(p + '?') === 0; })) return Promise.resolve(result(c, 'no such screen; routes: ' + Hub.routes().join(', '), true));
          addShown('step', 'Going to ' + i.route);
          location.hash = '#' + i.route;
          return settle().then(function () { refind(); return result(c, 'now on ' + i.route + '\n' + outline()); });
        case 'open_item':
          if (!str(i.ref, 120) || !/^[\w-]+:\S+$/.test(i.ref)) return Promise.resolve(result(c, 'ref must be type:id', true));
          if (Hub.open(i.ref) === false) return Promise.resolve(result(c, 'no item ' + i.ref, true));
          addShown('step', 'Opened ' + i.ref);
          return settle().then(function () {
            var title = clean(document.getElementById('drawer-title').textContent, 120), body = clean(document.getElementById('drawer-body').innerText, DRAWER_CAP);
            return result(c, 'opened [' + i.ref + '] ' + title + '\n' + body);
          });
        case 'close_item':
          Hub.close(); return settle().then(function () { return result(c, 'closed'); });
        case 'list_items':
          var items = [].map.call(document.querySelectorAll('#app-main [data-d]'), function (n) { return n.getAttribute('data-d') + ' — ' + clean(n.innerText || n.textContent, 90); });
          return Promise.resolve(result(c, items.length ? items.join('\n') : 'no items on this screen'));
        case 'focus':
          if (!str(i.target)) return Promise.resolve(result(c, 'target required', true));
          var n = resolve(i.target); if (!n) return Promise.resolve(result(c, 'not found on this screen: ' + i.target, true));
          n.scrollIntoView({ block: 'center', behavior: 'smooth' }); setFocus(n);
          return settle().then(function () { return result(c, 'outlined: ' + focusInfo.label); });
        case 'add_note':
          if (!str(i.target) || !str(i.text, 2000)) return Promise.resolve(result(c, 'target and text required (text up to 2000 characters)', true));
          return write(c, 'note', i.target, { text: i.text }, 'Add this note to ' );
        case 'set_status':
          if (!str(i.target) || ['approved', 'changes_requested'].indexOf(i.state) < 0 || typeof i.note !== 'string' || i.note.length > 2000) return Promise.resolve(result(c, 'target, state (approved | changes_requested) and note required', true));
          return write(c, 'status', i.target, { state: i.state, text: i.note }, i.state === 'approved' ? 'Mark as approved: ' : 'Request changes on ');
        default:
          return Promise.resolve(result(c, 'unknown tool ' + c.name, true));
      }
    } catch (e) { return Promise.resolve(result(c, 'failed: ' + e.message, true)); }
  }

  /* a write is a card: the person saves or cancels; nothing is stored before the yes */
  function write(c, kind, target, data, verb) {
    var node = resolve(target), ref = target === 'focus' ? (focusInfo && focusInfo.ref) : (/^[\w-]+:\S+$/.test(target) ? target : (node && describe(node).ref));
    if (target === 'focus' && !focusEl) return Promise.resolve(result(c, 'nothing is focused', true));
    var lab = label(target, node);
    return new Promise(function (resolveCard) {
      var card = el('div', { class: 'asst-msg asst-card', role: 'group', 'aria-label': 'Confirm' });
      card.innerHTML = '<p class="asst-card-q">' + esc(verb + lab) + '</p>' + (data.text ? '<blockquote>' + esc(data.text) + '</blockquote>' : '') +
        '<div class="asst-card-actions"><button type="button" class="asst-btn asst-yes">Save</button><button type="button" class="asst-btn asst-no">Cancel</button></div>';
      log.appendChild(card); log.scrollTop = log.scrollHeight;
      if (node) { node.scrollIntoView({ block: 'center', behavior: 'smooth' }); hoverEl = node; place(); }
      card.querySelector('.asst-yes').focus();
      function finish(ok) {
        card.remove(); hoverEl = null; place();
        var summary = (kind === 'note' ? 'Note on ' : (data.state === 'approved' ? 'Approved: ' : 'Changes requested on ')) + lab + (data.text ? ': ' + data.text : '');
        if (!ok) { addShown('card', summary, { outcome: 'Cancelled' }); return resolveCard(result(c, 'declined by the user; nothing was saved')); }
        Store.add({ kind: kind, state: data.state || null, text: data.text || '', target: { ref: ref || null, label: lab, route: location.hash.slice(1) } }).then(function () {
          addShown('card', summary, { outcome: 'Saved' }); countNotes(); say('Saved');
          resolveCard(result(c, 'saved'));
        }, function (e) { addShown('card', summary, { outcome: 'Not saved: ' + e.message }); resolveCard(result(c, 'saving failed: ' + e.message, true)); });
      }
      card.querySelector('.asst-yes').addEventListener('click', function () { finish(true); });
      card.querySelector('.asst-no').addEventListener('click', function () { finish(false); });
      busy && busy.signal.addEventListener('abort', function () { if (document.contains(card)) finish(false); });
    });
  }

  /* ─── notes list ─── */
  function countNotes() { q('.asst-count').textContent = String(Store.list().length); }
  function showNotes(on) {
    q('.asst-notes').hidden = !on; log.hidden = on; q('.asst-notes-btn').setAttribute('aria-pressed', String(on));
    if (on) { q('.asst-models').hidden = true; q('.asst-models-btn').setAttribute('aria-pressed', 'false'); }
    if (!on) return;
    var ul = q('.asst-notes ul'); ul.innerHTML = '';
    var all = Store.list().slice().reverse();
    if (!all.length) ul.innerHTML = '<li class="asst-meta">Nothing saved yet.</li>';
    all.forEach(function (r) {
      var li = el('li', {}), kind = r.kind === 'note' ? 'Note' : (r.state === 'approved' ? 'Approved' : 'Changes requested');
      li.innerHTML = '<strong>' + esc(kind) + '</strong> · ' + esc(r.target.label) + (r.text ? '<br>' + esc(r.text) : '') + '<br><span class="asst-meta">' + esc(r.target.route || '') + ' · ' + esc(new Date(r.at).toLocaleString()) + '</span> ';
      var b = el('button', { type: 'button', class: 'asst-btn' }); b.textContent = 'Show';
      b.addEventListener('click', function () {
        showNotes(false);
        var go = r.target.route && ('#' + r.target.route) !== location.hash; if (go) location.hash = '#' + r.target.route;
        settle().then(function () { var n = resolve(r.target.ref || r.target.label.split(' › ').pop()); if (n) { n.scrollIntoView({ block: 'center' }); setFocus(n); } });
      });
      li.appendChild(b); ul.appendChild(li);
    });
  }

  window.HubAssistant = { open: openPanel, close: closePanel, focus: function (n) { setFocus(n); }, state: function () { return { open: open, pick: pick, focus: focusInfo, busy: !!busy }; } };
})();
