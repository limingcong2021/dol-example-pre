export interface Player {
  id: string;
  username: string;
  email?: string;
  created_at: number;
  last_login: number;
  is_online: boolean;
  location: string;
  state: Record<string, unknown>;
}

export interface PlayerStats {
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

export interface InventoryItem {
  id: number;
  player_id: string;
  item_id: string;
  quantity: number;
  equipped: boolean;
}

export interface Message {
  id: number;
  sender_id: string;
  receiver_id: string;
  content: string;
  timestamp: number;
  read: boolean;
}

export interface Room {
  id: string;
  name: string;
  description?: string;
  is_public: boolean;
}

export interface WorldState {
  time: number;
  day: number;
  weather: 'sunny' | 'rainy' | 'cloudy' | 'snowy';
  temperature: number;
  events: WorldEvent[];
}

export interface WorldEvent {
  id: string;
  type: string;
  message: string;
  timestamp: number;
  location?: string;
}

export interface WebSocketMessage {
  type: string;
  payload?: Record<string, unknown>;
}

export interface PlayerStateUpdate {
  playerId: string;
  updates: Record<string, unknown>;
  timestamp: number;
}