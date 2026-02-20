'use strict';

const { buildContactDirectory, buildRoutingRules, buildHookMessage, matchCategory } = require('../lib/hooks');

const sampleRules = {
  openclaw: { hookUrl: 'http://127.0.0.1:18789/hooks/agent', hookToken: 'secret' },
  ignoreIds: ['bridge@c.us'],
  contacts: {
    categories: {
      family: {
        ids: ['111@c.us', '222@c.us'],
        action: 'reply-and-notify',
        style: 'casual',
        context: 'Family members',
      },
      work: {
        ids: [],
        matchName: 'Boss',
        action: 'notify-only',
        context: 'Work contacts',
      },
    },
    defaults: {
      groups: { action: 'ignore' },
      unknown: { action: 'notify-only' },
    },
  },
  telegram: { chatId: '12345' },
};

describe('matchCategory', () => {
  const cats = sampleRules.contacts.categories;

  test('matches by id', () => {
    const match = matchCategory('111@c.us', 'Mom', cats);
    expect(match).not.toBeNull();
    expect(match.name).toBe('family');
  });

  test('matches by name', () => {
    const match = matchCategory('999@c.us', 'My Boss John', cats);
    expect(match).not.toBeNull();
    expect(match.name).toBe('work');
  });

  test('returns null for unknown', () => {
    const match = matchCategory('999@c.us', 'Random', cats);
    expect(match).toBeNull();
  });

  test('name match is case-insensitive', () => {
    const match = matchCategory('999@c.us', 'the BOSS here', cats);
    expect(match).not.toBeNull();
    expect(match.name).toBe('work');
  });
});

describe('buildContactDirectory', () => {
  test('lists categories with ids and context', () => {
    const dir = buildContactDirectory(sampleRules.contacts.categories);
    expect(dir).toContain('FAMILY:');
    expect(dir).toContain('111@c.us');
    expect(dir).toContain('Context: Family members');
    expect(dir).toContain('WORK:');
    expect(dir).toContain('match contact name: Boss');
  });
});

describe('buildRoutingRules', () => {
  test('includes rules for categories and defaults', () => {
    const rules = buildRoutingRules(sampleRules.contacts.categories, sampleRules.contacts.defaults, '12345');
    expect(rules).toContain('FAMILY:');
    expect(rules).toContain('Reply on WhatsApp');
    expect(rules).toContain('WORK:');
    expect(rules).toContain('Do NOT reply on WhatsApp');
    expect(rules).toContain('GROUPS');
    expect(rules).toContain('SPAM / UNKNOWN');
    expect(rules).toContain('target=12345');
  });
});

describe('buildHookMessage', () => {
  test('builds full message with all sections', () => {
    const entry = {
      from: '111@c.us',
      pushName: 'Mom',
      body: 'Hey there!',
      type: 'chat',
      hasMedia: false,
      isGroup: false,
      chatName: null,
    };
    const msg = buildHookMessage(entry, sampleRules, 3100);
    expect(msg).toContain('📱 WhatsApp message received:');
    expect(msg).toContain('From: Mom');
    expect(msg).toContain('WA ID: 111@c.us');
    expect(msg).toContain('Hey there!');
    expect(msg).toContain('CONTACT DIRECTORY');
    expect(msg).toContain('ROUTING RULES');
    expect(msg).toContain('HOW TO REPLY ON WHATSAPP');
    expect(msg).toContain('127.0.0.1:3100/send');
  });

  test('includes group info when isGroup', () => {
    const entry = {
      from: '111@g.us',
      pushName: null,
      body: 'Group msg',
      type: 'chat',
      hasMedia: false,
      isGroup: true,
      chatName: 'Family Group',
    };
    const msg = buildHookMessage(entry, sampleRules, 3100);
    expect(msg).toContain('(grupo: Family Group)');
  });

  test('shows media flag', () => {
    const entry = {
      from: '111@c.us',
      pushName: 'X',
      body: '',
      type: 'image',
      hasMedia: true,
      isGroup: false,
    };
    const msg = buildHookMessage(entry, sampleRules, 3100);
    expect(msg).toContain('Has media: yes');
  });
});
