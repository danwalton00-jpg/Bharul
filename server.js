'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer, WebSocket } = require('ws');
const PORT = Number(process.env.PORT || 8080);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGIN || '').split(',').map(x => x.trim()).filter(Boolean);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const MAX_CONNECTIONS_PER_IP = Number(process.env.MAX_CONNECTIONS_PER_IP || 5);
const MAX_MESSAGES_PER_MINUTE = Number(process.env.MAX_MESSAGES_PER_MINUTE || 120);
const rooms = new Map();
const socketsByIp = new Map();
const iceServers = [{ urls: (process.env.STUN_URLS || 'stun:stun.l.google.com:19302').split(',').map(x => x.trim()).filter(Boolean) }];
if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
  iceServers.push({ urls: process.env.TURN_URL.split(',').map(x => x.trim()), username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
}
const originAllowed = (req) => {
  const origin = req.headers.origin;
  if (!origin) return false;
  if (ALLOWED_ORIGINS.length) return ALLOWED_ORIGINS.includes(origin);
  // Same-origin fallback supports a single Render service hosting both the PWA and signaling API.
  return origin === `https://${req.headers.host}`;
};
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon' };
const json = (res, status, body, extra = {}) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra });
  res.end(JSON.stringify(body));
};
const server = http.createServer((req, res) => {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' }, { allow: 'GET' });
  if (req.url === '/health') return json(res, 200, { ok: true, service: 'bharul-signaling' });
  if (req.url === '/ice-config') {
    if (!originAllowed(req)) return json(res, 403, { error: 'Origin not allowed' });
    return json(res, 200, { iceServers }, { 'access-control-allow-origin': req.headers.origin, vary: 'Origin' });
  }
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const requested = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  const file = path.resolve(__dirname, '.' + requested);
  if (!file.startsWith(path.resolve(__dirname) + path.sep)) return json(res, 400, { error: 'Invalid path' });
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return json(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', 'cache-control': path.basename(file) === 'index.html' || path.basename(file) === 'config.js' ? 'no-store' : 'public, max-age=3600' });
    fs.createReadStream(file).pipe(res);
  });
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024, perMessageDeflate: false });
server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin;
  if (!originAllowed(req)) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
  }
  const ip = req.socket.remoteAddress || 'unknown';
  const count = socketsByIp.get(ip) || 0;
  if (count >= MAX_CONNECTIONS_PER_IP) {
    socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
  }
  if (new URL(req.url, 'http://localhost').pathname !== '/signal') { socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => { ws.clientIp = ip; wss.emit('connection', ws, req); });
});
function send(ws, data) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }
function leave(ws) {
  const room = ws.room;
  if (!room) return;
  const peers = rooms.get(room);
  if (peers) {
    peers.delete(ws);
    for (const peer of peers) send(peer, { type: 'peer-left' });
    if (!peers.size) rooms.delete(room);
  }
  ws.room = null;
}
function closeWith(ws, code, reason) { try { ws.close(code, reason); } catch {} }
wss.on('connection', (ws) => {
  const ip = ws.clientIp;
  socketsByIp.set(ip, (socketsByIp.get(ip) || 0) + 1);
  ws.messageTimes = [];
  ws.on('message', raw => {
    const now = Date.now();
    ws.messageTimes = ws.messageTimes.filter(t => now - t < 60_000);
    if (ws.messageTimes.length >= MAX_MESSAGES_PER_MINUTE) return closeWith(ws, 1008, 'Rate limit exceeded');
    ws.messageTimes.push(now);
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return send(ws, { type: 'error', message: 'Invalid message' }); }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.type !== 'string') return send(ws, { type: 'error', message: 'Invalid message format' });
    if (msg.type === 'join') {
      const room = String(msg.room || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
      if (room.length < 6) return send(ws, { type: 'error', message: 'Room code must contain at least 6 valid characters' });
      if (ws.room && ws.room !== room) leave(ws);
      let peers = rooms.get(room);
      if (!peers) { peers = new Set(); rooms.set(room, peers); }
      if (peers.has(ws)) return;
      if (peers.size >= 2) return send(ws, { type: 'room-full' });
      ws.room = room; peers.add(ws);
      for (const peer of peers) if (peer !== ws) send(peer, { type: 'peer-joined' });
      send(ws, { type: 'joined', participants: peers.size });
      return;
    }
    if (msg.type === 'leave') { leave(ws); return; }
    if (!ws.room) return send(ws, { type: 'error', message: 'Join a room first' });
    const allowedSignalTypes = new Set(['offer', 'answer', 'ice-candidate']);
    if (!allowedSignalTypes.has(msg.type)) return send(ws, { type: 'error', message: 'Unsupported signaling message' });
    const peers = rooms.get(ws.room) || new Set();
    const payload = { type: msg.type };
    if (msg.type === 'offer' || msg.type === 'answer') {
      if (!msg.description || typeof msg.description !== 'object' || typeof msg.description.sdp !== 'string' || msg.description.sdp.length > 12_000) return send(ws, { type: 'error', message: 'Invalid session description' });
      payload.description = { type: msg.description.type, sdp: msg.description.sdp };
    } else {
      if (!msg.candidate || typeof msg.candidate !== 'object' || typeof msg.candidate.candidate !== 'string' || msg.candidate.candidate.length > 4_000) return send(ws, { type: 'error', message: 'Invalid ICE candidate' });
      payload.candidate = msg.candidate;
    }
    for (const peer of peers) if (peer !== ws) send(peer, payload);
  });
  ws.on('close', () => { leave(ws); const n = (socketsByIp.get(ip) || 1) - 1; if (n <= 0) socketsByIp.delete(ip); else socketsByIp.set(ip, n); });
  ws.on('error', () => leave(ws));
});
server.listen(PORT, '0.0.0.0', () => console.log(`Bharul web app and signaling listening on ${PORT}`));
