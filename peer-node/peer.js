/**
 * Peer node: TCP P2P + bootstrap + gossip (PEER_ANNOUNCE) + ACK/retry + nhóm + SQLite.
 *
 * Đối chiếu đề:
 * - Tham gia mạng: đăng ký bootstrap và/hoặc `join host port` (peer đã biết) + PEER_ANNOUNCE
 * - Chat 1-1 / nhóm: CHAT + fan-out nhóm
 * - Discovery: GET /peers + lan truyền địa chỉ qua PEER_ANNOUNCE
 * - Online/offline: heartbeat + TTL tracker; unregister khi thoát
 * - Tin cậy: msgId + ACK + retry; RELAY một chặng + RELAY_ACK; đứt socket outbound → hủy pending
 * - Online (3.5): tập `trackerOnlineIds` + lệnh `online` (tách khỏi gossip)
 *
 * NO_BOOTSTRAP=1 — không tự đăng ký tracker (demo “chỉ biết một peer”), dùng `sync` để lên tracker sau.
 */
const net = require('net');
const http = require('http');
const readline = require('readline');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const { encodeLine, createLineParser, newMsgId } = require('./protocol');
const { openStore } = require('./store');
const { sealChatPayload, openChatPayload } = require('./crypto-msg');
const { startWebDashboard } = require('./web-dashboard');

const PEER_ID = process.env.PEER_ID || `peer-${process.pid}`;
const LISTEN_HOST = process.env.LISTEN_HOST || '127.0.0.1';
const LISTEN_PORT = Number(process.env.LISTEN_PORT || 4001);
const BOOTSTRAP_URL = process.env.BOOTSTRAP_URL || 'http://127.0.0.1:3000';
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS || 5000);
const ACK_TIMEOUT_MS = Number(process.env.ACK_TIMEOUT_MS || 3000);
const MAX_RETRIES = Number(process.env.MAX_RETRIES || 3);
const NO_BOOTSTRAP = process.env.NO_BOOTSTRAP === '1' || process.env.NO_BOOTSTRAP === 'true';
const WEB_PORT = Number(process.env.WEB_PORT || 0);
const BCAST_DEFAULT_TTL = Number(process.env.BCAST_TTL || 3);
const OUTBOX_FLUSH_MS = Number(process.env.OUTBOX_FLUSH_MS || 8000);
const FILE_CHUNK_BYTES = Number(process.env.FILE_CHUNK_BYTES || 16384);

/** Bootstrap + gossip: peerId -> địa chỉ TCP */
const peerDirectory = new Map();
const groups = new Map();

/** Theo đề 3.5: peer “online” trên tracker (không trộn với peer chỉ có trong gossip). */
let trackerOnlineIds = /** @type {Set<string>} */ (new Set());

/**
 * Trung gian chuyển tiếp (đề: “chuyển tiếp tin nhắn cho các peer khác”) — một chặng.
 * Khi nhận ACK từ peer đích, trung gian gửi RELAY_ACK về người gốc.
 */
const relayHop = new Map();

const pendingAck = new Map();
const seenMsgIds = new Set();

/** @type {Awaited<ReturnType<typeof openStore>>|null} */
let store = null;

/** Outbound: "host:port" -> { socket, ready, queue } */
const outbound = new Map();

/** Inbound socket -> mô tả (quản lý kết nối — yêu cầu kỹ thuật đề) */
const inboundSockets = new Map();

let heartbeatTimer = null;
let fetchTimer = null;
let outboxTimer = null;
/** Dedup broadcast */
const seenBcastIds = new Set();
/** Gần đây cho web UI */
const recentEvents = /** @type {{ t: number, line: string }[]} */ ([]);
/** Nhận file: fileId -> trạng thái */
const fileReceive = new Map();

function httpRequest(method, urlString, jsonBody) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlString);
    const body = jsonBody != null ? JSON.stringify(jsonBody) : null;
    const opts = {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: `${u.pathname}${u.search}`,
      method,
      headers: body
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        : {},
    };
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({ status: res.statusCode || 0, body: raw ? JSON.parse(raw) : null });
        } catch {
          resolve({ status: res.statusCode || 0, body: raw });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function mergePeerRecord(p) {
  if (!p || !p.peerId || p.peerId === PEER_ID) return;
  const listenHost = String(p.listenHost || '127.0.0.1').trim();
  const listenPort = Number(p.listenPort);
  if (!Number.isFinite(listenPort) || listenPort <= 0) return;

  const key = p.peerId;
  const exists = peerDirectory.has(key);

  peerDirectory.set(p.peerId, {
    peerId: p.peerId,
    listenHost,
    listenPort,
    address: `${listenHost}:${listenPort}`,
  });

  if (!exists) {
    const line = `[Hệ thống] Đã phát hiện peer mới: ${p.peerId} (${listenHost}:${listenPort})`;
    console.log(line);
    pushRecent(line);
  }
}

/** Gossip: không gửi cả mạng — giới hạn để tránh gói quá lớn */
function buildPeerAnnounceMsg() {
  const peers = [{ peerId: PEER_ID, listenHost: LISTEN_HOST, listenPort: LISTEN_PORT }];
  const cap = 48;
  for (const [, v] of peerDirectory) {
    if (peers.length >= cap) break;
    if (v.peerId === PEER_ID) continue;
    peers.push({
      peerId: v.peerId,
      listenHost: v.listenHost,
      listenPort: v.listenPort,
    });
  }
  return { type: 'PEER_ANNOUNCE', from: PEER_ID, peers };
}

function applyPeerAnnounce(msg) {
  if (!msg || msg.type !== 'PEER_ANNOUNCE' || !Array.isArray(msg.peers)) return;
  for (const p of msg.peers) mergePeerRecord(p);
  console.log(
    `[peer] PEER_ANNOUNCE từ ${msg.from || '?'} — gói ${msg.peers.length} peer (đã merge vào cache)`
  );
}

async function registerWithBootstrap() {
  const r = await httpRequest('POST', `${BOOTSTRAP_URL}/register`, {
    peerId: PEER_ID,
    listenHost: LISTEN_HOST,
    listenPort: LISTEN_PORT,
  });
  if (r.status !== 200 || !r.body || r.body.error) {
    throw new Error(`register failed: ${r.status} ${JSON.stringify(r.body)}`);
  }
  console.log('[peer] đã đăng ký với bootstrap:', PEER_ID);
}

async function unregisterFromBootstrap() {
  try {
    await httpRequest('POST', `${BOOTSTRAP_URL}/unregister`, { peerId: PEER_ID });
  } catch {
    /* ignore */
  }
}

async function sendHeartbeat() {
  try {
    const r = await httpRequest('POST', `${BOOTSTRAP_URL}/heartbeat`, { peerId: PEER_ID });
    if (r.status !== 200) console.warn('[peer] heartbeat lỗi:', r.status, r.body);
  } catch (e) {
    console.warn('[peer] không gửi được heartbeat:', e.message);
  }
}

/**
 * Merge từ tracker — không xóa peer học qua gossip (tự phản biện: clear() trước đây làm mất discovery).
 */
async function fetchPeers() {
  const r = await httpRequest('GET', `${BOOTSTRAP_URL}/peers`);
  if (r.status !== 200 || !r.body || !Array.isArray(r.body.peers)) {
    console.warn('[peer] lấy danh sách peer thất bại:', r.status, r.body);
    return;
  }
  const newOnlineIds = new Set(r.body.peers.map((p) => p.peerId));

  // Phát hiện peer rời mạng (offline)
  for (const oldId of trackerOnlineIds) {
    if (oldId !== PEER_ID && !newOnlineIds.has(oldId)) {
      const line = `[Hệ thống] Peer rời mạng (offline): ${oldId}`;
      console.log(line);
      pushRecent(line);
    }
  }

  // Phát hiện peer mới online
  for (const newId of newOnlineIds) {
    if (newId !== PEER_ID && !trackerOnlineIds.has(newId)) {
      const line = `[Hệ thống] Peer tham gia mạng (online): ${newId}`;
      console.log(line);
      pushRecent(line);
    }
  }

  trackerOnlineIds = newOnlineIds;

  for (const p of r.body.peers) {
    mergePeerRecord({
      peerId: p.peerId,
      listenHost: p.listenHost,
      listenPort: p.listenPort,
    });
  }
  const others = [...peerDirectory.values()].filter((p) => p.peerId !== PEER_ID);
  console.log('[peer] danh sách peer (cache):', others.map((p) => `${p.peerId}@${p.address}`).join(', ') || '(chỉ có mình)');
  void flushOutboxOnce().catch(() => {});
}

function startTrackerLoops() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (fetchTimer) clearInterval(fetchTimer);
  heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_MS);
  fetchTimer = setInterval(fetchPeers, HEARTBEAT_MS * 3);
}

function rememberSeen(msgId) {
  if (!msgId) return false;
  if (seenMsgIds.has(msgId)) return true;
  seenMsgIds.add(msgId);
  if (seenMsgIds.size > 5000) seenMsgIds.clear();
  return false;
}

function failPendingForHostPort(hostPortKey) {
  for (const [msgId, pend] of pendingAck) {
    if (pend.hostPortKey === hostPortKey) {
      if (pend.timer) clearTimeout(pend.timer);
      pendingAck.delete(msgId);
      if (pend.reject) pend.reject(new Error('mất kết nối TCP tới ' + hostPortKey));
    }
  }
}

function pushRecent(line) {
  const last = recentEvents[recentEvents.length - 1];
  if (last && last.line === String(line) && (Date.now() - last.t < 3000)) {
    return; // Skip duplicate successive logs (like duplicate group ACKs)
  }
  recentEvents.push({ t: Date.now(), line: String(line) });
  if (recentEvents.length > 100) recentEvents.shift();
}

function rememberBcastId(id) {
  if (!id) return true;
  if (seenBcastIds.has(id)) return true;
  seenBcastIds.add(id);
  if (seenBcastIds.size > 4000) seenBcastIds.clear();
  return false;
}

function getWebSnapshot() {
  return {
    peerId: PEER_ID,
    listen: `${LISTEN_HOST}:${LISTEN_PORT}`,
    bootstrap: BOOTSTRAP_URL,
    peers: [...peerDirectory.values()].map((p) => ({ id: p.peerId, address: p.address })),
    trackerOnline: [...trackerOnlineIds].filter((x) => x !== PEER_ID),
    groups: [...groups.entries()].map(([k, v]) => ({ id: k, members: [...v] })),
    recent: recentEvents.slice(-40),
  };
}

/**
 * Giao CHAT vào ứng dụng (1-1 hoặc nhóm) — luôn trả ACK tầng ứng dụng cho đúng đề 3.6.
 * @param {import('net').Socket} socket
 * @param {object} chat
 */
function deliverInboundChat(socket, chat) {
  if (!chat || chat.type !== 'CHAT' || !chat.msgId) return;

  // Auto-learn group membership from incoming group message
  if (chat.groupId && Array.isArray(chat.groupMembers)) {
    groups.set(chat.groupId, new Set(chat.groupMembers));
  }

  const dup = rememberSeen(chat.msgId);
  socket.write(
    encodeLine({ type: 'ACK', msgId: chat.msgId, from: PEER_ID, ts: Date.now() })
  );
  if (dup) return;

  const plain = openChatPayload(chat.text);
  const g = chat.groupId ? `[nhóm ${chat.groupId}] ` : '';
  const line = `${g}CHAT từ ${chat.from}: ${plain}`;
  console.log(`[peer] ${line}`);
  pushRecent(line);
  if (store) {
    void store
      .log('in', {
        remotePeer: chat.from,
        msgId: chat.msgId,
        groupId: chat.groupId || null,
        content: plain,
      })
      .catch((e) => console.warn('[peer] sqlite (in):', e.message));
  }
}

function processBCAST(socket, msg) {
  if (!msg.bcastId || msg.text == null) return;
  if (rememberBcastId(msg.bcastId)) return;
  const line = `[BCAST ttl=${msg.ttl}] ${msg.from}: ${msg.text}`;
  console.log(`[peer] ${line}`);
  pushRecent(line);
  if (msg.ttl > 0) {
    const fwd = {
      type: 'BCAST',
      bcastId: msg.bcastId,
      from: msg.from,
      text: msg.text,
      ttl: msg.ttl - 1,
      ts: Date.now(),
    };
    for (const [, v] of peerDirectory) {
      if (v.peerId === PEER_ID) continue;
      if (msg.from && v.peerId === msg.from) continue;
      writeToPeer(v.listenHost, v.listenPort, encodeLine(fwd));
    }
  }
}

function processFileBegin(msg) {
  if (!msg.fileId || !msg.name || !msg.totalChunks) return;
  fileReceive.set(msg.fileId, {
    name: msg.name,
    total: msg.totalChunks,
    from: msg.from,
    chunks: /** @type {Buffer[]} */ ([]),
  });
  console.log(`[peer] FILE bắt đầu: ${msg.name} (${msg.totalChunks} phần) từ ${msg.from}`);
}

function processFilePart(msg) {
  const st = fileReceive.get(msg.fileId);
  if (!st || !msg.data) return;
  const buf = Buffer.from(msg.data, 'base64');
  st.chunks[msg.seq] = buf;
}

function processFileEnd(msg) {
  const st = fileReceive.get(msg.fileId);
  if (!st) return;
  fileReceive.delete(msg.fileId);
  const out = Buffer.concat(st.chunks.filter(Boolean));
  const dir = path.join(__dirname, 'received');
  fs.mkdirSync(dir, { recursive: true });
  const safe = st.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const fp = path.join(dir, `${Date.now()}_${safe}`);
  fs.writeFileSync(fp, out);
  const line = `Đã nhận file "${st.name}" từ ${st.from} → ${fp} (${out.length} byte)`;
  console.log('[peer]', line);
  pushRecent(line);
}

/**
 * RELAY một chặng: peer trung gian gửi tiếp CHAT tới targetPeerId; ACK từ đích → RELAY_ACK về nguồn.
 * @param {import('net').Socket} replySocket socket về phía người gửi RELAY
 * @param {object} msg
 */
function processRelay(replySocket, msg) {
  const targetPeerId = msg.targetPeerId;
  const chat = msg.chat;
  if (!targetPeerId || !chat || chat.type !== 'CHAT') return;

  if (targetPeerId === PEER_ID) {
    deliverInboundChat(replySocket, chat);
    return;
  }

  let addr = resolvePeer(targetPeerId);
  if (!addr && !NO_BOOTSTRAP) {
    void fetchPeers().then(() => {
      addr = resolvePeer(targetPeerId);
      if (!addr) {
        console.warn('[peer] RELAY: không có địa chỉ', targetPeerId);
        return;
      }
      relayHop.set(chat.msgId, { replySocket });
      writeToPeer(addr.host, addr.port, encodeLine(chat));
    });
    return;
  }
  if (!addr) {
    console.warn('[peer] RELAY: không có địa chỉ', targetPeerId);
    return;
  }

  relayHop.set(chat.msgId, { replySocket });
  writeToPeer(addr.host, addr.port, encodeLine(chat));
}

function handleInboundMessage(socket, msg) {
  if (msg.type === 'NOP') return;

  if (msg.type === 'HELLO' && msg.peerId) {
    socket.remotePeerId = msg.peerId;
    const meta = inboundSockets.get(socket);
    if (meta) meta.peerId = msg.peerId;
    return;
  }

  if (msg.type === 'PEER_ANNOUNCE') {
    applyPeerAnnounce(msg);
    return;
  }

  if (msg.type === 'ACK' && msg.msgId) {
    const pend = pendingAck.get(msg.msgId);
    if (pend && pend.onAck && !pend.waitRelayAck) pend.onAck();
    return;
  }

  if (msg.type === 'BCAST') {
    processBCAST(socket, msg);
    return;
  }
  if (msg.type === 'FILE_BEGIN') {
    processFileBegin(msg);
    return;
  }
  if (msg.type === 'FILE_PART') {
    processFilePart(msg);
    return;
  }
  if (msg.type === 'FILE_END') {
    processFileEnd(msg);
    return;
  }

  if (msg.type === 'RELAY' && msg.chat) {
    processRelay(socket, msg);
    return;
  }

  if (msg.type === 'CHAT' && msg.from && msg.text != null && msg.msgId) {
    deliverInboundChat(socket, msg);
    return;
  }

  console.log('[peer] tin không rõ:', msg);
}

function handleOutboundMessage(msg) {
  if (msg.type === 'NOP') return;

  if (msg.type === 'HELLO' && msg.peerId) {
    return;
  }
  if (msg.type === 'PEER_ANNOUNCE') {
    applyPeerAnnounce(msg);
    return;
  }
  if (msg.type === 'BCAST') {
    processBCAST(null, msg);
    return;
  }
  if (msg.type === 'FILE_BEGIN') {
    processFileBegin(msg);
    return;
  }
  if (msg.type === 'FILE_PART') {
    processFilePart(msg);
    return;
  }
  if (msg.type === 'FILE_END') {
    processFileEnd(msg);
    return;
  }
  if (msg.type === 'ACK' && msg.msgId) {
    const pend = pendingAck.get(msg.msgId);
    if (pend && pend.onAck && !pend.waitRelayAck) {
      pend.onAck();
      return;
    }
    const hop = relayHop.get(msg.msgId);
    if (hop && hop.replySocket && !hop.replySocket.destroyed) {
      relayHop.delete(msg.msgId);
      hop.replySocket.write(
        encodeLine({
          type: 'RELAY_ACK',
          msgId: msg.msgId,
          from: PEER_ID,
          ts: Date.now(),
        })
      );
    }
    return;
  }

  if (msg.type === 'RELAY_ACK' && msg.msgId) {
    const pend = pendingAck.get(msg.msgId);
    if (pend && pend.waitRelayAck && pend.onAck) pend.onAck();
    return;
  }

  if (msg.type === 'CHAT' && msg.from && msg.msgId) {
    const dup = rememberSeen(msg.msgId);
    const g = msg.groupId ? `[nhóm ${msg.groupId}] ` : '';
    if (!dup) {
      const plain = openChatPayload(msg.text);
      const line = `${g}(kênh outbound) CHAT từ ${msg.from}: ${plain}`;
      console.log(`[peer] ${line}`);
      pushRecent(line);
      if (store) {
        void store
          .log('in', {
            remotePeer: msg.from,
            msgId: msg.msgId,
            groupId: msg.groupId || null,
            content: plain,
          })
          .catch((e) => console.warn('[peer] sqlite (in):', e.message));
      }
    }
    return;
  }
}

function makeInboundParser(socket) {
  return createLineParser((msg) => handleInboundMessage(socket, msg));
}

/**
 * Mở / tái sử dụng outbound; sau connect gửi HELLO + PEER_ANNOUNCE rồi flush hàng đợi.
 */
function writeToPeer(host, port, buf) {
  const key = `${host}:${port}`;
  let o = outbound.get(key);
  if (!o) {
    o = {
      socket: null,
      ready: false,
      queue: /** @type {Buffer[]} */ ([]),
    };
    const sock = net.createConnection({ host, port }, () => {
      o.ready = true;
      sock.write(encodeLine({ type: 'HELLO', peerId: PEER_ID }));
      sock.write(encodeLine(buildPeerAnnounceMsg()));
      for (const b of o.queue) sock.write(b);
      o.queue = [];
    });
    o.socket = sock;
    const parse = createLineParser((msg) => handleOutboundMessage(msg));
    sock.on('data', parse);
    sock.on('close', () => {
      if (outbound.get(key) === o) {
        outbound.delete(key);
        failPendingForHostPort(key);
      }
    });
    sock.on('error', (e) => {
      console.warn('[peer] outbound', key, e.message);
      if (outbound.get(key) === o) {
        outbound.delete(key);
        failPendingForHostPort(key);
        try {
          sock.destroy();
        } catch (_) {
          /* ignore */
        }
      }
    });
    outbound.set(key, o);
  }
  if (o.ready && o.socket && !o.socket.destroyed) o.socket.write(buf);
  else o.queue.push(buf);
}

/** Chỉ mở kết nối (để demo tham gia qua peer đã biết — đề bài) */
function joinPeer(host, port) {
  writeToPeer(host, port, encodeLine({ type: 'NOP', from: PEER_ID }));
}

/**
 * Chờ ACK (CHAT trực tiếp) hoặc RELAY_ACK (đã chuyển tiếp tới đích qua trung gian).
 */
function trackPendingDelivery(
  host,
  port,
  toPeerId,
  payload,
  ackMsgId,
  waitRelayAck,
  logContent,
  logGroupId
) {
  const hostPortKey = `${host}:${port}`;

  return new Promise((resolve, reject) => {
    let attempt = 0;

    /** @type {{ timer?: ReturnType<typeof setTimeout>, hostPortKey: string, waitRelayAck?: boolean, onAck?: () => void, reject?: (e: Error) => void }} */
    const pend = { hostPortKey, waitRelayAck: !!waitRelayAck };

    const clearArm = () => {
      if (pend.timer) {
        clearTimeout(pend.timer);
        pend.timer = undefined;
      }
    };

    pend.reject = (err) => {
      clearArm();
      if (pendingAck.get(ackMsgId) === pend) pendingAck.delete(ackMsgId);
      reject(err);
    };

    pend.onAck = () => {
      clearArm();
      if (pendingAck.get(ackMsgId) !== pend) return;
      pendingAck.delete(ackMsgId);
      const g = logGroupId ? `[nhóm ${logGroupId}] ` : '';
      const toSuffix = logGroupId ? '' : ` tới ${toPeerId}`;
      pushRecent(`${g}(kênh outbound) CHAT từ ${PEER_ID}${toSuffix}: ${logContent}`);
      if (store) {
        void store
          .log('out', {
            remotePeer: toPeerId,
            msgId: ackMsgId,
            groupId: logGroupId || null,
            content: logContent,
          })
          .catch((e) => console.warn('[peer] sqlite (out):', e.message));
      }
      resolve({ ok: true });
    };

    const arm = () => {
      clearArm();
      pend.timer = setTimeout(() => {
        attempt += 1;
        if (attempt > MAX_RETRIES) {
          console.warn(
            `[peer] GỬI THẤT BẠI sau ${MAX_RETRIES} lần chờ ${waitRelayAck ? 'RELAY_ACK' : 'ACK'} tới ${toPeerId} (${ackMsgId})`
          );
          pend.reject(new Error('timeout'));
          return;
        }
        console.warn(
          `[peer] chưa có ${waitRelayAck ? 'RELAY_ACK' : 'ACK'}, gửi lại ${attempt}/${MAX_RETRIES} → ${toPeerId}`
        );
        writeToPeer(host, port, encodeLine(payload));
        arm();
      }, ACK_TIMEOUT_MS);
    };

    pendingAck.set(ackMsgId, pend);
    writeToPeer(host, port, encodeLine(payload));
    arm();
  });
}

function sendReliableChat(host, port, toPeerId, text, groupId) {
  const msgId = newMsgId();
  const sealed = sealChatPayload(text);

  let groupMembers = null;
  if (groupId) {
    const g = groups.get(groupId);
    if (g) groupMembers = [...g];
  }

  const payload = {
    type: 'CHAT',
    msgId,
    from: PEER_ID,
    ts: Date.now(),
    ...(groupId ? { groupId } : {}),
    ...(groupMembers ? { groupMembers } : {}),
    text: sealed.enc ? sealed : sealed.text,
  };
  const logPlain = sealed.enc ? '[encrypted]' : String(text);
  return trackPendingDelivery(host, port, toPeerId, payload, msgId, false, logPlain, groupId);
}

/**
 * Gửi RELAY tới peer trung gian; thành công khi trung gian nhận RELAY_ACK từ đích (đúng nghĩa 3.6 một chặng).
 */
async function sendRelayVia(viaPeerId, targetPeerId, text) {
  const innerMsgId = newMsgId();
  const sealed = sealChatPayload(text);
  const chat = {
    type: 'CHAT',
    msgId: innerMsgId,
    from: PEER_ID,
    ts: Date.now(),
    text: sealed.enc ? sealed : sealed.text,
  };
  const payload = { type: 'RELAY', targetPeerId, chat };
  let via = resolvePeer(viaPeerId);
  if (!via) {
    if (!NO_BOOTSTRAP) await fetchPeers();
    via = resolvePeer(viaPeerId);
  }
  if (!via) throw new Error('không có địa chỉ peer trung gian');
  return trackPendingDelivery(
    via.host,
    via.port,
    viaPeerId,
    payload,
    innerMsgId,
    true,
    `[RELAY→${targetPeerId}] ${text}`,
    null
  );
}

function resolvePeer(peerId) {
  const p = peerDirectory.get(peerId);
  if (!p) return null;
  return { host: p.listenHost, port: p.listenPort };
}

async function sendToPeerId(targetId, text, groupId = null) {
  if (targetId === PEER_ID) {
    console.warn('[peer] bỏ qua gửi cho chính mình');
    return;
  }
  const addr = resolvePeer(targetId);
  if (!addr) {
    console.warn('[peer] không tìm thấy peer trong cache:', targetId);
    if (!NO_BOOTSTRAP) await fetchPeers();
    const addr2 = resolvePeer(targetId);
    if (!addr2) {
      console.warn('[peer] vẫn không có địa chỉ — thử `join host port` hoặc đợi gossip.');
      if (store) {
        await store.enqueueOutbox(targetId, {
          type: 'CHAT',
          plainText: text,
          groupId,
          ts: Date.now(),
        });
        console.warn('[peer] đã lưu outbox (store-and-forward) →', targetId);
      }
      return;
    }
    try {
      await sendReliableChat(addr2.host, addr2.port, targetId, text, groupId);
    } catch (e) {
      if (store) {
        await store.enqueueOutbox(targetId, {
          type: 'CHAT',
          plainText: text,
          groupId,
          ts: Date.now(),
        });
        console.warn('[peer] gửi thất bại — outbox:', targetId, e.message);
      } else throw e;
    }
    return;
  }
  try {
    await sendReliableChat(addr.host, addr.port, targetId, text, groupId);
  } catch (e) {
    if (store) {
      await store.enqueueOutbox(targetId, {
        type: 'CHAT',
        plainText: text,
        groupId,
        ts: Date.now(),
      });
      console.warn('[peer] gửi thất bại — outbox:', targetId, e.message);
    } else throw e;
  }
}

async function flushOutboxOnce() {
  if (!store) return;
  const rows = await store.listOutbox(30);
  for (const row of rows) {
    const targetId = row.target_peer;
    const addr = resolvePeer(targetId);
    if (!addr) continue;
    let payload;
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      await store.deleteOutbox(row.id);
      continue;
    }
    if (payload.type !== 'CHAT' || payload.plainText == null) {
      await store.deleteOutbox(row.id);
      continue;
    }
    const text = String(payload.plainText);
    try {
      await sendReliableChat(addr.host, addr.port, targetId, text, payload.groupId || null);
      await store.deleteOutbox(row.id);
      console.log('[peer] outbox gửi thành công →', targetId);
    } catch {
      await store.bumpAttempt(row.id);
    }
  }
}

function broadcastNetwork(text) {
  const bcastId = newMsgId();
  rememberBcastId(bcastId);
  const msg = {
    type: 'BCAST',
    bcastId,
    from: PEER_ID,
    text,
    ttl: BCAST_DEFAULT_TTL,
    ts: Date.now(),
  };
  const line = `[BCAST gửi] ${text}`;
  console.log('[peer]', line);
  pushRecent(line);
  for (const [, v] of peerDirectory) {
    if (v.peerId === PEER_ID) continue;
    writeToPeer(v.listenHost, v.listenPort, encodeLine(msg));
  }
}

async function sendFileToPeer(targetId, filePath) {
  const addr = resolvePeer(targetId);
  if (!addr) {
    console.warn('[peer] không có địa chỉ peer:', targetId);
    return;
  }
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    console.warn('[peer] không tìm thấy file:', abs);
    return;
  }
  const buf = fs.readFileSync(abs);
  const name = path.basename(abs);
  const chunkSize = FILE_CHUNK_BYTES;
  const total = Math.ceil(buf.length / chunkSize) || 1;
  const fileId = newMsgId();
  writeToPeer(
    addr.host,
    addr.port,
    encodeLine({
      type: 'FILE_BEGIN',
      fileId,
      name,
      totalChunks: total,
      from: PEER_ID,
      ts: Date.now(),
    })
  );
  for (let i = 0; i < total; i++) {
    const slice = buf.subarray(i * chunkSize, (i + 1) * chunkSize);
    writeToPeer(
      addr.host,
      addr.port,
      encodeLine({
        type: 'FILE_PART',
        fileId,
        seq: i,
        total,
        data: slice.toString('base64'),
      })
    );
  }
  writeToPeer(addr.host, addr.port, encodeLine({ type: 'FILE_END', fileId, from: PEER_ID }));
  const line = `Đã gửi file "${name}" tới ${targetId} (${buf.length} byte)`;
  console.log('[peer]', line);
  pushRecent(line);
}

async function sendGroup(groupId, text) {
  const g = groups.get(groupId);
  if (!g || g.size === 0) {
    console.warn('[peer] nhóm không tồn tại hoặc rỗng:', groupId);
    return;
  }
  const targets = [...g].filter((id) => id !== PEER_ID);
  for (const tid of targets) {
    try {
      await sendToPeerId(tid, text, groupId);
      console.log(`[peer] đã gửi nhóm "${groupId}" tới ${tid}`);
    } catch {
      console.warn(`[peer] gửi nhóm tới ${tid} thất bại`);
    }
  }
}

function startTcpServer() {
  const srv = net.createServer((socket) => {
    const remote = `${socket.remoteAddress}:${socket.remotePort}`;
    inboundSockets.set(socket, { remote, peerId: null });
    socket.on('data', makeInboundParser(socket));
    socket.on('close', () => {
      inboundSockets.delete(socket);
      console.log('[peer] đóng kết nối inbound', remote);
    });
    socket.on('error', () => {});
    socket.write(encodeLine({ type: 'HELLO', peerId: PEER_ID }));
    socket.write(encodeLine(buildPeerAnnounceMsg()));
  });

  srv.listen(LISTEN_PORT, LISTEN_HOST, () => {
    console.log(`[peer] TCP lắng nghe ${LISTEN_HOST}:${LISTEN_PORT}`);
  });
  srv.on('error', (err) => {
    console.error(`[peer] không mở được cổng TCP ${LISTEN_HOST}:${LISTEN_PORT} —`, err.message);
    console.error('[peer] gợi ý: đổi LISTEN_PORT hoặc tắt tiến trình đang chiếm cổng.');
    process.exit(1);
  });
  return srv;
}

function printHelp() {
  console.log(`
Lệnh:
  help
  peers              — cache peerId@địa chỉ (tracker + gossip)
  online             — danh sách peer đang online trên tracker (3.5), refresh /peers
  connections        — kết nối TCP đang mở (inbound/outbound)
  join <host> <port> — tham gia/khám phá qua một peer đã biết (đề: không chỉ bootstrap)
  sync               — đăng ký + fetch tracker (khi NO_BOOTSTRAP hoặc cần làm mới)
  send <id> <tin>    — chat trực tiếp TCP + ACK
  relay <via> <đích> <tin> — chuyển tiếp một chặng: gửi tới <đích> qua peer <via> (RELAY_ACK)
  group-add <gid> <id> ...
  group-send <gid> <tin>  — fan-out nhóm (mỗi peer nhận một bản trực tiếp)
  bcast <tin>           — broadcast flood (TTL=${BCAST_DEFAULT_TTL})
  file-send <id> <đường_dẫn_file> — gửi file (chunk base64)
  outbox                — xem hàng đợi store-and-forward
  flush-outbox          — thử gửi lại outbox ngay
  quit
(Nâng cao: đặt P2P_SECRET=cùng_một_chuỗi trên mọi peer để mã hóa CHAT; WEB_PORT=8080 cho giao diện web)
`);
}

function setupReadline() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.setPrompt('> ');
  rl.prompt();

  rl.on('line', async (line) => {
    const parts = line.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();
    try {
      if (!cmd) {
        /* skip */
      } else if (cmd === 'help' || cmd === '?') {
        printHelp();
      } else if (cmd === 'peers') {
        console.log(
          [...peerDirectory.entries()].map(([k, v]) => `${k}@${v.address}`).join('\n') || '(trống)'
        );
      } else if (cmd === 'online') {
        try {
          await fetchPeers();
          const ids = [...trackerOnlineIds].filter((id) => id !== PEER_ID);
          const line = ids
            .map((id) => {
              const p = peerDirectory.get(id);
              return p ? `${id}@${p.address}` : `${id}@?`;
            })
            .join(', ');
          console.log('[peer] online (tracker):', line || '(chỉ có mình)');
        } catch (e) {
          console.warn('[peer] online:', e.message);
        }
      } else if (cmd === 'connections') {
        const ins = [...inboundSockets.values()].map((m) => `in  ${m.peerId || '?'} @ ${m.remote}`);
        const outs = [...outbound.keys()].map((k) => `out ${k}`);
        console.log([...ins, ...outs].join('\n') || '(chưa có kết nối P2P)');
      } else if (cmd === 'join' && parts.length >= 3) {
        const host = parts[1];
        const port = Number(parts[2]);
        if (!Number.isFinite(port)) console.warn('[peer] port không hợp lệ');
        else {
          joinPeer(host, port);
          console.log(`[peer] đã bắt đầu join tới ${host}:${port} (HELLO+PEER_ANNOUNCE)`);
        }
      } else if (cmd === 'sync') {
        try {
          await registerWithBootstrap();
          await fetchPeers();
          await sendHeartbeat();
          startTrackerLoops();
          console.log('[peer] sync tracker xong.');
        } catch (e) {
          console.warn('[peer] sync:', e.message);
        }
      } else if (cmd === 'send' && parts.length >= 3) {
        const to = parts[1];
        const text = parts.slice(2).join(' ');
        await sendToPeerId(to, text, null);
      } else if (cmd === 'relay' && parts.length >= 4) {
        const via = parts[1];
        const target = parts[2];
        const text = parts.slice(3).join(' ');
        await sendRelayVia(via, target, text);
        console.log('[peer] RELAY tới', target, 'qua', via, '— RELAY_ACK đã về.');
      } else if (cmd === 'group-add' && parts.length >= 3) {
        const gid = parts[1];
        const members = parts.slice(2);
        groups.set(gid, new Set(members));
        console.log(`[peer] nhóm "${gid}":`, [...groups.get(gid)].join(', '));
      } else if (cmd === 'group-send' && parts.length >= 3) {
        const gid = parts[1];
        const text = parts.slice(2).join(' ');
        await sendGroup(gid, text);
      } else if (cmd === 'bcast' && parts.length >= 2) {
        const text = parts.slice(1).join(' ');
        broadcastNetwork(text);
      } else if (cmd === 'file-send' && parts.length >= 3) {
        const tid = parts[1];
        const fp = parts.slice(2).join(' ');
        await sendFileToPeer(tid, fp);
      } else if (cmd === 'outbox') {
        if (!store) console.log('(không có sqlite)');
        else {
          const rows = await store.listOutbox(20);
          console.log(rows.length ? JSON.stringify(rows, null, 2) : '(outbox trống)');
        }
      } else if (cmd === 'flush-outbox') {
        await flushOutboxOnce();
        console.log('[peer] flush outbox xong.');
      } else if (cmd === 'quit' || cmd === 'exit') {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (fetchTimer) clearInterval(fetchTimer);
        if (outboxTimer) clearInterval(outboxTimer);
        await unregisterFromBootstrap();
        rl.close();
        process.exit(0);
      } else {
        console.log('Lệnh không rõ. Gõ help.');
      }
    } catch (e) {
      console.warn('[peer]', e.message);
    }
    rl.prompt();
  });
}

async function main() {
  store = await openStore(PEER_ID);
  startTcpServer();

  if (NO_BOOTSTRAP) {
    console.warn('[peer] NO_BOOTSTRAP=1 — không tự đăng ký tracker. Dùng: join host port | sync');
  } else {
    await registerWithBootstrap();
    await fetchPeers();
    await sendHeartbeat();
    startTrackerLoops();
  }

  if (WEB_PORT > 0) {
    startWebDashboard(WEB_PORT, getWebSnapshot, {
      send: async (to, text) => {
        await sendToPeerId(to, text, null);
      },
      join: async (host, port) => {
        joinPeer(host, port);
      },
      bcast: async (text) => {
        broadcastNetwork(text);
      },
      groupAdd: async (groupId, members) => {
        groups.set(groupId, new Set(members));
      },
      groupSend: async (groupId, text) => {
        await sendGroup(groupId, text);
      },
      fileSend: async (to, filePath) => {
        await sendFileToPeer(to, filePath);
      }
    });
  }
  outboxTimer = setInterval(() => {
    void flushOutboxOnce().catch(() => {});
  }, OUTBOX_FLUSH_MS);

  if (process.env.P2P_SECRET) {
    console.log('[peer] P2P_SECRET đã bật — tin CHAT được mã hóa AES-256-GCM.');
  }

  printHelp();

  const chatTo = process.env.CHAT_TO;
  if (chatTo) {
    const m = chatTo.match(/^(.*):(\d+):(.*)$/s);
    if (!m) {
      console.warn('[peer] CHAT_TO sai định dạng; dùng host:port:nội_dung');
    } else {
      const host = m[1];
      const port = Number(m[2]);
      const text = m[3] || 'xin chào';
      const fakeId = `${host}:${port}`;
      try {
        await sendReliableChat(host, port, fakeId, text, null);
        console.log('[peer] CHAT_TO đã gửi xong (có ACK).');
      } catch (e) {
        console.warn('[peer] CHAT_TO:', e.message);
      }
    }
  }

  setupReadline();

  const shutdown = async () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (fetchTimer) clearInterval(fetchTimer);
    if (outboxTimer) clearInterval(outboxTimer);
    await unregisterFromBootstrap();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
