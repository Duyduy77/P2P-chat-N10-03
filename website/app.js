// FRONTEND APPLICATION LOGIC FOR P2P-CHAT (SPLIT PAGES SUPPORT)

// -------------------------------------------------------------
// NAVIGATION & ELEMENT DETECTION
// -------------------------------------------------------------
const isShowcasePage = !!document.getElementById('simulator');
const isChatPage = !!document.querySelector('.live-chat-grid');

// -------------------------------------------------------------
// SHOWCASE & SIMULATOR LOGIC (Runs only on showcase.html)
// -------------------------------------------------------------
if (isShowcasePage) {
  // Quickstart Steps Navigation
  const stepButtons = document.querySelectorAll('.step-btn');
  const stepPanes = document.querySelectorAll('.step-pane');

  stepButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetStep = btn.getAttribute('data-step');
      
      stepButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      stepPanes.forEach(pane => {
        pane.classList.remove('active');
        if (pane.id === `step-pane-${targetStep}`) {
          pane.classList.add('active');
        }
      });
    });
  });

  // Simulator Canvas Elements
  const packetEl = document.getElementById('packet');
  const simTerminalLog = document.getElementById('simTerminalLog');
  const lines = {
    'alice-tracker': document.getElementById('line-alice-tracker'),
    'bob-tracker': document.getElementById('line-bob-tracker'),
    'charlie-tracker': document.getElementById('line-charlie-tracker'),
    'alice-bob': document.getElementById('line-alice-bob'),
    'alice-charlie': document.getElementById('line-alice-charlie'),
    'bob-charlie': document.getElementById('line-bob-charlie')
  };

  // Node Center Coordinates
  const coordinates = {
    tracker: { x: 360, y: 90 },
    alice: { x: 130, y: 270 },
    bob: { x: 590, y: 270 },
    charlie: { x: 360, y: 400 }
  };

  let simTimeout = null;

  window.logSim = function(text, type = '') {
    if (!simTerminalLog) return;
    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    const now = new Date();
    const ts = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
    line.innerHTML = `<span style="color: var(--text-dark)">[${ts}]</span> ${text}`;
    simTerminalLog.appendChild(line);
    simTerminalLog.scrollTop = simTerminalLog.scrollHeight;
  };

  window.resetSimulator = function() {
    if (simTerminalLog) {
      simTerminalLog.innerHTML = '<div class="log-line text-muted">// Simulator cleared. Click a command on the left to start.</div>';
    }
    if (packetEl) packetEl.style.opacity = 0;
    if (simTimeout) clearTimeout(simTimeout);
    
    // Deactivate all lines
    Object.values(lines).forEach(l => {
      if (l) l.classList.remove('active');
    });
    const bobStatus = document.getElementById('bob-status-dot');
    if (bobStatus) bobStatus.className = 'node-status-dot online';
    
    // Deactivate all node borders
    document.querySelectorAll('.node').forEach(n => n.classList.remove('active'));
  };

  // Animate the packet along coordinate path
  window.animatePacket = function(fromNode, toNode, color, duration = 800) {
    return new Promise((resolve) => {
      if (!packetEl) return resolve();
      const start = coordinates[fromNode];
      const end = coordinates[toNode];
      
      // Find connection line and activate it
      const lineKey = `${fromNode}-${toNode}`;
      const reverseKey = `${toNode}-${fromNode}`;
      const line = lines[lineKey] || lines[reverseKey];
      if (line) line.classList.add('active');

      // Setup packet style
      packetEl.style.background = color;
      packetEl.style.boxShadow = `0 0 12px ${color}`;
      packetEl.style.opacity = 1;
      
      const startTime = performance.now();
      
      function update(time) {
        const elapsed = time - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        const currentX = start.x + (end.x - start.x) * progress;
        const currentY = start.y + (end.y - start.y) * progress;
        
        packetEl.style.left = `${currentX}px`;
        packetEl.style.top = `${currentY}px`;
        
        if (progress < 1) {
          requestAnimationFrame(update);
        } else {
          if (line) line.classList.remove('active');
          packetEl.style.opacity = 0;
          resolve();
        }
      }
      
      requestAnimationFrame(update);
    });
  };

  // Simulation 1: Direct TCP Chat
  window.simDirectChat = async function() {
    resetSimulator();
    document.getElementById('node-alice').classList.add('active');
    document.getElementById('node-bob').classList.add('active');
    
    logSim('--- KHỞI ĐẦU: CHAT TRỰC TIẾP TCP (ALICE ➔ BOB) ---', 'system');
    
    logSim('[Alice] Đang truy vấn Tracker để lấy IP của Bob...', 'outgoing');
    await animatePacket('alice', 'tracker', 'var(--primary)', 600);
    
    logSim('[Tracker] GET /peers ➔ Trả về: bob@127.0.0.1:4102', 'system');
    await animatePacket('tracker', 'alice', 'var(--accent-green)', 600);
    
    logSim('[Alice] Đã tìm thấy Bob trong cache. Mở kết nối TCP tới 127.0.0.1:4102...', 'system');
    logSim('[Alice] Gửi gói tin bốc tay: type=HELLO, peerId=alice', 'outgoing');
    await animatePacket('alice', 'bob', 'var(--secondary)', 800);
    
    logSim('[Bob] Nhận kết nối TCP. Nhận HELLO(alice). Trả về: HELLO(bob)', 'incoming');
    await animatePacket('bob', 'alice', 'var(--accent-green)', 800);
    
    logSim('[Alice] Kết nối TCP đã thiết lập thành công. Bắt đầu truyền CHAT...', 'system');
    logSim('[Alice] Gửi CHAT: "Chào Bob, mình là Alice!" (msgId: 8e19-2030)', 'outgoing');
    await animatePacket('alice', 'bob', 'var(--primary)', 800);
    
    logSim('[Bob] Đã nhận tin nhắn từ Alice: "Chào Bob, mình là Alice!"', 'incoming');
    logSim('[Bob] Đang ghi tin nhắn vào SQLite DB local...', 'system');
    logSim('[Bob] Gửi tin ACK(8e19-2030) xác nhận đã nhận tin nhắn', 'outgoing');
    await animatePacket('bob', 'alice', 'var(--accent-green)', 800);
    
    logSim('[Alice] Đã nhận được ACK từ Bob! Hoàn tất truyền tin cậy.', 'system');
    document.getElementById('node-alice').classList.remove('active');
    document.getElementById('node-bob').classList.remove('active');
  };

  // Simulation 2: 1-Hop Relay Chat
  window.simRelayChat = async function() {
    resetSimulator();
    document.getElementById('node-alice').classList.add('active');
    document.getElementById('node-bob').classList.add('active');
    document.getElementById('node-charlie').classList.add('active');
    
    logSim('--- KHỞI ĐẦU: RELAY TRUNG GIAN (ALICE ➔ BOB QUA CHARLIE) ---', 'system');
    logSim('[Alice] Cố gắng kết nối trực tiếp đến Bob (127.0.0.1:4102)...', 'system');
    logSim('[Alice] Lỗi: Timeout (Bob bị chặn bởi NAT/Firewall hoặc offline)', 'warn');
    
    // Simulate Bob blocked
    document.getElementById('bob-status-dot').className = 'node-status-dot offline';
    
    logSim('[Alice] Khởi chạy Relay: Gửi gói tin RELAY tới Charlie để chuyển tiếp đến Bob...', 'system');
    logSim('[Alice] Gửi gói tin RELAY: target=bob, payload=CHAT("Hello Bob!")', 'outgoing');
    await animatePacket('alice', 'charlie', 'var(--primary)', 800);
    
    logSim('[Charlie] Nhận RELAY. Mục tiêu: Bob. Kiểm tra cache địa chỉ của Bob...', 'system');
    logSim('[Charlie] Gửi gói tin CHAT trực tiếp tới Bob...', 'outgoing');
    await animatePacket('charlie', 'bob', 'var(--secondary)', 800);
    
    logSim('[Bob] Nhận CHAT từ Charlie (nguồn gốc: Alice): "Hello Bob!"', 'incoming');
    logSim('[Bob] Trả về gói ACK(msgId) về phía Charlie...', 'outgoing');
    await animatePacket('bob', 'charlie', 'var(--accent-green)', 800);
    
    logSim('[Charlie] Đã nhận ACK từ Bob. Chuyển đổi thành RELAY_ACK...', 'system');
    logSim('[Charlie] Gửi gói tin RELAY_ACK về cho Alice...', 'outgoing');
    await animatePacket('charlie', 'alice', 'var(--accent-green)', 800);
    
    logSim('[Alice] Đã nhận được RELAY_ACK từ Charlie! Xác nhận Bob đã nhận tin.', 'system');
    
    document.getElementById('node-alice').classList.remove('active');
    document.getElementById('node-bob').classList.remove('active');
    document.getElementById('node-charlie').classList.remove('active');
    document.getElementById('bob-status-dot').className = 'node-status-dot online';
  };

  // Simulation 3: Broadcast Flooding
  window.simBroadcast = async function() {
    resetSimulator();
    document.getElementById('node-alice').classList.add('active');
    document.getElementById('node-bob').classList.add('active');
    document.getElementById('node-charlie').classList.add('active');
    
    logSim('--- KHỞI ĐẦU: BROADCAST FLOODING (TTL=3) ---', 'system');
    logSim('[Alice] Tạo broadcast bcastId: 77a1. Nội dung: "Hệ thống bảo trì lúc 14h!"', 'outgoing');
    
    logSim('[Alice] Flood gói tin BCAST tới tất cả các Peer trong cache (Bob, Charlie)...', 'system');
    animatePacket('alice', 'bob', 'var(--primary)', 800);
    await animatePacket('alice', 'charlie', 'var(--primary)', 800);
    
    logSim('[Bob] Nhận BCAST(77a1). Chưa từng xử lý. Hiển thị: "Hệ thống bảo trì lúc 14h!"', 'incoming');
    logSim('[Charlie] Nhận BCAST(77a1). Chưa từng xử lý. Hiển thị: "Hệ thống bảo trì lúc 14h!"', 'incoming');
    
    logSim('[Bob] Giảm TTL còn 2. Flood tiếp BCAST(77a1) tới Charlie...', 'outgoing');
    logSim('[Charlie] Giảm TTL còn 2. Flood tiếp BCAST(77a1) tới Bob...', 'outgoing');
    
    animatePacket('bob', 'charlie', 'var(--secondary)', 800);
    await animatePacket('charlie', 'bob', 'var(--secondary)', 800);
    
    logSim('[Charlie] Nhận BCAST(77a1) từ Bob. Trùng lặp bcastId. Bỏ qua để tránh lặp vô tận.', 'warn');
    logSim('[Bob] Nhận BCAST(77a1) từ Charlie. Trùng lặp bcastId. Bỏ qua để tránh lặp vô tận.', 'warn');
    
    logSim('--- KẾT THÚC BROADCAST: Toàn bộ mạng đã nhận tin ---', 'system');
    
    document.getElementById('node-alice').classList.remove('active');
    document.getElementById('node-bob').classList.remove('active');
    document.getElementById('node-charlie').classList.remove('active');
  };

  // Simulation 4: Store & Forward
  window.simStoreForward = async function() {
    resetSimulator();
    document.getElementById('node-alice').classList.add('active');
    document.getElementById('node-bob').classList.add('active');
    
    logSim('--- KHỞI ĐẦU: STORE & FORWARD (SQLITE OUTBOX) ---', 'system');
    logSim('[Mô phỏng] Bob đột ngột mất kết nối...', 'warn');
    document.getElementById('bob-status-dot').className = 'node-status-dot offline';
    
    logSim('[Alice] Gửi tin nhắn cho Bob: "Mai họp nhóm nhé!"', 'outgoing');
    logSim('[Alice] Đang thử kết nối TCP đến Bob...', 'system');
    
    await new Promise(r => setTimeout(r, 1200));
    
    logSim('[Alice] Lỗi kết nối TCP tới 127.0.0.1:4102: ETIMEDOUT', 'warn');
    logSim('[Alice] Tự động chuyển chế độ: Lưu tin nhắn vào SQLite db `outbox` table...', 'system');
    logSim('[SQLite] INSERT INTO outbox (target_peer, payload_json) VALUES ("bob", ...)', 'system');
    logSim('[Alice] Đã ghi outbox thành công. Sẽ flush lại định kỳ.', 'system');
    
    await new Promise(r => setTimeout(r, 2000));
    logSim('[Mô phỏng] Bob đã kết nối lại và online trên Tracker.', 'system');
    document.getElementById('bob-status-dot').className = 'node-status-dot online';
    
    logSim('[Alice] Định kỳ dọn outbox (outboxTimer). Phát hiện Bob online. Bắt đầu flush outbox...', 'system');
    logSim('[Alice] Đọc SQLite outbox ➔ Gửi tin nhắn đang chờ cho Bob...', 'outgoing');
    await animatePacket('alice', 'bob', 'var(--primary)', 800);
    
    logSim('[Bob] Đã nhận tin nhắn từ Alice: "Mai họp nhóm nhé!"', 'incoming');
    logSim('[Bob] Trả về ACK...', 'outgoing');
    await animatePacket('bob', 'alice', 'var(--accent-green)', 800);
    
    logSim('[Alice] Nhận được ACK! Xóa tin nhắn ra khỏi SQLite `outbox` table.', 'system');
    logSim('[SQLite] DELETE FROM outbox WHERE id = ...', 'system');
    
    document.getElementById('node-alice').classList.remove('active');
    document.getElementById('node-bob').classList.remove('active');
  };

  // Copy Code Clipboard Utility
  window.copyCode = function(button) {
    const code = button.previousElementSibling.querySelector('code').innerText;
    navigator.clipboard.writeText(code).then(() => {
      const originalText = button.innerText;
      button.innerText = 'Copied!';
      button.style.background = 'var(--primary)';
      button.style.color = '#fff';
      setTimeout(() => {
        button.innerText = originalText;
        button.style.background = '';
        button.style.color = '';
      }, 2000);
    });
  };

  window.scrollToSimulator = function() {
    const simEl = document.getElementById('simulator');
    if (simEl) simEl.scrollIntoView({ behavior: 'smooth' });
  };
}


// -------------------------------------------------------------
// LIVE CHAT CLIENT LOGIC (Runs only on index.html)
// -------------------------------------------------------------
if (isChatPage) {
  let isLive = false;
  let localPeerId = '';
  let activeChatTarget = ''; // Can be peerId, 'broadcast', or 'group:<groupId>'
  let knownPeers = [];
  let knownGroups = [];
  let lastRecentJson = '';
  let lastChatTarget = '';

  // Elements
  const connectionBadge = document.getElementById('connectionBadge');
  const offlineOverlay = document.getElementById('offlineOverlay');
  const localPeerIdEl = document.getElementById('localPeerId');
  const localPeerAddressEl = document.getElementById('localPeerAddress');
  const trackerTextEl = document.getElementById('trackerText');
  const trackerIndicator = document.getElementById('trackerIndicator');
  const contactsListEl = document.getElementById('contactsList');
  const messagePane = document.getElementById('messagePane');
  const messageInput = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');
  const sendMessageForm = document.getElementById('sendMessageForm');
  const liveConsoleLog = document.getElementById('liveConsoleLog');
  const joinPeerForm = document.getElementById('joinPeerForm');
  const groupAddForm = document.getElementById('groupAddForm');
  const groupMembersCheckboxes = document.getElementById('groupMembersCheckboxes');
  const chatTargetName = document.getElementById('chatTargetName');
  const chatTargetSub = document.getElementById('chatTargetSub');
  const chatTargetType = document.getElementById('chatTargetType');

  // Automatically check if running on a live peer on page load
  checkLiveStatus();
  setInterval(checkLiveStatus, 3000);

  async function checkLiveStatus() {
    try {
      const res = await fetch('/api/snapshot');
      if (res.status === 200) {
        const data = await res.json();
        if (!isLive) {
          isLive = true;
          if (connectionBadge) {
            connectionBadge.textContent = 'Live';
            connectionBadge.className = 'badge online';
          }
          if (offlineOverlay) {
            offlineOverlay.style.display = 'none';
          }
          logLiveSystem('Kết nối thành công tới API cục bộ của Peer Node!');
        }
        updateDashboardData(data);
      } else {
        handleOfflineState();
      }
    } catch (e) {
      handleOfflineState();
    }
  }

  function handleOfflineState() {
    if (isLive || isLive === undefined) {
      isLive = false;
      if (connectionBadge) {
        connectionBadge.textContent = 'Offline';
        connectionBadge.className = 'badge offline';
      }
      if (offlineOverlay) {
        offlineOverlay.style.display = 'flex';
      }
      logLiveWarn('Mất kết nối tới API Peer Node. Hãy khởi chạy peer bằng CLI.');
    }
  }

  function logLiveSystem(text) {
    if (!liveConsoleLog) return;
    const entry = document.createElement('div');
    entry.className = 'log-entry sys';
    entry.innerText = `[API] ${text}`;
    liveConsoleLog.appendChild(entry);
    liveConsoleLog.scrollTop = liveConsoleLog.scrollHeight;
  }
  
  function logLiveWarn(text) {
    if (!liveConsoleLog) return;
    const entry = document.createElement('div');
    entry.className = 'log-entry warn';
    entry.innerText = `[API] ${text}`;
    liveConsoleLog.appendChild(entry);
    liveConsoleLog.scrollTop = liveConsoleLog.scrollHeight;
  }

  // Update dashboard content with API Snapshot
  function updateDashboardData(data) {
    localPeerId = data.peerId;
    if (localPeerIdEl) localPeerIdEl.textContent = data.peerId;
    if (localPeerAddressEl) localPeerAddressEl.textContent = data.listen;
    if (trackerTextEl) trackerTextEl.textContent = `Tracker: ${data.bootstrap}`;
    if (trackerIndicator) trackerIndicator.className = 'dot-indicator online';
    
    // Set Local Peer Avatar
    const localAvatar = document.getElementById('localAvatar');
    if (localAvatar) {
      localAvatar.textContent = String(data.peerId).substring(0, 1).toUpperCase();
    }

    // Handle Peers and Groups List
    knownPeers = data.peers || [];
    knownGroups = data.groups || [];
    renderContactsList(data.peers, data.trackerOnline || []);

    // Update Console Logs and Chat Messages
    const recentJson = JSON.stringify(data.recent || []);
    const eventsChanged = recentJson !== lastRecentJson;
    const targetChanged = activeChatTarget !== lastChatTarget;

    if (eventsChanged) {
      renderConsoleLogs(data.recent || []);
      lastRecentJson = recentJson;
    }

    if ((eventsChanged || targetChanged) && activeChatTarget) {
      renderChatMessages(data.recent || []);
      lastChatTarget = activeChatTarget;
    }
  }

  // Render contacts list
  function renderContactsList(peers, onlineIds) {
    if (!contactsListEl) return;
    const onlineSet = new Set(onlineIds);
    
    // Save currently checked members so we don't uncheck them on redraw
    const checkedMembers = new Set();
    if (groupMembersCheckboxes) {
      const checkedBoxes = groupMembersCheckboxes.querySelectorAll('input[name="groupMember"]:checked');
      checkedBoxes.forEach(cb => checkedMembers.add(cb.value));
    }
    
    // If list is empty
    if (peers.length === 0) {
      contactsListEl.innerHTML = '<p class="empty-list-text">No cached peers found. Use Join or wait for discovery.</p>';
      if (groupMembersCheckboxes) groupMembersCheckboxes.innerHTML = '<p class="text-muted">No other peers online</p>';
      return;
    }

    // Build Checkboxes for Group Creation
    let checkboxesHtml = '';
    let contactsHtml = '';
    
    // 1. Add Broadcast contact option first
    const isBcastActive = activeChatTarget === 'broadcast';
    contactsHtml += `
      <div class="contact-item ${isBcastActive ? 'active' : ''}" onclick="selectChatTarget('broadcast')">
        <div class="contact-meta">
          <div class="contact-avatar" style="background: var(--accent-orange)">📢</div>
          <div class="contact-info">
            <h5>[Broadcast] Toàn mạng</h5>
            <p>Flooding TTL=3</p>
          </div>
        </div>
        <div class="contact-status">
          <span class="badge" style="background: rgba(255, 140, 0, 0.1); color: var(--accent-orange)">Net</span>
        </div>
      </div>
    `;

    // 2. Add Groups to contact list
    knownGroups.forEach(group => {
      const isActive = activeChatTarget === `group:${group.id}`;
      contactsHtml += `
        <div class="contact-item ${isActive ? 'active' : ''}" onclick="selectChatTarget('group:${group.id}')">
          <div class="contact-meta">
            <div class="contact-avatar" style="background: rgba(110, 86, 240, 0.2); color: var(--primary)">👥</div>
            <div class="contact-info">
              <h5>${group.id}</h5>
              <p>${group.members.join(', ')}</p>
            </div>
          </div>
          <div class="contact-status">
            <span class="badge" style="background: rgba(110, 86, 240, 0.1); color: var(--primary)">Group</span>
          </div>
        </div>
      `;
    });

    // 3. Loop through normal peers
    peers.forEach(peer => {
      const isOnline = onlineSet.has(peer.id) || onlineIds.includes(peer.id);
      const isActive = activeChatTarget === peer.id;
      
      contactsHtml += `
        <div class="contact-item ${isActive ? 'active' : ''}" onclick="selectChatTarget('${peer.id}')">
          <div class="contact-meta">
            <div class="contact-avatar">${peer.id.substring(0,1).toUpperCase()}</div>
            <div class="contact-info">
              <h5>${peer.id}</h5>
              <p>${peer.address}</p>
            </div>
          </div>
          <div class="contact-status" style="flex-direction: column; align-items: flex-end; gap: 0.2rem;">
            <span class="contact-status-dot ${isOnline ? 'online' : ''}"></span>
            <span style="font-size: 0.7rem; font-weight: 500; color: ${isOnline ? 'var(--accent-green)' : 'var(--text-muted)'}">${isOnline ? 'Online' : 'Offline'}</span>
          </div>
        </div>
      `;

      const isChecked = checkedMembers.has(peer.id) ? 'checked' : '';
      checkboxesHtml += `
        <label class="checkbox-row">
          <input type="checkbox" name="groupMember" value="${peer.id}" ${isChecked}>
          <span>${peer.id}</span>
        </label>
      `;
    });

    contactsListEl.innerHTML = contactsHtml;
    if (groupMembersCheckboxes) {
      groupMembersCheckboxes.innerHTML = checkboxesHtml || '<p class="text-muted">No other peers online</p>';
    }
  }

  // Select a contact/group to chat with
  window.selectChatTarget = function(target) {
    activeChatTarget = target;
    
    // Enable inputs
    if (messageInput) messageInput.removeAttribute('disabled');
    if (sendBtn) sendBtn.removeAttribute('disabled');
    
    const attachBtn = document.getElementById('attachBtn');
    if (attachBtn) {
      if (target) {
        attachBtn.removeAttribute('disabled');
      } else {
        attachBtn.setAttribute('disabled', 'true');
      }
    }
    
    if (target === 'broadcast') {
      if (chatTargetName) chatTargetName.textContent = 'Broadcast Flooding';
      if (chatTargetSub) chatTargetSub.textContent = 'Sends message to all connected peers in network';
      if (chatTargetType) {
        chatTargetType.textContent = 'Broadcast';
        chatTargetType.style.background = 'rgba(255, 140, 0, 0.1)';
        chatTargetType.style.color = 'var(--accent-orange)';
      }
    } else if (target.startsWith('group:')) {
      const groupId = target.replace('group:', '');
      if (chatTargetName) chatTargetName.textContent = `Group: ${groupId}`;
      if (chatTargetSub) chatTargetSub.textContent = 'Sends concurrent messages to all group members';
      if (chatTargetType) {
        chatTargetType.textContent = 'Group Fan-out';
        chatTargetType.style.background = 'rgba(110, 86, 240, 0.15)';
        chatTargetType.style.color = 'var(--primary)';
      }
    } else {
      if (chatTargetName) chatTargetName.textContent = target;
      const peerInfo = knownPeers.find(p => p.id === target);
      if (chatTargetSub) chatTargetSub.textContent = peerInfo ? `TCP Sockets — ${peerInfo.address}` : 'TCP Sockets';
      if (chatTargetType) {
        chatTargetType.textContent = 'TCP Direct';
        chatTargetType.style.background = '';
        chatTargetType.style.color = '';
      }
    }

    // Refresh active highlighting
    checkLiveStatus();
  };

  // Render Console Logs in the right panel
  function renderConsoleLogs(events) {
    if (!liveConsoleLog) return;
    liveConsoleLog.innerHTML = '';
    events.forEach(evt => {
      const entry = document.createElement('div');
      entry.className = 'log-entry';
      
      if (evt.line.includes('CHAT từ')) {
        entry.className += ' chat-in';
      } else if (evt.line.includes('outbound')) {
        entry.className += ' chat-out';
      } else if (evt.line.includes('lắng nghe') || evt.line.includes('đăng ký')) {
        entry.className += ' sys';
      } else if (evt.line.includes('lỗi') || evt.line.includes('thất bại')) {
        entry.className += ' warn';
      }
      
      const now = new Date(evt.t);
      const ts = now.toTimeString().split(' ')[0];
      entry.innerText = `[${ts}] ${evt.line}`;
      liveConsoleLog.appendChild(entry);
    });
    liveConsoleLog.scrollTop = liveConsoleLog.scrollHeight;
  }

  // Parse recentEvents to reconstruct the chat thread for the active peer
  function renderChatMessages(events) {
    if (!messagePane) return;
    messagePane.innerHTML = '';
    let msgCount = 0;
    
    // Set to keep track of rendered file messages in groups/broadcast to prevent duplicates
    const renderedFiles = new Set();

    events.forEach(evt => {
      const line = evt.line;
      let isIncoming = false;
      let isOutgoing = false;
      let sender = '';
      let text = '';
      let receiver = null;
      let groupId = null;
      let isBcast = false;

      let isFileMessage = false;
      let filename = '';
      let fileSize = '';
      let filepath = '';

      // Detect chat type
      if (line.includes('CHAT từ')) {
        const matches = line.match(/(?:\[nhóm (.*?)\]\s*)?(?:\(kênh outbound\)\s*)?CHAT từ (.*?)(?:\s*tới\s+(.*?))?:\s*(.*)/);
        if (matches) {
          groupId = matches[1] || null;
          sender = matches[2];
          receiver = matches[3] || null;
          text = matches[4];

          const isMe = localPeerId ? (sender === localPeerId) : line.includes('(kênh outbound)');
          if (isMe) {
            isOutgoing = true;
          } else {
            isIncoming = true;
          }
        }
      } else if (line.includes('[BCAST')) {
        isBcast = true;
        if (line.includes('BCAST gửi')) {
          isOutgoing = true;
          sender = localPeerId;
          const matches = line.match(/\[BCAST gửi\]\s*(.*)/);
          text = matches ? matches[1] : '';
        } else {
          isIncoming = true;
          const matches = line.match(/\[BCAST\s+ttl=\d+\]\s*(.*?):\s*(.*)/);
          if (matches) {
            sender = matches[1];
            text = matches[2];
          }
        }
      } else if (line.includes('Đã gửi file') || line.includes('Đã nhận file')) {
        const isSend = line.includes('Đã gửi file');
        if (isSend) {
          const matches = line.match(/(?:\[nhóm (.*?)\]\s*)?(?:\[(Broadcast)\]\s*)?Đã gửi file "(.*?)" tới (.*?)\s*(?:→\s*(.*?)\s*)?\((\d+)\s*byte\)/);
          if (matches) {
            groupId = matches[1] || null;
            isBcast = matches[2] === 'Broadcast';
            filename = matches[3];
            const recipient = matches[4];
            filepath = matches[5] || '';
            fileSize = matches[6];
            
            let matchTarget = false;
            if (groupId) {
              matchTarget = (activeChatTarget === `group:${groupId}`);
            } else if (isBcast) {
              matchTarget = (activeChatTarget === 'broadcast');
            } else {
              matchTarget = (recipient === activeChatTarget);
            }

            if (matchTarget) {
              isOutgoing = true;
              sender = localPeerId;
              isFileMessage = true;
              text = `📎 Gửi file: ${filename} (${formatBytes(fileSize)})`;
            }
          }
        } else {
          const matches = line.match(/(?:\[nhóm (.*?)\]\s*)?(?:\[(Broadcast)\]\s*)?Đã nhận file "(.*?)" từ (.*?)\s*→\s*(.*?)\s*\((\d+)\s*byte\)/);
          if (matches) {
            groupId = matches[1] || null;
            isBcast = matches[2] === 'Broadcast';
            filename = matches[3];
            const senderId = matches[4];
            filepath = matches[5];
            fileSize = matches[6];
            
            let matchTarget = false;
            if (groupId) {
              matchTarget = (activeChatTarget === `group:${groupId}`);
            } else if (isBcast) {
              matchTarget = (activeChatTarget === 'broadcast');
            } else {
              matchTarget = (senderId === activeChatTarget);
            }

            if (matchTarget) {
              isIncoming = true;
              sender = senderId;
              isFileMessage = true;
              text = `📎 Nhận file: ${filename} (${formatBytes(fileSize)})`;
            }
          }
        }
      }

      if (text) {
        let show = false;
        if (activeChatTarget === 'broadcast' && isBcast) {
          show = true;
        } else if (activeChatTarget.startsWith('group:')) {
          const targetGid = activeChatTarget.replace('group:', '');
          if (groupId === targetGid) show = true;
        } else if (!isBcast && !groupId) {
          if (isIncoming && sender === activeChatTarget) show = true;
          if (isOutgoing && activeChatTarget !== 'broadcast' && !activeChatTarget.startsWith('group:')) {
            let effectiveReceiver = receiver;
            const relayMatch = text.match(/^\[RELAY\u2192(.*?)\]/);
            if (relayMatch) {
              effectiveReceiver = relayMatch[1];
            }
            if (!effectiveReceiver || effectiveReceiver === activeChatTarget) {
              show = true;
            }
          }
        }

        // Deduplicate file messages for group/broadcast outgoing logs (since one log is printed per member)
        if (show && isFileMessage && (groupId || isBcast)) {
          const fileKey = `${groupId || 'bcast'}_${isOutgoing ? 'out' : 'in'}_${filename}_${fileSize}`;
          if (renderedFiles.has(fileKey)) {
            return; // skip duplicate send logs
          }
          renderedFiles.add(fileKey);
        }

        if (show) {
          msgCount++;
          const bubble = document.createElement('div');
          bubble.className = `message-bubble ${isIncoming ? 'incoming' : 'outgoing'}`;
          
          const senderLabel = isIncoming ? `<span class="msg-sender">${sender}</span>` : '';
          const dateStr = new Date(evt.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          
          if (isFileMessage) {
            let fileActionHtml = '';
            const cleanFilename = filename.replace(/^\d{13}_/, '');
            
            let previewHtml = '';
            if (filepath) {
              const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
              const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext);
              const isVideo = ['.mp4', '.webm', '.ogg', '.mov'].includes(ext);
              
              if (isImage) {
                previewHtml = `
                  <div class="file-preview">
                    <img src="/api/file/raw?path=${encodeURIComponent(filepath)}" alt="${escapeHtml(cleanFilename)}" data-filepath="${escapeHtml(filepath)}" onclick="openLocalFile(this.dataset.filepath)" />
                  </div>
                `;
              } else if (isVideo) {
                previewHtml = `
                  <div class="file-preview">
                    <video src="/api/file/raw?path=${encodeURIComponent(filepath)}" controls></video>
                  </div>
                `;
              }
            }

            if (filepath) {
              fileActionHtml = `
                ${previewHtml}
                <div class="file-card">
                  <div class="file-card-icon" style="color: var(--primary-light); display: flex; align-items: center;">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
                  </div>
                  <div class="file-card-details">
                    <span class="file-card-name" data-filepath="${escapeHtml(filepath)}" onclick="openLocalFile(this.dataset.filepath)">${escapeHtml(cleanFilename)}</span>
                    <span class="file-card-size">${formatBytes(fileSize)}</span>
                  </div>
                  <button class="file-card-btn" data-filepath="${escapeHtml(filepath)}" onclick="exploreLocalFile(this.dataset.filepath)" title="Mở thư mục chứa tệp tin">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                  </button>
                </div>
              `;
            } else {
              fileActionHtml = `
                <div class="file-card">
                  <div class="file-card-icon" style="color: var(--text-muted); display: flex; align-items: center;">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
                  </div>
                  <div class="file-card-details">
                    <span class="file-card-name" style="text-decoration: none; cursor: default;">${escapeHtml(cleanFilename)}</span>
                    <span class="file-card-size">${formatBytes(fileSize)}</span>
                  </div>
                </div>
              `;
            }
            bubble.innerHTML = `
              ${senderLabel}
              ${fileActionHtml}
              <div class="msg-time">${dateStr}</div>
            `;
          } else {
            bubble.innerHTML = `
              ${senderLabel}
              <div class="msg-text">${escapeHtml(text)}</div>
              <div class="msg-time">${dateStr}</div>
            `;
          }
          messagePane.appendChild(bubble);
        }
      }
    });

    if (msgCount === 0) {
      messagePane.innerHTML = `
        <div class="pane-placeholder">
          <div class="placeholder-icon">💬</div>
          <h4>Start of Conversation</h4>
          <p>Your direct messages are secure and sent directly over TCP sockets.</p>
        </div>
      `;
    } else {
      messagePane.scrollTop = messagePane.scrollHeight;
    }
  }

  // Submit Join Peer
  if (joinPeerForm) {
    joinPeerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const host = document.getElementById('joinHost').value;
      const port = document.getElementById('joinPort').value;
      
      logLiveSystem(`Gửi yêu cầu join tới ${host}:${port}...`);
      try {
        const res = await fetch('/api/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host, port })
        });
        if (res.ok) {
          logLiveSystem(`Đã bắt đầu join tới ${host}:${port} (HELLO + PEER_ANNOUNCE)`);
          document.getElementById('joinPort').value = '';
          checkLiveStatus();
        } else {
          const err = await res.json();
          logLiveWarn(`Lỗi join: ${err.error}`);
        }
      } catch (err) {
        logLiveWarn(`Lỗi mạng khi gọi /api/join: ${err.message}`);
      }
    });
  }

  // Submit Send Message
  if (sendMessageForm) {
    sendMessageForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = messageInput.value.trim();
      if (!text || !activeChatTarget) return;
      
      messageInput.value = '';
      
      try {
        let url = '/api/send';
        let bodyObj = { text };
        
        if (activeChatTarget === 'broadcast') {
          url = '/api/bcast';
        } else if (activeChatTarget.startsWith('group:')) {
          url = '/api/group/send';
          bodyObj.groupId = activeChatTarget.replace('group:', '');
        } else {
          bodyObj.to = activeChatTarget;
        }
        
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyObj)
        });
        
        if (res.ok) {
          checkLiveStatus();
        } else {
          const err = await res.json();
          logLiveWarn(`Lỗi gửi tin: ${err.error}`);
        }
      } catch (err) {
        logLiveWarn(`Lỗi mạng khi gửi tin: ${err.message}`);
      }
    });
  }

  // Submit Create Group
  if (groupAddForm) {
    groupAddForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const groupId = document.getElementById('groupNameInput').value.trim();
      const checkboxes = document.querySelectorAll('input[name="groupMember"]:checked');
      
      if (!groupId) return;
      
      const members = Array.from(checkboxes).map(cb => cb.value);
      members.push(localPeerId);

      logLiveSystem(`Gửi yêu cầu tạo nhóm "${groupId}" với thành viên: ${members.join(', ')}...`);
      
      try {
        const res = await fetch('/api/group/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupId, members })
        });
        
        if (res.ok) {
          logLiveSystem(`Đã tạo thành công nhóm local: "${groupId}"`);
          document.getElementById('groupNameInput').value = '';
          
          activeChatTarget = `group:${groupId}`;
          
          renderGroupsList(groupId);
          checkLiveStatus();
        } else {
          const err = await res.json();
          logLiveWarn(`Lỗi tạo nhóm: ${err.error}`);
        }
      } catch (err) {
        logLiveWarn(`Lỗi mạng khi tạo nhóm: ${err.message}`);
      }
    });
  }

  function renderGroupsList(newGroupId) {
    if (!knownGroups.includes(newGroupId)) {
      knownGroups.push(newGroupId);
    }
  }

  window.refreshSnapshot = function() {
    logLiveSystem('Đang làm mới danh sách peer từ API...');
    checkLiveStatus();
  };

  // Handle P2P File Sending via attachment button
  const fileInput = document.getElementById('fileInput');
  const attachBtn = document.getElementById('attachBtn');
  if (attachBtn && fileInput) {
    attachBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;

      const confirmSend = confirm(`Bạn có muốn gửi file "${file.name}" tới ${activeChatTarget} không?`);
      if (!confirmSend) {
        fileInput.value = '';
        return;
      }

      logLiveSystem(`Đang đọc file "${file.name}"...`);

      const reader = new FileReader();
      reader.onload = async (e) => {
        const dataUrl = e.target.result;
        const base64Data = dataUrl.split(',')[1];

        logLiveSystem(`Đang gửi file "${file.name}"...`);
        try {
          const res = await fetch('/api/file/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: activeChatTarget,
              filename: file.name,
              base64Data: base64Data
            })
          });

          const data = await res.json();
          if (res.status === 200 && data.ok) {
            logLiveSystem(`Đã hoàn tất gửi file "${file.name}"!`);
            checkLiveStatus();
          } else {
            logLiveWarn(`Lỗi khi gửi file: ${data.error || 'Lỗi không xác định'}`);
          }
        } catch (err) {
          logLiveWarn(`Lỗi kết nối khi gửi file: ${err.message}`);
        }
        fileInput.value = '';
      };
      reader.readAsDataURL(file);
    });
  }

  function formatBytes(bytes) {
    const b = Number(bytes);
    if (!Number.isFinite(b) || b <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return parseFloat((b / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  window.openLocalFile = async function(filepath) {
    if (!filepath) return;
    try {
      const res = await fetch('/api/file/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filepath })
      });
      const data = await res.json();
      if (res.status === 200 && data.ok) {
        logLiveSystem(`Đã mở file: ${filepath}`);
      } else {
        logLiveWarn(`Lỗi mở file: ${data.error}`);
      }
    } catch (err) {
      logLiveWarn(`Lỗi mạng khi mở file: ${err.message}`);
    }
  };

  window.exploreLocalFile = async function(filepath) {
    if (!filepath) return;
    try {
      const res = await fetch('/api/file/explore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filepath })
      });
      const data = await res.json();
      if (res.status === 200 && data.ok) {
        logLiveSystem(`Đã mở thư mục chứa file: ${filepath}`);
      } else {
        logLiveWarn(`Lỗi hiển thị file: ${data.error}`);
      }
    } catch (err) {
      logLiveWarn(`Lỗi mạng khi hiển thị thư mục: ${err.message}`);
    }
  };

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
