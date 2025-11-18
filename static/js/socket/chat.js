// static/js/socket/chat.js
import { socket } from "./index.js";
import { setCurrentConversation } from '../chat_input.js';
import { resetGroupChat } from './group.js';

let currentConversation = null;
// Lưu callback do main.js truyền vào để biết khi nào user mở hội thoại 1-1
let onOpenPrivateConversationCb = null;


function resetGroupState() {
  if (typeof resetGroupChat === 'function') {
    resetGroupChat();
  }
}

export function setupChatEvents() {
  socket.on('connect', () => {
    console.log('✅ Connected to server');
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
      // Nếu chưa có hội thoại nào đang mở, tự động join hội thoại mới
      if (!currentConversation) {
        joinConversation(data.conversation_id);
        // Gọi callback báo đã mở hội thoại 1-1
        if (typeof onOpenPrivateConversationCb === 'function') {
          onOpenPrivateConversationCb(data.conversation_id, 'private');
        }
      }
    }
  });

  socket.on('conversation_ready', (data) => {
    joinConversation(data.conversation_id);
    // Báo cho UI (private chat)
    if (typeof onOpenPrivateConversationCb === 'function') {
      onOpenPrivateConversationCb(data.conversation_id, 'private');
    }
  });
}

/**
 * Đăng ký click trên danh sách hội thoại 1-1.
 * @param {(conversationId: string, type: 'private') => void} onOpen
 */
export function setupConversationClickEvents(onOpen) {
  // Lưu callback để dùng lại nơi khác (reconnect, conversation_created…)
  if (typeof onOpen === 'function') {
    onOpenPrivateConversationCb = onOpen;
  }

  // Thêm sự kiện click cho các conversation item hiện có
  document.querySelectorAll('.conversation-item').forEach(el => {
    el.addEventListener('click', () => {
      const conversationId = el.dataset.id;
      console.log(`[Chat] Conversation clicked: ${conversationId}`);
      
      // QUAN TRỌNG: Reset group trước khi mở chat cá nhân
      resetGroupState();
      
      const anim = document.getElementById('animation-screen');
      if (anim) anim.classList.add('hidden');

      joinConversation(conversationId);

      // Gọi callback báo Main: đã mở hội thoại 1-1
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

  // Reset group state trước khi join conversation
  resetGroupState();

  // Set conversation cho file sharing
  if (typeof setCurrentConversation === 'function') {
    setCurrentConversation(conversationId, 'private');
  }

  // Mark read cũ → sẽ chạy lại khi tải lịch sử
  markMessagesAsRead(conversationId);

  // Rời room cũ
  if (currentConversation) {
    socket.emit('leave_conversation', { conversation_id: currentConversation });
  }

  // Join room mới
  currentConversation = conversationId;
  socket.emit('join_conversation', { conversation_id: conversationId });

  // Active item UI
  document.querySelectorAll('.conversation-item').forEach(el => {
    el.classList.remove('active');
    if (el.dataset.id === conversationId) {
      el.classList.add('active');
    }
  });

  // Tải lịch sử tin nhắn
  fetch(`/conversation/${conversationId}`)
    .then(res => res.json())
    .then(data => {
      const messagesEl = document.getElementById('messages');
      if (messagesEl) messagesEl.innerHTML = '';

      if (!data.messages) return;

      const myId = getUserId();

      // Load tất cả tin nhắn và hiển thị
      data.messages.forEach(msg => {
        addMessageToUI(msg);

        // 🔥 Nếu tin nhắn của người khác và chưa đọc → mark read
        if (msg.sender_id !== myId && msg.status !== 'read') {
          markMessageAsRead(msg.message_id);
        }
      });

      // Auto scroll xuống cuối
      if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;

      // Update tên header
      const selectedConversation = document.querySelector(
        `.conversation-item[data-id="${conversationId}"] .conversation-name`
      );
      const headerTitle = document.querySelector('.chat-header h2');
      if (selectedConversation && headerTitle) {
        headerTitle.textContent = selectedConversation.textContent;
      }
    })
    .catch(err => console.error('Error loading messages:', err));
}

// Cập nhật hàm addMessageToUI để hiển thị trạng thái
export function addMessageToUI(msg) {
  const myId = getUserId();
  const isMe = msg.sender_id === myId;
  const messagesEl = document.getElementById('messages');
  if (!messagesEl) return;

  const senderName = isMe ? 'Bạn' : (msg.sender_name || 'Unknown');
  const avatarUrl = msg.sender_avatar || window.defaultUserAvatar || '/static/img/default-avatar.png';

  const messageEl = document.createElement('div');
  messageEl.classList.add('message', isMe ? 'sent' : 'received');

  // Format thời gian
  const timeString = formatMessageTime(msg.timestamp);

  // QUAN TRỌNG: Xử lý loại tin nhắn
  let messageType = msg.message_type || 'text';
  let parsedContent = msg.content;

  if (messageType === 'file' || messageType === 'image') {
    if (typeof msg.content === 'string') {
      try {
        parsedContent = JSON.parse(msg.content);
      } catch {
        messageType = 'text';
      }
    }
  } else if (!msg.message_type || messageType === 'text') {
    if (typeof msg.content === 'string') {
      try {
        const testParse = JSON.parse(msg.content);
        if (testParse?.type === 'file') {
          messageType = 'file';
          parsedContent = testParse;
        } else if (testParse?.type === 'image') {
          messageType = 'image';
          parsedContent = testParse;
        }
      } catch {
        const stickerCodes = ['sticker1', 'sticker2', 'sticker3', 'sticker4', 'sticker5', 'sticker6'];
        if (stickerCodes.includes(msg.content)) messageType = 'sticker';
      }
    }
  }

  let messageContent = '';

  if (messageType === 'file') {
    messageContent = `
      <div class="file-message">
        <div class="file-info">
          <div class="file-icon"><i class="fi fi-rr-file"></i></div>
          <div class="file-details">
            <div class="file-name">${escapeHtml(parsedContent.name)}</div>
            <div class="file-size">${formatFileSize(parsedContent.size)}</div>
          </div>
        </div>
        <a href="${parsedContent.url}" class="file-download" download>Tải xuống</a>
      </div>
    `;
  } else if (messageType === 'image') {
    messageContent = `
      <div class="image-message">
        <div class="image-info">
          <i class="fi fi-rr-picture"></i> ${escapeHtml(parsedContent.name)}
        </div>
        <img src="${parsedContent.thumbnail || parsedContent.url}" class="uploaded-image" alt="${escapeHtml(parsedContent.name)}"
             onerror="this.src='${parsedContent.url}'; this.onerror=null;">
        <div class="image-actions">
          <a href="${parsedContent.url}" target="_blank" class="view-original">Xem ảnh gốc</a>
        </div>
      </div>
    `;
  } else if (messageType === 'sticker') {
    messageContent = `<div class="sticker-message">${getStickerHTML(msg.content)}</div>`;
  } else {
    messageContent = `<div class="message-text">${escapeHtml(msg.content)}</div>`;
  }

  // 🔥 THÊM TRẠNG THÁI TIN NHẮN
  let statusText = getStatusText(msg.status || 'sent');
  let statusClass = `status-${msg.status || 'sent'}`;

  messageEl.innerHTML = `
      ${!isMe ? `<img src="${avatarUrl}" class="message-avatar" alt="${senderName}">` : ''}
      <div class="message-content-container">
          ${!isMe ? `<div class="sender-info">${senderName}</div>` : ''}
          <div class="message-content-wrapper">
              <div class="message-bubble">${messageContent}</div>
              ${
                isMe
                  ? `
                    <div class="message-status-container">
                      <span class="message-time">${timeString}</span>
                      <span class="message-status ${statusClass}">${statusText}</span>
                    </div>
                    `
                  : `<span class="message-time">${timeString}</span>`
              }
          </div>
      </div>
      ${isMe ? `<img src="${avatarUrl}" class="message-avatar" alt="${senderName}">` : ''}
  `;

  // 🔍 Gán thuộc tính để truy cập cập nhật trạng thái về sau
  messageEl.dataset.messageId = msg.message_id;

  messagesEl.appendChild(messageEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  // 🔥 Đánh dấu đã đọc nếu tin nhắn đến từ người khác
  if (!isMe && msg.status !== 'read') {
    markMessageAsRead(msg.message_id);
  }
}

// static/js/socket/chat.js - THAY THẾ 2 hàm format time
function formatMessageTime(timestamp) {
  if (!timestamp) return '';
  
  try {
    const messageDate = new Date(timestamp);
    const now = new Date();
    
    if (isNaN(messageDate.getTime())) return 'Vừa xong';

    // SỬA: Tính chênh lệch thời gian bằng milliseconds UTC
    const messageDateUTC = messageDate.getTime();
    const nowUTC = now.getTime();
    const diffMs = nowUTC - messageDateUTC;
    
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMinutes < 1) {
      return 'Vừa xong';
    } else if (diffMinutes < 60) {
      return `${diffMinutes} phút trước`;
    } else if (diffHours < 24) {
      return `${diffHours} giờ trước`;
    } else if (diffDays === 1) {
      return 'Hôm qua';
    } else if (messageDate.getFullYear() === now.getFullYear()) {
      const day = messageDate.getDate().toString().padStart(2, '0');
      const month = (messageDate.getMonth() + 1).toString().padStart(2, '0');
      return `${day}/${month}`;
    } else {
      const day = messageDate.getDate().toString().padStart(2, '0');
      const month = (messageDate.getMonth() + 1).toString().padStart(2, '0');
      const year = messageDate.getFullYear();
      return `${day}/${month}/${year}`;
    }
  } catch (error) {
    console.error('Error formatting message time:', error);
    return 'Vừa xong';
  }
}

function formatConversationTime(timestamp) {
  if (!timestamp) return '';
  
  try {
    const messageDate = new Date(timestamp);
    const now = new Date();
    
    if (isNaN(messageDate.getTime())) return 'Vừa xong';

    // SỬA: Tính chênh lệch thời gian bằng milliseconds UTC
    const messageDateUTC = messageDate.getTime();
    const nowUTC = now.getTime();
    const diffMs = nowUTC - messageDateUTC;
    
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMinutes < 1) {
      return 'Vừa xong';
    } else if (diffMinutes < 60) {
      return `${diffMinutes}p`;
    } else if (diffHours < 24) {
      return `${diffHours}g`;
    } else if (diffDays === 1) {
      return 'Hôm qua';
    } else if (messageDate.getFullYear() === now.getFullYear()) {
      const day = messageDate.getDate().toString().padStart(2, '0');
      const month = (messageDate.getMonth() + 1).toString().padStart(2, '0');
      return `${day}/${month}`;
    } else {
      const day = messageDate.getDate().toString().padStart(2, '0');
      const month = (messageDate.getMonth() + 1).toString().padStart(2, '0');
      const year = messageDate.getFullYear().toString().slice(-2);
      return `${day}/${month}/${year}`;
    }
  } catch (error) {
    console.error('Error formatting conversation time:', error);
    return 'Vừa xong';
  }
}
export function updateConversationList(conversationId, lastMessage) {
  let conversationEl = document.querySelector(`.conversation-item[data-id="${conversationId}"]`);
  if (!conversationEl) {
    addNewConversationToList(conversationId);
    return;
  }

  const myId = getUserId();
  const isMe = lastMessage.sender_id === myId;

  // Cập nhật data attributes
  conversationEl.dataset.lastMessage = JSON.stringify(lastMessage.content);
  conversationEl.dataset.lastMessageType = lastMessage.message_type || 'text';
  conversationEl.dataset.lastMessageSender = lastMessage.sender_id;

  // Cập nhật preview
  const previewEl = conversationEl.querySelector('.conversation-preview');
  if (previewEl) {
    const previewText = getMessagePreview(lastMessage);
    previewEl.innerHTML = (isMe ? 'Bạn: ' : '') + previewText;
  }

  // Cập nhật thời gian - SỬ DỤNG HÀM MỚI
  const timeEl = conversationEl.querySelector('.conversation-time');
  if (timeEl && lastMessage?.timestamp) {
    timeEl.textContent = formatConversationTime(lastMessage.timestamp);
    timeEl.dataset.timestamp = new Date(lastMessage.timestamp).getTime();
  }

  // Cập nhật unread count khi có tin nhắn mới
  if (!isMe && conversationId !== currentConversation) {
    updateUnreadCount(conversationEl, 1);
  }

  // Sắp xếp lại danh sách hội thoại
  sortConversationsList();
}

// Hàm mới để cập nhật unread count
function updateUnreadCount(conversationEl, increment = 1) {
  let unreadCountEl = conversationEl.querySelector('.unread-count');
  let currentCount = 0;

  if (unreadCountEl) {
    currentCount = parseInt(unreadCountEl.textContent, 10) || 0;
    const newCount = currentCount + increment;
    unreadCountEl.textContent = newCount;
    
    // Ẩn nếu count = 0 (sau khi decrement)
    if (newCount <= 0) {
      unreadCountEl.remove();
    }
  } else if (increment > 0) {
    // Tạo mới unread count element
    unreadCountEl = document.createElement('div');
    unreadCountEl.className = 'unread-count';
    unreadCountEl.textContent = increment;
    const statusWrap = conversationEl.querySelector('.conversation-status');
    if (statusWrap) {
      // Đảm bảo unread count được thêm sau thời gian
      const timeEl = statusWrap.querySelector('.conversation-time');
      if (timeEl && timeEl.nextSibling) {
        statusWrap.insertBefore(unreadCountEl, timeEl.nextSibling);
      } else {
        statusWrap.appendChild(unreadCountEl);
      }
    }
  }
}
function getMessagePreview(message) {
  if (!message || !message.content) return 'Bắt đầu trò chuyện';

  let messageType = message.message_type || 'text';
  let content = message.content;

  console.log('[Preview DEBUG] Processing message for preview:', { 
    messageType, 
    content: typeof content === 'string' ? content.substring(0, 50) : content 
  });

  // Xử lý tất cả các trường hợp một cách rõ ràng - GIỐNG HỆT SERVER
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
    // Text message - thử detect từ content (giống server)
    if (typeof content === 'string') {
      // Thử parse JSON để detect file/image
      if (content.trim().startswith('{') && content.trim().endswith('}')) {
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
          // Không phải JSON hợp lệ, tiếp tục xử lý như text
        }
      }
      
      // Kiểm tra sticker codes
      const stickerCodes = ['sticker1', 'sticker2', 'sticker3', 'sticker4', 'sticker5', 'sticker6'];
      if (stickerCodes.includes(content)) {
        return '😊 Sticker';
      }
    }
    
    // Text message thông thường
    let text = typeof content === 'string' ? content : String(content);
    text = text.replace('\r', ' ').replace('\n', ' ').trim();
    
    if (!text) return 'Bắt đầu trò chuyện';
    
    // Giới hạn độ dài preview
    const max = 35;
    return text.length > max ? text.substring(0, max) + '...' : text;
  }
}
function sortConversationsList() {
  const conversationsContainer = document.getElementById('conversations');
  if (!conversationsContainer) return;

  const conversations = Array.from(conversationsContainer.querySelectorAll('.conversation-item'));
  
  conversations.sort((a, b) => {
    // Ưu tiên hội thoại có tin nhắn chưa đọc
    const aUnread = a.querySelector('.unread-count');
    const bUnread = b.querySelector('.unread-count');
    
    if (aUnread && !bUnread) return -1;
    if (!aUnread && bUnread) return 1;
    if (aUnread && bUnread) {
      // Nếu cả hai đều có unread, so sánh số lượng
      const aCount = parseInt(aUnread.textContent);
      const bCount = parseInt(bUnread.textContent);
      if (aCount !== bCount) return bCount - aCount;
    }
    
    // Nếu cả hai đều có hoặc không có unread, sắp xếp theo thời gian
    const aTimeEl = a.querySelector('.conversation-time');
    const bTimeEl = b.querySelector('.conversation-time');
    
    const aTime = aTimeEl?.dataset.timestamp || 0;
    const bTime = bTimeEl?.dataset.timestamp || 0;
    
    return parseInt(bTime) - parseInt(aTime);
  });

  // Xóa và thêm lại theo thứ tự mới
  conversations.forEach(conv => {
    conversationsContainer.appendChild(conv);
  });
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

      // SỬ DỤNG HÀM FORMAT MỚI
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
        </div>
      `;

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
// Hàm refresh thời gian mỗi phút
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
  }, 60000); // Cập nhật mỗi phút
}

// Khởi động time refresher khi DOM ready
document.addEventListener('DOMContentLoaded', () => {
  startTimeRefresher();
});
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
        // Xóa unread count
        const unreadCountEl = conversationEl.querySelector('.unread-count');
        if (unreadCountEl) unreadCountEl.remove();
        
        // Sắp xếp lại danh sách sau khi đánh dấu đã đọc
        sortConversationsList();
      }
    }
  })
  .catch(error => console.error('Error marking messages as read:', error));
}
// Hàm giảm unread count (có thể dùng trong các trường hợp khác)
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

// Khởi tạo format "x phút trước" trên danh sách hội thoại ban đầu
document.addEventListener('DOMContentLoaded', () => {
  if (window.moment) {
    moment.locale('vi');
    document.querySelectorAll('.conversation-time').forEach(el => {
      const isoTime = el.dataset.time;
      if (isoTime) {
        const m = moment(isoTime);
        if (m.isValid()) {
          el.textContent = m.fromNow();
          // Lưu timestamp cho việc sắp xếp
          el.dataset.timestamp = m.valueOf();
        }
      }
    });
    
    // Sắp xếp danh sách hội thoại ban đầu
    sortConversationsList();
  }
});

/* ============ Utility functions for special message types ============ */
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
export function setupMessageStatus() {
  // Lắng nghe cập nhật trạng thái tin nhắn
  socket.on('message_status_updated', (data) => {
      updateMessageStatusUI(data.message_id, data.status);
  });
}

// Hàm cập nhật trạng thái tin nhắn trên UI
export function updateMessageStatusUI(messageId, status) {
  const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
  if (!messageElement) return;

  const statusElement = messageElement.querySelector('.message-status');
  if (statusElement) {
      statusElement.textContent = getStatusText(status);
      statusElement.className = `message-status status-${status}`;
  }
}

// Hàm lấy text hiển thị theo trạng thái
function getStatusText(status) {
  const statusMap = {
      'sent': 'Đã gửi',
      'delivered': 'Đã nhận',
      'read': 'Đã xem'
  };
  return statusMap[status] || 'Đã gửi';
}

// Hàm gửi thông báo tin nhắn đã được đọc
export function markMessageAsRead(messageId) {
  socket.emit('message_read', { message_id: messageId });
}

// Hàm gửi thông báo tin nhắn đã được giao
export function markMessageAsDelivered(messageId) {
  socket.emit('message_delivered', { message_id: messageId });
}

/* ============ Utils nhỏ ============ */
function escapeHtml(unsafe = '') {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
export function resetCurrentConversation() {
  currentConversation = null;
}
window.chatModule = { resetCurrentConversation };
