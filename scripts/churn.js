/**
 * Mô phỏng churn (nâng cao): đăng ký / hủy đăng ký lặp lại trên bootstrap.
 * Chạy: node scripts/churn.js [BOOTSTRAP_URL] [vòng lặp]
 * Ví dụ: node scripts/churn.js http://127.0.0.1:3020 30
 */
const http = require('http');
const { URL } = require('url');

const base = process.argv[2] || 'http://127.0.0.1:3000';
const rounds = Number(process.argv[3] || 25);

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(base);
    const data = body != null ? JSON.stringify(body) : null;
    const opts = {
      hostname: u.hostname,
      port: u.port || 80,
      path,
      method,
      headers: data
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        : {},
    };
    const r = http.request(opts, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  console.log('[churn] bootstrap:', base, 'rounds:', rounds);
  for (let i = 0; i < rounds; i++) {
    const id = `churn-${i % 5}`;
    const port = 9100 + (i % 5);
    await req('POST', '/register', {
      peerId: id,
      listenHost: '127.0.0.1',
      listenPort: port,
    });
    await new Promise((r) => setTimeout(r, 200));
    await req('POST', '/unregister', { peerId: id });
    await new Promise((r) => setTimeout(r, 150));
    if ((i + 1) % 5 === 0) console.log('[churn] đã', i + 1, 'vòng');
  }
  const peers = await req('GET', '/peers');
  console.log('[churn] xong. GET /peers status', peers.status);
  console.log(peers.body.slice(0, 500));
})().catch((e) => {
  console.error('[churn]', e.message);
  process.exit(1);
});
