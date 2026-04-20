/**
 * Mã hóa tin nhắn (nâng cao) — AES-256-GCM, khóa từ P2P_SECRET (SHA-256).
 * Mọi peer trong phiên phải dùng cùng P2P_SECRET.
 */
const crypto = require('crypto');

function deriveKey(secret) {
  return crypto.createHash('sha256').update(String(secret), 'utf8').digest();
}

/**
 * @param {string} plaintext
 * @returns {{ enc: true, iv: string, tag: string, ct: string } | { enc: false, text: string }}
 */
function sealChatPayload(plaintext) {
  const secret = process.env.P2P_SECRET;
  if (!secret) return { enc: false, text: plaintext };
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(String(plaintext), 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return {
    enc: true,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: enc.toString('base64'),
  };
}

/**
 * @param {string|object} textField — nội dung field `text` trong CHAT (chuỗi hoặc envelope)
 * @returns {string}
 */
function openChatPayload(textField) {
  if (textField == null) return '';
  if (typeof textField === 'string') return textField;
  if (typeof textField === 'object' && textField.enc === false && textField.text != null) {
    return String(textField.text);
  }
  if (typeof textField === 'object' && textField.enc === true && textField.ct) {
    const secret = process.env.P2P_SECRET;
    if (!secret) return '[encrypted — đặt P2P_SECRET]';
    const key = deriveKey(secret);
    const iv = Buffer.from(textField.iv, 'base64');
    const tag = Buffer.from(textField.tag, 'base64');
    const ct = Buffer.from(textField.ct, 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  }
  return String(textField);
}

module.exports = { sealChatPayload, openChatPayload };
