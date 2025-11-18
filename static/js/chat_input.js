import { socket } from "./socket/index.js";

let currentConversationId = null;
let currentConversationType = null; // 'private' hoặc 'group'

// ====== EXPORT FUNCTION TO SET CURRENT CONVERSATION ======
export function setCurrentConversation(conversationId, conversationType) {
  currentConversationId = conversationId;
  currentConversationType = conversationType;
  console.log(`[FileSharing] Set current conversation: ${conversationId}, type: ${conversationType}`);
}

// ====== INIT FILE SHARING + STICKER ======
export function initFileSharing() {
  console.log('[FileSharing] Initializing file sharing...');
  
  // Đính kèm file
  const attachFileBtn = document.getElementById('attach-file');
  if (attachFileBtn) {
    attachFileBtn.addEventListener('click', () => {
      document.getElementById('file-upload').click();
    });
  }

  // Đính kèm hình ảnh
  const attachImageBtn = document.getElementById('attach-image');
  if (attachImageBtn) {
    attachImageBtn.addEventListener('click', () => {
      document.getElementById('image-upload').click();
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
      sendSticker(stickerCode);
      const stickerPanel = document.getElementById('sticker-panel');
      if (stickerPanel) stickerPanel.style.display = 'none';
    });
  });

  // Upload file
  const fileUpload = document.getElementById('file-upload');
  if (fileUpload) {
    fileUpload.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        uploadFile(e.target.files[0]);
        e.target.value = ''; // Reset input
      }
    });
  }

  // Upload hình ảnh
  const imageUpload = document.getElementById('image-upload');
  if (imageUpload) {
    imageUpload.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        uploadImage(e.target.files[0]);
        e.target.value = ''; // Reset input
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
        message_type: 'file'
      };

      // Thêm các trường khác nhau cho private và group
      if (currentConversationType === 'group') {
        messageData.group_id = currentConversationId;
      } else {
        messageData.conversation_id = currentConversationId;
        messageData.conversation_type = currentConversationType;
      }

      socket.emit(eventName, messageData);
    } else {
      alert('Upload file thất bại: ' + result.error);
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
        message_type: 'image'
      };

      // Thêm các trường khác nhau cho private và group
      if (currentConversationType === 'group') {
        messageData.group_id = currentConversationId;
      } else {
        messageData.conversation_id = currentConversationId;
        messageData.conversation_type = currentConversationType;
      }

      socket.emit(eventName, messageData);
    } else {
      alert('Upload hình ảnh thất bại: ' + result.error);
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
    message_type: 'sticker'
  };

  // Thêm các trường khác nhau cho private và group
  if (currentConversationType === 'group') {
    messageData.group_id = currentConversationId;
  } else {
    messageData.conversation_id = currentConversationId;
    messageData.conversation_type = currentConversationType;
  }

  socket.emit(eventName, messageData);
}
// ====== HIỂN THỊ TIN NHẮN ======
export function displayMessage(message) {
  const messagesContainer = document.getElementById('messages');
  if (!messagesContainer) return;

  const messageElement = document.createElement('div');
  messageElement.className = `message ${message.sender_id === getUserId() ? 'sent' : 'received'}`;

  if (message.message_type === 'file') {
    const fileInfo = JSON.parse(message.content);
    messageElement.innerHTML = `
      <div class="message-sender">${message.sender_name}</div>
      <div class="file-message">
        <div class="file-info">
          <div class="file-icon"><i class="fi fi-rr-file"></i></div>
          <div class="file-details">
            <div class="file-name">${fileInfo.name}</div>
            <div class="file-size">${formatFileSize(fileInfo.size)}</div>
          </div>
        </div>
        <a href="${fileInfo.url}" class="file-download" download>Tải xuống</a>
      </div>
      <div class="message-time">${formatTime(message.timestamp)}</div>
    `;
  } else if (message.message_type === 'image') {
    const imageInfo = JSON.parse(message.content);
    messageElement.innerHTML = `
      <div class="message-sender">${message.sender_name}</div>
      <div class="image-message">
        <div class="image-info">
          <i class="fi fi-rr-picture"></i> ${imageInfo.name}
        </div>
        <img src="${imageInfo.thumbnail || imageInfo.url}" class="uploaded-image" alt="${imageInfo.name}">
        <a href="${imageInfo.url}" target="_blank">Xem ảnh gốc</a>
      </div>
      <div class="message-time">${formatTime(message.timestamp)}</div>
    `;
  } else if (message.message_type === 'sticker') {
    messageElement.innerHTML = `
      <div class="message-sender">${message.sender_name}</div>
      <div class="sticker-message">${getStickerHTML(message.content)}</div>
      <div class="message-time">${formatTime(message.timestamp)}</div>
    `;
  } else {
    messageElement.innerHTML = `
      <div class="message-sender">${message.sender_name}</div>
      <div class="message-text">${escapeHtml(message.content)}</div>
      <div class="message-time">${formatTime(message.timestamp)}</div>
    `;
  }

  messagesContainer.appendChild(messageElement);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// ====== UTILS ======
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
  return unsafe
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
    if (diffHours < 24) return `${messageDate.getHours().toString().padStart(2, '0')}:${messageDate.getMinutes().toString().padStart(2, '0')}`;

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    if (messageDate.toDateString() === yesterday.toDateString()) {
      return `Hôm qua ${messageDate.getHours().toString().padStart(2, '0')}:${messageDate.getMinutes().toString().padStart(2, '0')}`;
    }
    
    return `${messageDate.getDate().toString().padStart(2, '0')}/${(messageDate.getMonth() + 1).toString().padStart(2, '0')} ${messageDate.getHours().toString().padStart(2, '0')}:${messageDate.getMinutes().toString().padStart(2, '0')}`;
  } catch (error) {
    console.error('Error formatting time:', error);
    return 'Vừa xong';
  }
}