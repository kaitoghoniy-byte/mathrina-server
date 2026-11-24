const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const app = express();
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || 'https://tubular-melomakarona-a577c6.netlify.app' }));
app.get('/', (_req, res) => res.json({ name: 'MATHRINA Multiplayer Server', status: 'online', maxPlayers: 35 }));
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: process.env.ALLOWED_ORIGIN || 'https://tubular-melomakarona-a577c6.netlify.app', methods: ['GET', 'POST'] }, transports: ['websocket', 'polling'] });
const rooms = new Map();
const MAX_PLAYERS = 35;
const makeCode = () => { const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)]; return s; };
const cleanName = v => String(v || 'Guest').replace(/[<>]/g, '').trim().slice(0, 16) || 'Guest';
const clamp = (v, a, b) => { v = Number(v); return Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : 0; };
const publicPlayer = p => ({ id: p.id, name: p.name, x: p.x, y: 0, z: p.z, score: p.score, missions: p.missions, keys: p.keys, finished: p.finished, hidden: !!p.hidden });
const snapshot = r => ({ code: r.code, mode: r.mode, hostId: r.hostId, started: r.started, players: [...r.players.values()].map(publicPlayer), shared: r.shared });
function leave(socket) {
  const code = socket.data.roomCode; if (!code) return;
  const r = rooms.get(code); socket.leave(code); socket.data.roomCode = null; if (!r) return;
  r.players.delete(socket.id);
  if (!r.players.size) rooms.delete(code);
  else { if (r.hostId === socket.id) r.hostId = r.players.keys().next().value; io.to(code).emit('room:update', snapshot(r)); }
}
function emitSnapshot(r) { io.to(r.code).emit('room:update', snapshot(r)); }
io.on('connection', socket => {
  socket.on('room:create', ({ name, mode }, reply = () => {}) => {
    if (!['coop', 'race'].includes(mode)) return reply({ ok: false, error: 'Mode tidak valid.' });
    leave(socket); let code; do { code = makeCode(); } while (rooms.has(code));
    const p = { id: socket.id, name: cleanName(name), x: 0, y: 0, z: 3, score: 0, missions: 0, keys: 0, finished: false };
    const r = { code, mode, hostId: socket.id, started: false, players: new Map([[socket.id, p]]), shared: { tasks: [], keys: [], batteries: [], artifact: false, ghosts: [] } };
    rooms.set(code, r); socket.join(code); socket.data.roomCode = code;
    reply({ ok: true, room: snapshot(r), isHost: true }); emitSnapshot(r);
  });
  socket.on('room:join', ({ code, name }, reply = () => {}) => {
    code = String(code || '').trim().toUpperCase(); const r = rooms.get(code);
    if (!r) return reply({ ok: false, error: 'Room tidak ditemukan.' });
    if (r.started) return reply({ ok: false, error: 'Permainan sudah dimulai. Buat room baru untuk bergabung.' });
    if (r.players.size >= MAX_PLAYERS) return reply({ ok: false, error: 'Room penuh (maksimal 35 pemain).' });
    leave(socket);
    r.players.set(socket.id, { id: socket.id, name: cleanName(name), x: 0, y: 0, z: 3, score: 0, missions: 0, keys: 0, finished: false });
    socket.join(code); socket.data.roomCode = code;
    reply({ ok: true, room: snapshot(r), isHost: false }); emitSnapshot(r);
  });
  socket.on('room:set-mode', ({ mode }, reply = () => {}) => {
    const r = rooms.get(socket.data.roomCode);
    if (!r || r.hostId !== socket.id) return reply({ ok: false, error: 'Hanya host yang dapat memilih mode.' });
    if (r.started || !['coop', 'race'].includes(mode)) return reply({ ok: false, error: 'Mode tidak dapat diubah.' });
    r.mode = mode; emitSnapshot(r); reply({ ok: true, room: snapshot(r) });
  });
  socket.on('room:start', (_data, reply = () => {}) => {
    const r = rooms.get(socket.data.roomCode);
    if (!r || r.hostId !== socket.id) return reply({ ok: false, error: 'Hanya host yang dapat memulai room.' });
    if (r.started) return reply({ ok: false, error: 'Permainan sudah dimulai.' });
    r.started = true; for (const p of r.players.values()) { p.score = 0; p.missions = 0; p.keys = 0; p.finished = false; }
    r.shared = { tasks: [], keys: [], batteries: [], artifact: false, ghosts: [] };
    io.to(r.code).emit('game:start', { code: r.code, mode: r.mode }); emitSnapshot(r); reply({ ok: true });
  });
  socket.on('player:move', pos => {
    const r = rooms.get(socket.data.roomCode); if (!r || !r.players.has(socket.id)) return;
    const p = r.players.get(socket.id); p.x = clamp(pos?.x, -33, 33); p.y = 0; p.z = clamp(pos?.z, -27, 27); p.hidden = !!pos?.hidden;
    socket.to(r.code).emit('player:moved', { id: socket.id, name: p.name, x: p.x, y: 0, z: p.z, hidden: p.hidden });
  });
  socket.on('room:event', (event, reply = () => {}) => {
    const r = rooms.get(socket.data.roomCode); if (!r || !r.started || !r.players.has(socket.id)) return reply({ ok: false, error: 'Sesi tidak aktif.' });
    const p = r.players.get(socket.id); const type = String(event?.type || ''); const index = Math.floor(Number(event?.index));
    if (type === 'task' && index >= 0 && index < 7) {
      if (r.mode === 'coop') { if (!r.shared.tasks.includes(index)) { r.shared.tasks.push(index); for (const pl of r.players.values()) { pl.missions = r.shared.tasks.length; pl.score += 100; } } }
      else if (!p._tasks?.includes(index)) { p._tasks ||= []; p._tasks.push(index); p.missions = p._tasks.length; p.score += 100; }
    } else if (type === 'key' && index >= 0 && index < 2) {
      if (r.mode === 'coop') { if (!r.shared.keys.includes(index)) { r.shared.keys.push(index); for (const pl of r.players.values()) { pl.keys = r.shared.keys.length; pl.score += 50; } } }
      else if (!p._keys?.includes(index)) { p._keys ||= []; p._keys.push(index); p.keys = p._keys.length; p.score += 50; }
    } else if (type === 'battery' && index >= 0 && index < 4) {
      if (r.mode === 'coop') { if (!r.shared.batteries.includes(index)) { r.shared.batteries.push(index); for (const pl of r.players.values()) pl.score += 25; } }
      else if (!p._batteries?.includes(index)) { p._batteries ||= []; p._batteries.push(index); p.score += 25; }
    } else if (type === 'artifact') {
      if (r.mode === 'coop') { if (!r.shared.artifact) { r.shared.artifact = true; for (const pl of r.players.values()) pl.score += 200; } }
      else if (!p._artifact) { p._artifact = true; p.score += 200; }
    } else if (type === 'caught' && socket.id === r.hostId) { if (!r.players.has(String(event?.targetId || ''))) return reply({ ok: false, error: 'Target tidak ditemukan.' }); }
    else if (type === 'finish') { p.finished = true; }
    else return reply({ ok: false, error: 'Event tidak dikenal.' });
    io.to(r.code).emit('room:event', { type, index, win: !!event?.win, targetId: String(event?.targetId || ''), actorId: socket.id, mode: r.mode, shared: r.shared, players: [...r.players.values()].map(publicPlayer) });
    emitSnapshot(r); reply({ ok: true });
  });
  socket.on('game:ghosts', ghosts => {
    const r = rooms.get(socket.data.roomCode); if (!r || !r.started || r.hostId !== socket.id || !Array.isArray(ghosts)) return;
    r.shared.ghosts = ghosts.slice(0, 4).map(g => ({ x: clamp(g?.x, -33, 33), z: clamp(g?.z, -27, 27), state: String(g?.state || 'PATROL').slice(0, 12) }));
    socket.to(r.code).emit('game:ghosts', r.shared.ghosts);
  });
  socket.on('room:leave', () => leave(socket));
  socket.on('disconnect', () => leave(socket));
});
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, '0.0.0.0', () => console.log('MATHRINA server listening on ' + PORT));
