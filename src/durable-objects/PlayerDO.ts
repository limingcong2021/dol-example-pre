import { DurableObject } from 'cloudflare:workers';
import type { Player, PlayerStateUpdate } from '../types';

export class PlayerDO extends DurableObject {
  private player: Player | null = null;
  private ws: WebSocket | null = null;
  private db: D1Database;
  private roomDO: DurableObjectNamespace;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.db = env.DATABASE;
    this.roomDO = env.ROOM_DO;
    this.state.blockConcurrencyWhile(async () => {
      const playerId = this.state.id.name;
      const result = await this.db.prepare(
        'SELECT * FROM players WHERE id = ?'
      ).bind(playerId).first();
      if (result) {
        this.player = {
          ...result,
          state: typeof result.state === 'string' ? JSON.parse(result.state) : result.state
        };
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/ws') {
      return this.handleWebSocket(request);
    }

    if (request.method === 'GET') {
      return this.handleGet(path);
    }

    if (request.method === 'POST') {
      return this.handlePost(path, await request.json());
    }

    return new Response('Not Found', { status: 404 });
  }

  private async handleWebSocket(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const webSocketPair = new WebSocketPair();
    this.ws = webSocketPair[0];

    this.ws.onmessage = (event) => this.handleMessage(event.data);
    this.ws.onclose = () => this.handleDisconnect();
    this.ws.onerror = () => this.handleDisconnect();

    await this.setOnline(true);

    return new Response(null, {
      status: 101,
      webSocket: webSocketPair[1]
    });
  }

  private async handleMessage(data: string): Promise<void> {
    try {
      const message = JSON.parse(data);
      switch (message.type) {
        case 'state_update':
          await this.updateState(message.payload);
          break;
        case 'move':
          await this.move(message.payload.location);
          break;
        case 'send_message':
          await this.sendMessage(message.payload);
          break;
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  }

  private async handleDisconnect(): Promise<void> {
    this.ws = null;
    await this.setOnline(false);
  }

  private async setOnline(isOnline: boolean): Promise<void> {
    if (!this.player) return;
    this.player.is_online = isOnline;
    await this.db.prepare(
      'UPDATE players SET is_online = ? WHERE id = ?'
    ).bind(isOnline, this.player.id).run();
  }

  private async handleGet(path: string): Promise<Response> {
    switch (path) {
      case '/':
        return new Response(JSON.stringify(this.player), {
          headers: { 'Content-Type': 'application/json' }
        });
      case '/stats':
        const stats = await this.db.prepare(
          'SELECT * FROM player_stats WHERE player_id = ?'
        ).bind(this.state.id.name).first();
        return new Response(JSON.stringify(stats), {
          headers: { 'Content-Type': 'application/json' }
        });
      case '/inventory':
        const inventory = await this.db.prepare(
          'SELECT * FROM player_inventory WHERE player_id = ?'
        ).bind(this.state.id.name).all();
        return new Response(JSON.stringify(inventory.results), {
          headers: { 'Content-Type': 'application/json' }
        });
      case '/messages':
        const messages = await this.db.prepare(
          'SELECT * FROM messages WHERE receiver_id = ? ORDER BY timestamp DESC'
        ).bind(this.state.id.name).all();
        return new Response(JSON.stringify(messages.results), {
          headers: { 'Content-Type': 'application/json' }
        });
    }
    return new Response('Not Found', { status: 404 });
  }

  private async handlePost(path: string, payload: Record<string, unknown>): Promise<Response> {
    switch (path) {
      case '/state':
        await this.updateState(payload);
        return new Response('OK');
      case '/move':
        await this.move(payload.location as string);
        return new Response('OK');
      case '/stats':
        await this.updateStats(payload);
        return new Response('OK');
      case '/inventory':
        await this.updateInventory(payload);
        return new Response('OK');
      case '/messages':
        await this.sendMessage(payload);
        return new Response('OK');
    }
    return new Response('Not Found', { status: 404 });
  }

  async updateState(updates: Record<string, unknown>): Promise<void> {
    if (!this.player) return;
    this.player.state = { ...this.player.state, ...updates };
    await this.db.prepare(
      'UPDATE players SET state = ? WHERE id = ?'
    ).bind(JSON.stringify(this.player.state), this.player.id).run();
    this.broadcastStateUpdate(updates);
  }

  async move(location: string): Promise<void> {
    if (!this.player) return;
    const oldLocation = this.player.location;
    this.player.location = location;
    await this.db.prepare(
      'UPDATE players SET location = ? WHERE id = ?'
    ).bind(location, this.player.id).run();
    if (oldLocation) {
      const oldRoom = this.roomDO.get(this.roomDO.idFromName(oldLocation));
      await oldRoom.fetch(new Request('http://localhost/remove-player', {
        method: 'POST',
        body: JSON.stringify({ playerId: this.player!.id })
      }));
    }
    const newRoom = this.roomDO.get(this.roomDO.idFromName(location));
    await newRoom.fetch(new Request('http://localhost/add-player', {
      method: 'POST',
      body: JSON.stringify({ playerId: this.player!.id })
    }));
    this.broadcastStateUpdate({ location });
  }

  async updateStats(stats: Partial<Record<string, unknown>>): Promise<void> {
    const playerId = this.state.id.name;
    const setClause = Object.keys(stats).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(stats), playerId];
    await this.db.prepare(
      `UPDATE player_stats SET ${setClause} WHERE player_id = ?`
    ).bind(...values).run();
    this.broadcastStateUpdate({ stats });
  }

  async updateInventory(payload: Record<string, unknown>): Promise<void> {
    const playerId = this.state.id.name;
    const { item_id, quantity } = payload;
    const existing = await this.db.prepare(
      'SELECT * FROM player_inventory WHERE player_id = ? AND item_id = ?'
    ).bind(playerId, item_id).first();
    if (existing) {
      await this.db.prepare(
        'UPDATE player_inventory SET quantity = quantity + ? WHERE player_id = ? AND item_id = ?'
      ).bind(quantity, playerId, item_id).run();
    } else {
      await this.db.prepare(
        'INSERT INTO player_inventory (player_id, item_id, quantity) VALUES (?, ?, ?)'
      ).bind(playerId, item_id, quantity).run();
    }
    this.broadcastStateUpdate({ inventory: payload });
  }

  async sendMessage(payload: Record<string, unknown>): Promise<void> {
    const { receiver_id, content } = payload;
    const senderId = this.state.id.name;
    await this.db.prepare(
      'INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)'
    ).bind(senderId, receiver_id, content).run();
    const receiverDO = this.state.env.PLAYER_DO.get(
      this.state.env.PLAYER_DO.idFromName(receiver_id as string)
    );
    await receiverDO.fetch(new Request('http://localhost/deliver-message', {
      method: 'POST',
      body: JSON.stringify({ sender_id: senderId, content })
    }));
    this.broadcastStateUpdate({ message: { receiver_id, content } });
  }

  async deliverMessage(message: { sender_id: string; content: string }): Promise<void> {
    if (this.ws) {
      this.ws.send(JSON.stringify({
        type: 'new_message',
        payload: message
      }));
    }
  }

  private broadcastStateUpdate(updates: Record<string, unknown>): void {
    if (this.ws) {
      const update: PlayerStateUpdate = {
        playerId: this.state.id.name,
        updates,
        timestamp: Date.now()
      };
      this.ws.send(JSON.stringify({
        type: 'state_update',
        payload: update
      }));
    }
  }
}