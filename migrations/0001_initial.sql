CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    email TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    last_login INTEGER,
    is_online BOOLEAN NOT NULL DEFAULT FALSE,
    location TEXT NOT NULL DEFAULT 'home'
);

CREATE TABLE IF NOT EXISTS player_stats (
    player_id TEXT PRIMARY KEY REFERENCES players(id),
    strength INTEGER NOT NULL DEFAULT 10,
    dexterity INTEGER NOT NULL DEFAULT 10,
    intelligence INTEGER NOT NULL DEFAULT 10,
    charisma INTEGER NOT NULL DEFAULT 10,
    stamina INTEGER NOT NULL DEFAULT 10,
    level INTEGER NOT NULL DEFAULT 1,
    experience INTEGER NOT NULL DEFAULT 0,
    health INTEGER NOT NULL DEFAULT 100,
    max_health INTEGER NOT NULL DEFAULT 100,
    lust INTEGER NOT NULL DEFAULT 0,
    max_lust INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS player_inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL REFERENCES players(id),
    item_id TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    equipped BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id TEXT NOT NULL REFERENCES players(id),
    receiver_id TEXT NOT NULL REFERENCES players(id),
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    read BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    is_public BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS world_events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    location TEXT
);

INSERT OR IGNORE INTO rooms (id, name, description, is_public) VALUES
('home', 'Home', 'Your cozy home', TRUE),
('town_square', 'Town Square', 'The central square of the town', TRUE),
('market', 'Market', 'The bustling market', TRUE),
('forest', 'Forest', 'A dark forest on the edge of town', TRUE),
('tavern', 'Tavern', 'A lively tavern', TRUE),
('school', 'School', 'The local school', TRUE);

CREATE INDEX IF NOT EXISTS idx_players_username ON players(username);
CREATE INDEX IF NOT EXISTS idx_players_is_online ON players(is_online);
CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id);
CREATE INDEX IF NOT EXISTS idx_player_inventory_player ON player_inventory(player_id);