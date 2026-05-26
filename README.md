# Hệ thống chat P2P (Peer-to-Peer)

Mạng chat ngang hàng: peer trao đổi tin qua **TCP**; **bootstrap/tracker** (HTTP) chỉ hỗ trợ đăng ký, heartbeat và **discovery** — nội dung chat không đi qua tracker.

## Yêu cầu môi trường

- [Node.js](https://nodejs.org/) (LTS khuyến nghị)
- Windows PowerShell (hoặc shell tương đương)

## Cấu trúc thư mục

| Thư mục / file | Mô tả |
|----------------|--------|
| `bootstrap-server/` | Tracker HTTP: `GET /peers`, `POST /register`, `POST /heartbeat`, `POST /unregister` |
| `peer-node/` | Peer: `peer.js` (TCP + CLI), `protocol.js`, `store.js` (SQLite), `crypto-msg.js`, `web-dashboard.js` |
| `peer-node/db/` | SQLite tự tạo theo `PEER_ID` |
| `scripts/smoke-integration.js` | Kiểm thử tự động: bootstrap + 2 peer + gửi tin |
| `scripts/churn.js` | Mô phỏng churn (đăng ký / hủy đăng ký lặp) |


## Cài đặt

Sau khi **clone** repo, thư mục `peer-node/node_modules` thường **không có**. Mỗi máy cần cài dependency một lần:

```powershell
Set-Location "E:\HTPT BTL\peer-node"
npm install
```

(Bootstrap không cần thêm dependency — dùng module `http` có sẵn.)

## Chạy bootstrap (tracker)

Mở **terminal 1**:

```powershell
Set-Location "E:\HTPT BTL\bootstrap-server"
$env:BOOTSTRAP_PORT="3020"
node server.js
```

Giữ terminal này chạy. Đổi `3020` nếu cổng bận; khi đó các peer phải dùng cùng URL tương ứng.

## Chạy peer (CLI)

Mỗi peer một **terminal riêng**. Luôn `Set-Location` vào `peer-node`, đặt biến môi trường rồi `node peer.js`.

**Ví dụ — Alice (cổng 4101):**

```powershell
Set-Location "E:\HTPT BTL\peer-node"
$env:PEER_ID="alice"
$env:LISTEN_PORT="4101"
$env:LISTEN_HOST="127.0.0.1"
$env:BOOTSTRAP_URL="http://127.0.0.1:3020"
node peer.js
```

**Ví dụ — Bob (cổng 4102):**

```powershell
Set-Location "E:\HTPT BTL\peer-node"
$env:PEER_ID="bob"
$env:LISTEN_PORT="4102"
$env:LISTEN_HOST="127.0.0.1"
$env:BOOTSTRAP_URL="http://127.0.0.1:3020"
node peer.js
```

Sau khi chạy, gõ `help` để xem lệnh. Một số lệnh thường dùng:

- `online` / `peers` — discovery và peer online trên tracker  
- `send <peerId> <nội dung>` — chat trực tiếp  
- `join <host> <port>` — kết nối tới peer đã biết (ví dụ `join 127.0.0.1 4102`)  
- `group-add <tên_nhóm> <id1> <id2> ...` rồi `group-send <tên_nhóm> <tin>` — chat nhóm  
- `relay <via> <đích> <tin>` — relay một chặng  
- `bcast <tin>` — broadcast  
- `file-send <peerId> <đường_dẫn_file>` — gửi file  
- `outbox` / `flush-outbox` — store-and-forward  
- `quit` — thoát và `unregister` tracker  

**Không** gửi tin cho chính mình (`send alice ...` khi đang là `alice` sẽ bị bỏ qua).

## Tùy chọn nâng cao

| Biến môi trường | Ý nghĩa |
|-----------------|--------|
| `WEB_PORT=8080` | Bật dashboard web: `http://127.0.0.1:8080/` (mỗi peer một cổng khác nhau trên cùng máy) |
| `P2P_SECRET=cùng_một_chuỗi` | Đặt **giống nhau** trên mọi peer để mã hóa tin CHAT (AES-256-GCM) |
| `NO_BOOTSTRAP=1` | Không tự đăng ký lúc khởi động; dùng `join` / lệnh `sync` khi cần lên tracker |
| `CHAT_TO=host:port:nội_dung` | Gửi một tin ngay khi khởi động (hữu ích cho script / demo) |

## Kiểm thử tự động (smoke)

Từ **thư mục gốc** đồ án (chứa `scripts`):

```powershell
Set-Location "E:\HTPT BTL"
node scripts\smoke-integration.js
```

Thành công khi log có **PASS** và tiến trình thoát mã **0**. Nếu cổng bootstrap mặc định (3048) bận:

```powershell
$env:SMOKE_BOOT_PORT="3050"
node scripts\smoke-integration.js
```

## Mô phỏng churn

Bootstrap đang chạy (ví dụ `http://127.0.0.1:3020`):

```powershell
Set-Location "E:\HTPT BTL"
node scripts\churn.js http://127.0.0.1:3020 25
```

Tham số cuối là số vòng lặp (tùy chọn).

## Demo ba peer + nhóm

1. Bootstrap như trên.  
2. Chạy `alice` (4101), `bob` (4102), `carol` (4103) — cùng `BOOTSTRAP_URL`.  
3. Trên Alice: `group-add demo alice bob carol` rồi `group-send demo Chào nhóm`.  

Nếu chưa thấy peer trong cache: `sync` hoặc `join` tới cổng TCP của peer kia.


## Giới hạn

- Relay hỗ trợ **một chặng** (không routing đa hop tự động).  
- Cấu hình nhóm (`group-add`) là **cục bộ** trên peer gửi.  
