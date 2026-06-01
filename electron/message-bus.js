// Singleton event bus — all cross-module events go through here.
// No module should listen on another module's instance directly.

const { EventEmitter } = require('events');
const bus = new EventEmitter();
bus.setMaxListeners(50);

module.exports = bus;
