import { Hono } from 'hono';
import { cors } from 'hono/cors';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import type { Player, PlayerStats } from './types';
import { PlayerDO } from './durable-objects/PlayerDO';
import { RoomDO } from './durable-objects/RoomDO';
import { WorldDO } from './durable-objects/WorldDO';

type Bindings = {
  DATABASE: D1Database;
  WORLD_STATE: KVNamespace;
  PLAYER_DO: DurableObjectNamespace;
  ROOM_DO: DurableObjectNamespace;
  WORLD_DO: DurableObjectNamespace;
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

app.post('/api/auth/register', async (c) => {
  const { username, password, email } = await c.req.json();
  if (!username || !password) {
    return c.json({ error: 'Username and password required' }, 400);
  }
  const playerId = uuidv4();
  const passwordHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  const passwordHashBase64 = btoa(String.fromCharCode(...new Uint8Array(passwordHash)));
  try {
    await c.env.DATABASE.prepare(
      'INSERT INTO players (id, username, password_hash, email) VALUES (?, ?, ?, ?)'
    ).bind(playerId, username, passwordHashBase64, email).run();
    await c.env.DATABASE.prepare(
      'INSERT INTO player_stats (player_id) VALUES (?)'
    ).bind(playerId).run();
    const token = jwt.sign({ playerId }, c.env.JWT_SECRET, { expiresIn: '7d' });
    return c.json({ token, playerId, username });
  } catch (error) {
    return c.json({ error: 'Username already exists' }, 409);
  }
});

app.post('/api/auth/login', async (c) => {
  const { username, password } = await c.req.json();
  if (!username || !password) {
    return c.json({ error: 'Username and password required' }, 400);
  }
  const result = await c.env.DATABASE.prepare(
    'SELECT * FROM players WHERE username = ?'
  ).bind(username).first();
  if (!result) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }
  const passwordHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  const passwordHashBase64 = btoa(String.fromCharCode(...new Uint8Array(passwordHash)));
  if (result.password_hash !== passwordHashBase64) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }
  await c.env.DATABASE.prepare(
    'UPDATE players SET last_login = ? WHERE id = ?'
  ).bind(Math.floor(Date.now() / 1000), result.id).run();
  const token = jwt.sign({ playerId: result.id }, c.env.JWT_SECRET, { expiresIn: '7d' });
  return c.json({ token, playerId: result.id, username: result.username });
});

app.get('/api/player', authenticate, async (c) => {
  const playerId = c.get('playerId');
  const playerDO = c.env.PLAYER_DO.get(c.env.PLAYER_DO.idFromName(playerId));
  const response = await playerDO.fetch(new Request('http://localhost/'));
  return c.json(await response.json());
});

app.get('/api/player/stats', authenticate, async (c) => {
  const playerId = c.get('playerId');
  const playerDO = c.env.PLAYER_DO.get(c.env.PLAYER_DO.idFromName(playerId));
  const response = await playerDO.fetch(new Request('http://localhost/stats'));
  return c.json(await response.json());
});

app.post('/api/player/stats', authenticate, async (c) => {
  const playerId = c.get('playerId');
  const payload = await c.req.json();
  const playerDO = c.env.PLAYER_DO.get(c.env.PLAYER_DO.idFromName(playerId));
  await playerDO.fetch(new Request('http://localhost/stats', {
    method: 'POST',
    body: JSON.stringify(payload)
  }));
  return c.json({ success: true });
});

app.get('/api/player/inventory', authenticate, async (c) => {
  const playerId = c.get('playerId');
  const playerDO = c.env.PLAYER_DO.get(c.env.PLAYER_DO.idFromName(playerId));
  const response = await playerDO.fetch(new Request('http://localhost/inventory'));
  return c.json(await response.json());
});

app.post('/api/player/inventory', authenticate, async (c) => {
  const playerId = c.get('playerId');
  const payload = await c.req.json();
  const playerDO = c.env.PLAYER_DO.get(c.env.PLAYER_DO.idFromName(playerId));
  await playerDO.fetch(new Request('http://localhost/inventory', {
    method: 'POST',
    body: JSON.stringify(payload)
  }));
  return c.json({ success: true });
});

app.post('/api/player/move', authenticate, async (c) => {
  const playerId = c.get('playerId');
  const { location } = await c.req.json();
  const playerDO = c.env.PLAYER_DO.get(c.env.PLAYER_DO.idFromName(playerId));
  await playerDO.fetch(new Request('http://localhost/move', {
    method: 'POST',
    body: JSON.stringify({ location })
  }));
  return c.json({ success: true });
});

app.get('/api/player/messages', authenticate, async (c) => {
  const playerId = c.get('playerId');
  const playerDO = c.env.PLAYER_DO.get(c.env.PLAYER_DO.idFromName(playerId));
  const response = await playerDO.fetch(new Request('http://localhost/messages'));
  return c.json(await response.json());
});

app.post('/api/player/messages', authenticate, async (c) => {
  const playerId = c.get('playerId');
  const payload = await c.req.json();
  const playerDO = c.env.PLAYER_DO.get(c.env.PLAYER_DO.idFromName(playerId));
  await playerDO.fetch(new Request('http://localhost/messages', {
    method: 'POST',
    body: JSON.stringify(payload)
  }));
  return c.json({ success: true });
});

app.get('/api/room/:roomId', authenticate, async (c) => {
  const roomId = c.req.param('roomId');
  const roomDO = c.env.ROOM_DO.get(c.env.ROOM_DO.idFromName(roomId));
  const response = await roomDO.fetch(new Request('http://localhost/'));
  return c.json(await response.json());
});

app.get('/api/room/:roomId/players', authenticate, async (c) => {
  const roomId = c.req.param('roomId');
  const roomDO = c.env.ROOM_DO.get(c.env.ROOM_DO.idFromName(roomId));
  const response = await roomDO.fetch(new Request('http://localhost/players'));
  return c.json(await response.json());
});

app.get('/api/world', async (c) => {
  const worldDO = c.env.WORLD_DO.get(c.env.WORLD_DO.idFromName('world'));
  const response = await worldDO.fetch(new Request('http://localhost/'));
  return c.json(await response.json());
});

app.get('/api/world/time', async (c) => {
  const worldDO = c.env.WORLD_DO.get(c.env.WORLD_DO.idFromName('world'));
  const response = await worldDO.fetch(new Request('http://localhost/time'));
  return c.json(await response.json());
});

app.get('/api/world/weather', async (c) => {
  const worldDO = c.env.WORLD_DO.get(c.env.WORLD_DO.idFromName('world'));
  const response = await worldDO.fetch(new Request('http://localhost/weather'));
  return c.json(await response.json());
});

app.get('/api/world/events', async (c) => {
  const worldDO = c.env.WORLD_DO.get(c.env.WORLD_DO.idFromName('world'));
  const response = await worldDO.fetch(new Request('http://localhost/events'));
  return c.json(await response.json());
});

app.get('/api/online-players', authenticate, async (c) => {
  const result = await c.env.DATABASE.prepare(
    'SELECT id, username, location FROM players WHERE is_online = TRUE'
  ).all();
  return c.json(result.results);
});

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: Date.now() });
});

app.get('/ws/:playerId', async (c) => {
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