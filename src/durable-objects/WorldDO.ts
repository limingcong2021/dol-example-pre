import { DurableObject } from 'cloudflare:workers';
import type { WorldState, WorldEvent } from '../types';

export class WorldDO extends DurableObject {
  private worldState: WorldState;
  private playerDO: DurableObjectNamespace;
  private roomDO: DurableObjectNamespace;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.playerDO = env.PLAYER_DO;
    this.roomDO = env.ROOM_DO;
    this.worldState = {
      time: 8,
      day: 1,
      weather: 'sunny',
      temperature: 20,
      events: []
    };
    this.startWorldLoop();
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
        return new Response(JSON.stringify(this.worldState), {
          headers: { 'Content-Type': 'application/json' }
        });
      case '/time':
        return new Response(JSON.stringify({
          time: this.worldState.time,
          day: this.worldState.day
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      case '/weather':
        return new Response(JSON.stringify({
          weather: this.worldState.weather,
          temperature: this.worldState.temperature
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      case '/events':
        return new Response(JSON.stringify(this.worldState.events), {
          headers: { 'Content-Type': 'application/json' }
        });
    }
    return new Response('Not Found', { status: 404 });
  }

  private async handlePost(path: string, payload: Record<string, unknown>): Promise<Response> {
    switch (path) {
      case '/update-time':
        await this.updateTime(payload.time as number);
        return new Response('OK');
      case '/update-weather':
        await this.updateWeather(payload.weather as WorldState['weather'], payload.temperature as number);
        return new Response('OK');
      case '/add-event':
        await this.addEvent(payload as WorldEvent);
        return new Response('OK');
    }
    return new Response('Not Found', { status: 404 });
  }

  async updateTime(time: number): Promise<void> {
    this.worldState.time = time;
    if (time >= 24) {
      this.worldState.time = 0;
      this.worldState.day += 1;
    }
    await this.broadcastWorldUpdate('time_update', {
      time: this.worldState.time,
      day: this.worldState.day
    });
  }

  async updateWeather(weather: WorldState['weather'], temperature: number): Promise<void> {
    this.worldState.weather = weather;
    this.worldState.temperature = temperature;
    await this.broadcastWorldUpdate('weather_update', {
      weather: this.worldState.weather,
      temperature: this.worldState.temperature
    });
  }

  async addEvent(event: WorldEvent): Promise<void> {
    const newEvent: WorldEvent = {
      id: event.id || crypto.randomUUID(),
      type: event.type,
      message: event.message,
      timestamp: event.timestamp || Date.now(),
      location: event.location
    };
    this.worldState.events.unshift(newEvent);
    if (this.worldState.events.length > 100) {
      this.worldState.events.pop();
    }
    await this.broadcastWorldUpdate('new_event', newEvent);
  }

  private async broadcastWorldUpdate(type: string, payload: Record<string, unknown>): Promise<void> {
    await this.roomDO.get(this.roomDO.idFromName('global')).fetch(new Request('http://localhost/broadcast', {
      method: 'POST',
      body: JSON.stringify({ type, payload })
    }));
  }

  private startWorldLoop(): void {
    this.state.storage.setAlarm(Date.now() + 60000);
    this.state.onAlarm.addListener(async () => {
      await this.updateTime(this.worldState.time + 1);
      if (Math.random() < 0.1) {
        const weathers: WorldState['weather'][] = ['sunny', 'rainy', 'cloudy', 'snowy'];
        const newWeather = weathers[Math.floor(Math.random() * weathers.length)];
        await this.updateWeather(newWeather, Math.floor(Math.random() * 20) + 10);
      }
      this.state.storage.setAlarm(Date.now() + 60000);
    });
  }
}