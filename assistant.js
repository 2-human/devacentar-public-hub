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
  var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'assistant.css?v=d203cc1f7b'; css.setAttribute('data-asst', ''); document.head.appendChild(css);
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
    setPick(true); redrawLog(); countNotes(); loadModels(); greetFrames();
    window.addEventListener('mouseover', onOver, true); window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey, true); window.addEventListener('scroll', place, true); window.addEventListener('resize', place);
    input.focus();
  }
  function closePanel() {
    if (!open) return; open = false; tellFrames('hub-pick:off');
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
    tellFrames(on && open ? 'hub-pick:on' : 'hub-pick:off');
    if (!on) { hoverEl = null; place(); }
  }

  /* ─── embedded pages: the pick protocol (public/website/assets/pick-agent.js) ───
   * Pick works the same in every page the hub shows in a frame (the live site, website-change previews, the brand
   * guidelines): each frame is greeted; a page that answers runs Pick inside itself and reports what is under the pointer
   * and what was picked (its text and heading); the outlines are drawn here, at the frame's place and scale. A frame that
   * never answers (another site, the map) is picked whole and says so. A new screen with a frame needs nothing more: the
   * page it shows loads the agent (the website's site.js does; a copy the hub builds adds it), and the pick-coverage
   * test checks every screen. */
  var agents = new Map();   // frame element -> true once its page answered
  var frames = function () { return [].slice.call(document.querySelectorAll('#app-main iframe, #app-drawer iframe')); };
  function greet(f) { try { if (f.contentWindow) f.contentWindow.postMessage({ type: 'hub-pick:hello', on: !!(open && pick) }, '*'); } catch (e) {} }
  function greetFrames() {
    frames().forEach(function (f) {
      if (!f.__asstPick) { f.__asstPick = 1; f.addEventListener('load', function () { agents.delete(f); f.removeAttribute('data-pick-agent'); greet(f); setTimeout(function () { greet(f); }, 600); }); }
      if (!agents.has(f)) greet(f);
    });
  }
  function tellFrames(type) { if (!agents) return; agents.forEach(function (x, f) { try { if (f.isConnected && f.contentWindow) f.contentWindow.postMessage({ type: type }, '*'); } catch (e) {} }); }
  window.addEventListener('message', function (e) {
    var m = e.data; if (!m || typeof m.type !== 'string' || m.type.indexOf('hub-pick:') !== 0) return;
    var f = frames().filter(function (x) { return x.contentWindow === e.source; })[0]; if (!f) return;   // only frames on this screen
    if (m.type === 'hub-pick:ready') {
      agents.set(f, true); f.setAttribute('data-pick-agent', '');
      if (f.hasAttribute('data-fit-height') && m.height > 0) f.style.height = Math.ceil(m.height) + 'px';
      return;
    }
    if (!agents.has(f) || !open) return;
    if (m.type === 'hub-pick:hover') { hoverEl = m.rect ? { frame: f, rect: m.rect } : null; place(); }
    else if (m.type === 'hub-pick:focus' && m.info) { setFocus({ frame: f, rect: m.rect }, false, m.info); input.focus({ preventScroll: true }); }
    else if (m.type === 'hub-pick:rects') { if (hoverEl && hoverEl.frame === f) hoverEl.rect = m.hover; if (focusEl && focusEl.frame === f) focusEl.rect = m.focus; place(); }
    else if (m.type === 'hub-pick:key' && m.key === 'Escape') { if (focusEl) setFocus(null); else closePanel(); }
  });
  // an element inside a frame, in this page's coordinates: the frame's place plus the element's, times the frame's scale,
  // clipped to the frame
  function rectFor(node) {
    if (node && node.frame) {
      var f = node.frame, r = node.rect; if (!f.isConnected || !r) return null;
      var fr = f.getBoundingClientRect(), s = f.offsetWidth ? fr.width / f.offsetWidth : 1;
      var left = fr.left + (f.clientLeft + r.left) * s, top = fr.top + (f.clientTop + r.top) * s;
      var L = Math.max(left, fr.left), T = Math.max(top, fr.top), R = Math.min(left + r.width * s, fr.right), B = Math.min(top + r.height * s, fr.bottom);
      return R > L && B > T ? { left: L, top: T, width: R - L, height: B - T } : null;
    }
    return node && document.contains(node) ? node.getBoundingClientRect() : null;
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
  function onOver(e) { if (!pick || passes(e.target) || (e.target.tagName === 'IFRAME' && agents.has(e.target))) return; var p = pickable(e.target); if (p !== hoverEl) { hoverEl = p; place(); } }
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
  function setFocus(node, quiet, info) {   // node: an element, or { frame, rect } with info from the frame's page
    if (focusEl && focusEl.frame && focusEl !== node) tellFrames('hub-pick:clear');
    focusEl = node || null;
    focusInfo = !node ? null : node.frame ? { ref: null, tag: info.tag, where: 'embedded page "' + (node.frame.getAttribute('title') || 'page') + '"', heading: info.heading || '', text: info.text || '', label: info.label || info.tag } : describe(node);
    chip.hidden = !node; q('.asst-chip-v').textContent = node ? focusInfo.label : '';
    if (node && !quiet) say('Focused on ' + focusInfo.label);
    place();
  }
  function box(b, node) {
    var r = rectFor(node); if (!r || (!r.width && !r.height)) { b.style.display = 'none'; return; }
    b.style.display = 'block'; b.style.left = r.left - 3 + 'px'; b.style.top = r.top - 3 + 'px'; b.style.width = r.width + 6 + 'px'; b.style.height = r.height + 6 + 'px';
  }
  var placing = 0;
  function place() { if (placing) return; placing = requestAnimationFrame(function () { placing = 0; box(hoverBox, pick && hoverEl !== focusEl ? hoverEl : null); box(focusBox, focusEl); }); }
  /* a redraw replaces the screen's nodes: find the focused element again by its item reference or its text */
  function refind() {
    greetFrames();
    if (focusEl && focusEl.frame) { if (!focusEl.frame.isConnected) setFocus(null, true); return place(); }
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
    var text = node.tagName === 'IFRAME' ? 'embedded page "' + (node.getAttribute('title') || node.src || 'page') + '" (its contents cannot be picked: it is another site)' : node.tagName === 'IMG' ? 'image: ' + (node.getAttribute('alt') || '') + ' (' + (node.currentSrc || node.src).split('/').pop() + ')' : clean(node.innerText || node.textContent, TEXT_CAP);
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
    if (!shown.length) { var e = el('div', { class: 'asst-msg asst-hint' }); e.innerHTML = '<p>Ask about this page. With <strong>Pick</strong> on, click anything to focus the chat on it; turn Pick off to use the hub normally.</p><p>Each answer comes from the cheapest model that has proven good at that kind of question; 👍 / 👎 teach it.</p><p class="asst-notice">What you ask, and what is on this page, goes to the model that answers. On this hub that is Anthropic\'s Claude only, under its commercial terms (not used for training). Leave out anything private that is not already in the hub.</p>'; log.appendChild(e); }
    shown.forEach(function (m) { log.appendChild(row(m)); });
    log.scrollTop = log.scrollHeight;
  }
  var announcer = el('div', { class: 'asst-sr', role: 'status', 'aria-live': 'polite', 'data-asst': '' }); document.body.appendChild(announcer);
  function say(t) { announcer.textContent = ''; setTimeout(function () { announcer.textContent = t; }, 30); }

  /* ─── send a message and run the tool loop ─── */
  q('.asst-form').addEventListener('submit', function (e) { e.preventDefault(); var t = input.value.trim(); if (!t || busy) return; input.value = ''; send(t); });
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); q('.asst-form').requestSubmit(); } });

  var lastTurn = ls.get('lastTurn', null);
  /* a step the model asked for that never ran (the page reloaded while a card waited) gets a "not run" answer, or
   * Claude refuses the whole conversation; the server does the same for any client */
  function repairHistory() {
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i]; if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
      var ids = m.content.filter(function (b) { return b.type === 'tool_use'; }).map(function (b) { return b.id; }); if (!ids.length) continue;
      var nx = messages[i + 1], blocks = nx && nx.role === 'user' ? (typeof nx.content === 'string' ? [{ type: 'text', text: nx.content }] : nx.content) : null;
      var have = blocks ? blocks.filter(function (b) { return b.type === 'tool_result'; }).map(function (b) { return b.tool_use_id; }) : [];
      var missing = ids.filter(function (id) { return have.indexOf(id) < 0; }).map(function (id) { return { type: 'tool_result', tool_use_id: id, content: 'not run: the page was reloaded or the step was interrupted before it finished', is_error: true }; });
      if (!missing.length) continue;
      if (blocks) messages[i + 1] = { role: 'user', content: blocks.filter(function (b) { return b.type === 'tool_result'; }).concat(missing, blocks.filter(function (b) { return b.type !== 'tool_result'; })) };
      else messages.splice(i + 1, 0, { role: 'user', content: missing });
    }
  }
  function send(text) {
    repairHistory();
    if (shown.length === 0) log.innerHTML = '';
    addShown('user', text, { focus: focusInfo ? focusInfo.label : null });
    var blocks = [{ type: 'text', text: context() }, { type: 'text', text: text }], last = messages[messages.length - 1];
    if (last && last.role === 'user' && Array.isArray(last.content)) last.content = last.content.concat(blocks);   // after a repaired step: one user message
    else messages.push({ role: 'user', content: blocks });
    save(); loop();
  }

  /* one user turn: same turn id on every request, so the server keeps it on one model (or escalates it) */
  function loop() {
    var ctl = new AbortController(); busy = ctl; panel.setAttribute('aria-busy', 'true'); q('.asst-send').disabled = true;
    var rounds = 0, tid = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    var turnInfo = { id: tid, prevId: lastTurn, pin: q('.asst-model-pick').value || null, toolErrors: 0 };
    lastTurn = tid; ls.set('lastTurn', tid); currentTurn = turnInfo;
    function done() {
      // a proposal discarded in this turn: a soft signal for the router (half a failure); a 👍/👎 later replaces it
      if (turnInfo.discarded) authed().then(function (h) { return fetch(base + '/feedback', { method: 'POST', headers: h, body: JSON.stringify({ id: tid, signal: 'discarded' }) }); }).catch(function () {});
      busy = null; panel.removeAttribute('aria-busy'); q('.asst-send').disabled = false; }
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
        return runRound(calls)
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
      if (rep.dailyCap) html += '<p class="asst-meta">Paid models today: ' + esc(money(rep.spentToday) === 'free' ? '$0' : money(rep.spentToday)) + ' of the $' + esc(rep.dailyCap) + ' daily budget.</p>';
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
  /* ─── proposals that wait for a yes: one card, or a stack when a reply proposes several (operator, 21 Nov 2026) ───
   * Two or more proposals in one reply (website changes, coding-agent requests, tasks, task updates, log entries) appear at
   * once as a stack: each with its title and small Apply / Discard, its details a click away (a website change's title also
   * shows its preview). A proposal with depends_on is nested under the one it names and can only be applied once that one
   * is applied; if that one is discarded or fails, it can only be discarded. Each is decided on its own; the reply goes on
   * when all are. Other tools in the same reply run first, in order. */
  var STACKABLE = ['propose_site_change', 'request_site_code_change', 'revise_site_code_change', 'create_task', 'update_task', 'log_conversation'];
  var stack = null;
  function runRound(calls) {
    var seq = function (list) { return list.reduce(function (p, c) { return p.then(function (acc) { return run(c).then(function (r) { acc.push(r); return acc; }); }); }, Promise.resolve([])); };
    var props = calls.filter(function (c) { return STACKABLE.indexOf(c.name) >= 0; });
    if (props.length < 2) return seq(calls);
    var others = calls.filter(function (c) { return props.indexOf(c) < 0; });
    return seq(others).then(function (first) {
      openStack(props);
      return Promise.all(props.map(function (c) { return run(c).then(function (r) { settleRow(c, r); return r; }); })).then(function (rest) {
        closeStack();
        var all = first.concat(rest);
        return calls.map(function (c) { return all.filter(function (r) { return r.tool_use_id === c.id; })[0] || result(c, 'not run', true); });
      });
    });
  }
  function openStack(props) {
    var box = el('div', { class: 'asst-msg asst-card asst-stack', role: 'group', 'aria-label': 'Proposals' });
    box.innerHTML = '<p class="asst-card-q">' + props.length + ' proposals: apply or discard each</p><div class="asst-stack-list"></div>';
    stack = { el: box, rows: {}, byKey: {}, shown: false };
    props.forEach(function (c) {
      var i = c.input || {}, key = typeof i.key === 'string' && i.key ? i.key : c.id;
      var row = el('div', { class: 'asst-stack-item', 'data-call': c.id });
      row.innerHTML = '<div class="asst-stack-row"><button type="button" class="asst-stack-title" aria-expanded="false"></button><span class="asst-stack-state">Checking…</span>' +
        '<span class="asst-stack-btns"><button type="button" class="asst-btn asst-sm asst-yes" disabled>Apply</button><button type="button" class="asst-btn asst-sm asst-no" disabled>Discard</button></span></div>' +
        '<div class="asst-stack-detail" hidden></div><div class="asst-stack-children"></div>';
      row.querySelector('.asst-stack-title').textContent = i.title || i.change_id || i.task_id || c.name;
      var r = { c: c, el: row, key: key, dep: typeof i.depends_on === 'string' && i.depends_on ? i.depends_on : null, state: 'pending', spec: null, resolve: null };
      stack.rows[c.id] = r; stack.byKey[key] = r;
    });
    Object.keys(stack.rows).forEach(function (id) {   // nest each under the one it depends on (when that one is in this reply)
      var r = stack.rows[id], parent = r.dep && r.dep !== r.key && stack.byKey[r.dep];
      r.parent = parent || null;
      (parent ? parent.el.querySelector('.asst-stack-children') : box.querySelector('.asst-stack-list')).appendChild(r.el);
    });
    log.appendChild(box); log.scrollTop = log.scrollHeight;
  }
  function closeStack() { if (stack && stack.el.parentNode) stack.el.parentNode.removeChild(stack.el); stack = null; }
  // whether a row may be applied: on its own, or once the one it depends on is applied
  function gate(r) {
    if (!r.spec || r.state !== 'pending') return;
    var p = r.parent, yes = r.el.querySelector('.asst-yes'), no = r.el.querySelector('.asst-no'), st = r.el.querySelector('.asst-stack-state'), name = p ? '"' + p.el.querySelector('.asst-stack-title').textContent + '"' : '';
    no.disabled = false;
    if (!p || p.state === 'applied') { yes.disabled = false; st.textContent = ''; }
    else if (p.state === 'pending' || p.state === 'working') { yes.disabled = true; st.textContent = 'After ' + name; }
    else { yes.disabled = true; st.textContent = 'Needs ' + name + ', which was ' + p.state + ': discard it'; }
  }
  function present(c, spec) {   // spec: { title, quote, note, yes, no, onShow } -> Promise<boolean>
    var r = stack && stack.rows[c.id];
    if (!r) return new Promise(function (resolve) {   // a single proposal: the full card
      var card = el('div', { class: 'asst-msg asst-card', role: 'group', 'aria-label': 'Confirm' });
      card.innerHTML = '<p class="asst-card-q">' + esc(spec.title) + '</p>' + (spec.quote ? '<blockquote>' + esc(spec.quote) + '</blockquote>' : '') + '<p class="asst-meta">' + esc(spec.note) + '</p>' +
        '<div class="asst-card-actions"><button type="button" class="asst-btn asst-yes">' + esc(spec.yes) + '</button><button type="button" class="asst-btn asst-no">' + esc(spec.no || 'Cancel') + '</button></div>';
      log.appendChild(card); log.scrollTop = log.scrollHeight; card.querySelector('.asst-yes').focus();
      var done = function (ok) { card.remove(); resolve(ok); };
      card.querySelector('.asst-yes').addEventListener('click', function () { done(true); });
      card.querySelector('.asst-no').addEventListener('click', function () { done(false); });
      busy && busy.signal.addEventListener('abort', function () { if (document.contains(card)) done(false); });
    });
    return new Promise(function (resolve) {
      r.spec = spec; r.resolve = resolve;
      var t = r.el.querySelector('.asst-stack-title'), d = r.el.querySelector('.asst-stack-detail');
      t.textContent = spec.title;
      d.innerHTML = (spec.quote ? '<blockquote>' + esc(spec.quote) + '</blockquote>' : '') + '<p class="asst-meta">' + esc(spec.note) + '</p>';
      t.onclick = function () { var open2 = d.hidden; d.hidden = !open2; t.setAttribute('aria-expanded', String(open2)); if (open2 && spec.onShow) spec.onShow(); };
      r.el.querySelector('.asst-yes').textContent = spec.yes === 'Save as proposal' ? 'Apply' : spec.yes.length > 12 ? 'Apply' : spec.yes;
      r.el.querySelector('.asst-yes').onclick = function () { if (!this.disabled) { r.state = 'working'; r.el.querySelector('.asst-stack-state').textContent = 'Working…'; this.disabled = true; r.el.querySelector('.asst-no').disabled = true; regate(); resolve(true); } };
      r.el.querySelector('.asst-no').onclick = function () { r.state = 'discarded'; r.el.querySelector('.asst-stack-state').textContent = 'Discarded'; this.disabled = true; r.el.querySelector('.asst-yes').disabled = true; regate(); resolve(false); };
      busy && busy.signal.addEventListener('abort', function () { if (r.state === 'pending') r.el.querySelector('.asst-no').onclick.call(r.el.querySelector('.asst-no')); });
      regate();   // this row is ready, and rows that name it now see its full title
    });
  }
  function regate() { if (stack) Object.keys(stack.rows).forEach(function (id) { gate(stack.rows[id]); }); }
  // after a proposal's own work: applied, or failed (its tool result says which)
  function settleRow(c, res) {
    var r = stack && stack.rows[c.id]; if (!r) return;
    if (r.state === 'working') r.state = res.is_error ? 'failed' : 'applied';
    else if (r.state === 'pending') r.state = res.is_error ? 'failed' : 'discarded';   // never shown (refused before its card)
    r.el.classList.add('asst-stack-' + r.state);
    r.el.querySelector('.asst-stack-state').textContent = { applied: 'Applied', failed: 'Failed', discarded: 'Discarded' }[r.state] || '';
    r.el.querySelectorAll('button.asst-btn').forEach(function (b) { b.disabled = true; });
    regate();
  }
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
        case 'read_site_copy':
          if (!window.HubSite) return Promise.resolve(result(c, 'website changes are not available in this hub', true));
          if (!str(i.section, 40)) return Promise.resolve(result(c, 'section required', true));
          addShown('step', 'Reading the website copy: ' + i.section);
          return HubSite.copy(i.section).then(function (t) { return result(c, t.length > 12000 ? t.slice(0, 12000) + '\n…' : t); }, function (e) { return result(c, e.message, true); });
        case 'propose_site_change':
          if (!window.HubSite) return Promise.resolve(result(c, 'website changes are not available in this hub', true));
          return proposeSite(c, { taskId: typeof i.task_id === 'string' ? i.task_id : null, title: i.title, summary: i.summary, edits: (i.edits || []).map(function (e) {
            var o = { path: e.path }; if (e.sr != null) o.sr = e.sr; if (e.en != null) o.en = e.en;
            if (e.value != null) o.value = e.value.map(function (v) { var x = { network: v.network, url: v.url }; if (v.handle) x.handle = v.handle; return x; });
            return o;
          }) }, i.show);
        case 'read_change_log':
          if (!window.HubSite) return Promise.resolve(result(c, 'website changes are not available in this hub', true));
          addShown('step', 'Reading the record of past website changes');
          return HubSite.list().then(function (all) {
            var done = all.filter(function (x) { return x.record; });
            return result(c, done.length ? done.map(function (x) {
              var d = x.libraryDraft;
              return 'THIS SITE\'S RECORD\n' + x.record + (d && !d.notAMove ? '\n\nTHE GENERAL LESSON (library draft' + (d.undone ? '; the change was undone, so treat it with caution' : '') + ')\n' + d.markdown : '');
            }).join('\n\n======\n\n') : 'no finished website changes yet');
          }, function (e) { return result(c, 'could not read the change log: ' + e.message, true); });
        case 'read_work':
          addShown('step', 'Reading Work › Tasks');
          return readWork().then(function (t) { return result(c, t); }, function (e) { return result(c, 'could not read the work list: ' + e.message, true); });
        case 'read_work_log':
          if (!window.HubWork) return Promise.resolve(result(c, 'the work log is not available in this hub', true));
          addShown('step', 'Reading the work log');
          return HubWork.list().then(function (all) {
            // threads: each task with the conversations it came from (their decisions) and the actions that did it
            var by = {}, acts = {}, used = {}, d = function (x) { return String(x || '').slice(0, 10); };
            var kind = function (e) { return { 'site-change': 'action', session: 'conversation' }[e.kind] || e.kind; };
            all.forEach(function (e) { by[e.id] = e; if (kind(e) === 'action' && e.task) (acts[e.task] = acts[e.task] || []).push(e); });
            var conv = function (id) { var x = by[id]; if (!x) return ''; used[id] = 1; return '\n  from [' + id + '] ' + x.title + ' (' + d(x.at) + ')' + ((x.decisions || []).length ? ' — decided: ' + x.decisions.join('; ') : ''); };
            var sigs = {}; all.forEach(function (e) { if (e.kind === 'signal' && e.type !== 'withdrawn' && e.about) (sigs[e.about] = sigs[e.about] || []).push(e); });
            var GOOD = ['approved', 'up', 'praise'], BAD = ['rejected', 'correction', 'problem', 'changes-requested', 'down', 'discarded', 'reverted'];
            var said = function (ids) { var l = ids.reduce(function (o, id) { return o.concat(sigs[id] || []); }, []); if (!l.length) return ''; var g = l.filter(function (x) { return GOOD.indexOf(x.type) >= 0; }).length, b = l.filter(function (x) { return BAD.indexOf(x.type) >= 0; }); return '\n  feedback: +' + g + ' −' + b.length + (b.length ? ' (' + b.slice(0, 3).map(function (x) { return x.type + ': ' + String(x.note || '').slice(0, 90); }).join('; ') + ')' : ''); };
            var tasks = all.filter(function (e) { return kind(e) === 'task'; }).slice(0, 45).map(function (t) {
              var a = acts[t.id] || [], l = t.lesson && !t.lesson.notAMove && t.lesson.review !== 'rejected' ? '\n  lesson (' + (t.lesson.review || 'draft') + '): ' + t.lesson.markdown.replace(/^---[\s\S]*?---\s*/, '').split('\n## How to apply')[0].replace(/\s+/g, ' ').slice(0, 400) : '';
              return '[' + t.id + '] ' + t.title + ' — ' + (t.status || '?') + '; assigned by ' + (t.assignedBy ? t.assignedBy.who : '?') + ' to ' + (t.assignee ? t.assignee.who : '?') + ', ' + d(t.at) +
                (t.outcome ? '\n  outcome: ' + t.outcome.result + (t.outcome.note ? ' — ' + t.outcome.note : '') : '') + said([t.id].concat(a.map(function (x) { return x.id; }))) +
                (t.conversations || []).map(conv).join('') + (a.length ? '\n  done: ' + a.slice(0, 6).map(function (x) { return x.title; }).join('; ') + (a.length > 6 ? ' (+' + (a.length - 6) + ' more)' : '') + ' — last ' + d(a.reduce(function (m, x) { return x.at > m ? x.at : m; }, '')) : '') + l;
            });
            var talks = all.filter(function (e) { return kind(e) === 'conversation' && !used[e.id] && (e.decisions || []).length; }).slice(0, 15).map(function (e) { return '[' + e.id + '] ' + e.title + ' (' + d(e.at) + ') — decided: ' + e.decisions.join('; '); });
            // decisions, each in its context and with how it relates to others (for a situation, check_decisions finds the nearest)
            var decs = all.filter(function (e) { return e.kind === 'decision'; }), byId = {}; decs.forEach(function (x) { byId[x.id] = x; });
            var REL = { revises: 'revises', diverges: 'diverges from', confirms: 'confirms' };
            var decLines = decs.slice(0, 80).map(function (x) {
              return '- [' + x.id + '] ' + x.title + (x.context && x.context.facets && x.context.facets.surface ? ' (' + x.context.facets.surface + ')' : '') + said([x.id]).replace('\n  ', ' — ') +
                (x.relations || []).map(function (rl) { var o = byId[rl.to]; return '\n    ' + REL[rl.type] + ': ' + (o ? o.title : rl.to) + (rl.reason ? ' — ' + rl.reason : ''); }).join('');
            });
            return result(c, tasks.length || talks.length ? (decLines.length ? 'Decisions, newest first, each in its context (use check_decisions to find those nearest a situation; an older or opposite decision can still apply where its context fits):\n' + decLines.join('\n') + '\n\n' : '') +
              'Tasks, newest first (each with its outcome, feedback, where it came from and what was done):\n' + tasks.join('\n\n') + (talks.length ? '\n\nConversations with decisions but no task:\n' + talks.join('\n') : '') : 'the work log is empty');
          }, function (e) { return result(c, 'could not read the work log: ' + e.message, true); });
        case 'check_decisions':
          if (!window.HubWork) return Promise.resolve(result(c, 'the work log is not available in this hub', true));
          if (!str(i.situation, 2000)) return Promise.resolve(result(c, 'situation (a sentence or two) is required', true));
          addShown('step', 'Checking earlier decisions in similar contexts');
          return HubWork.cluster({ text: i.situation, k: 10 }).then(function (r) {
            var REL = { revises: 'revises', diverges: 'diverges from', confirms: 'confirms' }, BACK = { revises: 'revised by', diverges: 'diverged from by', confirms: 'confirmed by' };
            var facets = function (c) { return c && c.facets ? Object.keys(c.facets).map(function (k) { return k + ': ' + [].concat(c.facets[k]).join(', '); }).join('; ') : ''; };
            return result(c, r.items.length ? 'Decisions in the nearest contexts (closeness ' + r.matching + ', 1 = same situation):\n\n' + r.items.map(function (x) {
              var d = x.decision, ctx = d.context || {};
              return '[' + d.id + '] ' + d.title + ' — closeness ' + x.score + ', ' + String(d.at || '').slice(0, 10) +
                '\n  context: ' + (ctx.statement || '(none recorded)') + (facets(ctx) ? ' (' + facets(ctx) + ')' : '') +
                x.relations.map(function (rl) { return '\n  ' + REL[rl.type] + ' [' + rl.to + '] ' + (rl.title || '') + ': ' + (rl.reason || '') + (rl.changed ? ' — changed: ' + rl.changed : ''); }).join('') +
                x.relatedBy.map(function (rl) { return '\n  ' + BACK[rl.type] + ' [' + rl.from + '] ' + (rl.title || '') + ': ' + (rl.reason || '') + (rl.changed ? ' — changed: ' + rl.changed : ''); }).join('') +
                (x.tasks.length ? '\n  led to: ' + x.tasks.map(function (t) { return t.title + ' (' + (t.outcome ? t.outcome.result + (t.outcome.note ? ': ' + String(t.outcome.note).slice(0, 100) : '') : t.status) + ')'; }).join('; ') : '') +
                (x.signals.length ? '\n  feedback: ' + x.signals.slice(0, 4).map(function (g) { return g.type + (g.note ? ' — ' + String(g.note).slice(0, 100) : ''); }).join('; ') : '');
            }).join('\n\n') : 'no decisions logged yet');
          }, function (e) { return result(c, 'could not check decisions: ' + e.message, true); });
        case 'log_conversation':
          if (!window.HubWork) return Promise.resolve(result(c, 'the work log is not available in this hub', true));
          if (!str(i.title, 120) || typeof i.summary !== 'string' || i.summary.length < 20 || i.summary.length > 4000 || typeof i.between !== 'string') return Promise.resolve(result(c, 'title (up to 120 characters), summary (20 to 4000) and between are required', true));
          return confirmCard(c, 'Add to the work log: ' + i.title, i.summary, 'A summary of a conversation ' + (i.between ? 'between ' + i.between + ' ' : '') + 'that you shared on purpose; people as roles, no contact details.', 'Add to the log', function () {
            return HubWork.logPasted({ title: i.title, summary: i.summary, between: i.between }).then(function (e) { return { shown: 'Added to Work › Log', model: 'logged as ' + e.id + ' on Work › Log (#/work/log)' }; });
          });
        case 'suggest_tasks':
          if (!window.HubWork || !window.HubTasks) return Promise.resolve(result(c, 'suggestions are not available in this hub', true));
          if (typeof i.context !== 'string' || i.context.length < 20 || i.context.length > 8000) return Promise.resolve(result(c, 'context: 20 to 8000 characters', true));
          addShown('step', 'Looking at the work log for the tasks that should follow');
          return HubWork.suggest(i.context).then(function (batch) { return suggestCard(c, batch); }, function (e) { return result(c, 'could not suggest tasks: ' + e.message, true); });
        case 'create_task':
          if (!window.HubTasks) return Promise.resolve(result(c, 'tasks are not available in this hub', true));
          if (!str(i.title, 120) || typeof i.detail !== 'string' || i.detail.length > 2000 || !str(i.owner, 60)) return Promise.resolve(result(c, 'title (up to 120 characters), detail (up to 2000) and owner are required', true));
          return confirmCard(c, 'Add this task for ' + i.owner + ': ' + i.title, i.detail, 'It goes on Work › Tasks, where the whole team sees it.', 'Add task', function () {
            return HubTasks.create({ title: i.title, detail: i.detail, owner: i.owner }, turnNow()).then(function (t) { return { shown: 'Added to Work › Tasks', model: 'added task:' + t.id + ' "' + t.title + '" (Open, with ' + t.owner + ') on Work › Tasks (#/work/tasks)' }; });
          });
        case 'update_task':
          if (!window.HubTasks) return Promise.resolve(result(c, 'tasks are not available in this hub', true));
          var tid = String(i.task_id || '').replace(/^task:/, '');
          if (!str(tid, 40) || HubTasks.statuses.indexOf(i.status) < 0 || typeof i.note !== 'string' || i.note.length > 500) return Promise.resolve(result(c, 'task_id, status (' + HubTasks.statuses.join(', ') + ') and note (up to 500 characters) are required', true));
          return confirmCard(c, 'Set the task to ' + i.status, i.note, 'On Work › Tasks, with this note in its history.', 'Set ' + i.status, function () {
            return HubTasks.update(tid, { status: i.status, note: i.note }).then(function (t) { return { shown: 'Task set to ' + t.status, model: 'task:' + t.id + ' "' + t.title + '" is now ' + t.status }; });
          });
        case 'reopen_task':   // no card: reopening is easy to undo; the reason goes in the task's history
          if (!window.HubTasks) return Promise.resolve(result(c, 'tasks are not available in this hub', true));
          var rid = String(i.task_id || '').replace(/^task:/, '');
          if (!str(rid, 40) || !str(i.reason, 500)) return Promise.resolve(result(c, 'task_id and a reason (up to 500 characters) are required', true));
          return HubTasks.update(rid, { status: 'Open', note: 'Reopened by the hub assistant: ' + i.reason }).then(function (t) {
            addShown('note', 'Reopened the task "' + t.title + '": ' + i.reason);
            return result(c, 'task:' + t.id + ' "' + t.title + '" is Open again, with the reason in its history');
          }, function (e) { return result(c, 'could not reopen it: ' + e.message, true); });
        case 'request_site_code_change':
          if (!window.HubSite) return Promise.resolve(result(c, 'website changes are not available in this hub', true));
          if (!str(i.title, 90) || !str(i.brief, 4000) || i.brief.length < 20) return Promise.resolve(result(c, 'title (up to 90 characters) and a brief (20 to 4000 characters) are required', true));
          return confirmCard(c, 'Ask the coding agent: ' + i.title, i.brief, 'It works on a copy of the site (usually 3 to 8 minutes) on a paid model; the preview appears on Work › Tasks. Nothing is published until an admin approves it.', 'Start', function () {
            return HubSite.request({ title: i.title, brief: i.brief }, turnNow(), typeof i.task_id === 'string' ? i.task_id : null).then(function (doc) {
              followRun(doc.id, i.title);
              return { shown: 'Started; the coding agent is working', model: 'started change ' + doc.id + ': the coding agent is working on a copy of the site; the preview appears on its page (#/website/preview?c=' + doc.id + ') in a few minutes. It is NOT published.' };
            });
          });
        case 'revise_site_code_change':
          if (!window.HubSite) return Promise.resolve(result(c, 'website changes are not available in this hub', true));
          if (!str(i.change_id, 40) || !str(i.feedback, 2000)) return Promise.resolve(result(c, 'change_id and feedback are required', true));
          return confirmCard(c, 'Send this to the coding agent', i.feedback, 'It adjusts the same copy of the site (a few minutes, paid model); the preview updates when it is done.', 'Send', function () {
            return HubSite.revise(i.change_id, i.feedback).then(function () { followRun(i.change_id, 'Revision'); return { shown: 'Sent; the coding agent is working', model: 'sent: the coding agent is adjusting change ' + i.change_id + '; the preview updates in a few minutes' }; });
          });
        default:   // the server knows a newer tool than this page: the hub was published since the page was opened
          addShown('note', 'This hub page is older than the assistant: reload the page to use "' + c.name + '".');
          return Promise.resolve(result(c, 'this hub page is out of date and does not have ' + c.name + '; ask the person to reload the hub page and try again', true));
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

  /* a website change: checked against the live copy, shown on the real page in the main column, then saved or discarded */
  // what was discarded last (edits and social links), so the same proposal is not offered again unchanged
  var lastDiscarded = null, currentTurn = null;
  var turnNow = function () { return currentTurn ? currentTurn.id : null; };   // the work log links what a turn creates to its conversation
  var sameAs = function (change) { return JSON.stringify({ edits: change.edits || null, social: change.social || null }); };
  var DISCARDED = 'discarded by the person: nothing was saved, the preview is closed and the main column is back where they were. ' +
    'A discard means they did not get what they wanted, or are still exploring and needed to see it to decide. Do not propose the same change again unchanged: ' +
    'if they said what was wrong, change exactly that; if not, ask in one short question what they want different. ' +
    'If they mention a yellow frame, box or outline: that is only the preview\'s marker of what changes (shown with Mark changes), never on the site; Clean view shows the page exactly as it will look. Say so plainly and do not change the text for it.';
  function proposeSite(c, change, lang) {
    if (lastDiscarded && sameAs(change) === lastDiscarded) return Promise.resolve(result(c, 'not shown: this is exactly the change the person just discarded. Do not offer it again unchanged: say what would differ, or ask what they want changed. If their objection was the yellow outline, explain it is only the preview\'s marker.', true));
    return HubSite.validate(change).then(function (r) {
      if (!r.ok) return result(c, 'not valid against the live site:\n- ' + r.errors.join('\n- '), true);
      var id = 'd' + c.id.replace(/[^\w]/g, '').slice(-12), show = function () { HubSite.preview(change, id); };
      if (!stack || !stack.shown) { addShown('step', 'Showing the website with the change'); show(); if (stack) stack.shown = true; }
      return settle().then(function () {
        return present(c, { title: 'Website change: ' + change.title, quote: change.summary, note: 'The page in the main column shows it' + (stack ? ' (click the title to show this one)' : '') + '; nothing is published until an admin approves it.', yes: 'Save as proposal', no: 'Discard', onShow: show });
      }).then(function (ok) { return new Promise(function (resolveCard) {
        (function finish(ok) {
          if (!ok) {
            HubSite.drop(id); lastDiscarded = sameAs(change); if (currentTurn) currentTurn.discarded = true;
            addShown('card', 'Website change: ' + change.title, { outcome: 'Discarded' }); return resolveCard(result(c, DISCARDED));
          }
          HubSite.save({ title: change.title, summary: change.summary, edits: change.edits, social: change.social }, id, turnNow(), change.taskId).then(function (doc) {
            addShown('card', 'Website change: ' + change.title, { outcome: 'Saved as a proposal; waiting for an admin to approve it' }); say('Saved as a proposal');
            resolveCard(result(c, 'saved as proposal ' + doc.id + '; it is NOT published: an admin approves it on Work › Tasks (#/work/tasks), which publishes it'));
          }, function (e) { HubSite.drop(id); addShown('card', 'Website change: ' + change.title, { outcome: 'Not saved: ' + e.message }); resolveCard(result(c, 'saving failed: ' + e.message, true)); });
        })(ok);
      }); });
    }, function (e) { return result(c, 'the live website copy could not be loaded: ' + e.message, true); });
  }

  /* Work › Tasks as text for the model: the project's tasks, the hub's tasks, the website change requests (fresh) */
  function readWork() {
    var STATE = { draft: 'not saved (still in the chat)', building: 'the coding agent is working on it', proposed: 'waiting for an admin to approve', publishing: 'approved, being published', published: 'LIVE on centardeva.com', failed: 'failed', reverting: 'being undone', reverted: 'undone (no longer on the site)', discarded: 'discarded' };
    var day = function (iso) { return iso ? new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : ''; };
    var project = ((window.HUB_DATA || {}).next || []).map(function (n) { return '- step:' + n.id + ' · ' + n.title + ' · ' + n.status + ' · with ' + n.owner; });
    // people as roles, never emails: this text goes to the model
    function roleName(r) { return r === 'admin' ? 'an admin' : r === 'team' ? 'a team member' : 'a hub member'; }
    return Promise.all([
      window.HubTasks ? HubTasks.list().catch(function (e) { return { error: e.message }; }) : Promise.resolve([]),
      window.HubSite ? HubSite.list().catch(function (e) { return { error: e.message }; }) : Promise.resolve([])
    ]).then(function (r) {
      var tasks = r[0], changes = r[1];
      var hub = tasks.error ? ['- (could not be read: ' + tasks.error + ')'] : tasks.map(function (t) { return '- task:' + t.id + ' · ' + t.title + ' · ' + t.status + ' · with ' + t.owner + ' · added ' + day(t.at) + (t.byRole ? ' by ' + roleName(t.byRole) : ''); });
      var site = changes.error ? ['- (could not be read: ' + changes.error + ')'] : changes.map(function (c) {
        return '- change ' + c.id + ' · ' + c.change.title + ' · ' + (c.lane === 'code' ? 'layout / code' : 'copy / links') + ' · ' + (STATE[c.status] || c.status) +
          ' · asked ' + day(c.at) + (c.byRole ? ' by ' + roleName(c.byRole) : '') + (c.approvedBy ? ' · approved' : '') + (c.commit ? ' · commit ' + c.commit.slice(0, 7) : '') +
          (c.status === 'published' || c.status === 'reverted' ? ' · ' + c.status + ' ' + day(c.updated) : '') + (c.error ? ' · error: ' + c.error : '');
      });
      return 'Project tasks (set in the project; change them only with a note):\n' + (project.join('\n') || '- none') +
        '\n\nTasks added in the hub:\n' + (hub.join('\n') || '- none') + '\n\nWebsite change requests (newest first):\n' + (site.join('\n') || '- none');
    });
  }

  /* suggested tasks: one card, each suggestion with its reason and Accept / Edit / Dismiss; the outcome of each is kept,
   * so later suggestions learn from it. The tool answers once every suggestion is decided (or the card is closed). */
  function suggestCard(c, batch) {
    var items = batch.items || [];
    if (!items.length) { addShown('note', 'No tasks to suggest for this.'); return Promise.resolve(result(c, 'no tasks suggested for this context')); }
    return new Promise(function (resolveCard) {
      var card = el('div', { class: 'asst-msg asst-card asst-suggest', role: 'group', 'aria-label': 'Suggested tasks' });
      card.innerHTML = '<p class="asst-card-q">Suggested tasks</p>' + items.map(function (it) {
        return '<div class="asst-sugg" data-n="' + it.n + '"><p><strong>' + esc(it.title) + '</strong> <span class="asst-meta">· ' + esc(it.owner) + '</span></p>' + (it.detail ? '<p>' + esc(it.detail) + '</p>' : '') +
          (it.because ? '<p class="asst-meta">Why: ' + esc(it.because) + '</p>' : '') +
          '<div class="asst-card-actions"><button type="button" class="asst-btn asst-yes" data-s="accepted">Accept</button><button type="button" class="asst-btn" data-s="edited">Edit</button><button type="button" class="asst-btn asst-no" data-s="dismissed">Dismiss</button></div><p class="asst-meta asst-sugg-out" hidden></p></div>';
      }).join('') + '<div class="asst-card-actions"><button type="button" class="asst-btn asst-sugg-done">Done</button></div>';
      log.appendChild(card); log.scrollTop = log.scrollHeight;
      var outcomes = {};
      function finish() {
        var lines = items.map(function (it) { var o = outcomes[it.n]; return '- "' + it.title + '": ' + (o ? o.status + (o.taskId ? ' (task:' + o.taskId + ')' : '') : 'left open'); });
        card.remove();
        addShown('card', 'Suggested tasks', { outcome: items.map(function (it) { var o = outcomes[it.n]; return it.title + ': ' + (o ? o.status : 'left open'); }).join(' · ') });
        resolveCard(result(c, 'the person decided:\n' + lines.join('\n')));
      }
      card.addEventListener('click', function (ev) {
        var b = ev.target.closest('button'); if (!b) return;
        if (b.classList.contains('asst-sugg-done')) return finish();
        var box = b.closest('.asst-sugg'), n = Number(box.getAttribute('data-n')), it = items.filter(function (x) { return x.n === n; })[0], s = b.getAttribute('data-s');
        var out = box.querySelector('.asst-sugg-out'), bs = box.querySelectorAll('button');
        var lock = function (text) { [].forEach.call(bs, function (x) { x.disabled = true; }); out.hidden = false; out.textContent = text; };
        var p;
        if (s === 'dismissed') { var why = window.prompt('Why not? (optional; it helps later suggestions)', '') || ''; p = HubWork.outcome(batch.id, n, { status: 'dismissed', note: why }).then(function () { outcomes[n] = { status: 'dismissed' }; lock('Dismissed'); }); }
        else {
          var title = it.title, detail = it.detail;
          if (s === 'edited') { title = window.prompt('The task:', it.title); if (!title) return; detail = window.prompt('Details:', it.detail || '') || ''; }
          p = HubTasks.create({ title: title, detail: detail, owner: it.owner, origin: { batch: batch.id, n: n } }, turnNow()).then(function (t) {
            return HubWork.outcome(batch.id, n, { status: s, taskId: t.id, note: s === 'edited' ? 'changed to: ' + title : '' }).then(function () { outcomes[n] = { status: s, taskId: t.id }; lock((s === 'edited' ? 'Edited and added' : 'Added') + ' to Work › Tasks'); });
          });
        }
        p.then(function () { if (Object.keys(outcomes).length === items.length) finish(); }, function (e) { window.alert(e.message); });
      });
      busy && busy.signal.addEventListener('abort', function () { if (document.contains(card)) finish(); });
    });
  }

  /* a card for an action that costs or starts something: the person says yes or no; go() -> { shown, model } */
  /* a coding run, followed live in the chat (the same phases as the run bar on its page), ending with the preview */
  var PHASE = { queued: 'Request received', editing: 'Editing files', building: 'Building the preview', checking: 'QA check', publishing: 'Publishing' };
  function followRun(id, title) {
    var card = el('div', { class: 'asst-msg asst-run', role: 'status', 'aria-live': 'polite', 'data-run': id }), started = Date.now();
    log.appendChild(card); log.scrollTop = log.scrollHeight;
    function paint() {
      var c = HubSite.get && HubSite.get(id), st = c ? c.status : 'building', pr = c && c.progress;
      if (!document.contains(card)) return document.removeEventListener('hub-site-changes', paint);
      var since = (pr && pr.startedAt) ? Date.parse(pr.startedAt) : started, sec = Math.max(0, Math.round((Date.now() - since) / 1000)), t = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
      var open = '<a class="asst-btn asst-sm" href="#/website/preview?c=' + esc(encodeURIComponent(id)) + '">';
      var qa = st === 'proposed' && c.preview && c.preview.qa;
      if (st === 'proposed') { card.innerHTML = '<p><strong>✓ Preview ready:</strong> ' + esc(title) + '</p>' + (c.preview && c.preview.summary ? '<p class="asst-meta">' + esc(c.preview.summary) + '</p>' : '') +
        (qa && qa.total ? '<p class="asst-meta">QA ' + qa.passed + '/' + qa.total + (qa.failed ? ': not done: ' + esc(qa.items.filter(function (i) { return i.status === 'fail'; }).map(function (i) { return i.requirement; }).join('; ')) : '') + '</p>' : '<p class="asst-meta">QA: not checked</p>') + '<p>' + open + 'Show the preview</a></p>'; card.classList.add('asst-run-done'); return document.removeEventListener('hub-site-changes', paint); }
      if (st === 'failed') { card.innerHTML = '<p><strong>✕ It did not work:</strong> ' + esc(title) + '</p>' + (c.error ? '<p class="asst-meta">' + esc(c.error) + '</p>' : '') + '<p>' + open + 'Open</a></p>'; card.classList.add('asst-run-done'); return document.removeEventListener('hub-site-changes', paint); }
      card.innerHTML = '<p><span class="runbar-dot" aria-hidden="true"></span> <strong>The coding agent is working:</strong> ' + esc(title) + '</p><p class="asst-meta">' + esc(PHASE[(pr && pr.phase) || 'queued'] || 'Working') + ' · ' + t + ' · ' + open + 'see it on the site</a></p>';
    }
    document.addEventListener('hub-site-changes', paint); paint();
    var tick = setInterval(function () { if (!document.contains(card) || card.classList.contains('asst-run-done')) return clearInterval(tick); paint(); }, 1000);
  }
  function confirmCard(c, question, quote, note, yes, go) {
    return present(c, { title: question, quote: quote, note: note, yes: yes }).then(function (ok) {
      if (!ok) { addShown('card', question, { outcome: 'Cancelled' }); return result(c, 'declined by the user; nothing was started'); }
      return go().then(function (r) { addShown('card', question, { outcome: r.shown }); say(r.shown); return result(c, r.model); },
        function (e) { addShown('card', question, { outcome: 'Not started: ' + e.message }); return result(c, 'failed: ' + e.message, true); });
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

  // what Pick can reach on this screen (the pick-coverage test): every frame and whether its page answered
  function coverage() { return { frames: frames().map(function (f) { return { title: f.getAttribute('title') || '', src: (f.getAttribute('src') || (f.hasAttribute('srcdoc') ? 'srcdoc' : '')).slice(0, 80), agent: agents.has(f) }; }) }; }
  window.HubAssistant = { coverage: coverage, open: openPanel, close: closePanel, focus: function (n) { setFocus(n); }, state: function () { return { open: open, pick: pick, focus: focusInfo, busy: !!busy }; },
    /* the server, as the signed-in member (website-changes.js uses it) */
    api: function (path, init) { return authed().then(function (h) { return fetch(base + path, Object.assign({}, init || {}, { headers: h })); }); } };
})();
