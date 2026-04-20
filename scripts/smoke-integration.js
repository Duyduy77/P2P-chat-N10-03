/**
 * Demo tự động (smoke): bootstrap + alice + bob gửi CHAT_TO tới alice.
 * Chạy từ thư mục gốc đồ án: node scripts/smoke-integration.js
 */
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const BOOT_PORT = Number(process.env.SMOKE_BOOT_PORT || 3048);
const ALICE_PORT = 5211;
const BOB_PORT = 5212;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => resolve({ status: res.statusCode, body: b }));
      })
      .on('error', reject);
  });
}

(async () => {
  console.log('[smoke] Khởi động bootstrap cổng', BOOT_PORT);
  const boot = spawn(process.execPath, ['server.js'], {
    cwd: path.join(ROOT, 'bootstrap-server'),
    env: { ...process.env, BOOTSTRAP_PORT: String(BOOT_PORT) },
    stdio: 'pipe',
  });
  boot.stderr.on('data', (c) => process.stderr.write(c));

  await sleep(900);
  try {
    const peers = await httpGet(`http://127.0.0.1:${BOOT_PORT}/peers`);
    console.log('[smoke] GET /peers →', peers.status);
  } catch (e) {
    console.error('[smoke] bootstrap không phản hồi:', e.message);
    boot.kill('SIGTERM');
    process.exit(1);
  }

  let aliceBuf = '';
  const alice = spawn(process.execPath, ['peer.js'], {
    cwd: path.join(ROOT, 'peer-node'),
    env: {
      ...process.env,
      PEER_ID: 'smoke-alice',
      LISTEN_PORT: String(ALICE_PORT),
      LISTEN_HOST: '127.0.0.1',
      BOOTSTRAP_URL: `http://127.0.0.1:${BOOT_PORT}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  alice.stdout.on('data', (c) => {
    aliceBuf += c.toString();
  });
  alice.stderr.on('data', (c) => process.stderr.write(c));

  await sleep(1800);

  let bobBuf = '';
  const bob = spawn(process.execPath, ['peer.js'], {
    cwd: path.join(ROOT, 'peer-node'),
    env: {
      ...process.env,
      PEER_ID: 'smoke-bob',
      LISTEN_PORT: String(BOB_PORT),
      LISTEN_HOST: '127.0.0.1',
      BOOTSTRAP_URL: `http://127.0.0.1:${BOOT_PORT}`,
      CHAT_TO: `127.0.0.1:${ALICE_PORT}:SmokeIntegrationOK`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  bob.stdout.on('data', (c) => {
    bobBuf += c.toString();
  });
  bob.stderr.on('data', (c) => process.stderr.write(c));

  await sleep(5000);

  alice.kill('SIGTERM');
  bob.kill('SIGTERM');
  boot.kill('SIGTERM');

  const pass =
    aliceBuf.includes('CHAT từ smoke-bob') && aliceBuf.includes('SmokeIntegrationOK');
  const bobOk = bobBuf.includes('CHAT_TO đã gửi xong');

  console.log('\n--- [smoke] tóm tắt ---');
  console.log(pass ? '[smoke] alice nhận tin: PASS' : '[smoke] alice nhận tin: FAIL');
  console.log(bobOk ? '[smoke] bob gửi CHAT_TO: PASS' : '[smoke] bob gửi CHAT_TO: FAIL');

  process.exit(pass && bobOk ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
