import { socket } from "./socket/index.js";

let currentConversationId = null;
let currentConversationType = null; // 'private' hoặc 'group'

// [MỚI] Biến lưu ID tin nhắn đang trả lời
let replyingToId = null; 

// [MỚI] Biến & helper cho hiệu ứng "đang nhập..."
let isTyping = false;
let typingTimeout = null;
const TYPING_DELAY = 2500; // 2.5s sau khi ngừng gõ sẽ gửi stop_typing

function emitTyping() {
  if (!currentConversationId) return;

  if (currentConversationType === 'group') {
    socket.emit('group_typing', {
      group_id: currentConversationId,
      conversation_id: currentConversationId
    });
  } else {
    socket.emit('typing', {
      conversation_id: currentConversationId
    });
  }
}

function emitStopTyping() {
  if (!currentConversationId) return;

  if (currentConversationType === 'group') {
    socket.emit('group_stop_typing', {
      group_id: currentConversationId,
      conversation_id: currentConversationId
    });
  } else {
    socket.emit('stop_typing', {
      conversation_id: currentConversationId
    });
  }
}

function showTypingIndicator(username) {
  const indicator = document.getElementById('typing-indicator');
  if (!indicator) return;

  const textEl = indicator.querySelector('.typing-text');
  if (textEl) {
    textEl.innerText = username ? `${username} đang nhập...` : 'Đang nhập...';
  }

  indicator.classList.remove('hidden');
}

function hideTypingIndicator() {
  const indicator = document.getElementById('typing-indicator');
  if (!indicator) return;
  indicator.classList.add('hidden');
}


// ====== CÁC HÀM XỬ LÝ REPLY (THÊM MỚI VÀO ĐÂY ĐỂ KHÔNG ẢNH HƯỞNG CẤU TRÚC DƯỚI) ======
export function enableReplyMode(messageId, content, username) {
  replyingToId = messageId;
  const preview = document.getElementById('reply-preview');
  
  if (preview) {
    document.getElementById('reply-to-user').innerText = `Đang trả lời ${username}`;
    document.getElementById('reply-text-content').innerText = content;
    document.getElementById('reply-message-id').value = messageId;
    preview.classList.remove('hidden');
    const messageInput = document.getElementById('message');
    if (messageInput) messageInput.focus();
  }
}

export function cancelReply() {
  replyingToId = null;
  const preview = document.getElementById('reply-preview');
  if (preview) preview.classList.add('hidden');
  const replyInput = document.getElementById('reply-message-id');
  if (replyInput) replyInput.value = '';
}

export function getReplyToId() {
  return replyingToId;
}
// =====================================================================================


// ====== EXPORT FUNCTION TO SET CURRENT CONVERSATION ======
export function setCurrentConversation(conversationId, conversationType) {
  currentConversationId = conversationId;
  currentConversationType = conversationType;
  console.log(`[FileSharing] Set current conversation: ${conversationId}, type: ${conversationType}`);
  
  // [MỚI] Reset reply khi chuyển hội thoại
  cancelReply();
}

// ====== INIT FILE SHARING + STICKER + INPUT ======
export function initFileSharing() {
  console.log('[FileSharing] Initializing file sharing...');

  // [MỚI] Nút đóng Reply
  const closeReplyBtn = document.getElementById('close-reply');
  if (closeReplyBtn) {
      closeReplyBtn.addEventListener('click', cancelReply);
  }

  // [MỚI] Xử lý gửi tin nhắn TEXT (Để hỗ trợ Reply Text)
  const sendBtn = document.getElementById('send');
  const messageInput = document.getElementById('message');
  
    const handleSendText = () => {
    if (!messageInput) return;
    const content = messageInput.value.trim();
    if (content && currentConversationId) {
      const eventName = currentConversationType === 'group' ? 'send_group_message' : 'send_message';
      const msgData = {
        content: content,
        conversation_id: currentConversationId,
        group_id: currentConversationId, // Gửi cả 2 cho chắc
        conversation_type: currentConversationType,
        message_type: 'text',
        reply_to_id: replyingToId // [QUAN TRỌNG] Gửi kèm ID reply
      };

      socket.emit(eventName, msgData);

      // [MỚI] Gửi stop_typing khi gửi tin nhắn xong
      if (isTyping) {
        emitStopTyping();
        isTyping = false;
      }

      messageInput.value = '';
      cancelReply(); // Tắt reply sau khi gửi
    }
  };


  if (sendBtn) sendBtn.addEventListener('click', handleSendText);
  if (messageInput) {
    messageInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSendText();
      }
    });
  }

    // [MỚI] Bắt sự kiện gõ phím để emit typing / stop_typing
  if (messageInput) {
    messageInput.addEventListener('input', () => {
      if (!currentConversationId) return;

      // Lần đầu gõ -> emit typing
      if (!isTyping) {
        isTyping = true;
        emitTyping();
      }

      // Reset lại timeout mỗi lần gõ
      if (typingTimeout) {
        clearTimeout(typingTimeout);
      }

      typingTimeout = setTimeout(() => {
        emitStopTyping();
        isTyping = false;
      }, TYPING_DELAY);
    });
  }

  // ---------------------------------------------------------
  
  // Đính kèm file
  const attachFileBtn = document.getElementById('attach-file');
  if (attachFileBtn) {
    attachFileBtn.addEventListener('click', () => {
      const fileInput = document.getElementById('file-upload');
      if (fileInput) fileInput.click();
    });
  }

  // Đính kèm hình ảnh
  const attachImageBtn = document.getElementById('attach-image');
  if (attachImageBtn) {
    attachImageBtn.addEventListener('click', () => {
      const imageInput = document.getElementById('image-upload');
      if (imageInput) imageInput.click();
    });
  }

  // Mở sticker panel
  const showStickersBtn = document.getElementById('show-stickers');
  if (showStickersBtn) {
    showStickersBtn.addEventListener('click', () => {
      const stickerPanel = document.getElementById('sticker-panel');
      if (stickerPanel) stickerPanel.style.display = 'block';
    });
  }

  // Đóng sticker panel
  const closeStickersBtn = document.getElementById('close-stickers');
  if (closeStickersBtn) {
    closeStickersBtn.addEventListener('click', () => {
      const stickerPanel = document.getElementById('sticker-panel');
      if (stickerPanel) stickerPanel.style.display = 'none';
    });
  }

  // Chọn sticker
  document.querySelectorAll('.sticker').forEach(sticker => {
    sticker.addEventListener('click', () => {
      const stickerCode = sticker.getAttribute('data-sticker');
      if (stickerCode) {
        sendSticker(stickerCode);
        const stickerPanel = document.getElementById('sticker-panel');
        if (stickerPanel) stickerPanel.style.display = 'none';
      }
    });
  });

  // Upload file
  const fileUpload = document.getElementById('file-upload');
  if (fileUpload) {
    fileUpload.addEventListener('change', (e) => {
      const target = e.target;
      if (target && target.files && target.files.length > 0) {
        uploadFile(target.files[0]);
        target.value = ''; // Reset input
      }
    });
  }

  // Upload hình ảnh
  const imageUpload = document.getElementById('image-upload');
  if (imageUpload) {
    imageUpload.addEventListener('change', (e) => {
      const target = e.target;
      if (target && target.files && target.files.length > 0) {
        uploadImage(target.files[0]);
        target.value = ''; // Reset input
      }
    });
  }
}

// ====== UPLOAD FILE ======
async function uploadFile(file) {
  if (!currentConversationId) {
    alert('Vui lòng chọn một cuộc trò chuyện trước');
    return;
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('conversation_id', currentConversationId);
  formData.append('conversation_type', currentConversationType);

  try {
    const response = await fetch('/upload_file', {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const result = await response.json();

    if (result.success) {
      // QUAN TRỌNG: Sử dụng socket event khác nhau cho private và group
      const eventName = currentConversationType === 'group' ? 'send_group_message' : 'send_message';
      const messageData = {
        content: JSON.stringify({
          type: 'file',
          name: file.name,
          size: file.size,
          url: result.file_url
        }),
        message_type: 'file',
        reply_to_id: replyingToId // [MỚI] Thêm dòng này
      };

      // Thêm các trường khác nhau cho private và group
      if (currentConversationType === 'group') {
        messageData.group_id = currentConversationId;
      } else {
        messageData.conversation_id = currentConversationId;
        messageData.conversation_type = currentConversationType;
      }

      socket.emit(eventName, messageData);
      cancelReply(); // [MỚI] Reset sau khi gửi
    } else {
      alert('Upload file thất bại: ' + (result.error || 'Unknown error'));
    }
  } catch (err) {
    console.error('Upload file error:', err);
    alert('Có lỗi khi upload file');
  }
}

// ====== UPLOAD IMAGE ======
async function uploadImage(file) {
  if (!currentConversationId) {
    alert('Vui lòng chọn một cuộc trò chuyện trước');
    return;
  }

  if (file.size > 5 * 1024 * 1024) { // 5MB
    alert('Hình ảnh không được vượt quá 5MB');
    return;
  }

  const formData = new FormData();
  formData.append('image', file);
  formData.append('conversation_id', currentConversationId);
  formData.append('conversation_type', currentConversationType);

  try {
    const response = await fetch('/upload_image', {
      method: 'POST',
      body: formData
    });
    const result = await response.json();

    if (result.success) {
      // QUAN TRỌNG: Sử dụng socket event khác nhau cho private và group
      const eventName = currentConversationType === 'group' ? 'send_group_message' : 'send_message';
      const messageData = {
        content: JSON.stringify({
          type: 'image',
          name: file.name,
          url: result.image_url,
          thumbnail: result.thumbnail_url
        }),
        message_type: 'image',
        reply_to_id: replyingToId // [MỚI] Thêm dòng này
      };

      // Thêm các trường khác nhau cho private và group
      if (currentConversationType === 'group') {
        messageData.group_id = currentConversationId;
      } else {
        messageData.conversation_id = currentConversationId;
        messageData.conversation_type = currentConversationType;
      }

      socket.emit(eventName, messageData);
      cancelReply(); // [MỚI] Reset sau khi gửi
    } else {
      alert('Upload hình ảnh thất bại: ' + (result.error || 'Unknown error'));
    }
  } catch (err) {
    console.error('Upload image error:', err);
    alert('Có lỗi khi upload hình ảnh');
  }
}

// ====== STICKER ======
function sendSticker(stickerCode) {
  if (!currentConversationId) {
    alert('Vui lòng chọn một cuộc trò chuyện trước');
    return;
  }
  
  // QUAN TRỌNG: Sử dụng socket event khác nhau cho private và group
  const eventName = currentConversationType === 'group' ? 'send_group_message' : 'send_message';
  const messageData = {
    content: stickerCode,
    message_type: 'sticker',
    reply_to_id: replyingToId // [MỚI] Thêm dòng này
  };

  // Thêm các trường khác nhau cho private và group
  if (currentConversationType === 'group') {
    messageData.group_id = currentConversationId;
  } else {
    messageData.conversation_id = currentConversationId;
    messageData.conversation_type = currentConversationType;
  }

  socket.emit(eventName, messageData);
  cancelReply(); // [MỚI] Reset sau khi gửi
}

// ====== HIỂN THỊ TIN NHẮN (ĐÃ NÂNG CẤP HỖ TRỢ REPLY UI) ======
export function displayMessage(message) {
  const messagesContainer = document.getElementById('messages');
  if (!messagesContainer) return;

  const userId = getUserId();
  const isMe = message.sender_id === userId;
  const messageId = message.message_id || message._id || message.id || '';

  const messageElement = document.createElement('div');
  messageElement.className = `message ${isMe ? 'sent me' : 'received'}`;
  if (messageId) messageElement.dataset.id = messageId;

  const senderName = message.sender_name || 'Unknown';
  const timeLabel = formatTime(message.timestamp);

  // Trạng thái message (tùy chọn)
  let statusText = '';
  let statusClass = '';
  if (message.status) {
    switch (message.status) {
      case 'sent':
        statusText = 'Đã gửi';
        statusClass = 'status-sent';
        break;
      case 'delivered':
        statusText = 'Đã nhận';
        statusClass = 'status-delivered';
        break;
      case 'read':
        statusText = 'Đã xem';
        statusClass = 'status-read';
        break;
      default:
        statusText = '';
        statusClass = '';
    }
  }

  const isDeleted = message.deleted || message.content === 'Tin nhắn đã được thu hồi';

  // ===== Build nội dung chính theo loại tin nhắn =====
  let mainContentHTML = '';

  if (message.message_type === 'file') {
    let fileInfo = {};
    try {
      fileInfo = JSON.parse(message.content || '{}');
    } catch (e) {
      console.warn('Cannot parse file content JSON:', e);
    }
    mainContentHTML = `
      <div class="file-message">
        <div class="file-info">
          <div class="file-icon"><i class="fi fi-rr-file"></i></div>
          <div class="file-details">
            <div class="file-name">${escapeHtml(fileInfo.name || 'File')}</div>
            <div class="file-size">${formatFileSize(fileInfo.size || 0)}</div>
          </div>
        </div>
        <a href="${fileInfo.url || '#'}" class="file-download" download>Tải xuống</a>
      </div>
    `;
  } else if (message.message_type === 'image') {
    let imageInfo = {};
    try {
      imageInfo = JSON.parse(message.content || '{}');
    } catch (e) {
      console.warn('Cannot parse image content JSON:', e);
    }
    const imageName = imageInfo.name || 'Hình ảnh';
    const thumbUrl = imageInfo.thumbnail || imageInfo.url || '';
    const fullUrl = imageInfo.url || '';
    mainContentHTML = `
      <div class="image-message">
        <div class="image-info">
          <i class="fi fi-rr-picture"></i> ${escapeHtml(imageName)}
        </div>
        ${thumbUrl ? `<img src="${thumbUrl}" class="uploaded-image" alt="${escapeHtml(imageName)}">` : ''}
        ${fullUrl ? `<a href="${fullUrl}" target="_blank">Xem ảnh gốc</a>` : ''}
      </div>
    `;
  } else if (message.message_type === 'sticker') {
    mainContentHTML = `
      <div class="sticker-message">${getStickerHTML(message.content)}</div>
    `;
  } else {
    // text + deleted
    const text = escapeHtml(message.content || '');
    mainContentHTML = `
      <div class="message-text">${text}</div>
    `;
  }

  // ===== Reply quote (nếu có) =====
  let replyQuoteHTML = '';
  if (message.reply_context) {
    const reply = message.reply_context;
    const replySender = reply.sender_name || 'Unknown';
    let replyText = reply.content || '';

    // Nếu là JSON (file/image) -> rút gọn
    if (typeof replyText === 'string' && replyText.trim().startsWith('{')) {
      try {
        const data = JSON.parse(replyText);
        if (data.type === 'file') replyText = data.name || 'File';
        else if (data.type === 'image') replyText = data.name || 'Hình ảnh';
      } catch (e) {
        // ignore
      }
    }

    replyText = String(replyText)
      .replace(/\r?\n/g, ' ')
      .trim();
    if (replyText.length > 80) replyText = replyText.slice(0, 80) + '...';

    replyQuoteHTML = `
      <div class="message-reply-quote" data-reply-id="${reply.message_id || ''}">
        <span class="reply-sender">${escapeHtml(replySender)}</span>
        <span class="reply-text-short">${escapeHtml(replyText)}</span>
      </div>
    `;
  }

  // ===== Meta row (time + status + edited) =====
  const editedBadgeHTML = message.edited ? `<span class="edited-badge">(đã chỉnh sửa)</span>` : '';

  const metaHTML = `
    <div class="message-status-container">
      <span class="message-time">${timeLabel}</span>
      ${editedBadgeHTML}
      ${statusText ? `<span class="message-status ${statusClass}">${statusText}</span>` : ''}
    </div>
  `;

  // ===== Wrap toàn bộ theo cấu trúc CSS mới =====
  messageElement.innerHTML = `
    <div class="message-content-wrapper">
      <div class="message-sender">${escapeHtml(senderName)}</div>
      ${replyQuoteHTML}
      <div class="message-content">
        ${mainContentHTML}
        ${metaHTML}
      </div>
      <div class="message-actions">
        ${
          isDeleted
            ? ''
            : `<button class="message-action-btn btn-reply" title="Trả lời">
                 <i class="fas fa-reply"></i>
               </button>`
        }
      </div>
    </div>
  `;

  // ===== Gắn event cho nút Reply =====
  if (!isDeleted) {
    const replyBtn = messageElement.querySelector('.btn-reply');
    if (replyBtn) {
      replyBtn.addEventListener('click', () => {
        const previewText = buildReplyPreviewFromMessage(message);
        enableReplyMode(messageId, previewText, senderName);
      });
    }
  }

  // ===== Gắn event click vào quote để scroll tới tin gốc =====
  const replyQuoteEl = messageElement.querySelector('.message-reply-quote');
  if (replyQuoteEl) {
    replyQuoteEl.addEventListener('click', () => {
      const replyId = replyQuoteEl.getAttribute('data-reply-id');
      if (!replyId) return;
      const target = document.querySelector(`.message[data-id="${replyId}"]`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('highlight-message');
        setTimeout(() => {
          target.classList.remove('highlight-message');
        }, 2000);
      }
    });
  }

  messagesContainer.appendChild(messageElement);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// ====== UTILS (GIỮ NGUYÊN + THÊM MỚI) ======

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

function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getUserId() {
  // Lấy user ID từ session hoặc từ element trên page
  const userAvatar = document.querySelector('.user-avatar');
  return userAvatar ? userAvatar.dataset.userId : null;
}

// Build short preview text để fill vào thanh reply-preview
function buildReplyPreviewFromMessage(message) {
  if (!message) return '';
  const type = message.message_type || 'text';

  if (type === 'file' || type === 'image') {
    try {
      const data = JSON.parse(message.content || '{}');
      if (data.type === 'file') return data.name || 'File';
      if (data.type === 'image') return data.name || 'Hình ảnh';
    } catch (e) {
      // ignore
    }
    return type === 'file' ? 'File đính kèm' : 'Hình ảnh';
  }

  if (type === 'sticker') {
    return 'Sticker';
  }

  // Text
  let text = message.content || '';
  text = String(text).replace(/\r?\n/g, ' ').trim();
  if (text.length > 80) text = text.slice(0, 80) + '...';
  return text;
}

// ====== FORMAT TIME UTILITY ======
function formatTime(timestamp) {
  if (!timestamp) return '';
  try {
    const messageDate = new Date(timestamp);
    if (isNaN(messageDate.getTime())) return 'Vừa xong';

    const now = new Date();
    const diffMs = now.getTime() - messageDate.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

    if (diffMinutes < 1) return 'Vừa xong';
    if (diffMinutes < 60) return `${diffMinutes} phút trước`;
    if (diffHours < 24) {
      const h = messageDate.getHours().toString().padStart(2, '0');
      const m = messageDate.getMinutes().toString().padStart(2, '0');
      return `${h}:${m}`;
    }

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    const h = messageDate.getHours().toString().padStart(2, '0');
    const m = messageDate.getMinutes().toString().padStart(2, '0');

    if (messageDate.toDateString() === yesterday.toDateString()) {
      return `Hôm qua ${h}:${m}`;
    }
    
    const d = messageDate.getDate().toString().padStart(2, '0');
    const mm = (messageDate.getMonth() + 1).toString().padStart(2, '0');
    return `${d}/${mm} ${h}:${m}`;
  } catch (error) {
    console.error('Error formatting time:', error);
    return 'Vừa xong';
  }
}



// ====== SOCKET LISTENERS CHO TYPING INDICATOR ======

// Private chat: nhận "đang nhập"
socket.on('typing', (data) => {
  if (!data) return;
  // Chỉ hiển thị nếu đang ở cùng conversation
  if (data.conversation_id !== currentConversationId) return;

  // Không hiển thị nếu là chính mình
  const userId = getUserId();
  if (data.user_id && data.user_id === userId) return;

  showTypingIndicator(data.username || 'Người dùng');
});

// Private chat: nhận stop_typing
socket.on('stop_typing', (data) => {
  if (!data) return;
  if (data.conversation_id !== currentConversationId) return;
  hideTypingIndicator();
});

// Group chat: nhận "đang nhập"
socket.on('group_typing', (data) => {
  if (!data) return;
  if (data.group_id !== currentConversationId) return;

  const userId = getUserId();
  if (data.user_id && data.user_id === userId) return;

  showTypingIndicator(data.username || 'Thành viên');
});

// Group chat: nhận stop_typing
socket.on('group_stop_typing', (data) => {
  if (!data) return;
  if (data.group_id !== currentConversationId) return;
  hideTypingIndicator();
});
