import { socket } from "./index.js";
import { setCurrentConversation } from '../chat_input.js';
import { resetGroupChat } from './group.js';
import { setupChatInteractions } from './chat_interactions.js';

let currentConversation = null;
let currentConversationType = 'private';
let pinnedMessage = null;
let pinnedConversationType = 'private';

let onOpenPrivateConversationCb = null;


function resetGroupState() {
  if (typeof resetGroupChat === 'function') {
    resetGroupChat();
  }
}

export function setupChatEvents() {
  socket.on('connect', () => {
    console.log('✅ Connected to server');
    // [THÊM DÒNG NÀY] Kích hoạt sự kiện Reply (Click chuột phải, Swipe)
    setupChatInteractions();
    if (currentConversation) {
      joinConversation(currentConversation);
    }
  });

  socket.on('receive_message', (data) => {
    if (data.conversation_id === currentConversation) {
      addMessageToUI(data);
    }
    updateConversationList(data.conversation_id, data);
  });

  socket.on('conversation_created', (data) => {
    if (data.participants && data.participants.includes(getUserId())) {
      addNewConversationToList(data.conversation_id);
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
}

export function setupConversationClickEvents(onOpen) {
  if (typeof onOpen === 'function') {
    onOpenPrivateConversationCb = onOpen;
  }

  document.querySelectorAll('.conversation-item').forEach(el => {
    el.addEventListener('click', () => {
      const conversationId = el.dataset.id;
      console.log(`[Chat] Conversation clicked: ${conversationId}`);
      
      resetGroupState();
      
      const anim = document.getElementById('animation-screen');
      if (anim) anim.classList.add('hidden');

      joinConversation(conversationId);

      if (typeof onOpenPrivateConversationCb === 'function') {
        onOpenPrivateConversationCb(conversationId, 'private');
      }
    });
  });
}

export function setupSendMessage() {
  const messageInput = document.getElementById('message');
  const sendBtn = document.getElementById('send');
  if (!messageInput || !sendBtn) return;

  sendBtn.addEventListener('click', sendMessage);
  messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  function sendMessage() {
    const message = messageInput.value.trim();
    if (message && currentConversation) {
      socket.emit('send_message', {
        conversation_id: currentConversation,
        content: message
      });
      messageInput.value = '';
      messageInput.focus();
    }
  }
}
export function joinConversation(conversationId) {
  if (!conversationId) return;
  if (currentConversation === conversationId) return;

  resetGroupState();

  // QUAN TRỌNG: Ẩn hoàn toàn UI của nhóm khi chuyển về chat 1-1
  hideAllGroupUI();

  if (typeof setCurrentConversation === 'function') {
    setCurrentConversation(conversationId, 'private');
  }

  currentConversationType = 'private';
  
  
  // QUAN TRỌNG: Load pinned message NGAY LẬP TỨC
  console.log(`[Chat] Loading pinned message for conversation: ${conversationId}`);
  loadPinnedMessage(conversationId, 'private');
  
  markMessagesAsRead(conversationId);

  if (currentConversation) {
    socket.emit('leave_conversation', { conversation_id: currentConversation });
  }

  currentConversation = conversationId;
  window.currentConversation = conversationId; 
  socket.emit('join_conversation', { conversation_id: conversationId });
  
  // Cập nhật UI conversation
  document.querySelectorAll('.conversation-item').forEach(el => {
    el.classList.remove('active');
    if (el.dataset.id === conversationId) {
      el.classList.add('active');
    }
  });

  // QUAN TRỌNG: Reset header về dạng chat 1-1
  resetPrivateChatHeader();

  fetch(`/conversation/${conversationId}`)
    .then(res => res.json())
    .then(data => {
      const messagesEl = document.getElementById('messages');
      if (messagesEl) messagesEl.innerHTML = '';

      if (!data.messages) return;

      const myId = getUserId();

      data.messages.forEach(msg => {
        addMessageToUI(msg);

        if (msg.sender_id !== myId && msg.status !== 'read') {
          markMessageAsRead(msg.message_id);
        }
      });

      if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;

      // Cập nhật header với tên người dùng (không phải tên nhóm)
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
        <span class="status-text" style="font-size:12px;color:#888;">Đang hoạt động</span>
      </div>
    </div>
    <div class="header-actions" style="display:flex; align-items:center; gap:10px;">
      <button id="btn-private-call" class="btn-icon" title="Gọi video" style="font-size:1.2rem;border:none;background:none;cursor:pointer;color:#555;">
        <i class="fas fa-video"></i>
      </button>
      <button class="btn-icon" style="font-size:1.2rem;border:none;background:none;cursor:pointer;color:#555;">
        <i class="fi fi-rr-menu-dots"></i>
      </button>
    </div>
  `;

  const btnCall = document.getElementById('btn-private-call');
  if (btnCall) {
    btnCall.addEventListener('click', () => {
      // 🔥 DÙNG CHUNG HELPER 1v1
      startPrivateCall(conversationId);
    });
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
  
  if (!confirm('Bạn có chắc muốn xóa tin nhắn này?')) return;
  
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
      alert('Lỗi khi xóa tin nhắn: ' + data.error);
    }
  } catch (error) {
    console.error('Error deleting message:', error);
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
  
  document.addEventListener('contextmenu', (e) => {
    console.log('[Context Menu] Right-click detected');
    
    const messageElement = e.target.closest('.message');
    console.log('[Context Menu] Message element found:', messageElement);
    
    if (messageElement && messageElement.dataset.messageId) {
      e.preventDefault();
      console.log('[Context Menu] Showing context menu for message:', messageElement.dataset.messageId);
      
      const messageId = messageElement.dataset.messageId;
      const isMyMessage = messageElement.classList.contains('sent');
      
      showMessageContextMenu(e.clientX, e.clientY, messageId, isMyMessage);
    } else {
      console.log('[Context Menu] No message element found or missing messageId');
    }
  });
  
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
}

function showMessageContextMenu(x, y, messageId, isMyMessage) {
  hideMessageContextMenu();
  
  const contextMenu = document.createElement('div');
  contextMenu.id = 'message-context-menu';
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
    min-width: 160px;
    padding: 4px 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;
  
  let menuItems = '';
  
  if (isMyMessage) {
    menuItems += `
      <div class="context-menu-item" data-action="edit" data-message-id="${messageId}">
        <i class="fi fi-rr-edit" style="margin-right: 8px;"></i>Sửa tin nhắn
      </div>
      <div class="context-menu-item" data-action="delete" data-message-id="${messageId}">
        <i class="fi fi-rr-trash" style="margin-right: 8px;"></i>Xóa tin nhắn
      </div>
      <div class="context-menu-divider"></div>
    `;
  }
  
  menuItems += `
    <div class="context-menu-item" data-action="pin" data-message-id="${messageId}">
      <i class="fi fi-rr-thumbtack" style="margin-right: 8px;"></i>Ghim tin nhắn
    </div>
  `;
  
  contextMenu.innerHTML = menuItems;
  document.body.appendChild(contextMenu);
  
  // Thêm event listeners cho các menu item
  contextMenu.querySelectorAll('.context-menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = item.dataset.action;
      const msgId = item.dataset.messageId;
      
      console.log('[Context Menu] Action clicked:', action, 'for message:', msgId);
      
      switch (action) {
        case 'edit':
          startEditMessage(msgId);
          break;
        case 'delete':
          deleteMessage(msgId);
          break;
        case 'pin':
          pinMessage(msgId);
          break;
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
  
  console.log('[Context Menu] Context menu shown');
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
  const myId = getUserId();
  const isMe = String(msg.sender_id) === String(myId);
  const messagesEl = document.getElementById('messages');
  if (!messagesEl) return;

  const senderName = isMe ? 'Bạn' : (msg.sender_name || 'Unknown');
  const avatarUrl = msg.sender_avatar || window.defaultUserAvatar || '/static/img/default-avatar.png';

  const messageEl = document.createElement('div');
  messageEl.classList.add('message', isMe ? 'sent' : 'received');
  
  // Gắn Data ID
  const msgId = msg.message_id || msg._id;
  messageEl.dataset.id = msgId; 
  messageEl.dataset.messageId = msgId; 
  messageEl.dataset.senderName = senderName; 
  messageEl.dataset.conversationType = msg.conversation_type || currentConversationType || 'private';

  const timeString = formatMessageTime(msg.timestamp);

  // --- 1. XỬ LÝ CONTENT (AN TOÀN) ---
  let messageType = msg.message_type || 'text';
  let parsedContent = msg.content;

  // Logic parse thông minh: Chỉ parse nếu chuỗi bắt đầu bằng {
  if (typeof msg.content === 'string') {
    const trimmed = msg.content.trim();
    if (trimmed.startsWith('{')) {
      try {
        const test = JSON.parse(msg.content);
        if (test && (test.type === 'file' || test.type === 'image')) {
          messageType = test.type; // Cập nhật type chuẩn từ JSON
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
    
    // Xử lý nội dung trích dẫn: Nếu là JSON thì hiện [Hình ảnh]/[File]
    let quoteText = msg.reply_context.content;
    try {
      if (typeof quoteText === 'string' && quoteText.trim().startsWith('{')) {
        const quoteObj = JSON.parse(quoteText);
        if (quoteObj.type === 'image') quoteText = '📷 [Hình ảnh]';
        else if (quoteObj.type === 'file') quoteText = `📎 [File] ${quoteObj.name}`;
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

  if (messageType === 'file') {
    messageContent = `
      <div class="file-message">
        <div class="file-info">
          <div class="file-icon"><i class="fi fi-rr-file"></i></div>
          <div class="file-details">
            <div class="file-name">${escapeHtml(parsedContent.name || 'File')}</div>
            <div class="file-size">${formatFileSize(parsedContent.size || 0)}</div>
          </div>
        </div>
        <a href="${parsedContent.url}" class="file-download" download>Tải xuống</a>
      </div>
    `;
  } else if (messageType === 'image') {
    messageContent = `
      <div class="image-message">
        <div class="image-info">
          <i class="fi fi-rr-picture"></i> ${escapeHtml(parsedContent.name || 'Hình ảnh')}
        </div>
        <img src="${parsedContent.thumbnail || parsedContent.url}" 
             class="uploaded-image" 
             alt="${escapeHtml(parsedContent.name || '')}"
             onclick="window.openImageModal && window.openImageModal('${parsedContent.url}')"
             onerror="this.src='${parsedContent.url}'; this.onerror=null;">
        <div class="image-actions">
          <a href="${parsedContent.url}" target="_blank" class="view-original">Xem ảnh gốc</a>
        </div>
      </div>
    `;
  } else if (messageType === 'sticker') {
    messageContent = `<div class="sticker-message">${getStickerHTML(msg.content)}</div>`;
  } else {
    messageContent = `<div class="message-text">${escapeHtml(msg.content || '')}</div>`;
  }

  // --- 4. STATUS ---
  let statusHTML = '';
  if (isMe) {
    const status = msg.status || 'sent';
    const statusText = getStatusText(status);
    const statusClass = `status-${status}`;
    statusHTML = `
      <div class="message-status-container">
        <span class="message-time" title="${msg.timestamp || ''}">${timeString}</span>
        <span class="message-status ${statusClass}">${statusText}</span>
      </div>
    `;
  } else {
    statusHTML = `
      <div class="message-status-container">
        <span class="message-time" title="${msg.timestamp || ''}">${timeString}</span>
      </div>
    `;
  }

  // --- 5. LẮP RÁP (THÊM .message-content CHO SWIPE & REPLY CSS) ---
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
          </div>
          ${statusHTML}
        </div>

        <div class="message-actions">
          <button class="message-action-btn reply-btn" title="Trả lời">
            <i class="fas fa-reply"></i>
          </button>
        </div>
      </div>
    </div>
  `;

  messagesEl.appendChild(messageEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  messageEl.classList.add('message-item');

  // Đánh dấu đã đọc
  if (!isMe && msg.status !== 'read') {
    markMessageAsRead(msg.message_id || msg._id);
  }
}


// ====== CONVERSATION LIST MANAGEMENT ======
export function updateConversationList(conversationId, lastMessage) {
  let conversationEl = document.querySelector(`.conversation-item[data-id="${conversationId}"]`);
  if (!conversationEl) {
    addNewConversationToList(conversationId);
    return;
  }

  const myId = getUserId();
  const isMe = lastMessage.sender_id === myId;

  conversationEl.dataset.lastMessage = JSON.stringify(lastMessage.content);
  conversationEl.dataset.lastMessageType = lastMessage.message_type || 'text';
  conversationEl.dataset.lastMessageSender = lastMessage.sender_id;

  const previewEl = conversationEl.querySelector('.conversation-preview');
  if (previewEl) {
    const previewText = getMessagePreview(lastMessage);
    previewEl.innerHTML = (isMe ? 'Bạn: ' : '') + previewText;
  }

  const timeEl = conversationEl.querySelector('.conversation-time');
  if (timeEl && lastMessage?.timestamp) {
    timeEl.textContent = formatConversationTime(lastMessage.timestamp);
    timeEl.dataset.timestamp = new Date(lastMessage.timestamp).getTime();
  }

  if (!isMe && conversationId !== currentConversation) {
    updateUnreadCount(conversationEl, 1);
  }

  sortConversationsList();
}

function updateUnreadCount(conversationEl, increment = 1) {
  let unreadCountEl = conversationEl.querySelector('.unread-count');
  let currentCount = 0;

  if (unreadCountEl) {
    currentCount = parseInt(unreadCountEl.textContent, 10) || 0;
    const newCount = currentCount + increment;
    unreadCountEl.textContent = newCount;
    
    if (newCount <= 0) {
      unreadCountEl.remove();
    }
  } else if (increment > 0) {
    unreadCountEl = document.createElement('div');
    unreadCountEl.className = 'unread-count';
    unreadCountEl.textContent = increment;
    const statusWrap = conversationEl.querySelector('.conversation-status');
    if (statusWrap) {
      const timeEl = statusWrap.querySelector('.conversation-time');
      if (timeEl && timeEl.nextSibling) {
        statusWrap.insertBefore(unreadCountEl, timeEl.nextSibling);
      } else {
        statusWrap.appendChild(unreadCountEl);
      }
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

      const myId = getUserId();
      const isLastMessageFromMe = data.last_message_sender === myId;

      const previewText = data.last_message_preview || getMessagePreview({
        content: data.last_message,
        message_type: data.last_message_type
      });

      const timestamp = data.last_message_time ? new Date(data.last_message_time).getTime() : Date.now();
      const displayTime = data.last_message_time ? 
        formatConversationTime(data.last_message_time) : 
        formatConversationTime(data.created_at);

      convEl.innerHTML = `
        <img src="${data.friend_avatar || '/static/img/default-avatar.png'}" class="conversation-avatar" alt="${data.friend_name || ''}">
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
          startPrivateCall(conversationId);
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
  
  if (window.moment) {
    const m = moment(timestamp);
    const now = moment();
    
    if (!m.isValid()) return '';
    
    const diffMinutes = now.diff(m, 'minutes');
    
    if (diffMinutes < 1) return 'Vừa xong';
    if (diffMinutes < 60) return `${diffMinutes}p`; // 5p
    if (diffMinutes < 1440) return `${Math.floor(diffMinutes/60)}g`; // 2g
    
    if (m.isSame(now, 'day')) return m.format('HH:mm');
    if (m.isSame(now.clone().subtract(1, 'days'), 'day')) return 'Hôm qua';
    
    if (m.isSame(now, 'year')) return m.format('DD/MM');
    return m.format('DD/MM/YY');
  }
  
  return '';
}
function getMessagePreview(message) {
  if (!message || !message.content) return 'Bắt đầu trò chuyện';

  let messageType = message.message_type || 'text';
  let content = message.content;

  if (messageType === 'file') {
    try {
      const fileInfo = typeof content === 'string' ? JSON.parse(content) : content;
      const fileName = fileInfo.name || fileInfo.filename || 'File';
      return `📎 ${fileName}`;
    } catch (e) {
      console.error('Error parsing file preview:', e);
      return '📎 File';
    }
  } else if (messageType === 'image') {
    try {
      const imageInfo = typeof content === 'string' ? JSON.parse(content) : content;
      const imageName = imageInfo.name || imageInfo.filename || 'Hình ảnh';
      return `🖼️ ${imageName}`;
    } catch (e) {
      console.error('Error parsing image preview:', e);
      return '🖼️ Hình ảnh';
    }
  } else if (messageType === 'sticker') {
    return '😊 Sticker';
  } else {
    if (typeof content === 'string') {
      // SỬA LỖI Ở ĐÂY: startsWith thay vì startswith
      if (content.trim().startsWith('{') && content.trim().endsWith('}')) {
        try {
          const data = JSON.parse(content);
          if (typeof data === 'object') {
            if (data.type === 'file') {
              const fileName = data.name || data.filename || 'File';
              return `📎 ${fileName}`;
            } else if (data.type === 'image') {
              const imageName = data.name || data.filename || 'Hình ảnh';
              return `🖼️ ${imageName}`;
            }
          }
        } catch (e) {
          // Continue as text
        }
      }
      
      const stickerCodes = ['sticker1', 'sticker2', 'sticker3', 'sticker4', 'sticker5', 'sticker6'];
      if (stickerCodes.includes(content)) {
        return '😊 Sticker';
      }
    }
    
    let text = typeof content === 'string' ? content : String(content);
    text = text.replace('\r', ' ').replace('\n', ' ').trim();
    
    if (!text) return 'Bắt đầu trò chuyện';
    
    const max = 35;
    return text.length > max ? text.substring(0, max) + '...' : text;
  }
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
  socket.on('message_status_updated', (data) => {
      updateMessageStatusUI(data.message_id, data.status);
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

// --- 4. THAY THẾ HÀM updateMessageStatusUI ---
export function updateMessageStatusUI(messageId, status) {
  const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
  if (!messageElement) return;

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

export function markMessageAsRead(messageId) {
  socket.emit('message_read', { message_id: messageId });
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
  const userAvatar = document.querySelector('.user-avatar');
  return userAvatar ? userAvatar.dataset.userId : null;
}

export function resetCurrentConversation() {
  currentConversation = null;
   window.currentConversation = null;
}
// ====== PRIVATE CALL HELPER ======
export function startPrivateCall(conversationId) {
  if (!conversationId) return;

  console.log('[Call] Start 1v1 call:', conversationId);

  if (socket) {
    socket.emit('call:invite_group', {
      conversation_id: conversationId,
      conversation_type: 'private'
      // ❌ BỎ dòng room_name: roomName
    });
  }

  if (window.startGroupCall) {
    // Dùng luôn conversationId làm “room”
    window.startGroupCall(conversationId, 'private');
  } else {
    alert("Chức năng gọi chưa sẵn sàng (Chưa load group_call.js)");
  }
}

// Cho phép gọi từ HTML / file khác
window.startPrivateCall = startPrivateCall;


// ====== INITIALIZATION ======
function startTimeRefresher() {
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
  }, 60000);
}

document.addEventListener('DOMContentLoaded', () => {
  startTimeRefresher();
  
  if (window.moment) {
    moment.locale('vi');
    document.querySelectorAll('.conversation-time').forEach(el => {
      const isoTime = el.dataset.time;
      if (isoTime) {
        const m = moment(isoTime);
        if (m.isValid()) {
          el.textContent = m.fromNow();
          el.dataset.timestamp = m.valueOf();
        }
      }
    });
    sortConversationsList();
  }
});

// ====== GLOBAL EXPORTS ======
window.chatModule = { resetCurrentConversation };
window.pinMessage = pinMessage;
window.unpinMessage = unpinMessage;
window.editMessage = editMessage;
window.deleteMessage = deleteMessage;
window.scrollToPinnedMessage = scrollToPinnedMessage;

// --- THÊM VÀO CUỐI FILE group.js ---

window.scrollToMessage = function(messageId) {
    console.log("Cuộn tới tin nhắn:", messageId);
    // Tìm tin nhắn theo data-id hoặc data-message-id
    const el = document.querySelector(`.message[data-id="${messageId}"]`) || 
               document.querySelector(`.message[data-message-id="${messageId}"]`);
    
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('highlight-message'); // CSS highlight sẽ làm nó nháy sáng
        setTimeout(() => el.classList.remove('highlight-message'), 2000);
    } else {
        console.warn("Không tìm thấy tin nhắn gốc (có thể chưa load lịch sử).");
    }
};