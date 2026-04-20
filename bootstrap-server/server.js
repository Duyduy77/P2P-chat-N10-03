/**
 * Bootstrap / tracker: chỉ phục vụ discovery + trạng thái online.
 * Chat thật không đi qua đây
 */
const http = require('http');

const PORT = Number(process.env.BOOTSTRAP_PORT || 3000);
/** Peer không gửi heartbeat sau bao lâu thì coi là offline (ms) */
const PEER_TTL_MS = Number(process.env.PEER_TTL_MS || 15000);
/** Định kỳ dọn peer hết hạn */
const SWEEP_MS = Number(process.env.SWEEP_MS || 3000);

/** @type {Map<string, { peerId: string, listenHost: string, listenPort: number, lastSeen: number }>} */
const peers = new Map();

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sweepStale() {
  const now = Date.now();
  for (const [id, p] of peers) {
    if (now - p.lastSeen > PEER_TTL_MS) peers.delete(id);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/peers') {
      sweepStale();
      const list = [...peers.values()].map((p) => ({
        peerId: p.peerId,
        address: `${p.listenHost}:${p.listenPort}`,
        listenHost: p.listenHost,
        listenPort: p.listenPort,
      }));
      return json(res, 200, { peers: list });
    }

    if (req.method === 'POST' && req.url === '/register') {
      const body = await readBody(req);
      const peerId = String(body.peerId || '').trim();
      const listenHost = String(body.listenHost || '127.0.0.1').trim();
      const listenPort = Number(body.listenPort);
      if (!peerId || !Number.isFinite(listenPort) || listenPort <= 0) {
        return json(res, 400, { error: 'peerId và listenPort (số dương) là bắt buộc' });
      }
      const now = Date.now();
      peers.set(peerId, { peerId, listenHost, listenPort, lastSeen: now });
      return json(res, 200, { ok: true, peerId });
    }

    if (req.method === 'POST' && req.url === '/heartbeat') {
      const body = await readBody(req);
      const peerId = String(body.peerId || '').trim();
      const p = peers.get(peerId);
      if (!p) return json(res, 404, { error: 'peer chưa đăng ký' });
      p.lastSeen = Date.now();
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && req.url === '/unregister') {
      const body = await readBody(req);
      const peerId = String(body.peerId || '').trim();
      if (!peerId) return json(res, 400, { error: 'peerId bắt buộc' });
      const ok = peers.delete(peerId);
      return json(res, 200, { ok, removed: ok });
    }

    return json(res, 404, { error: 'not found' });
  } catch (e) {
    return json(res, 400, { error: 'invalid json' });
  }
});

server.listen(PORT, () => {
  console.log(`[bootstrap] http://127.0.0.1:${PORT}`);
  console.log(
    `[bootstrap] GET /peers | POST /register | POST /heartbeat | POST /unregister (TTL ${PEER_TTL_MS}ms)`
  );
});

setInterval(sweepStale, SWEEP_MS);
