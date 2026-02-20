'use strict';

const { run } = require('../lib/cli');
const http = require('http');

// Simple mock HTTP server
function createMockServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port, url: `http://127.0.0.1:${port}` });
    });
  });
}

describe('CLI', () => {
  let mockServer, mockPort, mockUrl;

  beforeAll(async () => {
    const mock = await createMockServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');

      if (req.url === '/status' && req.method === 'GET') {
        res.end(JSON.stringify({ status: 'connected', info: { pushname: 'Test' } }));
      } else if (req.url === '/events' && req.method === 'GET') {
        res.end(JSON.stringify([{ from: '111@c.us', body: 'hi' }]));
      } else if (req.url === '/events/peek' && req.method === 'GET') {
        res.end(JSON.stringify([{ from: '111@c.us', body: 'hi' }]));
      } else if (req.url === '/chats' && req.method === 'GET') {
        res.end(JSON.stringify([{ id: '111@c.us', name: 'Alice' }]));
      } else if (req.url === '/contacts' && req.method === 'GET') {
        res.end(JSON.stringify([{ id: '111@c.us', name: 'Alice' }]));
      } else if (req.url === '/groups' && req.method === 'GET') {
        res.end(JSON.stringify([{ id: 'g1@g.us', name: 'Group' }]));
      } else if (req.url === '/monitor' && req.method === 'GET') {
        res.end(JSON.stringify([]));
      } else if (req.url.startsWith('/search') && req.method === 'GET') {
        res.end(JSON.stringify([{ body: 'found' }]));
      } else if (req.url === '/send' && req.method === 'POST') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
          const data = JSON.parse(body);
          res.end(JSON.stringify({ success: true, to: data.to }));
        });
        return;
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'not found' }));
      }
    });
    mockServer = mock.server;
    mockPort = mock.port;
    mockUrl = mock.url;
  });

  afterAll((done) => {
    mockServer.close(done);
  });

  function capture(args) {
    let output = '';
    const fakeOut = { write: (s) => { output += s; } };
    return run(args, { baseUrl: mockUrl, output: fakeOut, noExit: true }).then(() => {
      try { return JSON.parse(output.trim()); } catch { return output; }
    });
  }

  test('status', async () => {
    const result = await capture(['status']);
    expect(result.status).toBe('connected');
  });

  test('events', async () => {
    const result = await capture(['events']);
    expect(result).toHaveLength(1);
    expect(result[0].body).toBe('hi');
  });

  test('events --peek', async () => {
    const result = await capture(['events', '--peek']);
    expect(result).toHaveLength(1);
  });

  test('chats', async () => {
    const result = await capture(['chats']);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Alice');
  });

  test('contacts', async () => {
    const result = await capture(['contacts']);
    expect(result).toHaveLength(1);
  });

  test('groups', async () => {
    const result = await capture(['groups']);
    expect(result).toHaveLength(1);
  });

  test('send', async () => {
    const result = await capture(['send', '111', 'Hello', 'World']);
    expect(result.success).toBe(true);
  });

  test('send without args shows error', async () => {
    const result = await capture(['send']);
    expect(result.error).toBeDefined();
  });

  test('search', async () => {
    const result = await capture(['search', 'hello']);
    expect(result).toHaveLength(1);
  });

  test('monitor list', async () => {
    const result = await capture(['monitor']);
    expect(result).toEqual([]);
  });

  test('help', async () => {
    let output = '';
    const fakeOut = { write: (s) => { output += s; } };
    await run(['help'], { baseUrl: mockUrl, output: fakeOut, noExit: true });
    expect(output).toContain('Usage:');
  });

  test('unknown command', async () => {
    const result = await capture(['foobar']);
    expect(result.error).toContain('Unknown command');
  });
});
