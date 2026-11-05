const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const rooms = new Map();

function publicRooms() {
  return [...rooms.values()]
    .filter(r => r.public)
    .map(r => ({ id: r.id, name: r.name, players: r.players.size, max: r.max }));
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url === '/health') { res.end('ok'); return; }
  if (req.url === '/api/rooms') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(publicRooms()));
    return;
  }
  res.statusCode = 404;
  res.end('not found');
});

const wss = new WebSocketServer({ server, path: '/ws' });

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg, exceptId) {
  for (const p of room.players.values()) {
    if (p.id !== exceptId) send(p.ws, msg);
  }
}

wss.on('connection', ws => {
  const me = { id: crypto.randomUUID(), ws, room: null, name: 'Chercheur', skin: null };

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.type === 'ping') { send(ws, { type: 'pong', t: m.t }); return; }

    if (m.type === 'list') { send(ws, { type: 'rooms', rooms: publicRooms() }); return; }

    if (m.type === 'create') {
      const id = crypto.randomUUID().slice(0, 8);
      const room = {
        id, name: String(m.name || 'Salle').slice(0, 30),
        public: !!m.public, password: m.password ? String(m.password) : null,
        max: Math.min(16, Math.max(2, Number(m.max) || 8)),
        players: new Map(),
      };
      rooms.set(id, room);
      send(ws, { type: 'created', id });
      return;
    }

    if (m.type === 'join') {
      const room = rooms.get(m.id);
      if (!room) return send(ws, { type: 'error', msg: 'Salle introuvable.' });
      if (room.password && room.password !== m.password) return send(ws, { type: 'error', msg: 'Mot de passe incorrect.' });
      if (room.players.size >= room.max) return send(ws, { type: 'error', msg: 'Salle pleine.' });
      me.name = String(m.name || 'Chercheur').slice(0, 20);
      me.skin = m.skin || null;
      me.room = room;
      room.players.set(me.id, me);
      send(ws, { type: 'joined', room: room.name, you: me.id,
        players: [...room.players.values()].filter(p => p.id !== me.id).map(p => ({ id: p.id, name: p.name, skin: p.skin })) });
      broadcast(room, { type: 'player_joined', id: me.id, name: me.name, skin: me.skin }, me.id);
      return;
    }

    if (m.type === 'state' && me.room) {
      broadcast(me.room, { type: 'state', id: me.id, x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: m.pitch, weapon: m.weapon }, me.id);
      return;
    }
  });

  ws.on('close', () => {
    if (!me.room) return;
    me.room.players.delete(me.id);
    broadcast(me.room, { type: 'player_left', id: me.id });
    if (me.room.players.size === 0) rooms.delete(me.room.id);
  });
});

server.listen(PORT, () => console.log('Serveur prêt sur le port ' + PORT));
