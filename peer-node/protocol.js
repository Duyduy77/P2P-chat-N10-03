/**
 * Giao thức P2P tối thiểu: mỗi thông điệp là một dòng JSON (NDJSON).
 *
 * Các type đang dùng (đối chiếu đề — trao đổi thông điệp qua TCP):
 * - HELLO: bắt tay, gắn peerId cho socket
 * - PEER_ANNOUNCE: lan truyền danh sách peer đã biết (gossip / tham gia qua peer quen)
 * - CHAT / ACK: tin nhắn có msgId + xác nhận (tin cậy tầng ứng dụng)
 * - RELAY / RELAY_ACK: chuyển tiếp một chặng (trung gian gửi CHAT tới đích; ACK từ đích → RELAY_ACK về nguồn)
 * - BCAST: broadcast flood có TTL + bcastId (chống lặp)
 * - FILE_BEGIN / FILE_PART / FILE_END: gửi file (chunk base64)
 *
 * Ghi chú: nhóm dùng fan-out (mỗi bản tin TCP trực tiếp); relay đa hop không hỗ trợ.
 */
const crypto = require('crypto');

function newMsgId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * @param {object} obj
 * @returns {Buffer}
 */
function encodeLine(obj) {
  return Buffer.from(`${JSON.stringify(obj)}\n`, 'utf8');
}

/**
 * Tạo parser stream: gọi onMessage mỗi khi đủ một dòng JSON.
 * @param {(msg: object) => void} onMessage
 */
function createLineParser(onMessage) {
  let buf = '';
  return (chunk) => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        onMessage(JSON.parse(line));
      } catch {
        // bỏ qua dòng lỗi; sau này có thể log metric
      }
    }
  };
}

module.exports = { encodeLine, createLineParser, newMsgId };
