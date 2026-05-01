import { socket } from "./index.js";
import { setCurrentConversation } from '../chat_input.js';
import { resetGroupChat } from './group.js';
// Thêm showAISummaryButton vào dòng import
import { setupChatInteractions, showAISummaryButton,getSmartMessages } from './chat_interactions.js';

let currentConversation = null;
let currentConversationType = 'private';
let pinnedMessage = null;
let pinnedConversationType = 'private';

let onOpenPrivateConversationCb = null;
let conversationContextMenuAttached = false;

function resetGroupState() {
  if (typeof resetGroupChat === 'function') {
    resetGroupChat();
  }
}

// ============================================================
// 1. SETUP SỰ KIỆN SOCKET (UPDATED: SILENT JOIN)
// ============================================================
export function setupChatEvents() {
  
  socket.on('connect', () => {
    console.log('✅ Connected to server');
    
    // 🔥 [QUAN TRỌNG] Join room cá nhân để nhận lời mời gọi 1v1
    const myUserId = getUserId();
    if (myUserId) {
        socket.emit('join_user_room', { user_id: myUserId });
        console.log(`[Socket] Joined user room for ${myUserId}`);
    }
    
    // Kích hoạt tương tác (swipe/long-press)
    setupChatInteractions();

    // 1. Join lại conversation đang mở (nếu có - trường hợp F5 lại trang)
    if (currentConversation) {
      joinConversation(currentConversation);
    }

    // 🔥 [FIX LỖI QUAN TRỌNG] ÂM THẦM THAM GIA TẤT CẢ CÁC PHÒNG CHAT 
    // Để nhận tin nhắn realtime ngay cả khi không mở chat đó
    const allConvs = document.querySelectorAll('.conversation-item');
    if (allConvs.length > 0) {
        console.log(`[Silent Join] Joining ${allConvs.length} conversations...`);
        allConvs.forEach(el => {
            const convId = el.dataset.id;
            if (convId) {
                socket.emit('join_conversation', { conversation_id: convId });
            }
        });
    }
  });

  // ====== NHẬN TIN NHẮN 1v1 (CẬP NHẬT PREVIEW + UNREAD) ======
  socket.on('receive_message', (data) => {
    // Chỉ xử lý cho chat riêng; group đã có handler riêng trong group.js
    if (data.conversation_type && data.conversation_type !== 'private') {
      return;
    }

    // Lấy id cuộc hội thoại từ data
    const convId = data.conversation_id || data.conversation || data.room_id || null;
    if (!convId) return;

    const myId = getUserId();
    const isMe = data.sender_id && String(data.sender_id) === String(myId);

    // Kiểm tra có đang mở đúng cuộc chat đó không
    const isCurrent = currentConversation && String(currentConversation) === String(convId);

    // 1. Nếu đang ở đúng cuộc chat -> add vào UI luôn (KHÔNG tăng unread)
    if (isCurrent) {
      addMessageToUI(data);
      // Nếu không phải mình gửi -> Đánh dấu đã đọc ngay
      if (!isMe) markMessageAsRead(data.message_id || data._id);
    }

    // 2. Cập nhật preview + badge số tin chưa đọc trong sidebar
    // Tận dụng hàm updateConversationList để tránh trùng logic
    if (typeof updateConversationList === 'function') {
      const shouldIncreaseUnread = !isMe && !isCurrent;

      updateConversationList(
        convId,
        {
          content: data.content,
          message_type: data.message_type || 'text',
          gift_style: data.gift_style,
          sender_id: data.sender_id,
          sender_name: data.sender_name,
          sender_avatar: data.sender_avatar,
          timestamp: data.timestamp || new Date().toISOString()
        },
        shouldIncreaseUnread,
        isMe
      );
    }

    // 3. Notification (popup nổi) nếu không ở trong cuộc chat đó
    // 13/12/2025 - Không hiện notification nếu hội thoại đang bị mute cho user hiện tại
    let isMutedConv = false;
    const convEl = document.querySelector(`.conversation-item[data-id="${convId}"]`);
    if (convEl && convEl.dataset.muted === '1') {
      isMutedConv = true;
    }
    if (!isMe && !isCurrent && window.showInAppNotification) {
      const senderName = data.sender_name || data.sender || 'Người dùng';
      const preview = getMessagePreview({
        content: data.content,
        message_type: data.message_type,
        gift_style: data.gift_style
      });

      window.showInAppNotification({
        title: senderName,
        messagePreview: preview,
        conversationId: convId,
        conversationType: 'private'
      });
    }
  });

// ====== CẬP NHẬT SUMMARY TỪ SERVER (1v1) ======
  socket.on('conversation_summary_updated', (data) => {
    if (!data || data.conversation_type !== 'private') return;

    // Tận dụng hàm updateConversationList để code gọn hơn
    // Lưu ý: data từ sự kiện này hơi khác data message thường, cần map lại nếu cần thiết
    // Tuy nhiên, logic cũ của bạn xử lý DOM trực tiếp cũng ổn. Giữ nguyên logic cũ cho an toàn:
    
    const conversationId = data.conversation_id;
    if (!conversationId) return;

    // 13/12/2025 - Giữ một biến duy nhất cho element hội thoại để tránh lỗi trùng tên
    const convEl = document.querySelector(`.conversation-item[data-id="${conversationId}"]`);
    if (!convEl) return; // Nếu chưa có thì thôi, đợi receive_message xử lý

    const myId = getUserId();
    const isMe = myId && String(data.last_sender_id) === String(myId);

    // Update Preview
    const previewEl = convEl.querySelector('.conversation-preview');
    if (previewEl && data.last_message) {
      let previewText = data.last_message.trim();
      const max = 35;
      if (previewText.length > max) previewText = previewText.slice(0, max) + '...';
      
      previewEl.textContent = (isMe ? 'Bạn: ' : '') + previewText;
      // Reset style về bình thường nếu đang đọc
      if (currentConversation === conversationId) {
          previewEl.style.fontWeight = 'normal';
          previewEl.style.color = '#fff';
      }
    }

    // Update Time
    if (data.last_message_time) {
      const timeEl = convEl.querySelector('.conversation-time');
      if (timeEl) {
        timeEl.dataset.timestamp = new Date(data.last_message_time).getTime();
        timeEl.textContent = formatConversationTime(data.last_message_time);
      }
    }

    // Update Unread (Số từ server)
    // Chỉ update nếu mình không đang xem
    if (currentConversation !== conversationId) {
        const unread = typeof data.unread_count === 'number' ? data.unread_count : 0;
        let unreadEl = convEl.querySelector('.unread-count');
        const statusWrap = convEl.querySelector('.conversation-status');

        if (unread > 0) {
          if (!unreadEl) {
            unreadEl = document.createElement('div');
            unreadEl.className = 'unread-count';
            if (statusWrap) statusWrap.insertBefore(unreadEl, statusWrap.firstChild);
          }
          unreadEl.textContent = unread;
        } else if (unreadEl) {
          unreadEl.remove();
        }
    }

    sortConversationsList();
  });


  // Khi có cuộc hội thoại mới
  socket.on('conversation_created', (data) => {
    if (data.participants && data.participants.includes(getUserId())) {
      addNewConversationToList(data.conversation_id);
      
      // 🔥 [FIX] Join phòng ngay lập tức để nhận tin nhắn tiếp theo
      socket.emit('join_conversation', { conversation_id: data.conversation_id });

      if (!currentConversation) {
        joinConversation(data.conversation_id);
        if (typeof onOpenPrivateConversationCb === 'function') {
          onOpenPrivateConversationCb(data.conversation_id, 'private');
        }
      }
    }
  });

  socket.on('conversation_ready', (data) => {
    joinConversation(data.conversation_id);
    if (typeof onOpenPrivateConversationCb === 'function') {
      onOpenPrivateConversationCb(data.conversation_id, 'private');
    }
  });

  // 🔥 [NEW] Lắng nghe cập nhật trạng thái online của friend cho chat header
  setupChatHeaderStatusListener();
}

// ============================================================
// CÁC HÀM SỰ KIỆN UI KHÁC
// ============================================================

export function setupConversationClickEvents(onOpen) {
  if (typeof onOpen === 'function') {
    onOpenPrivateConversationCb = onOpen;
  }

  // Dùng Event Delegation cho cha (#conversations) sẽ tốt hơn, 
  // nhưng giữ nguyên logic của bạn để tránh sửa nhiều file HTML
  const list = document.getElementById('conversations');
  if (list) {
      list.addEventListener('click', (e) => {
          const item = e.target.closest('.conversation-item');
          if (item) {
              const conversationId = item.dataset.id;
              console.log(`[Chat] Conversation clicked: ${conversationId}`);
              
              resetGroupState();
              
              const anim = document.getElementById('animation-screen');
              if (anim) anim.classList.add('hidden');

              joinConversation(conversationId);

              if (typeof onOpenPrivateConversationCb === 'function') {
                onOpenPrivateConversationCb(conversationId, 'private');
              }
          }
      });
  }
}

export function setupSendMessage() {
  // 🔥 [QUAN TRỌNG - SỬA LỖI]
  // KHÔNG gắn event listener ở đây nữa vì chat_input.js đã xử lý gửi tin nhắn thống nhất
  // cho cả chat riêng và chat nhóm
  // Giữ hàm này để tương thích với code cũ
  console.log('[Chat] setupSendMessage - Delegated to chat_input.js unified handler');
}
// --- THAY THẾ TOÀN BỘ HÀM joinConversation ---
export function joinConversation(conversationId) {
  if (!conversationId) return;

  // 1. XỬ LÝ GIAO DIỆN (UI) - QUAN TRỌNG
  // Hiện thanh nhập liệu
  const inputArea = document.querySelector('.message-input');
  if (inputArea) inputArea.classList.remove('hidden');

  // Ẩn màn hình chào mừng
  const welcomeScreen = document.getElementById('welcome-screen');
  if (welcomeScreen) welcomeScreen.style.display = 'none';

  // Ẩn các UI của nhóm (nếu đang mở nhóm)
 
  // (Hoặc gọi hàm resetGroupState() nếu bạn có)
  resetGroupState();
  hideAllGroupUI(); 

  // 2. KIỂM TRA LOGIC TRÁNH LOAD LẠI
  if (currentConversation === conversationId) return;

  // 3. THIẾT LẬP TRẠNG THÁI MỚI
  if (typeof setCurrentConversation === 'function') {
    setCurrentConversation(conversationId, 'private');
  }
  currentConversationType = 'private';
  
  // 4. LOAD TIN NHẮN GHIM & ĐÁNH DẤU ĐÃ ĐỌC
  console.log(`[Chat] Loading pinned message for: ${conversationId}`);
  loadPinnedMessage(conversationId, 'private');
  markMessagesAsRead(conversationId);

  // 5. RỜI PHÒNG CŨ - VÀO PHÒNG MỚI (SOCKET)
  if (currentConversation) {
    // Do nothing, we want to stay in the old room to receive updates
  }

  currentConversation = conversationId;
  window.currentConversation = conversationId; // Cập nhật biến Global
  
  socket.emit('join_conversation', { conversation_id: conversationId });
  
  // 6. CẬP NHẬT UI SIDEBAR (ACTIVE CLASS)
  document.querySelectorAll('.conversation-item').forEach(el => {
    el.classList.remove('active');
    if (el.dataset.id === conversationId) {
      el.classList.add('active');
    }
  });
  // 13/12/2025 - Áp dụng lại theme hội thoại ngay khi mở (dựa trên data-theme hiện tại)
  applyConversationThemeForConversation(conversationId);

  // 7. CẬP NHẬT HEADER & LOAD TIN NHẮN TỪ API
  resetPrivateChatHeader();
  
  // Hiện loading hoặc xoá tin nhắn cũ
  const messagesEl = document.getElementById('messages');
  if (messagesEl) messagesEl.innerHTML = ''; // Xóa tin cũ ngay lập tức

  fetch(`/conversation/${conversationId}`)
    .then(res => res.json())
    .then(data => {
      if (!data.messages) return;

      const myId = getUserId();

     data.messages.forEach(msg => {
        addMessageToUI(msg);

        if (msg.sender_id !== myId && msg.status !== 'read') {
          markMessageAsRead(msg.message_id);
        }
      });
      // 🔥 [CẬP NHẬT LOGIC MỚI] 🔥
      // 1. Tính toán tin nhắn mới/cũ
      const { msgs, label, isNew } = getSmartMessages(data.messages, 'private', conversationId);
      
      // 2. Hiển thị nút (Truyền thêm isNew để nút đổi màu Tím/Xám)
      showAISummaryButton('messages', msgs, label, isNew);

      // ---------------------------------------------------

      if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;

      // Cập nhật header lần cuối khi có data
      updatePrivateChatHeader(conversationId);
    })
    .catch(err => console.error('Error loading messages:', err));
}

// THÊM HÀM MỚI: Ẩn tất cả UI của nhóm
function hideAllGroupUI() {
  console.log('[Chat] Hiding all group UI elements');
  
  // Ẩn nút quản lý nhóm
  const manageBtn = document.getElementById('manage-group-btn');
  if (manageBtn) {
    manageBtn.style.display = 'none';
  }
  
  // Ẩn nút gọi nhóm
  const callBtn = document.getElementById('btn-group-call');
  if (callBtn) {
    callBtn.style.display = 'none';
  }
  
  // Ẩn header actions của nhóm
  const headerActions = document.querySelector('.header-actions');
  if (headerActions) {
    headerActions.style.display = 'none';
  }
  
  // Ẩn group header
  const groupHeader = document.querySelector('.group-header');
  if (groupHeader) {
    groupHeader.style.display = 'none';
  }
}

// THÊM HÀM MỚI: Reset header về dạng chat 1-1
function resetPrivateChatHeader() {
  const header = document.querySelector('.chat-header');
  if (!header) return;
  
  // Kiểm tra xem header đã ở dạng private chưa
  const existingPrivateHeader = header.querySelector('.private-chat-header');
  if (existingPrivateHeader) return;
  
  // Xóa tất cả nội dung header hiện tại
  header.innerHTML = '';
  
  // Tạo header mới cho chat 1-1
  const privateHeader = document.createElement('div');
  privateHeader.className = 'private-chat-header';
  privateHeader.innerHTML = `
    <h2>Messages</h2>
  `;
  
  header.appendChild(privateHeader);
}

// --- DÁN ĐOẠN NÀY VÀO FILE chat.js (Nên để gần các hàm update UI khác) ---

// Hàm gọi thoại (audio only) 1v1
function startPrivateAudioCall(conversationId) {
  if (!conversationId) {
    console.error("Thiếu Conversation ID để gọi");
    return;
  }

  console.log(`[Call] Bắt đầu gọi thoại 1v1 trong hội thoại: ${conversationId}`);

  const convItem = document.querySelector(`.conversation-item[data-id="${conversationId}"]`);
  if (!convItem) {
    console.error("[Call] Không tìm thấy conversation item");
    return;
  }
  
  const recipientId = convItem.dataset.friendId;
  if (!recipientId) {
    console.error("[Call] Không tìm thấy friend_id (recipient)");
    return;
  }
  
  const name = convItem.querySelector('.conversation-name').innerText || "Người dùng";
  const avatar = convItem.querySelector('.conversation-avatar').src || "/static/img/default-avatar.png";

  // Hiện màn hình "Đang gọi..." - dùng safety wrapper
  safeShowOutgoingCallUI(name, avatar);

  // 🔥 [NEW] Set initiator flag để tự động vô phòng khi người nhận accept
  if (window.setCallInitiator) {
      window.setCallInitiator(conversationId, 'audio');
  }

  // Gửi lệnh lên Server
  if (socket) {
    socket.emit('call:invite_private', {
      conversation_id: conversationId,
      recipient_id: recipientId,
      conversation_type: 'private',  // 🔥 FIX: Thêm loại private
      call_mode: 'audio'  // Đánh dấu là call audio
    });
    
    // [1v1] Không tự động vào phòng - chờ người nhận accept giống như group call
    console.log('[1v1 Audio Call] Đã gửi lời mời, chờ người nhận accept...');
  } else {
    alert("Mất kết nối máy chủ!");
  }
}

// Hàm gọi video 1v1
function startPrivateVideoCall(conversationId) {
  if (!conversationId) {
    console.error("Thiếu Conversation ID để gọi");
    return;
  }

  console.log(`[Call] Bắt đầu gọi video 1v1 trong hội thoại: ${conversationId}`);

  const convItem = document.querySelector(`.conversation-item[data-id="${conversationId}"]`);
  if (!convItem) {
    console.error("[Call] Không tìm thấy conversation item");
    return;
  }
  
  const recipientId = convItem.dataset.friendId;
  if (!recipientId) {
    console.error("[Call] Không tìm thấy friend_id (recipient)");
    return;
  }
  
  const name = convItem.querySelector('.conversation-name').innerText || "Người dùng";
  const avatar = convItem.querySelector('.conversation-avatar').src || "/static/img/default-avatar.png";

  // Hiện màn hình "Đang gọi..." - dùng safety wrapper
  safeShowOutgoingCallUI(name, avatar);

  // 🔥 [NEW] Set initiator flag để tự động vô phòng khi người nhận accept
  if (window.setCallInitiator) {
      window.setCallInitiator(conversationId, 'video');
  }

  // Gửi lệnh lên Server
  if (socket) {
    socket.emit('call:invite_private', {
      conversation_id: conversationId,
      recipient_id: recipientId,
      conversation_type: 'private',  // 🔥 FIX: Thêm loại private
      call_mode: 'video'  // Đánh dấu là call video
    });
    
    // [1v1] Không tự động vào phòng - chờ người nhận accept giống như group call
    console.log('[1v1 Video Call] Đã gửi lời mời, chờ người nhận accept...');
  } else {
    alert("Mất kết nối máy chủ!");
  }
}

// Export các hàm để sử dụng
window.startPrivateAudioCall = startPrivateAudioCall;
window.startPrivateVideoCall = startPrivateVideoCall;
window.unpinMessage = unpinMessage;
window.pinMessage = pinMessage;

// ============================================
// ===== SAFETY WRAPPER FOR OUTGOING CALL UI ===
// ============================================

/**
 * Hiển thị màn hình "Đang gọi..." với safety check
 * Đảm bảo UI hiện ra ngay cả khi call.js chưa load xong
 */
function safeShowOutgoingCallUI(name, avatar, callMode = 'video') {
  console.log('[Safe UI] Requesting outgoing call UI for:', name, 'mode:', callMode);
  
  // Nếu call.js đã load và có hàm showOutgoingCallUI, dùng nó
  if (typeof window.showOutgoingCallUI === 'function') {
    console.log('[Safe UI] Using call.js showOutgoingCallUI');
    window.showOutgoingCallUI(name, avatar);
    return;
  }
  
  // Fallback: Tự tạo UI đơn giản nếu call.js chưa load
  console.log('[Safe UI] call.js not ready, creating simple UI');
  
  // Xóa popup cũ nếu có
  const old = document.getElementById('outgoing-call-popup-chatjs');
  if (old) old.remove();
  
  // Tạo popup đơn giản
  const div = document.createElement('div');
  div.id = 'outgoing-call-popup-chatjs';
  div.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(0, 0, 0, 0.85); z-index: 10000;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    color: white; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  `;
  
  const avatarSrc = avatar || '/static/img/default-avatar.png';
  const callTypeText = callMode === 'audio' ? 'Đang gọi thoại...' : 'Đang gọi video...';
  
  div.innerHTML = `
    <div style="text-align: center;">
      <img src="${avatarSrc}" style="
        width: 120px; height: 120px; border-radius: 50%; 
        border: 4px solid rgba(255,255,255,0.2); object-fit: cover;
        margin-bottom: 20px;
      ">
      <h2 style="font-size: 24px; margin-bottom: 10px;">${name}</h2>
      <p style="font-size: 16px; color: #ccc; margin-bottom: 40px;">${callTypeText}</p>
      
      <button id="btn-cancel-outgoing-chatjs" style="
        background: #ff3b30; border: none; width: 70px; height: 70px;
        border-radius: 50%; color: white; font-size: 28px; cursor: pointer;
      ">
        <i class="fas fa-phone-slash"></i>
      </button>
    </div>
  `;
  
  document.body.appendChild(div);
  
  // Xử lý nút hủy
  const cancelBtn = document.getElementById('btn-cancel-outgoing-chatjs');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      div.remove();
      console.log('[Safe UI] Outgoing call cancelled');
    });
  }
  
  // Thử gọi lại hàm gốc sau 500ms nếu call.js load chậm
  setTimeout(() => {
    if (typeof window.showOutgoingCallUI === 'function' && document.getElementById('outgoing-call-popup-chatjs')) {
      console.log('[Safe UI] call.js ready now, switching to full UI');
      div.remove();
      window.showOutgoingCallUI(name, avatar);
    }
  }, 500);
}

// Export safety function
window.safeShowOutgoingCallUI = safeShowOutgoingCallUI;

// ============================================
// ===== CALL ANYWHERE - GỌI NGAY LẬP TỨC =====
// ============================================

/**
 * Gọi 1v1 ngay lập tức chỉ với friend_id
 * Không cần tìm conversation ID trước
 * @param {string} friendId - ID người bạn muốn gọi
 * @param {string} callMode - 'audio' hoặc 'video'
 */
async function startPrivateCallAnywhere(friendId, callMode = 'video') {
  if (!friendId) {
    console.error("[Call Anywhere] Thiếu friend_id để gọi");
    alert("Vui lòng nhập ID người dùng để gọi");
    return;
  }

  console.log(`[Call Anywhere] Bắt đầu gọi ${callMode} tới friend: ${friendId}`);

  try {
    // 1. Lấy hoặc tạo conversation
    const res = await fetch(`/get_or_create_conversation/${friendId}`);
    const data = await res.json();

    if (!res.ok || data.error) {
      console.error("[Call Anywhere] Lỗi lấy conversation:", data.error);
      alert("Không thể tìm thấy hoặc tạo hội thoại với người này");
      return;
    }

    const conversationId = data.conversation_id;
    const friendInfo = data.friend || {};
    
    console.log(`[Call Anywhere] Đã có conversation: ${conversationId}`);

    // 2. Lấy thông tin người gọi
    const name = friendInfo.full_name || friendInfo.username || "Người dùng";
    const avatar = friendInfo.avatar || "/static/img/default-avatar.png";

    // 3. Hiện màn hình "Đang gọi..." - dùng safety wrapper
    safeShowOutgoingCallUI(name, avatar);

    // 🔥 [NEW] Set initiator flag để tự động vô phòng khi người nhận accept
    if (window.setCallInitiator) {
        window.setCallInitiator(conversationId, callMode);
    }

    // 4. Gửi lệnh lên Server
    if (socket) {
      socket.emit('call:invite_private', {
        conversation_id: conversationId,
        recipient_id: friendId,
        conversation_type: 'private',  // 🔥 FIX: Thêm loại private
        call_mode: callMode
      });
      
      console.log(`[Call Anywhere] Đã gửi lời mời ${callMode} call tới ${friendId}`);
    } else {
      alert("Mất kết nối máy chủ!");
    }

  } catch (e) {
    console.error("[Call Anywhere] Lỗi:", e);
    alert("Lỗi khi gọi: " + e.message);
  }
}

/**
 * Gọi nhóm ngay lập tức chỉ với group_id
 * @param {string} groupId - ID nhóm muốn gọi
 * @param {string} callMode - 'audio' hoặc 'video'
 */
async function startGroupCallAnywhere(groupId, callMode = 'video') {
  if (!groupId) {
    console.error("[Call Anywhere] Thiếu group_id để gọi");
    alert("Vui lòng nhập ID nhóm để gọi");
    return;
  }

  console.log(`[Call Anywhere] Bắt đầu gọi nhóm ${callMode}: ${groupId}`);

  try {
    // 1. Lấy thông tin nhóm từ DOM hoặc API
    const groupEl = document.querySelector(`.group-item[data-group-id="${groupId}"]`);
    let groupName = "Nhóm";
    let groupAvatar = "/static/img/default-group.png";
    
    if (groupEl) {
      const nameEl = groupEl.querySelector('.group-name');
      const avatarEl = groupEl.querySelector('.group-avatar');
      if (nameEl) groupName = nameEl.textContent.trim();
      if (avatarEl) groupAvatar = avatarEl.src;
    }

    // 2. Hiện màn hình "Đang gọi..." - GIỐNG NHƯ 1V1
    safeShowOutgoingCallUI(groupName, groupAvatar);

    // 🔥 [NEW] Set initiator flag để tự động vô phòng khi có người accept
    if (window.setCallInitiator) {
        window.setCallInitiator(groupId, callMode);
    }

    // 3. Gửi lời mời gọi nhóm lên server - KHÔNG vô phòng ngay
    if (socket) {
      socket.emit('call:invite_group', {
        conversation_id: groupId,  // 🔥 SỬA: dùng conversation_id thay vì group_id
        conversation_type: 'group',  // 🔥 THÊM: chỉ định loại group
        call_mode: callMode
      });
      
      console.log(`[Call Anywhere] Đã gửi lời mời gọi nhóm ${callMode} tới ${groupId}`);
      console.log('[Group Call] Đã gửi lời mời, chờ thành viên nhóm accept...');
    } else {
      alert("Mất kết nối máy chủ!");
    }

  } catch (e) {
    console.error("[Call Anywhere] Lỗi gọi nhóm:", e);
    alert("Lỗi khi gọi nhóm: " + e.message);
  }
}

/**
 * Tìm và gọi theo tên người dùng/tên nhóm
 */
async function findAndCall(query, callMode = 'video') {
  if (!query || query.trim().length < 2) {
    alert("Vui lòng nhập ít nhất 2 ký tự để tìm");
    return;
  }

  console.log(`[Call Anywhere] Tìm kiếm: "${query}" để gọi ${callMode}`);

  try {
    // Tìm trong danh sách friends
    const friendEl = Array.from(document.querySelectorAll('.contact-item, .conversation-item')).find(el => {
      const name = el.querySelector('.contact-name, .conversation-name')?.textContent?.toLowerCase() || '';
      return name.includes(query.toLowerCase());
    });

    if (friendEl) {
      const friendId = friendEl.dataset.userId || friendEl.dataset.friendId;
      if (friendId) {
        console.log(`[Call Anywhere] Tìm thấy: ${friendId}`);
        await startPrivateCallAnywhere(friendId, callMode);
        return;
      }
    }

    // Tìm trong danh sách nhóm
    const groupEl = Array.from(document.querySelectorAll('.group-item')).find(el => {
      const name = el.querySelector('.group-name')?.textContent?.toLowerCase() || '';
      return name.includes(query.toLowerCase());
    });

    if (groupEl) {
      const groupId = groupEl.dataset.groupId;
      if (groupId) {
        console.log(`[Call Anywhere] Tìm thấy nhóm: ${groupId}`);
        startGroupCallAnywhere(groupId, callMode);
        return;
      }
    }

    alert(`Không tìm thấy "${query}" trong danh sách bạn bè hoặc nhóm`);

  } catch (e) {
    console.error("[Call Anywhere] Lỗi tìm kiếm:", e);
  }
}

// Export các hàm Call Anywhere ra window
window.startPrivateCallAnywhere = startPrivateCallAnywhere;
window.startGroupCallAnywhere = startGroupCallAnywhere;
window.findAndCall = findAndCall;

function updatePrivateChatHeader(conversationId) {
  const header = document.querySelector('.chat-header');
  if (!header) return;

  const convItem = document.querySelector(`.conversation-item[data-id="${conversationId}"]`);
  const name = convItem ? convItem.querySelector('.conversation-name').textContent : 'Người dùng';
  const avatar = convItem ? convItem.querySelector('.conversation-avatar').src : (window.defaultUserAvatar || '/static/img/default-avatar.png');

  header.innerHTML = `
    <div class="chat-header-user" style="display:flex; align-items:center; gap:10px;">
      <img src="${avatar}" class="header-avatar" style="width:40px;height:40px;border-radius:50%;object-fit:cover;">
      <div class="header-info">
        <h2 style="margin:0;font-size:16px;">${name}</h2>
        <span id="header-status-text" class="status-text" style="font-size:12px;color:#888;">
          <span class="status-dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#bbb;margin-right:5px;"></span>
          <span class="status-label">Đang tải...</span>
        </span>
      </div>
    </div>
    <div class="header-actions" style="display:flex; align-items:center; gap:10px;">
      <button id="btn-private-audio-call" class="btn-icon" title="Gọi thoại" style="font-size:1.2rem;border:none;background:none;cursor:pointer;color:#555;">
        <i class="fas fa-phone"></i>
      </button>
      <button id="btn-private-video-call" class="btn-icon" title="Gọi video" style="font-size:1.2rem;border:none;background:none;cursor:pointer;color:#555;">
        <i class="fas fa-video"></i>
      </button>
      <button id="btn-private-menu" class="btn-icon" style="font-size:1.2rem;border:none;background:none;cursor:pointer;color:#555;">
        <i class="fi fi-rr-menu-dots"></i>
      </button>
    </div>
  `;

  // 🔥 [NEW] Fetch và hiển thị trạng thái online thực tế của friend
  fetchFriendOnlineStatus(conversationId);

  // Nút gọi thoại (audio)
  const btnAudioCall = document.getElementById('btn-private-audio-call');
  if (btnAudioCall) {
    btnAudioCall.addEventListener('click', () => {
      startPrivateAudioCall(conversationId);
    });
  }

  // Nút gọi video
  const btnVideoCall = document.getElementById('btn-private-video-call');
  if (btnVideoCall) {
    btnVideoCall.addEventListener('click', () => {
      startPrivateVideoCall(conversationId);
    });
  }

  // 13/12/2025 - Gắn menu thao tác hội thoại (mute, đổi theme, xóa)
  const btnMenu = document.getElementById('btn-private-menu');
  if (btnMenu) {
    btnMenu.addEventListener('click', () => {
      openConversationOptions(conversationId);
    });
  }

  // 13/12/2025 - Áp dụng theme cho khu vực chat theo hội thoại hiện tại
  applyConversationThemeForConversation(conversationId);
}

// 13/12/2025 - Áp dụng theme (blue/pink/dark) cho khu vực chat dựa trên data-theme của conversation-item
function applyConversationThemeForConversation(conversationId) {
  const chatArea = document.querySelector('.chat-area');
  if (!chatArea) return;

  const themeClasses = ['theme-blue', 'theme-pink', 'theme-dark'];
  chatArea.classList.remove(...themeClasses);

  // 13/12/2025 - Đảm bảo xóa background ảnh cũ (nếu vừa chuyển từ theme nhóm hoặc 1v1 ảnh)
  chatArea.style.backgroundImage = '';
  chatArea.style.backgroundSize = '';
  chatArea.style.backgroundPosition = '';
  chatArea.style.backgroundRepeat = '';

  const convItem = document.querySelector(`.conversation-item[data-id="${conversationId}"]`);
  const rawTheme = convItem && convItem.dataset.theme ? convItem.dataset.theme : 'default';
let appliedType = 'color';
  let appliedValue = rawTheme;

  // 13/12/2025 - Hỗ trợ theme ảnh cho 1v1: dữ liệu lưu dạng "image:URL"
  if (rawTheme && rawTheme.startsWith('image:')) {
    appliedType = 'image';
    appliedValue = rawTheme.substring('image:'.length);
  }

  if (appliedType === 'color') {
    const theme = appliedValue || 'default';
    if (theme && theme !== 'default') {
      chatArea.classList.add(`theme-${theme}`);
    }
  } else if (appliedType === 'image' && appliedValue) {
    chatArea.style.backgroundImage = `url('${appliedValue}')`;
    chatArea.style.backgroundSize = 'cover';
    chatArea.style.backgroundPosition = 'center center';
    chatArea.style.backgroundRepeat = 'no-repeat';
  }

  // 13/12/2025 - Log debug để kiểm tra theme đã được áp dụng vào .chat-area
  console.log('[Theme] applyConversationThemeForConversation', {
    conversationId,
    rawTheme,
    appliedType,
    appliedValue,
    chatAreaClassList: Array.from(chatArea.classList),
    backgroundImage: chatArea.style.backgroundImage
  });
}

// 13/12/2025 - Mở menu context giống sidebar (Mute / Theme / Xóa)
function openConversationOptions(conversationId) {
  if (!conversationId) return;

  const convEl = document.querySelector(`.conversation-item[data-id="${conversationId}"]`);
  const btnMenu = document.getElementById('btn-private-menu');
  if (!btnMenu) return;

  const rect = btnMenu.getBoundingClientRect();
  const x = rect.left;
  const y = rect.bottom + 4; // Hiện menu ngay dưới nút 3 chấm

  showConversationContextMenu(x, y, conversationId, convEl);
}

// 🔥 [NEW] Hàm lấy trạng thái online của friend và cập nhật UI
async function fetchFriendOnlineStatus(conversationId) {
  try {
    // Lấy friend_id từ conversation
    const convEl = document.querySelector(`.conversation-item[data-id="${conversationId}"]`);
    const friendId = convEl ? convEl.dataset.friendId : null;
    
    if (!friendId) {
      console.log('[Online Status] No friendId found for conversation:', conversationId);
      return;
    }
    
    // Kiểm tra xem đã có trong cache chưa
    const cachedStatus = onlineStatusCache.get(friendId);
    if (cachedStatus && Date.now() - cachedStatus.timestamp < 30000) { // Cache 30 giây
      updateChatHeaderStatus(cachedStatus.online, cachedStatus.last_active);
      return;
    }
    
    // Fetch trạng thái online từ API
    const response = await fetch(`/user_status/${friendId}`);
    const data = await response.json();
    
    if (data.success) {
      // Lưu vào cache
      onlineStatusCache.set(friendId, {
        online: data.online,
        last_active: data.last_active,
        timestamp: Date.now()
      });
      
      updateChatHeaderStatus(data.online, data.last_active);
      // Lưu timestamp và bắt đầu interval nếu offline
      if (!data.online && data.last_active) {
        currentLastActiveTimestamp = data.last_active;
        startLastActiveUpdater();
      }
    }
  } catch (e) {
    console.error('[Online Status] Error fetching friend status:', e);
  }
}

// Cache cho trạng thái online
const onlineStatusCache = new Map();

// 🔥 [NEW] Cập nhật UI header với trạng thái online/offline
function updateChatHeaderStatus(isOnline, lastActive) {
  const statusTextEl = document.getElementById('header-status-text');
  if (!statusTextEl) return;
  
  const dotEl = statusTextEl.querySelector('.status-dot');
  const labelEl = statusTextEl.querySelector('.status-label');
  
  if (!dotEl || !labelEl) return;
  
  if (isOnline) {
    dotEl.style.background = '#4CAF50'; // Green
    dotEl.style.boxShadow = '';
    labelEl.textContent = 'Đang hoạt động';
    labelEl.style.color = '';
    // Dừng interval khi online
    stopLastActiveUpdater();
  } else {
    dotEl.style.background = '#bbb'; // Gray
    dotEl.style.boxShadow = '';
    if (lastActive) {
      const lastActiveText = formatLastActive(lastActive);
      labelEl.textContent = `Hoạt động ${lastActiveText}`;
      // Lưu timestamp và bắt đầu interval để cập nhật real-time
      currentLastActiveTimestamp = lastActive;
      startLastActiveUpdater();
    } else {
      labelEl.textContent = 'Không hoạt động';
      stopLastActiveUpdater();
    }
  }
}

// 🔥 [NEW] Format thời gian last active - FIX timezone và tính toán chính xác
function formatLastActive(timestamp) {
  if (!timestamp) return '';
  
  try {
    // Parse timestamp từ server (ISO format hoặc MongoDB date)
    let date;
    if (typeof timestamp === 'string') {
      // Đảm bảo parse đúng UTC
      if (timestamp.endsWith('Z') || timestamp.includes('+')) {
        date = new Date(timestamp);
      } else {
        // Nếu không có timezone, coi như UTC
        date = new Date(timestamp + 'Z');
      }
    } else if (timestamp instanceof Date) {
      date = timestamp;
    } else {
      return '';
    }
    
    // Kiểm tra date hợp lệ
    if (isNaN(date.getTime())) return '';
    
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diff = Math.floor(diffMs / 1000); // seconds
    
    console.log('[Last Active] Time details:', {
      now: now.toISOString(),
      date: date.toISOString(),
      diffSeconds: diff,
      diffMinutes: Math.floor(diff / 60),
      diffHours: Math.floor(diff / 3600)
    });
    
    if (diff < 0) return 'vừa xong'; // Future time protection
    if (diff < 10) return 'vừa xong';
    if (diff < 60) return `${diff} giây trước`;
    if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
    if (diff < 7200) return '1 giờ trước';
    if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
    if (diff < 172800) return 'hôm qua';
    if (diff < 604800) return `${Math.floor(diff / 86400)} ngày trước`;
    
    // Hiển thị chi tiết hơn nếu trong tuần này
    const days = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    const dayName = days[date.getDay()];
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    
    if (diff < 2592000) { // < 30 ngày
      return `${dayName} lúc ${hours}:${minutes}`;
    }
    
    return date.toLocaleDateString('vi-VN');
  } catch (e) {
    console.error('[Last Active] Error formatting:', e);
    return '';
  }
}

// 🔥 [NEW] Hàm cập nhật status khi nhận sự kiện friend_online_status - FIX real-time
let lastActiveInterval = null;
let currentLastActiveTimestamp = null;

function startLastActiveUpdater() {
  // Dừng interval cũ nếu có
  if (lastActiveInterval) {
    clearInterval(lastActiveInterval);
    lastActiveInterval = null;
  }
  
  // Chỉ chạy khi có timestamp và đang offline
  if (!currentLastActiveTimestamp) return;
  
  // Cập nhật mỗi 3 giây để smooth hơn
  lastActiveInterval = setInterval(() => {
    if (!currentConversation || !currentLastActiveTimestamp) {
      clearInterval(lastActiveInterval);
      lastActiveInterval = null;
      return;
    }
    
    const statusTextEl = document.getElementById('header-status-text');
    if (!statusTextEl) return;
    
    const labelEl = statusTextEl.querySelector('.status-label');
    if (!labelEl) return;
    
    // Chỉ cập nhật nếu đang hiển thị trạng thái offline (không phải typing)
    if (labelEl.textContent.includes('đang nhập')) return;
    
    const lastActiveText = formatLastActive(currentLastActiveTimestamp);
    const newText = `Hoạt động ${lastActiveText}`;
    
    if (labelEl.textContent !== newText) {
      console.log('[Last Active] Auto-updating:', newText);
      labelEl.textContent = newText;
    }
  }, 3000); // 3 giây để cập nhật nhanh hơn
}

function stopLastActiveUpdater() {
  if (lastActiveInterval) {
    clearInterval(lastActiveInterval);
    lastActiveInterval = null;
  }
  currentLastActiveTimestamp = null;
}

function setupChatHeaderStatusListener() {
  socket.on('friend_online_status', (data) => {
    console.log('[Chat Header] Friend status update received:', data);
    
    // Cập nhật cache ngay lập tức
    if (data.user_id) {
      onlineStatusCache.set(data.user_id, {
        online: data.is_online,
        last_active: data.last_active,
        timestamp: Date.now()
      });
    }
    
    // Kiểm tra xem có đang mở chat với user này không
    if (!currentConversation) {
      console.log('[Chat Header] No current conversation, skipping');
      return;
    }
    
    const convEl = document.querySelector(`.conversation-item[data-id="${currentConversation}"]`);
    if (!convEl) {
      console.log('[Chat Header] Conversation element not found:', currentConversation);
      return;
    }
    
    const friendId = convEl.dataset.friendId;
    console.log('[Chat Header] Comparing friend IDs:', { friendId, dataUserId: data.user_id });
    
    if (friendId && String(friendId) === String(data.user_id)) {
      console.log('[Chat Header] Match found! Updating status to:', data.is_online ? 'online' : 'offline');
      
      // Cập nhật ngay lập tức, không cần reload
      updateChatHeaderStatus(data.is_online, data.last_active);
      
      // Nếu friend offline, lưu timestamp và bắt đầu interval cập nhật
      if (!data.is_online && data.last_active) {
        currentLastActiveTimestamp = data.last_active;
        startLastActiveUpdater();
      } else if (data.is_online) {
        // Nếu online, dừng interval
        stopLastActiveUpdater();
      }
    }
  });
  
  // 🔥 [NEW] Lắng nghe sự kiện user_status tổng quát (backup)
  socket.on('user_status', (data) => {
    console.log('[Chat Header] User status event:', data);
    if (!currentConversation) return;
    
    const convEl = document.querySelector(`.conversation-item[data-id="${currentConversation}"]`);
    if (!convEl) return;
    
    const friendId = convEl.dataset.friendId;
    if (friendId && String(friendId) === String(data.userId)) {
      updateChatHeaderStatus(data.online, data.last_active);
      
      if (!data.online && data.last_active) {
        currentLastActiveTimestamp = data.last_active;
        startLastActiveUpdater();
      } else if (data.online) {
        stopLastActiveUpdater();
      }
    }
  });
}

// 13/12/2025 - Gọi API /mute_conversation để tắt/bật thông báo tạm thời
async function toggleMuteConversation(conversationId) {
  const convEl = document.querySelector(`.conversation-item[data-id="${conversationId}"]`);
  if (!convEl) return;

  const currentlyMuted = convEl.dataset.muted === '1';
  let duration = 'off';

  if (currentlyMuted) {
    const confirmOn = confirm('Bật lại thông báo cho hội thoại này?');
    if (!confirmOn) return;
    duration = 'off';
  } else {
    const input = prompt('Nhập thời gian tắt thông báo (vd: 15m, 1h, 8h, 24h, 7d, forever).\nĐể trống = 8h mặc định.', '8h');
    duration = (input || '8h').trim().toLowerCase();
  }

  try {
    const res = await fetch('/mute_conversation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: conversationId, duration })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      alert(data.error || 'Không thể cập nhật trạng thái thông báo');
      return;
    }

    const isMuted = !!data.is_muted;
    convEl.dataset.muted = isMuted ? '1' : '0';
    if (isMuted) {
      convEl.classList.add('is-muted');
    } else {
      convEl.classList.remove('is-muted');
    }

    // Cập nhật icon bell-slash trong khối status
const statusWrap = convEl.querySelector('.conversation-status');
    if (statusWrap) {
      let mutedIcon = statusWrap.querySelector('.conversation-muted-icon');
      if (isMuted) {
        if (!mutedIcon) {
          mutedIcon = document.createElement('div');
          mutedIcon.className = 'conversation-muted-icon';
          mutedIcon.title = 'Đã tắt thông báo tạm thời';
          mutedIcon.innerHTML = '<i class="fas fa-bell-slash"></i>';
          statusWrap.appendChild(mutedIcon);
        }
      } else if (mutedIcon) {
        mutedIcon.remove();
      }
    }
  } catch (e) {
    console.error('Error toggling mute conversation:', e);
    alert('Lỗi khi cập nhật tắt thông báo hội thoại');
  }
}

// 13/12/2025 - Gọi API /set_conversation_theme để đổi theme hội thoại
async function changeConversationTheme(conversationId) {
  const convEl = document.querySelector(`.conversation-item[data-id="${conversationId}"]`);
  if (!convEl) return;
  // 13/12/2025 - Dùng modal chọn theme thay vì prompt cho hội thoại 1v1
  if (window.openThemePicker) {
    window.openThemePicker('private', conversationId);
    return;
  }

  // Fallback cũ nếu vì lý do nào đó không có theme picker
  const currentTheme = convEl.dataset.theme || 'default';
  const input = prompt('Nhập theme (default, blue, pink, dark):', currentTheme);
  if (!input) return;

  const theme = input.trim().toLowerCase();

  try {
    const res = await fetch('/set_conversation_theme', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: conversationId, theme })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      alert(data.error || 'Không thể cập nhật theme hội thoại');
      return;
    }

    const appliedTheme = data.theme || 'default';
    convEl.dataset.theme = appliedTheme;
    applyConversationThemeForConversation(conversationId);
  } catch (e) {
    console.error('Error setting conversation theme:', e);
    alert('Lỗi khi đổi theme hội thoại');
  }
}

// 13/12/2025 - Gọi API /delete_conversation để xóa hội thoại khỏi danh sách cho user hiện tại
async function deleteConversationThread(conversationId) {
  const confirmDel = confirm('Bạn có chắc muốn xóa hội thoại này khỏi danh sách?\nTin nhắn vẫn được giữ cho phía người kia.');
  if (!confirmDel) return;

  try {
    const res = await fetch('/delete_conversation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: conversationId })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      alert(data.error || 'Không thể xóa hội thoại');
      return;
    }

    const convEl = document.querySelector(`.conversation-item[data-id="${conversationId}"]`);
    if (convEl && convEl.parentNode) {
      convEl.parentNode.removeChild(convEl);
}

    // Nếu đang mở đúng hội thoại đã xóa -> reset UI về màn hình chào mừng
    if (currentConversation && String(currentConversation) === String(conversationId)) {
      currentConversation = null;
      window.currentConversation = null;

      const messagesEl = document.getElementById('messages');
      if (messagesEl) messagesEl.innerHTML = '';

      const inputArea = document.querySelector('.message-input');
      if (inputArea) inputArea.classList.add('hidden');

      const welcomeScreen = document.getElementById('welcome-screen');
      if (welcomeScreen) welcomeScreen.style.display = 'flex';
    }
  } catch (e) {
    console.error('Error deleting conversation:', e);
    alert('Lỗi khi xóa hội thoại');
  }
}

// 13/12/2025 - Trạng thái modal chọn theme cho hội thoại/nhóm
let themePickerState = {
  mode: null,      // 'private' | 'group'
  targetId: null   // conversationId hoặc groupId
};

// 13/12/2025 - Tạo modal chọn theme nếu chưa tồn tại
function ensureThemePickerModal() {
  let modal = document.getElementById('theme-picker-modal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'theme-picker-modal';
  modal.className = 'theme-picker-modal hidden';
  modal.innerHTML = `
    <div class="theme-picker-backdrop"></div>
    <div class="theme-picker-content">
      <div class="theme-picker-header">
        <h3 id="theme-picker-title">Đổi theme</h3>
        <button id="theme-picker-close-btn">&times;</button>
      </div>
      <div class="theme-picker-section">
        <div class="theme-picker-title">Màu có sẵn</div>
        <div class="theme-options" id="theme-color-options">
          <button class="theme-option" data-theme="default">Mặc định</button>
          <button class="theme-option theme-option-blue" data-theme="blue">Xanh</button>
          <button class="theme-option theme-option-pink" data-theme="pink">Hồng</button>
          <button class="theme-option theme-option-dark" data-theme="dark">Tối</button>
        </div>
      </div>
      <div class="theme-picker-section theme-image-section" id="theme-image-section">
        <div class="theme-picker-title">Ảnh nền (giống Zalo)</div>
        <input type="file" id="theme-image-input" accept="image/*">
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeBtn = modal.querySelector('#theme-picker-close-btn');
  const backdrop = modal.querySelector('.theme-picker-backdrop');
  const colorContainer = modal.querySelector('#theme-color-options');
  const imageInput = modal.querySelector('#theme-image-input');

  const hideModal = () => {
    modal.classList.add('hidden');
  };

  if (closeBtn) closeBtn.addEventListener('click', hideModal);
  if (backdrop) backdrop.addEventListener('click', hideModal);

  if (colorContainer) {
    colorContainer.querySelectorAll('.theme-option').forEach(btn => {
btn.addEventListener('click', () => {
        const themeName = btn.dataset.theme || 'default';
        applyThemeColorChoice(themeName);
      });
    });
  }

  if (imageInput) {
    imageInput.addEventListener('change', () => {
      if (!imageInput.files || !imageInput.files[0]) return;
      handleThemeImageSelected(imageInput.files[0]);
      // Reset input để lần sau chọn lại được cùng file nếu muốn
      imageInput.value = '';
    });
  }

  return modal;
}

// 13/12/2025 - Mở modal chọn theme cho hội thoại (private) hoặc nhóm
function openThemePicker(mode, targetId) {
  if (!mode || !targetId) return;

  // 13/12/2025 - Debug log theo dõi mở modal chọn theme
  console.log('[ThemePicker] open', { mode, targetId });

  themePickerState.mode = mode;       // 'private' hoặc 'group'
  themePickerState.targetId = targetId;

  const modal = ensureThemePickerModal();
  const titleEl = modal.querySelector('#theme-picker-title');
  const imageSection = modal.querySelector('#theme-image-section');

  if (titleEl) {
    titleEl.textContent = mode === 'group' ? 'Đổi theme nhóm' : 'Đổi theme hội thoại';
  }

  // 13/12/2025 - Bật chọn ảnh cho cả 1v1 và group (đổi hình nền chat giống nhau)
  if (imageSection) {
    imageSection.style.display = 'block';
  }

  modal.classList.remove('hidden');
}

// Gắn ra window để group.js và các nơi khác gọi được
// 13/12/2025 - Hàm global mở modal chọn theme
window.openThemePicker = openThemePicker;

// 13/12/2025 - Áp dụng lựa chọn màu trong theme picker
async function applyThemeColorChoice(themeName) {
  if (!themePickerState || !themePickerState.targetId) return;
  const { mode, targetId } = themePickerState;

  // 13/12/2025 - Debug log khi user chọn theme màu
  console.log('[ThemePicker] applyThemeColorChoice', { mode, targetId, themeName });

  try {
    if (mode === 'private') {
      const convEl = document.querySelector(`.conversation-item[data-id="${targetId}"]`);
      if (!convEl) return;

      // 13/12/2025 - Optimistic UI: áp dụng theme ngay trên frontend trước khi chờ server
      const previousTheme = convEl.dataset.theme || 'default';
      const optimisticTheme = themeName || 'default';
      convEl.dataset.theme = optimisticTheme;
      applyConversationThemeForConversation(targetId);

      const res = await fetch('/set_conversation_theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: targetId, theme: themeName })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        // 13/12/2025 - Nếu server báo lỗi, revert về theme cũ
        convEl.dataset.theme = previousTheme;
        applyConversationThemeForConversation(targetId);
        alert(data.error || 'Không thể cập nhật theme hội thoại');
        return;
      }
const appliedTheme = data.theme || themeName || 'default';
      convEl.dataset.theme = appliedTheme;
      applyConversationThemeForConversation(targetId);
    } else if (mode === 'group') {
      // 13/12/2025 - Optimistic UI cho nhóm: áp dụng màu trực tiếp trước khi chờ server
      if (window.applyGroupThemeForCurrentUser) {
        window.applyGroupThemeForCurrentUser(targetId, {
          type: 'color',
          name: themeName || 'default'
        });
      }

      const res = await fetch('/set_group_theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_id: targetId,
          theme_type: 'color',
          theme_name: themeName
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error || 'Không thể cập nhật theme nhóm');
        return;
      }

      // Để group.js xử lý áp dụng theme thực tế cho .chat-area
      if (window.applyGroupThemeForCurrentUser) {
        window.applyGroupThemeForCurrentUser(targetId, data.theme);
      }
    }
  } catch (e) {
    console.error('Error applying theme color:', e);
    alert('Lỗi khi áp dụng theme');
  } finally {
    const modal = document.getElementById('theme-picker-modal');
    if (modal) modal.classList.add('hidden');
  }
}


// 13/12/2025 - Xử lý chọn ảnh nền cho theme (hỗ trợ cả 1v1 và nhóm)
async function handleThemeImageSelected(file) {
  if (!themePickerState || !themePickerState.mode || !themePickerState.targetId) {
    alert('Thiếu thông tin hội thoại để đặt ảnh nền.');
    return;
  }

  const { mode, targetId } = themePickerState;

  // 13/12/2025 - Debug log khi user chọn ảnh nền
  console.log('[ThemePicker] handleThemeImageSelected', { mode, targetId, fileName: file && file.name });

  try {
    const formData = new FormData();
    formData.append('image', file);
    formData.append('conversation_id', targetId);
    formData.append('conversation_type', mode === 'group' ? 'group' : 'private');

    const uploadRes = await fetch('/upload_image', {
      method: 'POST',
      body: formData
    });

    const uploadData = await uploadRes.json();
    if (!uploadRes.ok || !uploadData.success) {
      alert(uploadData.error || 'Không thể tải ảnh nền');
      return;
    }

    const imageUrl = uploadData.image_url;
    const thumbnailUrl = uploadData.thumbnail_url;

    if (mode === 'group') {
      // 13/12/2025 - Theme ảnh cho nhóm (giữ nguyên luồng cũ)
      const themeRes = await fetch('/set_group_theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_id: targetId,
          theme_type: 'image',
          image_url: imageUrl,
          thumbnail_url: thumbnailUrl
        })
      });

      const themeData = await themeRes.json();
if (!themeRes.ok || !themeData.success) {
        alert(themeData.error || 'Không thể lưu theme ảnh cho nhóm');
        return;
      }

      if (window.applyGroupThemeForCurrentUser) {
        window.applyGroupThemeForCurrentUser(targetId, themeData.theme);
      }
    } else if (mode === 'private') {
      // 13/12/2025 - Theme ảnh cho 1v1: lưu dạng image:<url> và áp dụng ngay
      const themeRes = await fetch('/set_conversation_image_theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: targetId,
          image_url: imageUrl
        })
      });

      const themeData = await themeRes.json();
      if (!themeRes.ok || !themeData.success) {
        alert(themeData.error || 'Không thể lưu theme ảnh cho hội thoại');
        return;
      }

      const convEl = document.querySelector(`.conversation-item[data-id="${targetId}"]`);
      if (convEl) {
        convEl.dataset.theme = themeData.theme || `image:${imageUrl}`;
      }

      applyConversationThemeForConversation(targetId);
    }
  } catch (e) {
    console.error('Error setting image theme for group:', e);
    alert('Lỗi khi đặt ảnh nền cho nhóm');
  } finally {
    const modal = document.getElementById('theme-picker-modal');
    if (modal) modal.classList.add('hidden');
  }
}


// ====== PINNED MESSAGE FUNCTIONS ======
async function loadPinnedMessage(conversationId, type) {
  try {
    console.log(`[Pinned Message] Loading pinned message for: ${conversationId}, type: ${type}`);
    
    const response = await fetch(`/get_pinned_message/${conversationId}?type=${type}`);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.pinned_message) {
      console.log(`[Pinned Message] Found pinned message:`, data.pinned_message);
      pinnedConversationType = type || 'private';
      pinnedMessage = data.pinned_message;
      displayPinnedMessage(pinnedMessage);
    } else {
      console.log(`[Pinned Message] No pinned message found for: ${conversationId}`);
      pinnedConversationType = type || 'private';
      hidePinnedMessage();
    }
  } catch (error) {
    console.error('Error loading pinned message:', error);
    hidePinnedMessage();
  }
}
function displayPinnedMessage(message) {
  let pinnedSection = document.getElementById('pinned-message-section');
  
  if (!pinnedSection) {
    pinnedSection = document.createElement('div');
    pinnedSection.id = 'pinned-message-section';
    pinnedSection.className = 'pinned-message-section';
    
    const messagesContainer = document.getElementById('messages');
    if (messagesContainer && messagesContainer.parentNode) {
      messagesContainer.parentNode.insertBefore(pinnedSection, messagesContainer);
    }
  }
  
  const previewText = getMessagePreview({
    content: message.content,
    message_type: message.message_type
  });
  
  pinnedSection.innerHTML = `
    <div class="pinned-message-header">
      <i class="fi fi-rr-pin"></i>
      <span>Tin nhắn được ghim</span>
      <button class="unpin-btn" onclick="unpinMessage()">
        <i class="fi fi-rr-cross"></i>
      </button>
    </div>
    <div class="pinned-message-content" onclick="scrollToPinnedMessage('${message.message_id}')">
      <img src="${message.sender_avatar}" class="pinned-sender-avatar" alt="${message.sender_name}">
      <div class="pinned-message-info">
        <div class="pinned-sender-name">${message.sender_name}</div>
        <div class="pinned-message-text">${previewText}</div>
      </div>
    </div>
  `;
  
  pinnedSection.style.display = 'block';
  
  // Lưu thông tin tin nhắn ghim để sử dụng sau này
  pinnedMessage = message;
}
export function scrollToPinnedMessage(messageId) {
  if (!messageId) return;
  
  console.log(`[Pinned Message] Scrolling to message: ${messageId}`);
  
  // Tìm element tin nhắn
  const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
  
  if (messageElement) {
    // Cuộn đến tin nhắn
    messageElement.scrollIntoView({ 
      behavior: 'smooth', 
      block: 'center' 
    });
    
    // Thêm hiệu ứng highlight
    messageElement.classList.add('highlight-message');
    
    // Xóa highlight sau 3 giây
    setTimeout(() => {
      messageElement.classList.remove('highlight-message');
    }, 3000);
    
  } else {
    // Nếu tin nhắn chưa được tải (có thể do cuộn tràn)
    console.log(`[Pinned Message] Message ${messageId} not found in current view, loading more messages...`);
    loadMessageAndScroll(messageId);
  }
}
async function loadMessageAndScroll(messageId) {
  try {
    // Gọi API để lấy thông tin tin nhắn cụ thể
    const response = await fetch(`/get_message/${messageId}`);
    const data = await response.json();
    
    if (data.success && data.message) {
      const message = data.message;
      
      // Kiểm tra xem tin nhắn có thuộc cuộc trò chuyện hiện tại không
      if (message.conversation_id === currentConversation) {
        // Tìm vị trí của tin nhắn trong danh sách
        const messagesContainer = document.getElementById('messages');
        const allMessages = Array.from(messagesContainer.querySelectorAll('.message'));
        
        // Tìm index mà tin nhắn nên được chèn vào
        // Đây là logic đơn giản - trong thực tế bạn cần logic phức tạp hơn
        // dựa trên timestamp của tin nhắn
        
        // Tạm thời hiển thị thông báo
        alert(`Tin nhắn được ghim không nằm trong phạm vi hiện tại. Cần tải thêm tin nhắn.`);
        
      } else {
        console.warn(`[Pinned Message] Message ${messageId} does not belong to current conversation`);
        alert('Tin nhắn được ghim không thuộc cuộc trò chuyện hiện tại.');
      }
    } else {
      console.error(`[Pinned Message] Failed to load message ${messageId}:`, data.error);
      alert('Không thể tải tin nhắn được ghim.');
    }
  } catch (error) {
    console.error(`[Pinned Message] Error loading message ${messageId}:`, error);
    alert('Lỗi khi tải tin nhắn được ghim.');
  }
}
function hidePinnedMessage() {
  const pinnedSection = document.getElementById('pinned-message-section');
  if (pinnedSection) {
    pinnedSection.style.display = 'none';
  }
  pinnedMessage = null;
}
function getMessageConversationType(messageId) {
  const el = document.querySelector(`[data-message-id="${messageId}"]`);
  if (el && el.dataset.conversationType) {
    return el.dataset.conversationType;
  }
  return currentConversationType || 'private';
}

export async function pinMessage(messageId) {
  if (!currentConversation || !messageId) return;

  const convType = getMessageConversationType(messageId);
  
  try {
    const response = await fetch('/pin_message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message_id: messageId,
        conversation_id: currentConversation,
        conversation_type: convType
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      socket.emit('pin_message', {
        message_id: messageId,
        conversation_id: currentConversation,
        conversation_type: convType
      });
      
      console.log(`[Pin Message] Reloading pinned message for: ${currentConversation}`);
      await loadPinnedMessage(currentConversation, convType);
      
      alert('Đã ghim tin nhắn');
    } else {
      alert('Lỗi khi ghim tin nhắn: ' + data.error);
    }
  } catch (error) {
    console.error('Error pinning message:', error);
    alert('Lỗi khi ghim tin nhắn');
  }
}


export async function unpinMessage() {
  if (!currentConversation) return;
  
  try {
    const response = await fetch('/unpin_message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: currentConversation,
        conversation_type: pinnedConversationType || currentConversationType
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      socket.emit('unpin_message', {
        conversation_id: currentConversation,
        conversation_type: pinnedConversationType || currentConversationType
      });
      hidePinnedMessage();

    } else {
      alert('Lỗi khi bỏ ghim: ' + data.error);
    }
  } catch (error) {
    console.error('Error unpinning message:', error);
    alert('Lỗi khi bỏ ghim');
  }
}

// ====== MESSAGE EDIT/DELETE FUNCTIONS ======
export async function editMessage(messageId, newContent) {
  if (!messageId || !newContent) return;
  
  try {
    // LẤY LOẠI CUỘC TRÒ CHUYỆN (private / group) TỪ DOM
    const convType = getMessageConversationType(messageId);

    const response = await fetch('/edit_message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message_id: messageId,
        new_content: newContent,
        conversation_type: convType      // 🔥 GỬI KÈM LOẠI CONVERSATION
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      // Báo cho tất cả client trong phòng
      socket.emit('message_edited', {
        message_id: messageId,
        conversation_id: currentConversation,
        conversation_type: convType,
        new_content: newContent
      });

      // Cập nhật UI local
      updateMessageUI(messageId, newContent);
    } else {
      alert('Lỗi khi sửa tin nhắn: ' + data.error);
    }
  } catch (error) {
    console.error('Error editing message:', error);
    alert('Lỗi khi sửa tin nhắn');
  }
}


export async function deleteMessage(messageId) {
  if (!messageId) return;
  
  if (!confirm('Bạn có chắc muốn thu hồi tin nhắn này?\nNgười nhận sẽ không còn nhìn thấy tin nhắn này nữa.')) return;
  
  try {
    const convType = getMessageConversationType(messageId);

    const response = await fetch('/delete_message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message_id: messageId,
        conversation_type: convType
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      socket.emit('message_deleted', {
        message_id: messageId,
        conversation_id: currentConversation,
        conversation_type: convType
      });
      removeMessageUI(messageId);
    } else {
      alert('Lỗi khi thu hồi tin nhắn: ' + data.error);
    }
  } catch (error) {
    console.error('Error recalling message:', error);
    alert('Lỗi khi thu hồi tin nhắn');
  }
}

// Xóa tin nhắn chỉ ở phía tôi
async function deleteMessageForMeOnly(messageId) {
  if (!messageId) {
    console.error('[DeleteForMe] No message ID provided');
    return;
  }
  
  console.log('[DeleteForMe] Attempting to delete message:', messageId);
  
  if (!confirm('Xóa tin nhắn này chỉ ở phía bạn?\nNgười nhận vẫn nhìn thấy tin nhắn này.')) {
    console.log('[DeleteForMe] User cancelled');
    return;
  }
  
  try {
    const convType = getMessageConversationType(messageId);
    
    const response = await fetch('/delete_message_for_me', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message_id: messageId,
        conversation_type: convType
      })
    });
    
    const data = await response.json();
    console.log('[DeleteForMe] Response:', data);
    
    if (data.success) {
      // Tìm và xóa element khỏi UI
      const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
      console.log('[DeleteForMe] Found element:', messageElement);
      
      if (messageElement) {
        messageElement.remove();
        console.log('[DeleteForMe] Message removed from UI');
      } else {
        console.warn('[DeleteForMe] Message element not found in UI');
      }
    } else {
      console.error('[DeleteForMe] Server error:', data.error);
      alert('Lỗi khi xóa tin nhắn: ' + (data.error || 'Unknown error'));
    }
  } catch (error) {
    console.error('[DeleteForMe] Error:', error);
    alert('Lỗi khi xóa tin nhắn');
  }
}

function updateMessageUI(messageId, newContent) {
  const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
  if (messageElement) {
    const messageText = messageElement.querySelector('.message-text');
    if (messageText) {
      messageText.innerHTML = escapeHtml(newContent) + ' <span class="edited-badge">(đã chỉnh sửa)</span>';
    }
  }
}

function removeMessageUI(messageId) {
  const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
  if (messageElement) {
    messageElement.remove();
  }
}

// ====== CONTEXT MENU FUNCTIONS ======
export function setupMessageContextMenu() {
  console.log('[Context Menu] Setting up message context menu...');
  
  // Đảm bảo chỉ gắn một lần
  if (window._messageContextMenuAttached) {
    console.log('[Context Menu] Already attached, skipping...');
    return;
  }
  window._messageContextMenuAttached = true;
  
  // Gắn event vào #messages container thay vì document
  const messagesContainer = document.getElementById('messages');
  if (!messagesContainer) {
    console.error('[Context Menu] #messages container not found!');
    return;
  }
  
  console.log('[Context Menu] Attaching to #messages container');
  
  // Sử dụng capture phase để bắt event sớm nhất
  messagesContainer.addEventListener('contextmenu', (e) => {
    console.log('[Context Menu] Right-click detected in messages container', e.target);
    
    // Tìm tin nhắn gần nhất - thử nhiều cách
    let messageElement = e.target.closest('.message');
    
    // Nếu không tìm thấy, thử tìm cha có class message
    if (!messageElement) {
      let el = e.target;
      while (el && el !== messagesContainer) {
        if (el.classList && el.classList.contains('message')) {
          messageElement = el;
          break;
        }
        el = el.parentElement;
      }
    }
    
    if (!messageElement) {
      console.log('[Context Menu] No message element found');
      return;
    }
    
    console.log('[Context Menu] Found message element:', messageElement);

    // Kiểm tra có phải tin nhắn 1v1 không (không phải group)
    const convType = messageElement.dataset.conversationType || messageElement.dataset.conversation_type || 'private';
    console.log('[Context Menu] Conversation type:', convType);
    
    if (convType === 'group') {
      console.log('[Context Menu] Skip group message');
      return;
    }

    // Kiểm tra có messageId không - thử cả 2 cách
    const messageId = messageElement.dataset.messageId || messageElement.dataset.id;
    console.log('[Context Menu] MessageId:', messageId);
    
    if (!messageId) {
      console.log('[Context Menu] No messageId found');
      return;
    }

    // Ngăn menu mặc định của trình duyệt
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    
    // Xác định tin nhắn của mình hay người khác
    const isMyMessage = messageElement.classList.contains('sent') || 
                        messageElement.classList.contains('me');
    
    console.log('[Context Menu] isMyMessage:', isMyMessage, 'Classes:', messageElement.classList.toString());
    
    showMessageContextMenu(e.clientX, e.clientY, messageId, isMyMessage, messageElement);
  }, true); // Use capture phase

  // Ẩn menu khi click ra ngoài
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#message-context-menu')) {
      hideMessageContextMenu();
    }
  });

  // Ẩn menu khi nhấn ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideMessageContextMenu();
    }
  });
  
  console.log('[Context Menu] Setup complete - attached to #messages');
}

function showMessageContextMenu(x, y, messageId, isMyMessage, messageElement) {
  // Ẩn menu cũ nếu có
  hideMessageContextMenu();
  
  // Tạo menu mới
  const contextMenu = document.createElement('div');
  contextMenu.id = 'message-context-menu';
  contextMenu.className = 'context-menu';
  
  // Style y chang bên group.js
  contextMenu.style.cssText = `
    position: fixed;
    left: ${x}px;
    top: ${y}px;
    background: white;
    border: 1px solid #ddd;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 10000;
    min-width: 200px;
    padding: 4px 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;
  
  // Kiểm tra tin nhắn này có phải đang được ghim không
  const isPinned = pinnedMessage && pinnedMessage.message_id === messageId;
  
  let menuItems = '';
  
  // TIN CỦA MÌNH: hiện Sửa, Thu hồi, Xóa chỉ ở phía tôi
  if (isMyMessage) {
    menuItems += `
      <div class="context-menu-item" data-action="edit" data-message-id="${messageId}">
        <i class="fi fi-rr-edit" style="margin-right: 8px;"></i>Sửa tin nhắn
      </div>
      <div class="context-menu-item" data-action="delete" data-message-id="${messageId}">
        <i class="fi fi-rr-rotate-left" style="margin-right: 8px; color: #ff9800;"></i>Thu hồi tin nhắn
      </div>
      <div class="context-menu-item" data-action="delete_for_me" data-message-id="${messageId}">
        <i class="fi fi-rr-trash" style="margin-right: 8px; color: #666;"></i>Xóa chỉ ở phía tôi
      </div>
      <div class="context-menu-divider"></div>
    `;
  } else {
    // TIN CỦA NGƯỜI KHÁC: hiện Xóa chỉ ở phía tôi
    menuItems += `
      <div class="context-menu-item" data-action="delete_for_me" data-message-id="${messageId}">
        <i class="fi fi-rr-trash" style="margin-right: 8px; color: #666;"></i>Xóa chỉ ở phía tôi
      </div>
      <div class="context-menu-divider"></div>
    `;
  }
  
  // TẤT CẢ TIN NHẮN: Ghim hoặc Bỏ ghim
  if (isPinned) {
    menuItems += `
      <div class="context-menu-item" data-action="unpin" data-message-id="${messageId}">
        <i class="fi fi-rr-thumbtack" style="margin-right: 8px; color: #ff4444;"></i>Bỏ ghim tin nhắn
      </div>
    `;
  } else {
    menuItems += `
      <div class="context-menu-item" data-action="pin" data-message-id="${messageId}">
        <i class="fi fi-rr-thumbtack" style="margin-right: 8px;"></i>Ghim tin nhắn
      </div>
    `;
  }
  
  contextMenu.innerHTML = menuItems;
  document.body.appendChild(contextMenu);
  
  // Xử lý click vào menu item
  contextMenu.querySelectorAll('.context-menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      
      const action = item.dataset.action;
      const msgId = item.dataset.messageId;
      
      console.log('[Context Menu] Action:', action, 'Message:', msgId);
      
      switch (action) {
        case 'edit':
          startEditMessage(msgId);
          break;
        case 'delete':
          deleteMessage(msgId);
          break;
        case 'delete_for_me':
          console.log('[DeleteForMe] Action triggered for message:', msgId);
          deleteMessageForMeOnly(msgId);
          break;
        case 'pin':
          pinMessage(msgId);
          break;
        case 'unpin':
          unpinMessage();
          break;
        default:
          console.warn('[Context Menu] Unknown action:', action);
      }
      
      hideMessageContextMenu();
    });
  });

  // Đảm bảo menu không vượt ra ngoài màn hình
  const rect = contextMenu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    contextMenu.style.left = (x - rect.width) + 'px';
  }
  if (rect.bottom > window.innerHeight) {
    contextMenu.style.top = (y - rect.height) + 'px';
  }
  
  console.log('[Context Menu] Menu shown at', x, y, 'isMyMessage:', isMyMessage, 'isPinned:', isPinned);
}

function hideMessageContextMenu() {
  const existingMenu = document.getElementById('message-context-menu');
  if (existingMenu) {
    existingMenu.remove();
    console.log('[Context Menu] Context menu hidden');
  }
}

window.startEditMessage = function(messageId) {
  console.log('[Context Menu] Starting edit for message:', messageId);
  
  const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
  if (!messageElement) {
    console.error('[Context Menu] Message element not found for editing');
    return;
  }
  
  const messageText = messageElement.querySelector('.message-text');
  if (!messageText) {
    console.error('[Context Menu] Message text not found for editing');
    return;
  }
  
  // Lấy nội dung hiện tại (loại bỏ badge đã chỉnh sửa nếu có)
  let currentContent = messageText.textContent;
  if (currentContent.includes('(đã chỉnh sửa)')) {
    currentContent = currentContent.replace('(đã chỉnh sửa)', '').trim();
  }
  
  const newContent = prompt('Sửa tin nhắn:', currentContent);
  if (newContent && newContent !== currentContent) {
    console.log('[Context Menu] Editing message with new content:', newContent);
    editMessage(messageId, newContent);
  } else {
    console.log('[Context Menu] Edit cancelled or no changes');
  }
  
  hideMessageContextMenu();
};
// ====== SOCKET EVENT LISTENERS ======
socket.on('message_pinned', (data) => {
  console.log(`[Socket] Message pinned in conversation: ${data.conversation_id}`);
  if (data.conversation_id === currentConversation) {
    // Load lại pinned message ngay lập tức khi nhận sự kiện từ socket
    loadPinnedMessage(data.conversation_id, data.conversation_type);
  }
});

socket.on('message_unpinned', (data) => {
  console.log(`[Socket] Message unpinned in conversation: ${data.conversation_id}`);
  if (data.conversation_id === currentConversation) {
    hidePinnedMessage();
  }
});
socket.on('message_updated', (data) => {
  if (data.conversation_id === currentConversation) {
    updateMessageUI(data.message_id, data.new_content);
  }
});

socket.on('message_removed', (data) => {
  if (data.conversation_id === currentConversation) {
    removeMessageUI(data.message_id);
  }
});

// ====== HÀM HIỂN THỊ TIN NHẮN (FULL CODE - FIX LỖI REPLY + SWIPE) ======
export function addMessageToUI(msg) {
  // 🔥 [FIX] BỎ QUA HOÀN TOÀN TIN NHẮN CALL - check mạnh hơn
  if (msg.message_type === 'call') return;
  
  // Check nếu content là JSON có status và duration (call message)
  if (typeof msg.content === 'string') {
    const trimmed = msg.content.trim();
    if (trimmed.startsWith('{') && trimmed.includes('"status"') && trimmed.includes('"duration"')) {
      try {
        const data = JSON.parse(trimmed);
        if (data.status && typeof data.duration !== 'undefined') {
          console.log('[Chat] Skipping call message:', data);
          return; // Bỏ qua không hiển thị
        }
      } catch (e) {
        // Không phải JSON hợp lệ, tiếp tục xử lý
      }
    }
  }
  
  const myId = getUserId();
  const isMe = String(msg.sender_id) === String(myId);
  const messagesEl = document.getElementById('messages');
  if (!messagesEl) return;

  const senderName = isMe ? 'Bạn' : (msg.sender_name || 'Unknown');
  const avatarUrl = msg.sender_avatar || window.defaultUserAvatar || '/static/img/default-avatar.png';

  const messageEl = document.createElement('div');
  messageEl.classList.add('message', isMe ? 'sent' : 'received');
  messageEl.dataset.conversationType = 'private';
  
  // Gắn Data ID
  const msgId = msg.message_id || msg._id;
  const senderId = msg.sender_id;
  messageEl.dataset.id = msgId; 
  messageEl.dataset.messageId = msgId; 
  messageEl.dataset.senderId = senderId;
  messageEl.dataset.senderName = senderName; 
  messageEl.dataset.conversationType = msg.conversation_type || currentConversationType || 'private';
  // LƯU THÊM THÔNG TIN REACTION LÊN DOM (NẾU CÓ)
  if (msg.reaction_details) {
    // Dạng ưu tiên: [{ user_id, user_name, emoji, avatar }]
    messageEl.dataset.reactionDetails = JSON.stringify(msg.reaction_details);
  } else if (msg.reactions) {
    // Dạng cũ: { userId: '❤️', userId2: '😂', ... }
    messageEl.dataset.reactions = JSON.stringify(msg.reactions);
  }

  let timeString = formatMessageTime(msg.timestamp);

  
   // --- 1. XỬ LÝ CONTENT (AN TOÀN) ---
  let messageType = msg.message_type || 'text';
  let parsedContent = msg.content;

  // Logic parse thông minh: Chỉ parse nếu chuỗi bắt đầu bằng {
  if (typeof msg.content === 'string') {
    const trimmed = msg.content.trim();
    if (trimmed.startsWith('{')) {
      try {
        const test = JSON.parse(msg.content);
        // ✅ hỗ trợ luôn audio và call
       if (test && ['file', 'image', 'audio', 'location', 'call'].includes(test.type)) {
          messageType = test.type; // Cập nhật type chuẩn từ JSON
          parsedContent = test;
        }
        // 🔥 FIX: Nếu JSON có status và duration -> là call message
        if (test && test.status && typeof test.duration !== 'undefined') {
          messageType = 'call';
          parsedContent = test;
        }
      } catch (e) {
        // Nếu lỗi parse, giữ nguyên là text
        messageType = 'text';
      }
    } else {
      // Check sticker
      const stickerCodes = ['sticker1', 'sticker2', 'sticker3', 'sticker4', 'sticker5', 'sticker6'];
      if (stickerCodes.includes(trimmed)) messageType = 'sticker';
    }
  }


 // --- 2. XỬ LÝ HIỂN THỊ KHUNG REPLY ---
    let replyBlock = '';
    if (msg.reply_context) {
      const isMyQuote = String(msg.reply_context.sender_id) === String(myId);
      
      let quoteText = msg.reply_context.content;
      try {
        if (typeof quoteText === 'string' && quoteText.trim().startsWith('{')) {
          const quoteObj = JSON.parse(quoteText);
          
          // --- SỬA Ở ĐÂY: THÊM DÒNG AUDIO ---
          if (quoteObj.type === 'image') quoteText = '📷 [Hình ảnh]';
          else if (quoteObj.type === 'file') quoteText = `📎 [File] ${quoteObj.name}`;
          else if (quoteObj.type === 'audio') quoteText = '🎤 [Tin nhắn thoại]'; // 👈 Thêm dòng này
          // ----------------------------------
          
        } else if (['sticker1', 'sticker2', 'sticker3', 'sticker4', 'sticker5', 'sticker6'].includes(quoteText)) {
          quoteText = '😊 [Sticker]';
        }
      } catch (e) {}

      replyBlock = `
        <div class="message-reply-quote" onclick="window.scrollToMessage('${msg.reply_context.message_id}')">
          <div class="reply-decoration"></div>
          <div class="reply-info">
            <div class="reply-sender">
              ${isMyQuote ? 'Chính bạn' : (msg.reply_context.sender_name || 'Unknown')}
            </div>
            <div class="reply-text-short">
              ${escapeHtml(quoteText || '')}
            </div>
          </div>
        </div>
      `;
    }

  // --- 3. TẠO HTML CONTENT CHÍNH ---
  let messageContent = '';

  // 🔥 [QUAN TRỌNG] Kiểm tra tin nhắn đã bị xóa/thu hồi
  const isDeleted = msg.deleted === true || msg.content === 'Tin nhắn đã được thu hồi';
  
  if (isDeleted) {
    // Hiển thị thông báo tin nhắn đã thu hồi
    messageContent = `
      <div class="message-deleted">
        <i class="fas fa-ban" style="margin-right: 6px; color: #999;"></i>
        <span style="font-style: italic; color: #888;">Tin nhắn đã được thu hồi</span>
      </div>
    `;
  } else if (messageType === 'call') {
    // 🔥 [MỚI] BỎ HIỂN THỊ TIN NHẮN CALL - user không muốn thấy thông báo kết thúc cuộc gọi
    return;
  } else if (messageType === 'file') {
    // Check if file is video
    const fileName = parsedContent.name || '';
    const isVideo = /\.(mp4|webm|mov|avi|mkv|flv|wmv)$/i.test(fileName);
    
    if (isVideo) {
      // Video message with nice CSS (không hiện tên file)
      messageContent = `
        <div class="video-message">
          <div class="video-container">
            <video controls class="video-player" preload="metadata">
              <source src="${parsedContent.url}" type="video/mp4">
              <source src="${parsedContent.url}" type="video/webm">
              Trình duyệt không hỗ trợ video.
            </video>
          </div>
          <div class="video-actions">
            <a href="${parsedContent.url}" download class="video-download">
              <i class="fas fa-download"></i> Tải xuống
            </a>
          </div>
        </div>
      `;
    } else {
      // Regular file message - Mac-style attachment
      const fileUrl = parsedContent.url || '#';
      const fileName = parsedContent.name || 'File';
      const fileSize = parsedContent.size || 0;
      
      // Get file icon class based on extension
      const ext = fileName.split('.').pop().toLowerCase();
      const fileIcons = {
        pdf: { icon: 'fa-file-pdf', class: 'pdf' },
        doc: { icon: 'fa-file-word', class: 'word' },
        docx: { icon: 'fa-file-word', class: 'word' },
        xls: { icon: 'fa-file-excel', class: 'excel' },
        xlsx: { icon: 'fa-file-excel', class: 'excel' },
        ppt: { icon: 'fa-file-powerpoint', class: 'powerpoint' },
        pptx: { icon: 'fa-file-powerpoint', class: 'powerpoint' },
        jpg: { icon: 'fa-file-image', class: 'image' },
        jpeg: { icon: 'fa-file-image', class: 'image' },
        png: { icon: 'fa-file-image', class: 'image' },
        gif: { icon: 'fa-file-image', class: 'image' },
        mp4: { icon: 'fa-file-video', class: 'video' },
        mp3: { icon: 'fa-file-audio', class: 'audio' },
        zip: { icon: 'fa-file-archive', class: 'archive' },
        rar: { icon: 'fa-file-archive', class: 'archive' },
        txt: { icon: 'fa-file-alt', class: 'text' }
      };
      const fileType = fileIcons[ext] || { icon: 'fa-file', class: 'default' };
      
      messageContent = `
        <div class="mac-file-attachment" data-file-url="${escapeHtml(fileUrl)}" data-file-name="${escapeHtml(fileName)}" data-file-size="${fileSize}">
          <div class="mac-file-icon ${fileType.class}">
            <i class="fas ${fileType.icon}"></i>
          </div>
          <div class="mac-file-info">
            <div class="mac-file-name">${escapeHtml(fileName)}</div>
            <div class="mac-file-meta">
              ${formatFileSize(fileSize)}
            </div>
          </div>
          <div class="mac-file-actions">
            <button class="mac-file-action-btn mac-file-preview-btn" title="Xem trước (Space)">
              <i class="fas fa-eye"></i>
            </button>
            <button class="mac-file-action-btn mac-file-open-btn" title="Mở file">
              <i class="fas fa-external-link-alt"></i>
            </button>
            <button class="mac-file-action-btn mac-file-download-btn" title="Tải xuống">
              <i class="fas fa-download"></i>
            </button>
          </div>
        </div>
      `;
    }
  } else if (messageType === 'image') {
    messageContent = `
      <div class="image-message">
        <img src="${parsedContent.url}" 
             class="uploaded-image" 
             alt="${escapeHtml(parsedContent.name || 'Hình ảnh')}"
             onclick="window.openImageModal && window.openImageModal('${parsedContent.url}')"
             onerror="this.onerror=null;">
        <div class="image-actions">
          <a href="${parsedContent.url}" target="_blank" class="view-original">Xem ảnh gốc</a>
        </div>
      </div>
    `;
  } else if (messageType === 'audio') {
    const audioInfo = parsedContent || {};
    const audioUrl = audioInfo.url || '';
    const audioName = audioInfo.name || 'Tin nhắn thoại';

    messageContent = `
      <div class="audio-message">
        <div class="audio-info">
          <i class="fas fa-microphone"></i>
          <span>${escapeHtml(audioName)}</span>
        </div>
        ${
          audioUrl
            ? `<audio controls src="${audioUrl}" class="voice-audio"></audio>`
            : '<span>Không tìm thấy file audio</span>'
        }
      </div>
    `;
   } else if (messageType === 'location') {
    const loc = parsedContent || {};
    const lat = loc.lat || loc.latitude;
    const lng = loc.lng || loc.longitude;
    // Lấy tên hoặc toạ độ
    const address = loc.address || loc.name || (lat && lng ? `${parseFloat(lat).toFixed(4)}, ${parseFloat(lng).toFixed(4)}` : 'Vị trí đã chia sẻ');

    let mapUrl = '#';
    if (lat && lng) {
      mapUrl = `https://www.google.com/maps?q=${lat},${lng}`;
    } else if (loc.url || loc.map_url) {
      mapUrl = loc.url || loc.map_url;
    }

    // 🔥 HTML CARD GIAO DIỆN MỚI (Trắng, chữ đen, có link)
    messageContent = `
      <div class="location-card">
        <div class="location-header">
          <div class="loc-icon-circle">
            <i class="fas fa-map-marker-alt"></i>
          </div>
          <div class="loc-info">
            <span class="loc-title" title="${escapeHtml(address)}">${escapeHtml(address)}</span>
            ${lat && lng ? `<span class="loc-coords">${parseFloat(lat).toFixed(6)}, ${parseFloat(lng).toFixed(6)}</span>` : ''}
          </div>
        </div>
        
        <a href="${mapUrl}" target="_blank" class="location-footer-link" onclick="event.stopPropagation()">
           <span>Mở Google Maps</span>
           <i class="fas fa-chevron-right"></i>
        </a>
      </div>
    `;
  } else if (messageType === 'sticker') {
    messageContent = `<div class="sticker-message">${getStickerHTML(msg.content)}</div>`;
  } else {
    messageContent = `<div class="message-text">${escapeHtml(msg.content || '')}</div>`;
  }
// 🔥 [CẬP NHẬT] LOGIC HỘP QUÀ THÔNG MINH (1v1)
  if (msg.gift_style) {
    const isOpenClass = msg.is_gift_open ? 'is-open' : '';
    const msgIdReal = msg.message_id || msg._id; // Lấy ID chuẩn

    messageContent = `
      <div class="gift-wrap gift-style-${msg.gift_style} ${isOpenClass}" 
           onclick="window.handleOpenGift(this, '${msgIdReal}', 'private')">
        <div class="gift-lid"></div>
        <div class="gift-content-real">
          ${messageContent}
        </div>
      </div>
    `;
  }
 // 🔥 [MỚI 1] XỬ LÝ HIỂN THỊ CẢM XÚC (CHAT 1-1) - ĐÃ CẬP NHẬT LOGIC SẮP XẾP
  let reactionsHTML = '';
  
  // Khai báo lại các biến cần thiết (nếu chưa có trong phạm vi này)
  const messageIdReal = msg.message_id || msg._id; 
  const conversationType = msg.conversation_type || currentConversationType || 'private'; 

  if (msg.reactions && Object.keys(msg.reactions).length > 0) {
      const allReactions = Object.values(msg.reactions);
      const totalCount = allReactions.length; // Tổng số lượt thả cảm xúc
      
      // 1. Nhóm và Đếm số lượng của từng icon
      const reactionCounts = {};
      for (const emoji of allReactions) {
        reactionCounts[emoji] = (reactionCounts[emoji] || 0) + 1;
      }

      // 2. Sắp xếp các icon theo số lượng giảm dần
      // Kết quả là mảng: [['❤️', 3], ['👍', 1]]
      const sortedReactions = Object.entries(reactionCounts).sort(([, countA], [, countB]) => countB - countA);

      let iconsHtml = '';
      // 3. Chỉ hiển thị tối đa 4 icon phổ biến nhất
      for (let i = 0; i < Math.min(4, sortedReactions.length); i++) {
        // sortedReactions[i][0] là icon emoji
        iconsHtml += sortedReactions[i][0]; 
      }
      
      // 4. Tạo HTML với ONCLICK
      reactionsHTML = `
          <div class="message-reactions-display" 
               onclick="window.viewReactionDetails(event, '${messageIdReal}', '${conversationType}')"> 
              ${iconsHtml} 
              <span style="margin-left:3px; color:#555; font-size:10px; font-weight:bold;">${totalCount}</span>
          </div>
      `;
  }

 // 🔥 [SỬA] Thêm event.stopPropagation()
  const reactionTriggerBtn = `
    <button class="message-action-btn btn-react-trigger" 
            title="Thả cảm xúc"
            onclick="event.stopPropagation(); window.showReactionPopup(this.closest('.message-content-wrapper'))">
        <i class="far fa-smile"></i>
    </button>
  `;

  // --- 4. STATUS ---
  let statusHTML = '';
  
  if (msg.timestamp) {
    const currentDate = new Date(msg.timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    // Check if we should show full time or just time
    const previousMessage = Array.from(messagesEl.children).reverse().find(el => el.classList.contains('message-item'));
    let showFullTime = true;
    
    if (previousMessage) {
      const prevTimeElement = previousMessage.querySelector('.message-time');
      if (prevTimeElement) {
        const prevTimestamp = prevTimeElement.getAttribute('title');
        if (prevTimestamp) {
          const prevDate = new Date(prevTimestamp);
          if (prevDate.toDateString() === currentDate.toDateString()) {
            showFullTime = false; // Same day, only show time
          }
        }
      }
    }
    
    if (showFullTime) {
      timeString = formatTime(msg.timestamp);
    } else {
      // Only show time (HH:mm) for same day messages
      const date = new Date(msg.timestamp);
      timeString = date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false });
    }
  }
  
  if (isMe) {
    const status = msg.status || 'sent';
    const statusText = getStatusText(status);
    const statusClass = `status-${status}`;
    statusHTML = `
      <div class="message-status-container" style="opacity: 0; transition: opacity 0.2s;">
        <span class="message-status ${statusClass}">${statusText}</span>
      </div>
    `;
  } else {
    statusHTML = `
      <div class="message-status-container" style="opacity: 0; transition: opacity 0.2s;">
      </div>
    `;
  }

 // --- 1. Tạo nút Dịch (Chỉ hiện nếu là tin nhắn chữ) ---
  // Lưu ý: Biến tin nhắn của bạn đang là 'msg' (dựa theo msg.conversation_type)
  const translateBtn = (msg.message_type === 'text') 
      ? `<button class="message-action-btn btn-translate" title="Dịch"><i class="fas fa-language"></i></button>` 
      : '';

  // --- 2. Lắp ráp HTML ---
  const showSenderName = !isMe && (currentConversationType === 'group' || msg.conversation_type === 'group');

  messageEl.innerHTML = `
    ${!isMe ? `<img src="${avatarUrl}" class="message-avatar" alt="${senderName}" title="${senderName}">` : ''}
    
    <div class="message-content-container">
      ${showSenderName ? `<div class="sender-info">${senderName}</div>` : ''}

      <div class="message-content-wrapper">
        <div class="message-content">
          <div class="message-bubble">
            ${replyBlock}     
            ${messageContent} 
            ${reactionsHTML}  
          </div>
          <div class="message-time" title="${msg.timestamp || ''}" style="font-size: 0.75rem; color: #888; margin-top: 4px; text-align: ${isMe ? 'right' : 'left'};">${timeString}</div>
          ${statusHTML}       
        </div>

        <div class="message-actions">
          ${translateBtn} ${reactionTriggerBtn} <button class="message-action-btn reply-btn" title="Trả lời">
            <i class="fas fa-reply"></i>
          </button>
        </div>
      </div>
    </div>
  `;

  // Add hover events to show/hide status
  const statusContainer = messageEl.querySelector('.message-status-container');
  if (statusContainer) {
    messageEl.addEventListener('mouseenter', () => {
      statusContainer.style.opacity = '1';
    });
    messageEl.addEventListener('mouseleave', () => {
      statusContainer.style.opacity = '0';
    });
  }

  // Check if we need to add date separator
  const previousMessage = Array.from(messagesEl.children).reverse().find(el => el.classList.contains('message-item'));
  let needDateSeparator = false;
  let dateSeparatorText = '';
  
  if (msg.timestamp) {
    const currentDate = new Date(msg.timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    // Determine date text
    if (currentDate.toDateString() === today.toDateString()) {
      dateSeparatorText = 'Hôm nay';
    } else if (currentDate.toDateString() === yesterday.toDateString()) {
      dateSeparatorText = 'Hôm qua';
    } else {
      dateSeparatorText = currentDate.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }
    
    // Check if previous message has different date
    if (previousMessage && previousMessage.classList.contains('message-item')) {
      const prevTimeElement = previousMessage.querySelector('.message-time');
      if (prevTimeElement) {
        const prevTimestamp = prevTimeElement.getAttribute('title');
        if (prevTimestamp) {
          const prevDate = new Date(prevTimestamp);
          if (prevDate.toDateString() !== currentDate.toDateString()) {
            needDateSeparator = true;
          }
        }
      }
    } else {
      // First message, always show separator
      needDateSeparator = true;
    }
  }
  
  // Add date separator if needed
  if (needDateSeparator && dateSeparatorText) {
    const separatorEl = document.createElement('div');
    separatorEl.className = 'date-separator';
    separatorEl.innerHTML = `
      <div style="text-align: center; margin: 20px 0; position: relative;">
        <span style="background: #f0f0f0; padding: 5px 15px; border-radius: 12px; font-size: 0.8rem; color: #666; position: relative; z-index: 1;">
          ${dateSeparatorText}
        </span>
        <div style="position: absolute; top: 50%; left: 0; right: 0; height: 1px; background: #e0e0e0; z-index: 0;"></div>
      </div>
    `;
    messagesEl.appendChild(separatorEl);
  }
  
  messagesEl.appendChild(messageEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  messageEl.classList.add('message-item');

  // Đánh dấu đã đọc
  if (!isMe && msg.status !== 'read') {
    markMessageAsRead(msg.message_id || msg._id);
  }
}


// --- TRONG FILE static/js/socket/chat.js ---

// ============================================================
// HÀM CẬP NHẬT DANH SÁCH HỘI THOẠI (FIX LỖI ASYNC)
// ============================================================

export function updateConversationList(conversationId, lastMessage, increaseUnread = false, isMe) {
  const listContainer = document.getElementById('conversations');
  if (!listContainer) return;

  // 1. Tìm thẻ HTML của cuộc hội thoại
  let convEl = document.querySelector(`.conversation-item[data-id="${conversationId}"]`);
  
  // Chuẩn bị dữ liệu hiển thị (dùng tạm nếu chưa fetch kịp)
  const senderName = isMe ? 'Bạn' : (lastMessage.sender_name || 'Người dùng');
  // Nếu là tin mình gửi thì avatar là recipient (nếu có data), ko thì default
  // Nếu người khác gửi thì lấy sender_avatar
  const avatarUrl = isMe ? (lastMessage.recipient_avatar || '/static/img/default-avatar.png') 
                         : (lastMessage.sender_avatar || '/static/img/default-avatar.png');

  // 2. NẾU CHƯA CÓ TRONG DANH SÁCH -> TẠO MỚI NGAY LẬP TỨC (Synchronous)
  if (!convEl) {
    convEl = document.createElement('div');
    convEl.className = 'conversation-item';
    convEl.dataset.id = conversationId;
    
    // Tạo cấu trúc HTML giống hệt server render
    convEl.innerHTML = `
      <div class="conversation-avatar-wrapper">
        <img src="${avatarUrl}" class="conversation-avatar" alt="${senderName}">
        <span class="online-status-indicator" style="display: none;"></span>
      </div>
      <div class="conversation-info">
        <div class="conversation-name">${!isMe ? senderName : 'Cuộc trò chuyện mới'}</div>
        <div class="conversation-preview"></div>
      </div>
      <div class="conversation-status">
        <div class="conversation-time">Vừa xong</div>
        <button class="conv-call-btn" title="Gọi nhanh" style="border:none;background:none;cursor:pointer;">
            <i class="fas fa-video"></i>
        </button>
      </div>
    `;

    // Chèn lên đầu danh sách NGAY LẬP TỨC
    listContainer.prepend(convEl);
    
    // Gắn sự kiện click (quan trọng)
    convEl.addEventListener('click', () => {
       const anim = document.getElementById('animation-screen');
       if (anim) anim.classList.add('hidden');
       
       // Gọi hàm mở chat từ chat.js
       joinConversation(conversationId);
       
       if (typeof onOpenPrivateConversationCb === 'function') {
         onOpenPrivateConversationCb(conversationId, 'private');
       }
    });

    // Gắn sự kiện nút gọi nhanh
    const callBtn = convEl.querySelector('.conv-call-btn');
    if(callBtn) {
        callBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // 🔥 FIX: Thêm callMode 'video' cho nút gọi nhanh
            if(window.startPrivateCall) window.startPrivateCall(conversationId, 'video');
        });
    }
    
   // Gọi API ngầm để update tên/avatar chính xác nhất (nếu socket thiếu data)
    if (isMe || !lastMessage.sender_name) {
        fetch(`/conversation_info_with_preview/${conversationId}`)
            .then(r => r.json())
            .then(info => {
                if(info.friend_name) convEl.querySelector('.conversation-name').textContent = info.friend_name;
                if(info.friend_avatar) convEl.querySelector('.conversation-avatar').src = info.friend_avatar;
                // 13/12/2025 - Cập nhật trạng thái mute & theme từ server nếu có
                if (typeof info.is_muted !== 'undefined') {
                  convEl.dataset.muted = info.is_muted ? '1' : '0';
                  if (info.is_muted) {
                    convEl.classList.add('is-muted');
                  } else {
                    convEl.classList.remove('is-muted');
                  }
                }
                if (info.theme) {
                  convEl.dataset.theme = info.theme;
                }
                // Thêm/bỏ icon bell-slash trong trạng thái
                const statusWrap = convEl.querySelector('.conversation-status');
                if (statusWrap) {
                  let mutedIcon = statusWrap.querySelector('.conversation-muted-icon');
                  const isMutedNow = convEl.dataset.muted === '1';
                  if (isMutedNow) {
                    if (!mutedIcon) {
                      mutedIcon = document.createElement('div');
                      mutedIcon.className = 'conversation-muted-icon';
                      mutedIcon.title = 'Đã tắt thông báo tạm thời';
                      mutedIcon.innerHTML = '<i class="fas fa-bell-slash"></i>';
                      statusWrap.appendChild(mutedIcon);
                    }
                  } else if (mutedIcon) {
                    mutedIcon.remove();
                  }
                }
            })
            .catch(e => console.log('Background fetch info error:', e));
    }
  }

  // 3. CẬP NHẬT DATA ATTRIBUTES
  convEl.dataset.lastMessage = JSON.stringify(lastMessage.content);
  convEl.dataset.lastMessageType = lastMessage.message_type || 'text';
  convEl.dataset.lastMessageSender = lastMessage.sender_id;

  // 4. CẬP NHẬT PREVIEW (NỘI DUNG TIN NHẮN)
  const previewEl = convEl.querySelector('.conversation-preview');
  if (previewEl) {
    const previewText = getMessagePreview({
        content: lastMessage.content,
        message_type: lastMessage.message_type,
        gift_style: lastMessage.gift_style
    });
    
    previewEl.textContent = (isMe ? 'Bạn: ' : '') + previewText;
    
    // Style đậm/nhạt tùy theo đã đọc hay chưa
    if (increaseUnread) {
        previewEl.style.fontWeight = 'bold';
        previewEl.style.color = '#fff';
    } else {
        previewEl.style.fontWeight = 'normal';
        previewEl.style.color = '#fff';
    }
  }

  // 5. CẬP NHẬT THỜI GIAN
  const timeEl = convEl.querySelector('.conversation-time');
  if (timeEl && lastMessage.timestamp) {
    timeEl.textContent = 'Vừa xong'; 
    timeEl.dataset.timestamp = new Date(lastMessage.timestamp).getTime();
  }

  // 6. XỬ LÝ BADGE SỐ LƯỢNG (QUAN TRỌNG)
  if (increaseUnread) {
    updateUnreadCount(convEl, 1);
  }

  // 7. LUÔN ĐẨY LÊN ĐẦU DANH SÁCH
  // (Dùng prepend để di chuyển element đã có lên đầu)
  listContainer.prepend(convEl);
}

// Hàm cập nhật số lượng tin chưa đọc (Phiên bản chuẩn)
function updateUnreadCount(conversationEl, increment) {
  // Tìm wrapper chứa status
  const statusWrap = conversationEl.querySelector('.conversation-status');
  if (!statusWrap) return;

  // Tìm badge hiện tại
  let unreadEl = statusWrap.querySelector('.unread-count');

  if (unreadEl) {
    // A. Đã có badge -> Tăng số
    let currentCount = parseInt(unreadEl.textContent, 10) || 0;
    let newCount = currentCount + increment;
    
    if (newCount <= 0) {
        unreadEl.remove(); // Hết tin chưa đọc -> Xóa badge
    } else {
        unreadEl.textContent = newCount > 99 ? '99+' : newCount;
    }
  } else if (increment > 0) {
    // B. Chưa có badge -> Tạo mới
    unreadEl = document.createElement('div');
    unreadEl.className = 'unread-count';
    unreadEl.textContent = increment;
    
    // Chèn badge vào vị trí đẹp (trước nút gọi hoặc sau thời gian)
    const callBtn = statusWrap.querySelector('.conv-call-btn');
    if (callBtn) {
        statusWrap.insertBefore(unreadEl, callBtn);
    } else {
        statusWrap.appendChild(unreadEl);
    }
  }
}
export function addNewConversationToList(conversationId) {
  fetch(`/conversation_info_with_preview/${conversationId}`)
    .then(res => res.json())
    .then(data => {
      const existingConv = document.querySelector(`.conversation-item[data-id="${conversationId}"]`);
      if (existingConv) {
        console.log(`Conversation ${conversationId} already exists in list`);
        return;
      }

      const convEl = document.createElement('div');
      convEl.className = 'conversation-item';
      convEl.dataset.id = conversationId;
      convEl.dataset.lastMessage = data.last_message ? JSON.stringify(data.last_message) : '';
      convEl.dataset.lastMessageType = data.last_message_type || 'text';
      convEl.dataset.lastMessageSender = data.last_message_sender || '';
       // 13/12/2025 - Thiết lập trạng thái mute & theme nếu server cung cấp
      if (typeof data.is_muted !== 'undefined') {
        convEl.dataset.muted = data.is_muted ? '1' : '0';
        if (data.is_muted) {
          convEl.classList.add('is-muted');
        }
      } else {
        convEl.dataset.muted = '0';
      }
      convEl.dataset.theme = data.theme || 'default';

      const myId = getUserId();
      const isLastMessageFromMe = data.last_message_sender === myId;

            let previewText = '';

      const hasStructuredType = ['location', 'file', 'image', 'audio', 'sticker'].includes(
        data.last_message_type
      );

      if (data.last_message_preview && !hasStructuredType) {
        // Nếu server gửi preview text "thường" (không phải JSON, không phải loại đặc biệt)
        const trimmed = String(data.last_message_preview).trim();
        const looksLikeJson =
          (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
          (trimmed.startsWith('[') && trimmed.endsWith(']'));

        if (!looksLikeJson) {
          previewText = data.last_message_preview;
        } else {
          // Nếu nó giống JSON -> dùng getMessagePreview cho chắc
          previewText = getMessagePreview({
            content: data.last_message,
            message_type: data.last_message_type
          });
        }
      } else {
        // Mặc định: cứ cho getMessagePreview xử lý hết
        previewText = getMessagePreview({
          content: data.last_message,
          message_type: data.last_message_type
        });
      }


      const timestamp = data.last_message_time ? new Date(data.last_message_time).getTime() : Date.now();
      const displayTime = data.last_message_time ? 
        formatConversationTime(data.last_message_time) : 
        formatConversationTime(data.created_at);

      convEl.innerHTML = `
        <div class="conversation-avatar-wrapper">
          <img src="${data.friend_avatar || '/static/img/default-avatar.png'}" class="conversation-avatar" alt="${data.friend_name || ''}">
          <span class="online-status-indicator ${data.is_online ? 'online' : ''}"></span>
        </div>
        <div class="conversation-info">
          <div class="conversation-name">${data.friend_name || 'Người dùng'}</div>
          <div class="conversation-preview">${isLastMessageFromMe && data.last_message ? 'Bạn: ' : ''}${previewText}</div>
        </div>
        <div class="conversation-status">
          <div class="conversation-time" data-timestamp="${timestamp}">
            ${displayTime}
          </div>
          ${data.unread_count > 0 ? `<div class="unread-count">${data.unread_count}</div>` : ''}
          <button class="conv-call-btn" title="Gọi nhanh 1v1" style="border:none;background:none;cursor:pointer;font-size:1.1rem;">
            <i class="fas fa-video"></i>
          </button>
        </div>
      `;

      // 🔥 NÚT GỌI NHANH 1v1 NGAY TRONG LIST
      const quickCallBtn = convEl.querySelector('.conv-call-btn');
      if (quickCallBtn) {
        quickCallBtn.addEventListener('click', (e) => {
          e.stopPropagation(); // Không mở chat khi bấm nút call
          // 🔥 FIX: Thêm callMode 'video' cho nút gọi nhanh
          startPrivateCall(conversationId, 'video');
        });
      }

      convEl.addEventListener('click', () => {
        const anim = document.getElementById('animation-screen');
        if (anim) anim.classList.add('hidden');

        joinConversation(conversationId);

        if (typeof onOpenPrivateConversationCb === 'function') {
          onOpenPrivateConversationCb(conversationId, 'private');
        }
      });

      const list = document.getElementById('conversations');
      if (list) {
        list.prepend(convEl);
        sortConversationsList();
      }
    })
    .catch(err => console.error('Error creating conversation item:', err));
}


function sortConversationsList() {
  const conversationsContainer = document.getElementById('conversations');
  if (!conversationsContainer) return;

  const conversations = Array.from(conversationsContainer.querySelectorAll('.conversation-item'));
  
  conversations.sort((a, b) => {
    const aUnread = a.querySelector('.unread-count');
    const bUnread = b.querySelector('.unread-count');
    
    if (aUnread && !bUnread) return -1;
    if (!aUnread && bUnread) return 1;
    if (aUnread && bUnread) {
      const aCount = parseInt(aUnread.textContent);
      const bCount = parseInt(bUnread.textContent);
      if (aCount !== bCount) return bCount - aCount;
    }
    
    const aTimeEl = a.querySelector('.conversation-time');
    const bTimeEl = b.querySelector('.conversation-time');
    
    const aTime = aTimeEl?.dataset.timestamp || 0;
    const bTime = bTimeEl?.dataset.timestamp || 0;
    
    return parseInt(bTime) - parseInt(aTime);
  });

  conversations.forEach(conv => {
    conversationsContainer.appendChild(conv);
  });
}

// ====== UTILITY FUNCTIONS ======
// --- 1. THAY THẾ HÀM formatMessageTime ---
function formatMessageTime(timestamp) {
  if (!timestamp) return '';
  
  // Nếu có moment.js thì dùng cho chuẩn
  if (window.moment) {
    const m = moment(timestamp);
    const now = moment();
    
    if (!m.isValid()) return 'Vừa xong';
    
    // Nếu nhỏ hơn 1 phút
    if (now.diff(m, 'seconds') < 60) return 'Vừa xong';
    
    // Nếu trong ngày hôm nay: "10:30"
    if (m.isSame(now, 'day')) {
      return m.format('HH:mm');
    }
    
    // Nếu là hôm qua: "Hôm qua 10:30"
    if (m.isSame(now.clone().subtract(1, 'days'), 'day')) {
      return 'Hôm qua ' + m.format('HH:mm');
    }
    
    // Nếu trong năm nay: "20/11 10:30"
    if (m.isSame(now, 'year')) {
      return m.format('DD/MM HH:mm');
    }
    
    // Khác năm: "20/11/2023"
    return m.format('DD/MM/YYYY');
  }

  // Fallback nếu không có moment (Javascript thuần)
  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return '';
  }
}

// --- 2. THAY THẾ HÀM formatConversationTime (Cho danh sách bên trái) ---
function formatConversationTime(timestamp) {
  if (!timestamp) return '';
  
  // Handle both numeric timestamp and ISO string
  let date;
  if (typeof timestamp === 'number' || /^\d+$/.test(String(timestamp))) {
    date = new Date(parseInt(timestamp));
  } else {
    date = new Date(timestamp);
  }
  
  if (isNaN(date.getTime())) return '';
  
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  
  // Less than 1 minute: "Vừa xong"
  if (diffSec < 60) return 'Vừa xong';
  
  // Less than 1 hour: "5 phút trước"
  if (diffMin < 60) return `${diffMin} phút trước`;
  
  // Less than 24 hours: "3 giờ trước"
  if (diffHour < 24) return `${diffHour} giờ trước`;
  
  // Yesterday: "Hôm qua"
  if (diffDay === 1) return 'Hôm qua';
  
  // Less than 7 days: show day name
  if (diffDay < 7) {
    const days = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    return days[date.getDay()];
  }
  
  // Same year: "20/11"
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}`;
  }
  
  // Different year: "20/11/2023"
  return `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getFullYear()}`;
}
function getMessagePreview(message) {
  if (!message) return 'Bắt đầu trò chuyện';

  // Ưu tiên hộp quà
  if (message.gift_style) {
    return '🎁 Tin nhắn hộp quà';
  }

  const type = message.message_type || 'text';
  let content = message.content;

  // ===== LOCATION =====
  if (type === 'location') {
    try {
      const loc = typeof content === 'string' ? JSON.parse(content) : (content || {});
      const name = loc.name || loc.label;
      return name ? `📍 ${name}` : '📍 Đã chia sẻ vị trí';
    } catch (e) {
      return '📍 Đã chia sẻ vị trí';
    }
  }

  // ===== FILE =====
  if (type === 'file') {
    try {
      const fileInfo = typeof content === 'string' ? JSON.parse(content) : content;
      const fileName = fileInfo?.name || fileInfo?.filename || 'File';
      return `📎 ${fileName}`;
    } catch (e) {
      return '📎 File';
    }
  }

  // ===== IMAGE =====
  if (type === 'image') {
    try {
      const imageInfo = typeof content === 'string' ? JSON.parse(content) : content;
      const imageName = imageInfo?.name || imageInfo?.filename || 'Hình ảnh';
      return `🖼️ ${imageName}`;
    } catch (e) {
      return '🖼️ Hình ảnh';
    }
  }

  // ===== AUDIO =====
  if (type === 'audio') {
    try {
      const audioInfo = typeof content === 'string' ? JSON.parse(content) : content;
      const audioName = audioInfo?.name || 'Tin nhắn thoại';
      return `🎤 ${audioName}`;
    } catch (e) {
      return '🎤 Tin nhắn thoại';
    }
  }

  // ===== STICKER =====
  const stickerCodes = ['sticker1', 'sticker2', 'sticker3', 'sticker4', 'sticker5', 'sticker6'];
  if (type === 'sticker') {
    return '😊 Sticker';
  }
  if (typeof content === 'string' && stickerCodes.includes(content.trim())) {
    return '😊 Sticker';
  }

  // ===== FALLBACK TEXT / OLD JSON =====
  if (typeof content === 'string') {
    const trimmed = content.trim();

    // Thử parse JSON cũ
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const data = JSON.parse(trimmed);

        if (data.type === 'file') {
          const fileName = data.name || data.filename || 'File';
          return `📎 ${fileName}`;
        }
        if (data.type === 'image') {
          const imageName = data.name || data.filename || 'Hình ảnh';
          return `🖼️ ${imageName}`;
        }
        if (data.type === 'audio') {
          const audioName = data.name || 'Tin nhắn thoại';
          return `🎤 ${audioName}`;
        }
        if (data.type === 'location') {
          const name = data.name || data.label;
          return name ? `📍 ${name}` : '📍 Đã chia sẻ vị trí';
        }
      } catch (e) {
        // Nếu parse lỗi, coi như text bình thường
      }
    }

    let text = trimmed.replace(/\r/g, ' ').replace(/\n/g, ' ');
    if (!text) return 'Bắt đầu trò chuyện';

    const max = 35;
    return text.length > max ? text.slice(0, max) + '...' : text;
  }

  // Nếu content không phải string (object/number...)
  const asString = String(content ?? '').trim();
  if (!asString) return 'Bắt đầu trò chuyện';
  const max = 35;
  return asString.length > max ? asString.slice(0, max) + '...' : asString;
}


function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getStickerHTML(stickerCode) {
  const stickerMap = {
    'sticker1': '😀',
    'sticker2': '😂',
    'sticker3': '😍',
    'sticker4': '🤔',
    'sticker5': '👍',
    'sticker6': '❤️'
  };
  return `<span class="sticker">${stickerMap[stickerCode] || stickerCode}</span>`;
}

function escapeHtml(unsafe = '') {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ====== MESSAGE STATUS FUNCTIONS ======
export function setupMessageStatus() {
  // Lắng nghe cập nhật status từ server
  socket.on('message_status_updated', (data) => {
      console.log('[Status Update] Received message_status_updated:', data);
      updateMessageStatusUI(data.message_id, data.status);
  });

  // 🔥 [NEW] Khi server yêu cầu đánh dấu read (người nhận đang online VÀ đang xem conversation)
  socket.on('message_read_request', (data) => {
      console.log('[Read Request] Server yêu cầu đánh dấu read:', data);
      const { message_id, conversation_id } = data;
      
      // Chỉ đánh dấu read nếu tin nhắn không phải của mình và đang đúng conversation
      const messageEl = document.querySelector(`[data-message-id="${message_id}"]`);
      if (messageEl) {
          const senderId = messageEl.dataset.senderId;
          const myId = getUserId();
          
          // Nếu mình là người nhận (không phải người gửi), emit read
          if (senderId && String(senderId) !== String(myId)) {
              markMessageAsRead(message_id);
              console.log(`[Read Request] Marked message ${message_id} as read`);
          }
      }
  });

  // 🔥 [QUAN TRỌNG] Khi server yêu cầu đánh dấu delivered (người nhận đang online nhưng không xem conversation)
  socket.on('message_delivered_request', (data) => {
      console.log('[Delivered Request] Server yêu cầu đánh dấu delivered:', data);
      const { message_id, conversation_id } = data;
      
      // Chỉ đánh dấu delivered nếu tin nhắn không phải của mình
      const messageEl = document.querySelector(`[data-message-id="${message_id}"]`);
      if (messageEl) {
          const senderId = messageEl.dataset.senderId;
          const myId = getUserId();
          
          // Nếu mình là người nhận (không phải người gửi), emit delivered
          if (senderId && String(senderId) !== String(myId)) {
              markMessageAsDelivered(message_id);
              console.log(`[Delivered Request] Marked message ${message_id} as delivered`);
          }
      }
  });

  // 🔥 [NEW] Typing indicator - Hiển thị "đang nhập..." trong header
  let typingTimeout = null;
  let currentTypingUser = null;
  
  socket.on('typing', (data) => {
      console.log('[Typing] User đang nhập:', data);
      const { conversation_id, user_id, username } = data;
      
      // Chỉ hiển thị nếu đang mở đúng conversation
      if (currentConversation !== String(conversation_id)) return;
      
      // Không hiển thị nếu chính mình đang nhập
      const myId = getUserId();
      if (String(user_id) === String(myId)) return;
      
      currentTypingUser = username;
      showTypingIndicator(username);
      
      // Xóa typing indicator sau 3 giây nếu không nhận thêm event
      if (typingTimeout) clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
          hideTypingIndicator();
          currentTypingUser = null;
      }, 3000);
  });
  
  socket.on('stop_typing', (data) => {
      console.log('[Stop Typing] User dừng nhập:', data);
      const { conversation_id, user_id } = data;
      
      if (currentConversation === String(conversation_id)) {
          hideTypingIndicator();
          currentTypingUser = null;
          if (typingTimeout) clearTimeout(typingTimeout);
      }
  });
}

// --- 3. THAY THẾ HÀM getStatusText ---
function getStatusText(status) {
  const statusMap = {
      'sent': 'Đã gửi',
      'delivered': 'Đã nhận',
      'read': 'Đã xem'
  };
  return statusMap[status] || 'Đã gửi';
}

// 🔥 [NEW] Typing indicator functions - ĐẸP HƠN với animation
function showTypingIndicator(username) {
  const statusTextEl = document.getElementById('header-status-text');
  if (!statusTextEl) return;
  
  const dotEl = statusTextEl.querySelector('.status-dot');
  const labelEl = statusTextEl.querySelector('.status-label');
  
  if (dotEl) {
      dotEl.style.background = 'linear-gradient(135deg, #4CAF50, #8BC34A)';
      dotEl.style.boxShadow = '0 0 8px rgba(76, 175, 80, 0.6)';
      dotEl.style.animation = 'typingPulse 1.5s ease-in-out infinite';
  }
  if (labelEl) {
      labelEl.innerHTML = `<span class="typing-text">${escapeHtml(username)} đang nhập</span><span class="typing-dots"><span>.</span><span>.</span><span>.</span></span>`;
      labelEl.style.color = '#4CAF50';
      labelEl.style.fontWeight = '500';
  }
  
  // Thêm CSS animation nếu chưa có
  if (!document.getElementById('typing-indicator-styles')) {
      const style = document.createElement('style');
      style.id = 'typing-indicator-styles';
      style.textContent = `
          @keyframes typingPulse {
              0%, 100% { transform: scale(1); opacity: 1; }
              50% { transform: scale(1.2); opacity: 0.8; }
          }
          @keyframes typingDot {
              0%, 60%, 100% { opacity: 0; transform: translateY(0); }
              30% { opacity: 1; transform: translateY(-2px); }
          }
          .typing-dots span {
              animation: typingDot 1.4s infinite;
              display: inline-block;
          }
          .typing-dots span:nth-child(2) { animation-delay: 0.2s; }
          .typing-dots span:nth-child(3) { animation-delay: 0.4s; }
          .typing-text {
              margin-right: 2px;
          }
      `;
      document.head.appendChild(style);
  }
}

function hideTypingIndicator() {
  const statusTextEl = document.getElementById('header-status-text');
  if (!statusTextEl) return;
  
  const dotEl = statusTextEl.querySelector('.status-dot');
  const labelEl = statusTextEl.querySelector('.status-label');
  
  if (dotEl) {
      dotEl.style.boxShadow = '';
      dotEl.style.animation = '';
  }
  if (labelEl) {
      labelEl.style.color = '';
      labelEl.style.fontWeight = '';
  }
  
  // Khôi phục lại trạng thái online/offline
  if (currentConversation) {
      fetchFriendOnlineStatus(currentConversation);
  }
}

// 🔥 [NEW] Emit typing events từ client - đảm bảo emit cho cả group và 1v1
let myTypingTimeout = null;
let isTyping = false;

export function emitTyping() {
  if (!currentConversation || !socket) return;
  
  if (!isTyping) {
      isTyping = true;
      
      // Emit event phù hợp với loại conversation
      if (currentConversationType === 'group') {
          socket.emit('typing', {
              conversation_id: currentConversation,
              conversation_type: 'group'
          });
      } else {
          socket.emit('typing', {
              conversation_id: currentConversation,
              conversation_type: 'private'
          });
      }
      console.log('[Typing] Emitted typing for:', currentConversationType, currentConversation);
  }
  
  // Clear previous timeout
  if (myTypingTimeout) clearTimeout(myTypingTimeout);
  
  // Stop typing sau 2 giây không nhập
  myTypingTimeout = setTimeout(() => {
      emitStopTyping();
  }, 2000);
}

export function emitStopTyping() {
  if (!currentConversation || !socket) return;
  
  isTyping = false;
  if (myTypingTimeout) clearTimeout(myTypingTimeout);
  
  // Emit event phù hợp với loại conversation
  if (currentConversationType === 'group') {
      socket.emit('stop_typing', {
          conversation_id: currentConversation,
          conversation_type: 'group'
      });
  } else {
      socket.emit('stop_typing', {
          conversation_id: currentConversation,
          conversation_type: 'private'
      });
  }
  console.log('[Typing] Emitted stop_typing for:', currentConversationType, currentConversation);
}

// --- 4. THAY THẾ HÀM updateMessageStatusUI ---
export function updateMessageStatusUI(messageId, status) {
  console.log(`[Status Update] Updating message ${messageId} to ${status}`); // for debugging
  const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
  if (!messageElement) {
    console.warn(`[Status Update] Message element not found for ${messageId}`);
    return;
  }

  // Tìm element hiển thị status
  const statusElement = messageElement.querySelector('.message-status');
  const container = messageElement.querySelector('.message-status-container');

  if (statusElement) {
      statusElement.textContent = getStatusText(status);
      
      // Xóa các class cũ
      statusElement.classList.remove('status-sent', 'status-delivered', 'status-read');
      // Thêm class mới
      statusElement.classList.add(`status-${status}`);
      
      // Nếu là "read", có thể thêm icon check đôi nếu muốn (tùy CSS)
      if (status === 'read') {
        // Logic phụ: Nếu muốn ẩn chữ "Đã xem" sau vài giây thì code ở đây
      }
  }
}

export function markMessageAsRead(messageId, conversationType = 'private') {
  socket.emit('message_read', { 
    message_id: messageId,
    conversation_type: conversationType
  });
}

export function markMessageAsDelivered(messageId) {
  socket.emit('message_delivered', { message_id: messageId });
}

export function markMessagesAsRead(conversationId) {
  fetch(`/mark_as_read/${conversationId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  })
  .then(r => r.json())
  .then(data => {
    if (data.success) {
      const conversationEl = document.querySelector(`.conversation-item[data-id="${conversationId}"]`);
      if (conversationEl) {
        const unreadCountEl = conversationEl.querySelector('.unread-count');
        if (unreadCountEl) unreadCountEl.remove();
        sortConversationsList();
      }
    }
  })
  .catch(error => console.error('Error marking messages as read:', error));
}

export function decrementUnreadCount(conversationId, decrement = 1) {
  const conversationEl = document.querySelector(`.conversation-item[data-id="${conversationId}"]`);
  if (conversationEl) {
    updateUnreadCount(conversationEl, -decrement);
  }
}

export function getUserId() {
  // Ưu tiên lấy từ window.session (đúng với chat.html)
  if (window.session && window.session.user_id) {
    return window.session.user_id;
  }
  
  // Fallback: tìm element có data-user-id
  const userAvatar = document.querySelector('.user-avatar[data-user-id]');
  if (userAvatar) {
    return userAvatar.dataset.userId;
  }
  
  // Fallback cuối cùng: tìm user-avatar bất kỳ
  const avatarEl = document.querySelector('.user-avatar');
  return avatarEl ? avatarEl.dataset.userId : null;
}

export function resetCurrentConversation() {
  currentConversation = null;
   window.currentConversation = null;
}
// --- TRONG static/js/socket/chat.js ---

// Hàm gọi 1v1 chung - nhận callMode từ tham số
export function startPrivateCall(conversationId, callMode = 'video') {
  if (!conversationId) {
      console.error("Thiếu Conversation ID để gọi");
      return;
  }

  console.log(`[Call] Bắt đầu gọi 1v1 ${callMode} trong hội thoại: ${conversationId}`);

  // 1. Lấy thông tin từ conversation item
  const convItem = document.querySelector(`.conversation-item[data-id="${conversationId}"]`);
  if (!convItem) {
      console.error("[Call] Không tìm thấy conversation item");
      return;
  }
  
  // Lấy friend_id từ data attribute - đây là ID người nhận cần gọi
  const recipientId = convItem.dataset.friendId;
  if (!recipientId) {
      console.error("[Call] Không tìm thấy friend_id (recipient)");
      return;
  }
  
  const name = convItem.querySelector('.conversation-name').innerText || "Người dùng";
  const avatar = convItem.querySelector('.conversation-avatar').src || "/static/img/default-avatar.png";

  // 2. Hiện màn hình "Đang gọi..." - dùng safety wrapper với đúng callMode
  safeShowOutgoingCallUI(name, avatar, callMode);
  
  // 🔥 [NEW] Set initiator flag để tự động vô phòng khi người nhận accept
  if (window.setCallInitiator) {
      window.setCallInitiator(conversationId, callMode);
  }

  // 3. Gửi lệnh lên Server với đầy đủ thông tin
  // Gửi cả conversation_id (room call) và recipient_id (người nhận thông báo)
  if (socket) {
      console.log(`[Call] Emitting call:invite_private to server:`, {
          conversation_id: conversationId,
          recipient_id: recipientId,
          conversation_type: 'private',  // 🔥 FIX: Đúng là 'private' chứ không phải 'group'
          call_mode: callMode  // 🔥 SỬA: Dùng callMode từ tham số
      });
      socket.emit('call:invite_private', {
          conversation_id: conversationId,
          recipient_id: recipientId,
          conversation_type: 'private',  // 🔥 FIX: Đúng là 'private' chứ không phải 'group'
          call_mode: callMode  // 🔥 SỬA: Dùng callMode từ tham số
      });
  } else {
      alert("Mất kết nối máy chủ!");
  }
}

// Export ra window để HTML gọi được
window.startPrivateCall = startPrivateCall;


// ====== INITIALIZATION ======
function startTimeRefresher() {
  // Update every 10 seconds for more real-time feel
  setInterval(() => {
    document.querySelectorAll('.conversation-time').forEach(el => {
      const timestamp = el.dataset.timestamp;
      if (timestamp) {
        el.textContent = formatConversationTime(parseInt(timestamp));
      }
    });
    
    document.querySelectorAll('.message-time').forEach(el => {
      const timestamp = el.title;
      if (timestamp) {
        el.textContent = formatMessageTime(timestamp);
      }
    });
  }, 10000); // 10 seconds instead of 60
}

document.addEventListener('DOMContentLoaded', () => {
  startTimeRefresher();
  
  // Event delegation for Mac-style file attachments
  const messagesContainer = document.getElementById('messages');
  if (messagesContainer) {
    messagesContainer.addEventListener('click', (e) => {
      // Handle preview button - open Mac-style preview
      const previewBtn = e.target.closest('.mac-file-preview-btn');
      if (previewBtn) {
        e.preventDefault();
        e.stopPropagation();
        const fileAttachment = previewBtn.closest('.mac-file-attachment');
        if (!fileAttachment) return;
        
        const fileUrl = fileAttachment.getAttribute('data-file-url');
        const fileName = fileAttachment.getAttribute('data-file-name');
        const fileSize = parseInt(fileAttachment.getAttribute('data-file-size')) || 0;
        
        if (window.macPreview) {
          window.macPreview.open(fileUrl, fileName, fileSize);
        }
        return;
      }
      
      // Handle open button - open in new tab
      const openBtn = e.target.closest('.mac-file-open-btn');
      if (openBtn) {
        e.preventDefault();
        e.stopPropagation();
        const fileAttachment = openBtn.closest('.mac-file-attachment');
        if (!fileAttachment) return;
        
        const fileUrl = fileAttachment.getAttribute('data-file-url');
        window.open(fileUrl, '_blank');
        return;
      }
      
      // Handle download button
      const downloadBtn = e.target.closest('.mac-file-download-btn');
      if (downloadBtn) {
        e.preventDefault();
        e.stopPropagation();
        const fileAttachment = downloadBtn.closest('.mac-file-attachment');
        if (!fileAttachment) return;
        
        const fileUrl = fileAttachment.getAttribute('data-file-url');
        const fileName = fileAttachment.getAttribute('data-file-name');
        
        const link = document.createElement('a');
        link.href = fileUrl;
        link.download = fileName;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return;
      }
      
      // Click on attachment itself - open preview
      const fileAttachment = e.target.closest('.mac-file-attachment');
      if (fileAttachment && !e.target.closest('.mac-file-actions')) {
        e.preventDefault();
        e.stopPropagation();
        
        const fileUrl = fileAttachment.getAttribute('data-file-url');
        const fileName = fileAttachment.getAttribute('data-file-name');
        const fileSize = parseInt(fileAttachment.getAttribute('data-file-size')) || 0;
        
        if (window.macPreview) {
          window.macPreview.open(fileUrl, fileName, fileSize);
        }
      }
    });
  }
  
  if (window.moment) {
    moment.locale('vi');
    document.querySelectorAll('.conversation-time').forEach(el => {
      const isoTime = el.dataset.time;
      if (isoTime) {
        const m = moment(isoTime);
        if (m.isValid()) {
          // 🔥 [FIX] Dùng formatConversationTime thay vì fromNow() để tránh hiển thị tiếng Anh
          el.textContent = formatConversationTime(isoTime);
          el.dataset.timestamp = m.valueOf();
        }
      }
    });
    sortConversationsList();
  }
});

// ====== OPEN CONVERSATION TỪ BẤT CỨ ĐÂU (CHO NOTIFICATION) ======
export function openConversation(conversationId) {
  if (!conversationId) return;

  console.log('[Chat] openConversation from notification:', conversationId);

  // Ẩn màn hình animation / welcome nếu có
  const anim = document.getElementById('animation-screen');
  if (anim) anim.classList.add('hidden');

  // Đảm bảo state đang về chế độ 1v1, không dính group
  resetGroupState();

  // Gọi đúng flow join 1v1 như khi bấm vào .conversation-item
  joinConversation(conversationId);

  // Gọi callback onOpenPrivateConversationCb (nếu bạn có dùng để update header, info,…)
  if (typeof onOpenPrivateConversationCb === 'function') {
    onOpenPrivateConversationCb(conversationId, 'private');
  }
}

// --- TRONG FILE static/js/socket/chat.js (PHẦN CUỐI - ĐÃ CẬP NHẬT) ---

// ❌❌❌ LƯU Ý QUAN TRỌNG ❌❌❌
// Đã XÓA BỎ hoàn toàn hàm 'viewReactionDetails' và 'hideReactionDetailsPopup' cũ ở đây.
// Lý do: Để trình duyệt sử dụng phiên bản Modal đẹp (có tab, nền mờ) nằm trong file 'chat_interactions.js'.
// Nếu giữ lại code cũ ở đây, nó sẽ ghi đè và làm hỏng giao diện mới.
function sendDirectMessage(conversationId, message) {
  if (!conversationId || !message) return;
  socket.emit('send_message', {
    conversation_id: conversationId,
    content: message
  });
}
window.sendDirectMessage = sendDirectMessage;
// ============================================================
// GLOBAL EXPORTS (GẮN CÁC HÀM VÀO WINDOW)
// ============================================================

window.chatModule = {
  resetCurrentConversation,
  openConversation,
};

// Gán các hàm vào window để gọi từ HTML (onclick) hoặc các module khác
window.openPrivateChat = openConversation;
window.pinMessage = pinMessage;
window.unpinMessage = unpinMessage;
window.editMessage = editMessage;
window.deleteMessage = deleteMessage;
window.scrollToPinnedMessage = scrollToPinnedMessage;

// Lưu ý: Hàm getMessagePreview đã được định nghĩa ở phần trên của file này (Phần 2).
// Hàm buildMessagePreview (nếu cần cho group) nên nằm bên file group.js để dễ quản lý.



// ====== CẬP NHẬT SUMMARY TỪ SERVER (1v1) ======
  socket.on('conversation_summary_updated', (data) => {
    if (!data || data.conversation_type !== 'private') return;

    // Tận dụng hàm updateConversationList để code gọn hơn
    // Lưu ý: data từ sự kiện này hơi khác data message thường, cần map lại nếu cần thiết
    // Tuy nhiên, logic cũ của bạn xử lý DOM trực tiếp cũng ổn. Giữ nguyên logic cũ cho an toàn:
    
    const conversationId = data.conversation_id;
    if (!conversationId) return;

    // 13/12/2025 - Giữ một biến duy nhất cho element hội thoại để tránh lỗi trùng tên
    const convEl = document.querySelector(`.conversation-item[data-id="${conversationId}"]`);
    if (!convEl) return; // Nếu chưa có thì thôi, đợi receive_message xử lý

    const myId = getUserId();
    const isMe = myId && String(data.last_sender_id) === String(myId);

    // Update Preview
    const previewEl = convEl.querySelector('.conversation-preview');
    if (previewEl && data.last_message) {
      let previewText = data.last_message.trim();
      const max = 35;
      if (previewText.length > max) previewText = previewText.slice(0, max) + '...';
      
      previewEl.textContent = (isMe ? 'Bạn: ' : '') + previewText;
      // Reset style về bình thường nếu đang đọc
      if (currentConversation === conversationId) {
          previewEl.style.fontWeight = 'normal';
          previewEl.style.color = '#fff';
      }
    }

    // Update Time
    if (data.last_message_time) {
      const timeEl = convEl.querySelector('.conversation-time');
      if (timeEl) {
        timeEl.dataset.timestamp = new Date(data.last_message_time).getTime();
        timeEl.textContent = formatConversationTime(data.last_message_time);
      }
    }

    // Update Unread (Số từ server)
    // Chỉ update nếu mình không đang xem
    if (currentConversation !== conversationId) {
        const unread = typeof data.unread_count === 'number' ? data.unread_count : 0;
        let unreadEl = convEl.querySelector('.unread-count');
        const statusWrap = convEl.querySelector('.conversation-status');

        if (unread > 0) {
          if (!unreadEl) {
            unreadEl = document.createElement('div');
            unreadEl.className = 'unread-count';
            if (statusWrap) statusWrap.insertBefore(unreadEl, statusWrap.firstChild);
          }
          unreadEl.textContent = unread;
        } else if (unreadEl) {
          unreadEl.remove();
        }
    }

    sortConversationsList();
  });
// 13/12/2025 - Context menu chuột phải cho từng hội thoại 1v1 trong sidebar
export function setupConversationContextMenu() {
  if (conversationContextMenuAttached) return;
  conversationContextMenuAttached = true;

  const list = document.getElementById('conversations');
  if (!list) return;

  // Right-click trên item hội thoại
  list.addEventListener('contextmenu', (e) => {
    const item = e.target.closest('.conversation-item');
    if (!item) return;

    e.preventDefault();
    e.stopPropagation();

    const convId = item.dataset.id;
    if (!convId) return;

    showConversationContextMenu(e.clientX, e.clientY, convId, item);
  });

  // Ẩn menu khi click ra ngoài
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#conversation-context-menu')) {
      hideConversationContextMenu();
    }
  });

  // Ẩn menu khi nhấn ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideConversationContextMenu();
    }
  });
}

// 13/12/2025 - Hiển thị menu context cho hội thoại 1v1 (Mở, Mute, Theme, Xóa)
function showConversationContextMenu(x, y, conversationId, convEl) {
  hideConversationContextMenu();

  const contextMenu = document.createElement('div');
  contextMenu.id = 'conversation-context-menu';
  contextMenu.className = 'context-menu';
  contextMenu.style.cssText = `
    position: fixed;
    left: ${x}px;
    top: ${y}px;
    background: white;
    border: 1px solid #ddd;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 10000;
    min-width: 200px;
    padding: 4px 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;

  const isMuted = convEl && convEl.dataset.muted === '1';
  const muteLabel = isMuted ? 'Bật lại thông báo' : 'Tắt thông báo tạm thời';

  let menuItems = '';

  menuItems += `
    <div class="context-menu-item" data-action="open" data-conversation-id="${conversationId}">
      <i class="fi fi-rr-comment" style="margin-right: 8px;"></i>Mở hội thoại
    </div>
    <div class="context-menu-divider"></div>
    <div class="context-menu-item" data-action="mute" data-conversation-id="${conversationId}">
      <i class="fas fa-bell-slash" style="margin-right: 8px;"></i>${muteLabel}
    </div>
    <div class="context-menu-item" data-action="theme" data-conversation-id="${conversationId}">
      <i class="fi fi-rr-palette" style="margin-right: 8px;"></i>Đổi theme hội thoại
    </div>
    <div class="context-menu-item" data-action="delete" data-conversation-id="${conversationId}">
      <i class="fi fi-rr-trash" style="margin-right: 8px;"></i>Xóa hội thoại khỏi danh sách
    </div>
  `;

  contextMenu.innerHTML = menuItems;
  document.body.appendChild(contextMenu);

  // Lắng nghe click trên từng item
  contextMenu.querySelectorAll('.context-menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
const action = item.dataset.action;
      const convId = item.dataset.conversationId;

      switch (action) {
        case 'open': {
          const convDom = document.querySelector(`.conversation-item[data-id="${convId}"]`);
          if (convDom) {
            convDom.click();
          } else {
            // fallback: gọi trực tiếp joinConversation nếu không tìm thấy DOM
            joinConversation(convId);
            if (typeof onOpenPrivateConversationCb === 'function') {
              onOpenPrivateConversationCb(convId, 'private');
            }
          }
          break;
        }
        case 'mute':
          if (typeof toggleMuteConversation === 'function') {
            toggleMuteConversation(convId);
          }
          break;
        case 'theme':
          if (typeof changeConversationTheme === 'function') {
            changeConversationTheme(convId);
          }
          break;
        case 'delete':
          if (typeof deleteConversationThread === 'function') {
            deleteConversationThread(convId);
          }
          break;
      }

      hideConversationContextMenu();
    });
  });

  // Đảm bảo menu không vượt ra ngoài màn hình
  const rect = contextMenu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    contextMenu.style.left = (x - rect.width) + 'px';
  }
  if (rect.bottom > window.innerHeight) {
    contextMenu.style.top = (y - rect.height) + 'px';
  }
}

function hideConversationContextMenu() {
  const existingMenu = document.getElementById('conversation-context-menu');
  if (existingMenu) {
    existingMenu.remove();
  }
}

// ====== ONLINE/OFFLINE STATUS UPDATES ======
// Listen for friend status changes and update conversation list
socket.on('friend_status_changed', (data) => {
  if (!data || !data.user_id) return;
  
  // Find all conversation items with this friend
  const convItems = document.querySelectorAll(`.conversation-item[data-friend-id="${data.user_id}"]`);
  
  convItems.forEach(item => {
    const statusIndicator = item.querySelector('.online-status-indicator');
    if (statusIndicator) {
      if (data.is_online) {
        statusIndicator.classList.add('online');
      } else {
        statusIndicator.classList.remove('online');
      }
    }
  });
});

// Also listen for user_online and user_offline events
socket.on('user_online', (data) => {
  if (!data || !data.user_id) return;
  const convItems = document.querySelectorAll(`.conversation-item[data-friend-id="${data.user_id}"]`);
  convItems.forEach(item => {
    const statusIndicator = item.querySelector('.online-status-indicator');
    if (statusIndicator) {
      statusIndicator.classList.add('online');
    }
  });
});

socket.on('user_offline', (data) => {
  if (!data || !data.user_id) return;
  const convItems = document.querySelectorAll(`.conversation-item[data-friend-id="${data.user_id}"]`);
  convItems.forEach(item => {
    const statusIndicator = item.querySelector('.online-status-indicator');
    if (statusIndicator) {
      statusIndicator.classList.remove('online');
    }
  });
});
