'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const request = require('supertest');
const { createApp } = require('../lib/server');

// Mock WA client
function createMockClient(ready = true) {
  const state = { ready, qr: ready ? null : 'mock-qr', info: ready ? { pushname: 'Test', wid: { _serialized: '123@c.us' }, platform: 'test' } : null };

  const mockChats = [
    {
      id: { _serialized: '111@c.us' },
      name: 'Alice',
      isGroup: false,
      unreadCount: 2,
      timestamp: 1000,
      lastMessage: { body: 'Hello', fromMe: false },
      fetchMessages: jest.fn().mockResolvedValue([
        { id: { _serialized: 'msg1' }, from: '111@c.us', author: null, body: 'Hi', timestamp: 1000, fromMe: false, hasMedia: false, type: 'chat' },
      ]),
    },
    {
      id: { _serialized: 'group1@g.us' },
      name: 'Test Group',
      isGroup: true,
      unreadCount: 0,
      timestamp: 900,
      lastMessage: null,
      groupMetadata: { participants: [{ id: { _serialized: '111@c.us' }, isAdmin: true, isSuperAdmin: false }], desc: 'A test group', creation: 1000 },
      fetchMessages: jest.fn().mockResolvedValue([]),
    },
  ];

  const mockContacts = [
    { id: { _serialized: '111@c.us' }, name: 'Alice', pushname: 'Alice', number: '111', isMyContact: true, isGroup: false },
    { id: { _serialized: '222@c.us' }, name: 'Bob', pushname: 'Bob', number: '222', isMyContact: true, isGroup: false },
  ];

  const client = {
    getChats: jest.fn().mockResolvedValue(mockChats),
    getChatById: jest.fn().mockImplementation(async (id) => {
      const chat = mockChats.find(c => c.id._serialized === id);
      if (!chat) throw new Error('Chat not found');
      return chat;
    }),
    getContacts: jest.fn().mockResolvedValue(mockContacts),
    sendMessage: jest.fn().mockResolvedValue({ id: { _serialized: 'sent_msg_1' } }),
    searchMessages: jest.fn().mockResolvedValue([
      { id: { _serialized: 'found1' }, from: '111@c.us', author: null, body: 'Found it', timestamp: 1000, chat: { name: 'Alice' } },
    ]),
  };

  return { client, state };
}

describe('Server API', () => {
  let app, tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srv-'));
    const { client, state } = createMockClient(true);
    app = createApp(client, state, {
      eventsDir: path.join(tmpDir, 'events'),
      logsDir: path.join(tmpDir, 'logs'),
      monitorsFile: path.join(tmpDir, 'monitors.json'),
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -- Status --
  test('GET /status returns connected', async () => {
    const res = await request(app).get('/status');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('connected');
    expect(res.body.info.pushname).toBe('Test');
  });

  // -- QR --
  test('GET /qr when already authenticated', async () => {
    const res = await request(app).get('/qr');
    expect(res.status).toBe(200);
    expect(res.body.qr).toBeNull();
    expect(res.body.message).toContain('authenticated');
  });

  // -- Events --
  test('GET /events returns empty initially', async () => {
    const res = await request(app).get('/events');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('GET /events/peek returns events without flushing', async () => {
    app._eventQueue.push({ from: '111@c.us', body: 'test' });
    const res1 = await request(app).get('/events/peek');
    expect(res1.body).toHaveLength(1);
    const res2 = await request(app).get('/events/peek');
    expect(res2.body).toHaveLength(1);
  });

  test('GET /events flushes', async () => {
    app._eventQueue.push({ from: '111@c.us', body: 'test' });
    const res1 = await request(app).get('/events');
    expect(res1.body).toHaveLength(1);
    const res2 = await request(app).get('/events');
    expect(res2.body).toHaveLength(0);
  });

  // -- Chats --
  test('GET /chats returns chat list', async () => {
    const res = await request(app).get('/chats');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].name).toBe('Alice');
  });

  test('GET /chats/:chatId/messages', async () => {
    const res = await request(app).get('/chats/111@c.us/messages');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].body).toBe('Hi');
  });

  // -- Contacts --
  test('GET /contacts returns all contacts', async () => {
    const res = await request(app).get('/contacts');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  test('GET /contacts/search filters by name', async () => {
    const res = await request(app).get('/contacts/search?q=alice');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Alice');
  });

  test('GET /contacts/search requires q', async () => {
    const res = await request(app).get('/contacts/search');
    expect(res.status).toBe(400);
  });

  // -- Groups --
  test('GET /groups returns only groups', async () => {
    const res = await request(app).get('/groups');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Test Group');
  });

  test('GET /groups/search', async () => {
    const res = await request(app).get('/groups/search?q=test');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  test('GET /groups/:groupId/info', async () => {
    const res = await request(app).get('/groups/group1@g.us/info');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Test Group');
    expect(res.body.participants).toHaveLength(1);
  });

  // -- Send --
  test('POST /send sends message', async () => {
    const res = await request(app).post('/send').send({ to: '111', message: 'Hello' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.messageId).toBe('sent_msg_1');
  });

  test('POST /send requires fields', async () => {
    const res = await request(app).post('/send').send({});
    expect(res.status).toBe(400);
  });

  test('POST /send-group sends to group', async () => {
    const res = await request(app).post('/send-group').send({ groupId: 'group1', message: 'Hi all' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // -- Search --
  test('GET /search finds messages', async () => {
    const res = await request(app).get('/search?q=hello');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  test('GET /search requires q', async () => {
    const res = await request(app).get('/search');
    expect(res.status).toBe(400);
  });

  // -- Monitors --
  test('monitor CRUD', async () => {
    // List empty
    let res = await request(app).get('/monitor');
    expect(res.body).toHaveLength(0);

    // Add
    res = await request(app).post('/monitor').send({ contactId: '555' });
    expect(res.body.success).toBe(true);
    expect(res.body.contactId).toBe('555@c.us');

    // List with 1
    res = await request(app).get('/monitor');
    expect(res.body).toHaveLength(1);

    // Remove
    res = await request(app).delete('/monitor/555@c.us');
    expect(res.body.success).toBe(true);

    // List empty again
    res = await request(app).get('/monitor');
    expect(res.body).toHaveLength(0);
  });

  test('DELETE /monitor for non-existent returns 404', async () => {
    const res = await request(app).delete('/monitor/999@c.us');
    expect(res.status).toBe(404);
  });
});

describe('Server API (disconnected)', () => {
  let app, tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srv-'));
    const { client, state } = createMockClient(false);
    app = createApp(client, state, {
      eventsDir: path.join(tmpDir, 'events'),
      logsDir: path.join(tmpDir, 'logs'),
      monitorsFile: path.join(tmpDir, 'monitors.json'),
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('GET /status returns waiting_for_qr', async () => {
    const res = await request(app).get('/status');
    expect(res.body.status).toBe('waiting_for_qr');
  });

  test('endpoints return 503 when disconnected', async () => {
    expect((await request(app).get('/chats')).status).toBe(503);
    expect((await request(app).get('/contacts')).status).toBe(503);
    expect((await request(app).post('/send').send({ to: '1', message: 'x' })).status).toBe(503);
  });
});

describe('Server API (auth token)', () => {
  let app, tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srv-'));
    const { client, state } = createMockClient(true);
    app = createApp(client, state, {
      apiToken: 'secret123',
      eventsDir: path.join(tmpDir, 'events'),
      logsDir: path.join(tmpDir, 'logs'),
      monitorsFile: path.join(tmpDir, 'monitors.json'),
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('rejects without token', async () => {
    const res = await request(app).get('/status');
    expect(res.status).toBe(401);
  });

  test('accepts with correct token', async () => {
    const res = await request(app).get('/status').set('Authorization', 'Bearer secret123');
    expect(res.status).toBe(200);
  });
});
