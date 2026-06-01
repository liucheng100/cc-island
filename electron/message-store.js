// MessageStore — single source of truth for session messages.
// All reads/writes go through this. Emits deltas automatically.

const { EventEmitter } = require('events');

class MessageStore extends EventEmitter {
  constructor() {
    super();
    this._messages = new Map();  // sessionId → message[]
    this._fileCount = new Map(); // sessionId → last known file message count
    this._dirty = new Set();     // sessionIds with unsent file-synced counts
  }

  // Get full message list for a session
  getMessages(sessionId) {
    return this._messages.get(sessionId) || [];
  }

  // Get message count
  getCount(sessionId) {
    const msgs = this._messages.get(sessionId);
    return msgs ? msgs.length : 0;
  }

  // Append a message (from sendToSession or queue auto-send)
  // Returns the new message with seq
  appendMessage(sessionId, msg) {
    if (!this._messages.has(sessionId)) this._messages.set(sessionId, []);
    const msgs = this._messages.get(sessionId);
    const seq = msgs.length;
    const entry = { role: msg.role, content: msg.content, timestamp: msg.timestamp || new Date().toISOString(), seq };
    msgs.push(entry);
    // Mark that we've advanced beyond file state
    this._dirty.add(sessionId);
    return entry;
  }

  // Sync from file (called by scan). Returns delta if new messages found.
  syncFromFile(sessionId, fileMessages) {
    const newCount = fileMessages ? fileMessages.length : 0;
    const prevCount = this._fileCount.get(sessionId) || 0;

    if (newCount > prevCount) {
      // File has new messages — extract delta
      const delta = fileMessages.slice(prevCount).map((m, j) => ({
        role: m.role, content: m.content, timestamp: m.timestamp,
        seq: prevCount + j
      }));
      // Update in-memory to match file
      this._messages.set(sessionId, fileMessages.slice());
      this._fileCount.set(sessionId, newCount);
      this._dirty.delete(sessionId);
      return delta;
    }

    if (newCount < prevCount) {
      // File lost messages (shouldn't happen) — don't regress
      return null;
    }

    // Count equal — update in-memory from file only if we're not dirty
    if (!this._dirty.has(sessionId)) {
      // We're in sync with file, update memory
      this._messages.set(sessionId, fileMessages ? fileMessages.slice() : []);
    }
    // else: we have unsent optimistic messages, don't overwrite

    this._fileCount.set(sessionId, newCount);
    return null;
  }

  // Called when a message has been confirmed in the file (clean state)
  markClean(sessionId) {
    this._dirty.delete(sessionId);
    this._fileCount.set(sessionId, this.getCount(sessionId));
  }

  // Initialize a session from file data
  initFromFile(sessionId, fileMessages) {
    const msgs = fileMessages ? fileMessages.slice() : [];
    this._messages.set(sessionId, msgs);
    this._fileCount.set(sessionId, msgs.length);
    this._dirty.delete(sessionId);
  }

  // Get message count for hash comparison (used by scanSessions)
  getMessageCount(sessionId) {
    return this.getCount(sessionId);
  }
}

module.exports = { MessageStore };
