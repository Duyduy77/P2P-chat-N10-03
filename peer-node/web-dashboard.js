/**
 * Giao diện web tối giản (nâng cao) — chỉ dùng http built-in.
 * Bật: WEB_PORT=8080 (hoặc số khác) khi chạy peer.
 */
const http = require('http');

function startWebDashboard(port, getSnapshot) {
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (req.method === 'GET' && url === '/api/snapshot') {
      const body = JSON.stringify(getSnapshot(), null, 0);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(body);
      return;
    }
    if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
      const html = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>P2P Peer — ${escapeHtml(String(getSnapshot().peerId || ''))}</title>
<style>
body{font-family:system-ui,sans-serif;margin:1rem;background:#0f1419;color:#e6edf3}
h1{font-size:1.1rem}
pre{background:#161b22;padding:.75rem;border-radius:8px;overflow:auto;max-height:60vh}
a{color:#58a6ff}
</style>
</head>
<body>
<h1>Peer: <span id="pid"></span></h1>
<p><a href="/api/snapshot">JSON snapshot</a> — tự làm mới mỗi 3s.</p>
<pre id="out">Đang tải…</pre>
<script>
async function load(){
  const r = await fetch('/api/snapshot');
  const j = await r.json();
  document.getElementById('pid').textContent = j.peerId || '';
  document.getElementById('out').textContent = JSON.stringify(j, null, 2);
}
load();
setInterval(load, 3000);
</script>
</body>
</html>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`[peer] web dashboard http://127.0.0.1:${port}/`);
  });
  return server;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { startWebDashboard };
