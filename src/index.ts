import { Hono } from 'hono';
import { cors } from 'hono/cors';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import type { Player, PlayerStats } from './types';
import { PlayerDO } from './durable-objects/PlayerDO';
import { RoomDO } from './durable-objects/RoomDO';
import { WorldDO } from './durable-objects/WorldDO';

type Bindings = {
  DATABASE?: D1Database;
  WORLD_STATE?: KVNamespace;
  PLAYER_DO?: DurableObjectNamespace;
  ROOM_DO?: DurableObjectNamespace;
  WORLD_DO?: DurableObjectNamespace;
  JWT_SECRET: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization']
}));

const authenticate = (c: any, next: any) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, c.env.JWT_SECRET) as { playerId: string };
    c.set('playerId', decoded.playerId);
    return next();
  } catch {
    return c.json({ error: 'Invalid token' }, 401);
  }
};

interface MemoryPlayer {
  id: string;
  username: string;
  password_hash: string;
  email?: string;
  created_at: number;
  last_login?: number;
  is_online: boolean;
  location: string;
}

interface MemoryPlayerStats {
  player_id: string;
  strength: number;
  dexterity: number;
  intelligence: number;
  charisma: number;
  stamina: number;
  level: number;
  experience: number;
  health: number;
  max_health: number;
  lust: number;
  max_lust: number;
}

const memoryPlayers: Map<string, MemoryPlayer> = new Map();
const memoryPlayerStats: Map<string, MemoryPlayerStats> = new Map();
const memoryMessages: Array<{ id: number; sender_id: string; receiver_id: string; content: string; timestamp: number; read: boolean }> = [];
let messageIdCounter = 1;

const hashPassword = (password: string): string => {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = crypto.subtle.digestSync('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)));
};

app.post('/api/auth/register', async (c) => {
  const { username, password, email } = await c.req.json();
  if (!username || !password) {
    return c.json({ error: 'Username and password required' }, 400);
  }

  const passwordHash = hashPassword(password);
  const playerId = uuidv4();
  const now = Math.floor(Date.now() / 1000);

  if (c.env.DATABASE) {
    try {
      await c.env.DATABASE.prepare(
        'INSERT INTO players (id, username, password_hash, email, created_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(playerId, username, passwordHash, email, now).run();
      await c.env.DATABASE.prepare(
        'INSERT INTO player_stats (player_id) VALUES (?)'
      ).bind(playerId).run();
    } catch (error) {
      return c.json({ error: 'Username already exists' }, 409);
    }
  } else {
    if (Array.from(memoryPlayers.values()).some(p => p.username === username)) {
      return c.json({ error: 'Username already exists' }, 409);
    }
    memoryPlayers.set(playerId, {
      id: playerId,
      username,
      password_hash: passwordHash,
      email,
      created_at: now,
      is_online: false,
      location: 'home'
    });
    memoryPlayerStats.set(playerId, {
      player_id: playerId,
      strength: 10,
      dexterity: 10,
      intelligence: 10,
      charisma: 10,
      stamina: 10,
      level: 1,
      experience: 0,
      health: 100,
      max_health: 100,
      lust: 0,
      max_lust: 100
    });
  }

  const token = jwt.sign({ playerId }, c.env.JWT_SECRET, { expiresIn: '7d' });
  return c.json({ token, playerId, username });
});

app.post('/api/auth/login', async (c) => {
  const { username, password } = await c.req.json();
  if (!username || !password) {
    return c.json({ error: 'Username and password required' }, 400);
  }

  const passwordHash = hashPassword(password);
  let player: MemoryPlayer | undefined;

  if (c.env.DATABASE) {
    const result = await c.env.DATABASE.prepare(
      'SELECT * FROM players WHERE username = ?'
    ).bind(username).first();
    if (!result || result.password_hash !== passwordHash) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }
    player = result as MemoryPlayer;
    await c.env.DATABASE.prepare(
      'UPDATE players SET last_login = ?, is_online = TRUE WHERE id = ?'
    ).bind(Math.floor(Date.now() / 1000), player.id).run();
  } else {
    player = Array.from(memoryPlayers.values()).find(p => p.username === username);
    if (!player || player.password_hash !== passwordHash) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }
    player.last_login = Math.floor(Date.now() / 1000);
    player.is_online = true;
    memoryPlayers.set(player.id, player);
  }

  const token = jwt.sign({ playerId: player.id }, c.env.JWT_SECRET, { expiresIn: '7d' });
  return c.json({ token, playerId: player.id, username: player.username });
});

app.get('/api/player', authenticate, async (c) => {
  const playerId = c.get('playerId');

  if (c.env.DATABASE) {
    const result = await c.env.DATABASE.prepare(
      'SELECT id, username, email, created_at, last_login, is_online, location FROM players WHERE id = ?'
    ).bind(playerId).first();
    return c.json(result || {});
  }

  const player = memoryPlayers.get(playerId);
  return c.json(player || {});
});

app.get('/api/player/stats', authenticate, async (c) => {
  const playerId = c.get('playerId');

  if (c.env.DATABASE) {
    const result = await c.env.DATABASE.prepare(
      'SELECT * FROM player_stats WHERE player_id = ?'
    ).bind(playerId).first();
    return c.json(result || {});
  }

  const stats = memoryPlayerStats.get(playerId);
  return c.json(stats || {});
});

app.post('/api/player/stats', authenticate, async (c) => {
  const playerId = c.get('playerId');
  const payload = await c.req.json();

  if (c.env.DATABASE) {
    const updateFields = Object.keys(payload).map(k => `${k} = ?`).join(', ');
    const values = Object.values(payload);
    values.push(playerId);
    await c.env.DATABASE.prepare(
      `UPDATE player_stats SET ${updateFields} WHERE player_id = ?`
    ).bind(...values).run();
  } else {
    const stats = memoryPlayerStats.get(playerId);
    if (stats) {
      Object.assign(stats, payload);
      memoryPlayerStats.set(playerId, stats);
    }
  }

  return c.json({ success: true });
});

app.get('/api/player/inventory', authenticate, async (c) => {
  const playerId = c.get('playerId');

  if (c.env.DATABASE) {
    const result = await c.env.DATABASE.prepare(
      'SELECT * FROM player_inventory WHERE player_id = ?'
    ).bind(playerId).all();
    return c.json(result.results || []);
  }

  return c.json([]);
});

app.post('/api/player/inventory', authenticate, async (c) => {
  const playerId = c.get('playerId');
  const payload = await c.req.json();

  if (c.env.DATABASE) {
    await c.env.DATABASE.prepare(
      'INSERT INTO player_inventory (player_id, item_id, quantity, equipped) VALUES (?, ?, ?, ?)'
    ).bind(playerId, payload.item_id, payload.quantity || 1, payload.equipped || false).run();
  }

  return c.json({ success: true });
});

app.post('/api/player/move', authenticate, async (c) => {
  const playerId = c.get('playerId');
  const { location } = await c.req.json();

  if (c.env.DATABASE) {
    await c.env.DATABASE.prepare(
      'UPDATE players SET location = ? WHERE id = ?'
    ).bind(location, playerId).run();
  } else {
    const player = memoryPlayers.get(playerId);
    if (player) {
      player.location = location;
      memoryPlayers.set(playerId, player);
    }
  }

  return c.json({ success: true });
});

app.get('/api/player/messages', authenticate, async (c) => {
  const playerId = c.get('playerId');

  if (c.env.DATABASE) {
    const result = await c.env.DATABASE.prepare(
      'SELECT * FROM messages WHERE receiver_id = ? ORDER BY timestamp DESC'
    ).bind(playerId).all();
    return c.json(result.results || []);
  }

  const messages = memoryMessages.filter(m => m.receiver_id === playerId).sort((a, b) => b.timestamp - a.timestamp);
  return c.json(messages);
});

app.post('/api/player/messages', authenticate, async (c) => {
  const playerId = c.get('playerId');
  const { receiver_id, content } = await c.req.json();

  const now = Math.floor(Date.now() / 1000);

  if (c.env.DATABASE) {
    await c.env.DATABASE.prepare(
      'INSERT INTO messages (sender_id, receiver_id, content, timestamp) VALUES (?, ?, ?, ?)'
    ).bind(playerId, receiver_id, content, now).run();
  } else {
    memoryMessages.push({
      id: messageIdCounter++,
      sender_id: playerId,
      receiver_id,
      content,
      timestamp: now,
      read: false
    });
  }

  return c.json({ success: true });
});

app.get('/api/room/:roomId', authenticate, async (c) => {
  const roomId = c.req.param('roomId');

  if (c.env.DATABASE) {
    const result = await c.env.DATABASE.prepare(
      'SELECT * FROM rooms WHERE id = ?'
    ).bind(roomId).first();
    return c.json(result || {});
  }

  const rooms: Record<string, { id: string; name: string; description: string; is_public: boolean }> = {
    home: { id: 'home', name: 'Home', description: 'Your cozy home', is_public: true },
    town_square: { id: 'town_square', name: 'Town Square', description: 'The central square', is_public: true },
    market: { id: 'market', name: 'Market', description: 'The bustling market', is_public: true },
    forest: { id: 'forest', name: 'Forest', description: 'A dark forest', is_public: true },
    tavern: { id: 'tavern', name: 'Tavern', description: 'A lively tavern', is_public: true },
    school: { id: 'school', name: 'School', description: 'The local school', is_public: true }
  };

  return c.json(rooms[roomId] || {});
});

app.get('/api/room/:roomId/players', authenticate, async (c) => {
  const roomId = c.req.param('roomId');

  if (c.env.DATABASE) {
    const result = await c.env.DATABASE.prepare(
      'SELECT id, username, location FROM players WHERE location = ? AND is_online = TRUE'
    ).bind(roomId).all();
    return c.json(result.results || []);
  }

  const players = Array.from(memoryPlayers.values())
    .filter(p => p.location === roomId && p.is_online)
    .map(p => ({ id: p.id, username: p.username, location: p.location }));
  return c.json(players);
});

const defaultWorldState = {
  time: 6,
  day: 1,
  weather: 'sunny' as const,
  temperature: 25,
  events: [] as Array<{ id: string; type: string; message: string; timestamp: number; location?: string }>
};

app.get('/api/world', async (c) => {
  if (c.env.WORLD_STATE) {
    const worldStateStr = await c.env.WORLD_STATE.get('world_state');
    if (worldStateStr) {
      return c.json(JSON.parse(worldStateStr));
    }
  }
  return c.json(defaultWorldState);
});

app.get('/api/world/time', async (c) => {
  const world = await app.request('/api/world');
  const data = await world.json();
  return c.json({ time: data.time, day: data.day });
});

app.get('/api/world/weather', async (c) => {
  const world = await app.request('/api/world');
  const data = await world.json();
  return c.json({ weather: data.weather, temperature: data.temperature });
});

app.get('/api/world/events', async (c) => {
  const world = await app.request('/api/world');
  const data = await world.json();
  return c.json(data.events || []);
});

app.get('/api/online-players', authenticate, async (c) => {
  if (c.env.DATABASE) {
    const result = await c.env.DATABASE.prepare(
      'SELECT id, username, location FROM players WHERE is_online = TRUE'
    ).all();
    return c.json(result.results || []);
  }

  const players = Array.from(memoryPlayers.values())
    .filter(p => p.is_online)
    .map(p => ({ id: p.id, username: p.username, location: p.location }));
  return c.json(players);
});

app.get('/api/online-count', async (c) => {
  let count = 0;
  if (c.env.DATABASE) {
    const result = await c.env.DATABASE.prepare(
      'SELECT COUNT(*) as count FROM players WHERE is_online = TRUE'
    ).first();
    count = result?.count || 0;
  } else {
    count = Array.from(memoryPlayers.values()).filter(p => p.is_online).length;
  }
  return c.json({ count });
});

app.get('/api/health', (c) => {
  return c.json({ 
    status: 'ok', 
    timestamp: Date.now(),
    hasDatabase: !!c.env.DATABASE,
    hasKV: !!c.env.WORLD_STATE,
    hasDO: !!c.env.PLAYER_DO
  });
});

app.get('/ws/:playerId', async (c) => {
  if (!c.env.PLAYER_DO) {
    return c.json({ error: 'WebSocket not available' }, 503);
  }
  const playerId = c.req.param('playerId');
  const playerDO = c.env.PLAYER_DO.get(c.env.PLAYER_DO.idFromName(playerId));
  const response = await playerDO.fetch(new Request('http://localhost/ws', {
    headers: {
      ...c.req.headers,
      'Host': 'localhost'
    }
  }));
  return response;
});

export default app;

export { PlayerDO, RoomDO, WorldDO };