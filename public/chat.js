/**
 * FlyTripVisa AI Chat Client (corrected)
 * Connects the index.html chat popup to the Cloudflare Worker
 * streaming endpoint: POST /api/ai-chat (Server-Sent Events).
 *
 * Designed for the index.html popup that uses these element IDs:
 *   chatPopupOverlay, chatPopupMessages, chatPopupInput,
 *   chatPopupSendBtn, closeChatPopupBtn, navAiChatBtn,
 *   aiChatInput, aiChatSendBtn
 * and CSS bubble classes: "chat-msg bot" / "chat-msg user".
 *
 * It takes over from the inline placeholder chat (hardcoded replies)
 * by re-binding the send/input controls after the inline script runs.
 */
(function () {
  'use strict';

  var ENDPOINT = '/api/ai-chat';
  var HISTORY_ENDPOINT = '/api/ai-chat/history';
  var CONV_KEY = 'ftv_conv_id';
  var MAX_HISTORY = 20;

  var overlay, messages, input, sendBtn, closeBtn, heroInput, heroSend, navBtn;

  var state = {
    conversationId: '',
    history: [],
    generating: false,
    abort: null
  };

  // ---- DOM helpers ----
  function $(id) { return document.getElementById(id); }

  // Strip any listeners an inline script already attached by cloning the node.
  function rebind(el) {
    if (!el) return null;
    var clone = el.cloneNode(true);
    el.parentNode.replaceChild(clone, el);
    return clone;
  }

  function scrollBottom() {
    requestAnimationFrame(function () {
      if (messages) messages.scrollTop = messages.scrollHeight;
    });
  }

  function addBubble(text, role) {
    var div = document.createElement('div');
    div.className = 'chat-msg ' + (role === 'user' ? 'user' : 'bot');
    div.textContent = text;
    messages.appendChild(div);
    scrollBottom();
    return div;
  }

  var typingEl = null;
  function showTyping() {
    if (typingEl) return;
    typingEl = document.createElement('div');
    typingEl.className = 'chat-msg bot';
    typingEl.textContent = '● ● ●';
    typingEl.style.letterSpacing = '4px';
    messages.appendChild(typingEl);
    scrollBottom();
  }
  function hideTyping() {
    if (typingEl) { typingEl.remove(); typingEl = null; }
  }

  // ---- persistence ----
  function loadConv() {
    try { state.conversationId = localStorage.getItem(CONV_KEY) || ''; } catch (e) {}
  }
  function saveConv() {
    try { localStorage.setItem(CONV_KEY, state.conversationId); } catch (e) {}
  }

  // ---- send + stream ----
  function send(text) {
    text = (text || '').trim();
    if (!text || state.generating) return;

    addBubble(text, 'user');
    state.history.push({ role: 'user', content: text });

    input.value = '';
    showTyping();
    setGenerating(true);

    var bubble = document.createElement('div');
    bubble.className = 'chat-msg bot';
    bubble.textContent = '';
    messages.appendChild(bubble);
    scrollBottom();

    var acc = '';
    state.abort = new AbortController();

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        conversationId: state.conversationId,
        history: state.history.slice(-MAX_HISTORY)
      }),
      signal: state.abort.signal
    }).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function(){return {};}).then(function(e){
          throw new Error(e.error || ('Request failed (' + res.status + ')'));
        });
      }
      if (!res.body) throw new Error('No response stream.');
      return readStream(res.body, bubble, function(tok){ acc += tok; });
    }).then(function () {
      hideTyping();
      if (!acc.trim()) {
        if (bubble.parentNode) bubble.remove();
        addBubble('No response received. Please try again.', 'bot');
      } else {
        state.history.push({ role: 'assistant', content: acc });
      }
      setGenerating(false);
    }).catch(function (err) {
      hideTyping();
      if (bubble.parentNode) bubble.remove();
      setGenerating(false);
      if (err.name === 'AbortError') {
        if (acc.trim()) { addBubble(acc, 'bot'); state.history.push({role:'assistant',content:acc}); }
        return;
      }
      var msg = (err instanceof TypeError) ? 'Network error. Check your connection.' : (err.message || 'Something went wrong.');
      addBubble(msg, 'bot');
    });
  }

  function readStream(body, bubble, onToken) {
    var reader = body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var acc = '';

    function pump() {
      return reader.read().then(function (result) {
        if (result.done) return;
        buffer += decoder.decode(result.value, { stream: true });
        var idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          var raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          var evt = 'message', data = '';
          raw.split('\n').forEach(function (line) {
            if (line.indexOf('event:') === 0) evt = line.slice(6).trim();
            else if (line.indexOf('data:') === 0) data += line.slice(5).trim();
          });
          if (evt === 'meta') {
            try { var m = JSON.parse(data); if (m.conversationId) { state.conversationId = m.conversationId; saveConv(); } } catch (e) {}
          } else if (evt !== 'done') {
            try {
              var obj = JSON.parse(data);
              var tok = obj && (obj.response || obj.token || (obj.choices && obj.choices[0] && obj.choices[0].delta && obj.choices[0].delta.content)) || '';
              if (tok) { acc += tok; onToken(tok); bubble.textContent = acc; scrollBottom(); }
            } catch (e) {}
          }
        }
        return pump();
      });
    }
    return pump();
  }

  function setGenerating(g) {
    state.generating = g;
    if (sendBtn) sendBtn.disabled = g;
    if (heroSend) heroSend.disabled = g;
  }

  // ---- popup open/close ----
  function openPopup(prefill) {
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(function(){ input.focus(); }, 200);
    if (prefill && prefill.trim()) send(prefill);
  }
  function closePopup() {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  // ---- init ----
  function init() {
    overlay = $('chatPopupOverlay');
    messages = $('chatPopupMessages');
    input = $('chatPopupInput');
    sendBtn = $('chatPopupSendBtn');
    closeBtn = $('closeChatPopupBtn');
    heroInput = $('aiChatInput');
    heroSend = $('aiChatSendBtn');
    navBtn = $('navAiChatBtn');

    if (!messages || !input || !sendBtn) return; // chat not present

    loadConv();

    // Re-bind to override the inline placeholder handlers
    sendBtn = rebind(sendBtn);
    input = rebind(input);
    if (heroSend) heroSend = rebind(heroSend);
    if (heroInput) heroInput = rebind(heroInput);
    if (navBtn) navBtn = rebind(navBtn);
    if (closeBtn) closeBtn = rebind(closeBtn);

    sendBtn.addEventListener('click', function () { send(input.value); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); }
    });
    if (closeBtn) closeBtn.addEventListener('click', closePopup);
    if (overlay) overlay.addEventListener('click', function (e) { if (e.target === overlay) closePopup(); });

    if (heroSend) heroSend.addEventListener('click', function () {
      var v = heroInput.value.trim(); heroInput.value = ''; openPopup(v);
    });
    if (heroInput) heroInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); var v = heroInput.value.trim(); heroInput.value = ''; openPopup(v); }
    });
    if (navBtn) navBtn.addEventListener('click', function () { openPopup(''); });

    // optional: load prior server history
    if (state.conversationId) {
      fetch(HISTORY_ENDPOINT + '?conversationId=' + encodeURIComponent(state.conversationId))
        .then(function(r){return r.json();})
        .then(function(d){
          if (d && d.messages && d.messages.length) {
            // keep the welcome bubble, append history
            d.messages.forEach(function(m){ addBubble(m.content, m.role === 'user' ? 'user' : 'bot'); state.history.push({role:m.role,content:m.content}); });
          }
        }).catch(function(){});
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
