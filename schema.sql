CREATE TABLE IF NOT EXISTS conversaciones (
  telefono TEXT PRIMARY KEY,
  estado TEXT NOT NULL,
  vista TEXT NOT NULL,
  ultimo INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mensajes (
  id TEXT PRIMARY KEY,
  telefono TEXT NOT NULL,
  at INTEGER NOT NULL,
  quien TEXT NOT NULL,
  texto TEXT NOT NULL,
  medio TEXT
);

CREATE INDEX IF NOT EXISTS mensajes_por_telefono ON mensajes (telefono, at);
