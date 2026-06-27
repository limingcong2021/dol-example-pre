import { DurableObject } from 'cloudflare:workers';
import type { Room } from '../types';

export class RoomDO extends DurableObject {
  private room: Room | null = null;
  private players: Set<string> = new Set();
  private playerDO: DurableObjectNamespace;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.playerDO = env.PLAYER_DO;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'GET') {
      return this.handleGet(path);
    }

    if (request.method === 'POST') {
      return this.handlePost(path, await request.json());
    }

    return new Response('Not Found', { status: 404 });
  }

  private async handleGet(path: string): Promise<Response> {
    switch (path) {
      case '/':
        return new Response(JSON.stringify({
          room: this.room,
          players: Array.from(this.players)
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      case '/players':
        return new Response(JSON.stringify({
          playerIds: Array.from(this.players),
          count: this.players.size
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
    }
    return new Response('Not Found', { status: 404 });
  }

  private async handlePost(path: string, payload: Record<string, unknown>): Promise<Response> {
    switch (path) {
      case '/add-player':
        await this.addPlayer(payload.playerId as string);
        return new Response('OK');
      case '/remove-player':
        await this.removePlayer(payload.playerId as string);
        return new Response('OK');
      case '/broadcast':
        await this.broadcast(payload);
        return new Response('OK');
    }
    return new Response('Not Found', { status: 404 });
  }

  async addPlayer(playerId: string): Promise<void> {
    this.players.add(playerId);
    await this.notifyPlayers('player_joined', { playerId });
  }

  async removePlayer(playerId: string): Promise<void> {
    this.players.delete(playerId);
    await this.notifyPlayers('player_left', { playerId });
  }

  async broadcast(message: Record<string, unknown>): Promise<void> {
    await this.notifyPlayers('room_broadcast', message);
  }

  private async notifyPlayers(type: string, payload: Record<string, unknown>): Promise<void> {
    for (const playerId of this.players) {
      const player = this.playerDO.get(this.playerDO.idFromName(playerId));
      await player.fetch(new Request('http://localhost/notify', {
        method: 'POST',
        body: JSON.stringify({ type, payload })
      }));
    }
  }
}