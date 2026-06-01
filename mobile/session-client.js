// SessionClient — unified transport adapter
// UI layer only calls these methods, never touches socket.io or HTTP directly

function SessionClient() {
  this.socket = null;
  this.pin = '';
  this.deviceId = '';
  this._handlers = {};
}

SessionClient.prototype = {

  // ===== Connection =====
  connect: function(pin, deviceId, deviceName) {
    var self = this;
    self.pin = pin;
    self.deviceId = deviceId;
    self.socket = io({
      auth: { pin: pin, deviceId: deviceId, deviceName: deviceName || '' },
      timeout: 30000
    });
    self._wireEvents();
  },

  disconnect: function() {
    if (this.socket) { this.socket.close(); this.socket = null; }
  },

  _wireEvents: function() {
    var self = this;
    var s = self.socket;

    s.on('connect', function() { self._emit('connect'); });
    s.on('disconnect', function() { self._emit('disconnect'); });
    s.on('ping', function() { self._emit('ping'); });
    s.on('sessions-updated', function(list) { self._emit('sessions-updated', list); });
    s.on('session-messages', function(data) { self._emit('session-messages', data); });
    s.on('queue-changed', function(data) { self._emit('queue-changed', data); });
    s.on('queue-data', function(data) { self._emit('queue-data', data); });
    s.on('auth-error', function(data) { self._emit('auth-error', data); });
    s.on('send-error', function(data) { self._emit('send-error', data); });
    s.on('latency-pong', function() { self._emit('latency-pong'); });
    s.on('queue-auto-ready', function(data) { self._emit('queue-auto-ready', data); });
  },

  // ===== Event subscription (UI binds here) =====
  on: function(event, fn) {
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(fn);
    return function() { /* unsub stub */ };
  },

  _emit: function(event, data) {
    var hs = this._handlers[event];
    if (hs) { for (var i = 0; i < hs.length; i++) hs[i](data); }
  },

  // ===== HTTP API =====
  _httpGet: function(url, cb) {
    var sep = url.indexOf('?') >= 0 ? '&' : '?';
    var full = url + sep + 'pin=' + encodeURIComponent(this.pin) + '&deviceId=' + encodeURIComponent(this.deviceId);
    var xhr = new XMLHttpRequest();
    xhr.open('GET', full);
    xhr.onload = function() {
      try { cb(JSON.parse(xhr.responseText)); } catch(e) { cb(null); }
    };
    xhr.onerror = function() { cb(null); };
    xhr.send();
  },

  getSessionList: function(cb) { this._httpGet('/api/sessions', cb); },
  getSessionDetail: function(id, cb) { this._httpGet('/api/sessions/' + encodeURIComponent(id), cb); },
  getQueue: function(id, cb) { this._httpGet('/api/queue/' + encodeURIComponent(id), cb); },

  verifyPin: function(pin, deviceId, deviceName, cb) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/auth');
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function() {
      try { cb(JSON.parse(xhr.responseText)); } catch(e) { cb(null); }
    };
    xhr.onerror = function() { cb(null); };
    xhr.send(JSON.stringify({ pin: pin, deviceId: deviceId, deviceName: deviceName || '' }));
  },

  // ===== Socket actions =====
  _emitSocket: function(event, data) {
    if (this.socket) this.socket.emit(event, data);
  },

  joinSession: function(id)       { this._emitSocket('join-session', id); },
  leaveSession: function(id)      { this._emitSocket('leave-session', id); },
  sendMessage: function(id, text) { this._emitSocket('send-message', { sessionId: id, message: text }); },
  focusSession: function(id)      { this._emitSocket('focus-session', id); },
  newSession: function(cwd)       { this._emitSocket('new-session', cwd || ''); },
  pong: function()                { this._emitSocket('pong'); },
  addToQueue: function(id, cmd)   { this._emitSocket('add-to-queue', { sessionId: id, command: cmd }); },
  removeFromQueue: function(id, idx) { this._emitSocket('remove-from-queue', { sessionId: id, index: idx }); },
  clearQueue: function(id)        { this._emitSocket('clear-queue', id); },
  reorderQueue: function(id, from, to) { this._emitSocket('reorder-queue', { sessionId: id, from: from, to: to }); },
  setAutoPlay: function(id, enabled) { this._emitSocket('set-auto-play', { sessionId: id, enabled: enabled }); },
  sendNextFromQueue: function(id) { this._emitSocket('send-next-from-queue', id); },
  requestQueue: function(id)      { this._emitSocket('get-queue', id); },
  latencyTest: function()         { this._emitSocket('latency-test'); }
};
