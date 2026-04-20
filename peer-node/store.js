const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

/**
 * Lịch sử cục bộ trên từng peer (không thay cho truyền tin P2P).
 * Ghi khi nhận tin hoặc khi gửi được xác nhận bằng ACK.
 */
async function openStore(peerId) {
  const safe = String(peerId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const dir = path.join(__dirname, 'db');
  fs.mkdirSync(dir, { recursive: true });
  const db = await open({
    filename: path.join(dir, `peer_${safe}.db`),
    driver: sqlite3.Database,
  });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      direction TEXT NOT NULL,
      remote_peer TEXT,
      msg_id TEXT,
      group_id TEXT,
      content TEXT,
      ts INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_peer TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0
    );
  `);
  return {
    /**
     * @param {'in'|'out'} direction
     * @param {{ remotePeer?: string, msgId?: string, groupId?: string|null, content: string }} row
     */
    async log(direction, row) {
      await db.run(
        `INSERT INTO messages (direction, remote_peer, msg_id, group_id, content, ts)
         VALUES (?,?,?,?,?,?)`,
        [
          direction,
          row.remotePeer || null,
          row.msgId || null,
          row.groupId || null,
          row.content,
          Date.now(),
        ]
      );
    },

    /** Store-and-forward: lưu CHAT chưa gửi được (peer offline / timeout). */
    async enqueueOutbox(targetPeer, payloadObj) {
      await db.run(
        `INSERT INTO outbox (target_peer, payload_json, created, attempts) VALUES (?,?,?,0)`,
        [targetPeer, JSON.stringify(payloadObj), Date.now()]
      );
    },

    async listOutbox(limit = 50) {
      return await db.all(
        `SELECT id, target_peer, payload_json, created, attempts FROM outbox ORDER BY id ASC LIMIT ?`,
        [limit]
      );
    },

    async deleteOutbox(id) {
      await db.run(`DELETE FROM outbox WHERE id = ?`, [id]);
    },

    async bumpAttempt(id) {
      await db.run(`UPDATE outbox SET attempts = attempts + 1 WHERE id = ?`, [id]);
    },
  };
}

module.exports = { openStore };

