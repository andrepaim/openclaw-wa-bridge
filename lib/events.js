'use strict';

const fs = require('fs');
const path = require('path');

class EventQueue {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'incoming.jsonl');
    fs.mkdirSync(dir, { recursive: true });
  }

  /** Append an event object to the JSONL file */
  push(event) {
    fs.appendFileSync(this.file, JSON.stringify(event) + '\n');
  }

  /** Read all events (does NOT flush) */
  peek() {
    if (!fs.existsSync(this.file)) return [];
    const raw = fs.readFileSync(this.file, 'utf8').trim();
    if (!raw) return [];
    return raw.split('\n').map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  }

  /** Read all events and flush the file */
  flush() {
    const events = this.peek();
    if (fs.existsSync(this.file)) fs.writeFileSync(this.file, '');
    return events;
  }

  /** Clear the queue */
  clear() {
    if (fs.existsSync(this.file)) fs.writeFileSync(this.file, '');
  }
}

module.exports = EventQueue;
