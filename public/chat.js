/**
 * FlyTripVisa AI Chat Controller (single shared controller for BOTH entry points:
 * hero input #aiChatSendBtn/#aiChatInput and bottom-nav center button #navAiChatBtn).
 *
 * Real backend integration (Cloudflare Worker src/index.ts):
 *   POST /api/chat            -> SSE stream, tokens arrive as `data: {"response":"..."}`
 *                               terminated by `data: [DONE]`.
 *   Request body accepted by the Worker: { messages: [{role, content}, ...] }
 *   (system prompt is injected server-side; no secrets are ever used in this file).
 *
 * UI contract (index.html popup, dark design preserved):
 *   #chatPopupOverlay .open   -> popup shown; body scroll locked by index.html observer
 *   bubbles: .chat-msg.user / .chat-msg.bot  (rendered with textContent only, no HTML injection)
 *
 * Conversation history: kept in memory + sessionStorage for the duration of the
 * browser session; reopening the popup does NOT clear it. Same controller is used
 * by the hero input and the nav button, so there is exactly one chat interface.
 */
(function () {
  'use strict';

  // Bail out if somehow loaded twice -> prevents duplicate event listeners.
  if (window.__ftvChatController) return;
  window.__ftvChatController = true;

  var ENDPOINT = '/api/chat';        // actual Worker route (was /api/ai-chat -> 404)
  var SESSION_KEY = 'ftv_chat_hist'; // sessionStorage key for conversation history
  var MAX_CTX = 20;                  // last N messages shipped to the model as context

  var overlay, panel, messages, input, sendBtn, closeBtn, heroInput, heroSend, navBtn;

  var state = {
    history: [],        // [{role:'user'|'assistant', content:'...'}]
    generating: false,
    lastFailed: '',     // user message that failed -> reused by Retry
    abort: null         // AbortController for the in-flight fetch
  };

  // ---------------- helpers ----------------
  function $(id) { return document.getElementById(id); }

  function scrollBottom() {
    requestAnimationFrame(function () {
      if (messages) messages.scrollTop = messages.scrollHeight;
    });
  }

  // addChatMessage(text, sender) -> returns the bubble element (safe: textContent only)
  function addChatMessage(text, sender) {
    var div = document.createElement('div');
    div.className = 'chat-msg ' + (sender === 'user' ? 'user' : 'bot');
    div.textContent = text;
    messages.appendChild(div);
    scrollBottom();
    return div;
  }

  var typingEl = null;
  function showTypingIndicator() {
    if (typingEl) return;
    typingEl = document.createElement('div');
    typingEl.className = 'chat-msg bot typing';
    typingEl.textContent = '● ● ●';
    typingEl.style.letterSpacing = '4px';
    messages.appendChild(typingEl);
    scrollBottom();
  }
  function hideTypingIndicator() {
    if (typingEl) { typingEl.remove(); typingEl = null; }
  }

  function setGenerating(g) {
    state.generating = g;
    if (sendBtn) { sendBtn.disabled = g; sendBtn.style.opacity = g ? '.55' : ''; }
    if (heroSend) { heroSend.disabled = g; heroSend.style.opacity = g ? '.55' : ''; }
  }

  // ---------------- session persistence ----------------
  function persist() {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(state.history)); } catch (e) {}
  }
  function restore() {
    var raw;
    try { raw = sessionStorage.getItem(SESSION_KEY); } catch (e) { return; }
    if (!raw) return;
    var arr;
    try { arr = JSON.parse(raw); } catch (e) { return; }
    if (!Array.isArray(arr) || !arr.length) return;
    arr.forEach(function (m) {
      if (!m || !m.content) return;
      state.history.push({ role: m.role, content: m.content });
      addChatMessage(m.content, m.role === 'user' ? 'user' : 'bot');
    });
  }

  // ---------------- Worker streaming response parser ----------------
  // Cloudflare AI SSE frames: "data: {\"response\":\"token\"}\n\n" ... "data: [DONE]\n\n"
  // The parser is tolerant: also accepts {token} / OpenAI-style delta payloads.
  function readStream(res, bubble, onToken) {
    var ctype = (res.headers.get('content-type') || '');
    if (ctype.indexOf('text/event-stream') === -1) {
      // Non-streaming JSON fallback (e.g. proxy or future Worker variant).
      return res.json().then(function (obj) {
        var txt = obj && (obj.response || obj.answer || (obj.choices && obj.choices[0] && obj.choices[0].message && obj.choices[0].message.content)) || '';
        if (txt) { onToken(txt); }
        return txt;
      });
    }
    if (!res.body) throw new Error('No response stream.');

    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var acc = '';

    function frame(raw, push) {
      var data = '';
      raw.split('\n').forEach(function (line) {
        if (line.indexOf('data:') === 0) data += line.slice(5).trim();
      });
      if (!data || data === '[DONE]') return;
      var obj;
      try { obj = JSON.parse(data); } catch (e) { return; }
      if (obj && obj.error) throw new Error(typeof obj.error === 'string' ? obj.error : 'Model error.');
      var tok = obj && (obj.response || obj.token ||
        (obj.choices && obj.choices[0] && obj.choices[0].delta && obj.choices[0].delta.content)) || '';
      if (tok) { acc += tok; push(tok); }
    }

    function pump() {
      return reader.read().then(function (result) {
        if (result.done) {
          if (buffer.trim()) frame(buffer, function () { bubble.textContent = acc; scrollBottom(); });
          return acc;
        }
        buffer += decoder.decode(result.value, { stream: true });
        var idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          var raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          frame(raw, function () { bubble.textContent = acc; scrollBottom(); });
        }
        return pump();
      });
    }
    return pump();
  }

  // ---------------- core send pipeline ----------------
  // sendMessageToAI(message) -> Promise<full reply text>
  function sendMessageToAI(message) {
    var ctx = state.history.slice(-MAX_CTX).map(function (m) {
      return { role: m.role, content: m.content };
    });

    var bubble = document.createElement('div');
    bubble.className = 'chat-msg bot';
    bubble.textContent = '';
    messages.appendChild(bubble);
    scrollBottom();

    state.abort = new AbortController();

    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: ctx, source: 'website' }),
      signal: state.abort.signal
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          var msg = 'Request failed (' + res.status + ').';
          try { var j = JSON.parse(t); if (j && j.error) msg = j.error; } catch (e) {}
          throw new Error(msg);
        });
      }
      return readStream(res, bubble, function () { /* live paint handled inside readStream */ });
    }).then(function (full) {
      hideTypingIndicator();
      var text = (full || '').trim();
      if (!text) {
        if (bubble.parentNode) bubble.remove();
        addChatMessage('I could not generate a reply just now. Please try again.', 'bot');
        state.lastFailed = message;
        return;
      }
      bubble.textContent = text;              // final normalized paint (multiline preserved via CSS white-space)
      state.history.push({ role: 'assistant', content: text });
      state.lastFailed = '';
      persist();
      scrollBottom();
    });
  }

  // handleChatError(error) -> error bubble + Retry button (no fake answers)
  function handleChatError(err, message) {
    hideTypingIndicator();
    // drop the empty streaming bubble if present
    var last = messages.lastElementChild;
    if (last && last.classList.contains('bot') && !last.textContent.trim()) last.remove();

    state.lastFailed = message || state.lastFailed;

    var isNetwork = (err && err.name === 'TypeError');           // fetch threw before response
    var isAbort = (err && err.name === 'AbortError');
    if (isAbort) { setGenerating(false); return; }

    var div = document.createElement('div');
    div.className = 'chat-msg bot error';
    div.textContent = isNetwork
      ? 'Network error — the AI service is unavailable. Check your connection.'
      : ((err && err.message) || 'Something went wrong.');

    if (state.lastFailed) {
      var btn = document.createElement('button');
      btn.className = 'chat-retry-btn';
      btn.type = 'button';
      btn.textContent = 'Retry ↻';
      btn.addEventListener('click', function () {
        div.remove();
        send(state.lastFailed);
      });
      var br = document.createElement('br');
      div.appendChild(br);
      div.appendChild(btn);
    }
    messages.appendChild(div);
    scrollBottom();
    setGenerating(false);
  }

  // handleChatSend(message) -> the ONE entry point for hero + popup + retry
  function handleChatSend(message) {
    var text = (message == null ? (input ? input.value : '') : message).trim();
    if (!text) return;            // empty messages never submitted
    if (state.generating) return; // duplicate rapid click / enter guard

    addChatMessage(text, 'user');
    state.history.push({ role: 'user', content: text });
    persist();

    if (input) input.value = '';
    showTypingIndicator();
    setGenerating(true);

    sendMessageToAI(text).catch(function (err) {
      handleChatError(err, text);
    }).then(function () {
      if (state.generating) setGenerating(false);
    });
  }

  // Thin alias kept for readability (same controller, single path)
  function send(text) { handleChatSend(text); }

  // ---------------- popup open/close (shared by both entry points) ----------------
  function openChatPopup(prefill) {
    if (!overlay) return;
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';

    var q = (typeof prefill === 'string') ? prefill.trim() : '';
    if (window.showBottomTabTemporarily) { try { window.showBottomTabTemporarily(); } catch (e) {} }

    setTimeout(function () {
      if (q) {
        handleChatSend(q);          // hero question: appears + submits automatically
      } else if (input) {
        input.focus();              // focus only when starting a fresh conversation
      }
    }, 250);
  }

  function closeChatPopup() {
    if (!overlay) return;
    overlay.classList.remove('open');
    document.body.style.overflow = (document.getElementById('joinModal') &&
      document.getElementById('joinModal').classList.contains('open')) ? 'hidden' : '';
  }

  // ---------------- init ----------------
  function init() {
    overlay  = $('chatPopupOverlay');
    panel    = $('chatPopupContainer');
    messages = $('chatPopupMessages');
    input    = $('chatPopupInput');
    sendBtn  = $('chatPopupSendBtn');
    closeBtn = $('closeChatPopupBtn');
    heroInput = $('aiChatInput');
    heroSend  = $('aiChatSendBtn');
    navBtn    = $('navAiChatBtn');

    if (!overlay || !messages || !input || !sendBtn) return; // page without chat UI

    restore(); // reopen/reload -> same-session history preserved

    // popup controls
    sendBtn.addEventListener('click', function () { send(input.value); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); }
    });
    if (closeBtn) closeBtn.addEventListener('click', closeChatPopup);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeChatPopup(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('open')) closeChatPopup();
    });

    // hero section -> same popup, auto-submit, clear hero input
    if (heroSend) heroSend.addEventListener('click', function () {
      var v = heroInput.value.trim();
      if (!v) { openChatPopup(''); return; }
      heroInput.value = '';
      openChatPopup(v);
    });
    if (heroInput) heroInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var v = heroInput.value.trim();
        if (!v) return;
        heroInput.value = '';
        openChatPopup(v);
      }
    });

    // bottom-nav center button -> opens the same popup, no tab navigation side effect
    if (navBtn) navBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openChatPopup('');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
