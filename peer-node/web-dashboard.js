/**
 * Giao diện web tối giản nâng cao — Phục vụ file tĩnh từ thư mục website/
 * và cung cấp REST API để tương tác với Peer CLI từ trình duyệt.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function startWebDashboard(port, getSnapshot, apiHandlers = {}) {
  const server = http.createServer((req, res) => {
    // Thêm CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = req.url.split('?')[0];

    // API: Lấy thông tin trạng thái của Peer
    if (req.method === 'GET' && url === '/api/snapshot') {
      const body = JSON.stringify(getSnapshot(), null, 0);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(body);
      return;
    }

    // API helper để đọc JSON body
    const readJsonBody = (request) => {
      return new Promise((resolve, reject) => {
        let bodyStr = '';
        request.on('data', chunk => { bodyStr += chunk; });
        request.on('end', () => {
          try {
            resolve(JSON.parse(bodyStr || '{}'));
          } catch (e) {
            reject(new Error('Invalid JSON format'));
          }
        });
        request.on('error', reject);
      });
    };

    // API: Gửi tin nhắn 1-1
    if (req.method === 'POST' && url === '/api/send') {
      readJsonBody(req)
        .then(async (body) => {
          if (!body.to || !body.text) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'to và text là bắt buộc' }));
            return;
          }
          if (apiHandlers.send) {
            await apiHandlers.send(body.to, body.text);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } else {
            res.writeHead(501, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'API handler send chưa được đăng ký' }));
          }
        })
        .catch(err => {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        });
      return;
    }

    // API: Kết nối tới một peer mới
    if (req.method === 'POST' && url === '/api/join') {
      readJsonBody(req)
        .then(async (body) => {
          const portNum = Number(body.port);
          if (!body.host || !Number.isFinite(portNum)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'host và port hợp lệ là bắt buộc' }));
            return;
          }
          if (apiHandlers.join) {
            await apiHandlers.join(body.host, portNum);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } else {
            res.writeHead(501, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'API handler join chưa được đăng ký' }));
          }
        })
        .catch(err => {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        });
      return;
    }

    // API: Broadcast toàn mạng
    if (req.method === 'POST' && url === '/api/bcast') {
      readJsonBody(req)
        .then(async (body) => {
          if (!body.text) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'text là bắt buộc' }));
            return;
          }
          if (apiHandlers.bcast) {
            await apiHandlers.bcast(body.text);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } else {
            res.writeHead(501, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'API handler bcast chưa được đăng ký' }));
          }
        })
        .catch(err => {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        });
      return;
    }

    // API: Thêm nhóm chat mới
    if (req.method === 'POST' && url === '/api/group/add') {
      readJsonBody(req)
        .then(async (body) => {
          if (!body.groupId || !Array.isArray(body.members)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'groupId và mảng members là bắt buộc' }));
            return;
          }
          if (apiHandlers.groupAdd) {
            await apiHandlers.groupAdd(body.groupId, body.members);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } else {
            res.writeHead(501, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'API handler groupAdd chưa được đăng ký' }));
          }
        })
        .catch(err => {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        });
      return;
    }

    // API: Gửi tin nhắn nhóm
    if (req.method === 'POST' && url === '/api/group/send') {
      readJsonBody(req)
        .then(async (body) => {
          if (!body.groupId || !body.text) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'groupId và text là bắt buộc' }));
            return;
          }
          if (apiHandlers.groupSend) {
            await apiHandlers.groupSend(body.groupId, body.text);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } else {
            res.writeHead(501, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'API handler groupSend chưa được đăng ký' }));
          }
        })
        .catch(err => {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        });
      return;
    }

    // Phục vụ file tĩnh từ thư mục /website/
    let filePath = url === '/' ? '/index.html' : url;
    // Ngăn chặn tấn công directory traversal
    const safePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
    const fullPath = path.join(__dirname, '..', 'website', safePath);

    fs.stat(fullPath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
        return;
      }
      
      fs.readFile(fullPath, (readErr, data) => {
        if (readErr) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('500 Internal Server Error');
          return;
        }
        const ext = path.extname(fullPath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      });
    });
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[peer] web dashboard http://0.0.0.0:${port}/`);
  });
  return server;
}

module.exports = { startWebDashboard };
