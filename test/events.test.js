'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const EventQueue = require('../lib/events');

describe('EventQueue', () => {
  let tmpDir, queue;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evq-'));
    queue = new EventQueue(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('push and peek returns events', () => {
    queue.push({ from: '123@c.us', body: 'hello' });
    queue.push({ from: '456@c.us', body: 'world' });
    const events = queue.peek();
    expect(events).toHaveLength(2);
    expect(events[0].body).toBe('hello');
    expect(events[1].body).toBe('world');
  });

  test('peek does not flush', () => {
    queue.push({ from: '123@c.us', body: 'test' });
    queue.peek();
    expect(queue.peek()).toHaveLength(1);
  });

  test('flush returns events and clears file', () => {
    queue.push({ from: '123@c.us', body: 'a' });
    queue.push({ from: '456@c.us', body: 'b' });
    const events = queue.flush();
    expect(events).toHaveLength(2);
    expect(queue.peek()).toHaveLength(0);
  });

  test('peek on empty queue returns empty array', () => {
    expect(queue.peek()).toEqual([]);
  });

  test('flush on empty queue returns empty array', () => {
    expect(queue.flush()).toEqual([]);
  });

  test('clear empties the queue', () => {
    queue.push({ from: '123@c.us', body: 'x' });
    queue.clear();
    expect(queue.peek()).toEqual([]);
  });

  test('handles malformed JSONL lines gracefully', () => {
    fs.writeFileSync(queue.file, '{"ok":true}\nBAD LINE\n{"ok":false}\n');
    const events = queue.peek();
    expect(events).toHaveLength(2);
    expect(events[0].ok).toBe(true);
    expect(events[1].ok).toBe(false);
  });
});
