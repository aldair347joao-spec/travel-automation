const EventEmitter = require("events");

const eventBus = new EventEmitter();

eventBus.setMaxListeners(1000);

module.exports = eventBus;
