// static/js/chat_input.js
import { socket } from "./socket/index.js";

let currentConversationId = null;
let currentConversationType = null; // 'private' hoặc 'group'
// [MỚI] Biến lưu kiểu hộp quà đang chọn
let selectedGiftStyle = null;

// [MỚI] Biến lưu ID tin nhắn đang trả lời
let replyingToId = null;

// [MỚI] Biến & helper cho hiệu ứng "đang nhập..."
let isTyping = false;
let typingTimeout = null;
const TYPING_DELAY = 2500; // 2.5s sau khi ngừng gõ sẽ gửi stop_typing

// ====== BIẾN CHO VOICE MESSAGE ======
let mediaRecorder = null;
let audioChunks = [];
let isRecordingVoice = false;

// ================= TYPING EMIT =================

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

// ====== CÁC HÀM XỬ LÝ REPLY ======

export function enableReplyMode(messageId, content, username) {
  replyingToId = messageId;
  const preview = document.getElementById('reply-preview');

  if (preview) {
    const replyUserEl = document.getElementById('reply-to-user');
    const replyTextEl = document.getElementById('reply-text-content');
    const replyIdInput = document.getElementById('reply-message-id');

    if (replyUserEl) replyUserEl.innerText = `Đang trả lời ${username}`;
    if (replyTextEl) replyTextEl.innerText = content;
    if (replyIdInput) replyIdInput.value = messageId;

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

// ====== SET CURRENT CONVERSATION ======

export function setCurrentConversation(conversationId, conversationType) {
  currentConversationId = conversationId;
  currentConversationType = conversationType || 'private';
  console.log(
    `[FileSharing] Set current conversation: ${conversationId}, type: ${currentConversationType}`
  );

  // Reset reply khi chuyển hội thoại
  cancelReply();

  // Khi chuyển hội thoại thì cũng ẩn typing indicator
  hideTypingIndicator();
}

// ====== INIT FILE SHARING + STICKER + INPUT + VOICE + GIFT ======

export function initFileSharing() {
  console.log('[FileSharing] Initializing file sharing...');

  // --- [MỚI] 1. XỬ LÝ NÚT HỘP QUÀ & PANEL ---
  const giftBtn = document.getElementById('btn-gift');
  const giftPanel = document.getElementById('gift-panel');
  const closeGift = document.querySelector('.close-gift');
  const giftOptions = document.querySelectorAll('.gift-option');

  // Toggle panel khi bấm nút quà
  if (giftBtn) {
    giftBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // Ngăn sự kiện click lan ra ngoài
      if (giftPanel) giftPanel.classList.toggle('hidden');
    });
  }

  // Đóng panel bằng nút X
  if (closeGift) {
    closeGift.addEventListener('click', () => {
      if (giftPanel) {
        giftPanel.classList.add('hidden');
        // Reset lựa chọn nếu muốn, hoặc giữ nguyên tuỳ ý. Ở đây mình reset UI panel thôi.
      }
    });
  }

  // Logic chọn kiểu hộp quà
  giftOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      // 1. Xóa class selected cũ
      giftOptions.forEach(o => o.classList.remove('selected'));
      
      // 2. Kiểm tra: Nếu click lại cái đang chọn -> Hủy chọn
      if (selectedGiftStyle === opt.dataset.style) {
        selectedGiftStyle = null;
        if (giftBtn) giftBtn.classList.remove('active');
      } else {
        // 3. Chọn mới
        opt.classList.add('selected');
        selectedGiftStyle = opt.dataset.style;
        if (giftBtn) giftBtn.classList.add('active');
      }
      
      // 4. Ẩn panel và focus lại ô nhập liệu
      if (giftPanel) giftPanel.classList.add('hidden');
      const messageInput = document.getElementById('message');
      if (messageInput) messageInput.focus();
    });
  });

  // Đóng panel khi click ra ngoài (bất kỳ đâu trên document)
  document.addEventListener('click', (e) => {
    if (giftPanel && !giftPanel.classList.contains('hidden')) {
      // Nếu click không nằm trong panel VÀ không nằm trong nút gift
      if (!giftPanel.contains(e.target) && e.target !== giftBtn && !giftBtn.contains(e.target)) {
        giftPanel.classList.add('hidden');
      }
    }
  });
  // ----------------------------------------------------

  // [MỚI] Nút đóng Reply
  const closeReplyBtn = document.getElementById('close-reply');
  if (closeReplyBtn) {
    closeReplyBtn.addEventListener('click', cancelReply);
  }

  // --- 2. GỬI TIN NHẮN (TEXT + GIFT) ---
  const sendBtn = document.getElementById('send');
  const messageInput = document.getElementById('message');

  const handleSendText = () => {
    if (!messageInput) return;
    const content = messageInput.value.trim();
    
    // Cho phép gửi nếu có nội dung HOẶC đang chọn hộp quà (nếu bạn muốn cho phép gửi hộp quà rỗng)
    // Ở đây mình vẫn yêu cầu có content
    if (content && currentConversationId) {
      const eventName =
        currentConversationType === 'group' ? 'send_group_message' : 'send_message';

      const msgData = {
        content: content,
        conversation_id: currentConversationId,
        group_id: currentConversationId, // Gửi cả 2 cho chắc
        conversation_type: currentConversationType,
        message_type: 'text',
        reply_to_id: replyingToId,
        
        // 🔥 [QUAN TRỌNG] Gửi kèm style hộp quà đã chọn
        gift_style: selectedGiftStyle 
      };

      socket.emit(eventName, msgData);

      // Gửi stop_typing khi gửi tin nhắn xong
      if (isTyping) {
        emitStopTyping();
        isTyping = false;
      }

      // Reset Input
      messageInput.value = '';
      cancelReply();

      // 🔥 [RESET] Reset trạng thái Hộp quà sau khi gửi thành công
      selectedGiftStyle = null;
      if (giftBtn) giftBtn.classList.remove('active');
      giftOptions.forEach(o => o.classList.remove('selected'));
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

    // Typing indicator
    messageInput.addEventListener('input', () => {
      if (!currentConversationId) return;

      if (!isTyping) {
        isTyping = true;
        emitTyping();
      }

      if (typingTimeout) {
        clearTimeout(typingTimeout);
      }

      typingTimeout = setTimeout(() => {
        emitStopTyping();
        isTyping = false;
      }, TYPING_DELAY);
    });
  }

  // ====== GHI ÂM VOICE MESSAGE ======
  const recordBtn = document.getElementById('record-voice');
  const recordingIndicator = document.getElementById('recording-indicator');

  if (recordBtn) {
    recordBtn.addEventListener('click', async () => {
      if (!currentConversationId) {
        alert('Vui lòng chọn một cuộc trò chuyện trước');
        return;
      }

      // Nếu đang ghi -> dừng ghi, onstop sẽ upload
      if (isRecordingVoice && mediaRecorder) {
        try {
          if (mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
          }
        } catch (e) {
          console.error('Error stopping MediaRecorder:', e);
        }
        return;
      }

      // Không hỗ trợ
      if (!navigator.mediaDevices || !window.MediaRecorder) {
        alert('Trình duyệt không hỗ trợ ghi âm (MediaRecorder).');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        audioChunks = [];
        mediaRecorder = new MediaRecorder(stream);

        mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            audioChunks.push(e.data);
          }
        };

        mediaRecorder.onstop = async () => {
          isRecordingVoice = false;

          // Tắt UI
          if (recordBtn) recordBtn.classList.remove('recording');
          if (recordingIndicator) recordingIndicator.classList.add('hidden');

          // Dừng stream
          if (mediaRecorder && mediaRecorder.stream) {
            mediaRecorder.stream.getTracks().forEach((t) => t.stop());
          }

          if (!audioChunks.length) return;

          const blob = new Blob(audioChunks, { type: 'audio/webm' });
          audioChunks = [];

          try {
            await uploadVoiceMessage(blob);
          } catch (err) {
            console.error('Upload voice failed:', err);
            alert('Có lỗi khi upload voice message');
          }
        };

        mediaRecorder.start();
        isRecordingVoice = true;

        if (recordBtn) recordBtn.classList.add('recording');
        if (recordingIndicator) recordingIndicator.classList.remove('hidden');
      } catch (err) {
        console.error('Không thể truy cập micro:', err);
        alert('Không thể truy cập micro. Vui lòng kiểm tra quyền micro của trình duyệt.');
      }
    });
  }

  // ====== ATTACH FILE ======
  const attachFileBtn = document.getElementById('attach-file');
  if (attachFileBtn) {
    attachFileBtn.addEventListener('click', () => {
      const fileInput = document.getElementById('file-upload');
      if (fileInput) fileInput.click();
    });
  }

  // ====== ATTACH IMAGE ======
  const attachImageBtn = document.getElementById('attach-image');
  if (attachImageBtn) {
    attachImageBtn.addEventListener('click', () => {
      const imageInput = document.getElementById('image-upload');
      if (imageInput) imageInput.click();
    });
  }
 // ====== SHARE LOCATION ======
const shareLocationBtn = document.getElementById('btn-share-location');
if (shareLocationBtn) {
  shareLocationBtn.addEventListener('click', handleShareLocation);
} else {
  console.warn('[Location] Không tìm thấy nút #btn-share-location');
}



  // ====== STICKER PANEL ======
  const showStickersBtn = document.getElementById('show-stickers');
  if (showStickersBtn) {
    showStickersBtn.addEventListener('click', () => {
      const stickerPanel = document.getElementById('sticker-panel');
      if (stickerPanel) stickerPanel.style.display = 'block';
    });
  }

  const closeStickersBtn = document.getElementById('close-stickers');
  if (closeStickersBtn) {
    closeStickersBtn.addEventListener('click', () => {
      const stickerPanel = document.getElementById('sticker-panel');
      if (stickerPanel) stickerPanel.style.display = 'none';
    });
  }

  document.querySelectorAll('.sticker').forEach((sticker) => {
    sticker.addEventListener('click', () => {
      const stickerCode = sticker.getAttribute('data-sticker');
      if (stickerCode) {
        sendSticker(stickerCode);
        const stickerPanel = document.getElementById('sticker-panel');
        if (stickerPanel) stickerPanel.style.display = 'none';
      }
    });
  });

  // ====== UPLOAD FILE ======
  const fileUpload = document.getElementById('file-upload');
  if (fileUpload) {
    fileUpload.addEventListener('change', (e) => {
      const target = e.target;
      if (target && target.files && target.files.length > 0) {
        uploadFile(target.files[0]);
        target.value = '';
      }
    });
  }

  // ====== UPLOAD IMAGE ======
  const imageUpload = document.getElementById('image-upload');
  if (imageUpload) {
    imageUpload.addEventListener('change', (e) => {
      const target = e.target;
      if (target && target.files && target.files.length > 0) {
        uploadImage(target.files[0]);
        target.value = '';
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
      const eventName =
        currentConversationType === 'group' ? 'send_group_message' : 'send_message';

      const messageData = {
        content: JSON.stringify({
          type: 'file',
          name: file.name,
          size: file.size,
          url: result.file_url
        }),
        message_type: 'file',
        reply_to_id: replyingToId
      };

      if (currentConversationType === 'group') {
        messageData.group_id = currentConversationId;
      } else {
        messageData.conversation_id = currentConversationId;
        messageData.conversation_type = currentConversationType;
      }

      socket.emit(eventName, messageData);
      cancelReply();
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

  if (file.size > 5 * 1024 * 1024) {
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
      const eventName =
        currentConversationType === 'group' ? 'send_group_message' : 'send_message';

      const messageData = {
        content: JSON.stringify({
          type: 'image',
          name: file.name,
          url: result.image_url,
          thumbnail: result.thumbnail_url
        }),
        message_type: 'image',
        reply_to_id: replyingToId
      };

      if (currentConversationType === 'group') {
        messageData.group_id = currentConversationId;
      } else {
        messageData.conversation_id = currentConversationId;
        messageData.conversation_type = currentConversationType;
      }

      socket.emit(eventName, messageData);
      cancelReply();
    } else {
      alert('Upload hình ảnh thất bại: ' + (result.error || 'Unknown error'));
    }
  } catch (err) {
    console.error('Upload image error:', err);
    alert('Có lỗi khi upload hình ảnh');
  }
}
// ====== SHARE LOCATION (GỬI VỊ TRÍ) ======
async function handleShareLocation() {
  if (!currentConversationId) {
    alert('Vui lòng chọn một cuộc trò chuyện trước');
    return;
  }

  if (!navigator.geolocation) {
    alert('Trình duyệt không hỗ trợ chia sẻ vị trí.');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude, accuracy } = position.coords;

      const locationPayload = {
        type: 'location',
        lat: latitude,
        lng: longitude,
        accuracy: accuracy,
        created_at: new Date().toISOString()
      };

      const eventName =
        currentConversationType === 'group' ? 'send_group_message' : 'send_message';

      const messageData = {
        content: JSON.stringify(locationPayload),
        message_type: 'location',
        reply_to_id: replyingToId
      };

      if (currentConversationType === 'group') {
        messageData.group_id = currentConversationId;
      } else {
        messageData.conversation_id = currentConversationId;
        messageData.conversation_type = currentConversationType;
      }

      socket.emit(eventName, messageData);
      cancelReply();
    },
    (error) => {
      console.error('Lấy vị trí bị lỗi:', error);
      let msg = 'Không lấy được vị trí hiện tại.';

      switch (error.code) {
        case error.PERMISSION_DENIED:
          msg = 'Bạn đã từ chối quyền truy cập vị trí.';
          break;
        case error.POSITION_UNAVAILABLE:
          msg = 'Không thể xác định vị trí hiện tại.';
          break;
        case error.TIMEOUT:
          msg = 'Lấy vị trí quá thời gian cho phép.';
          break;
      }
      alert(msg);
    },
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 10000
    }
  );
}


// ====== UPLOAD VOICE MESSAGE ======

async function uploadVoiceMessage(blob) {
  if (!currentConversationId) {
    alert('Vui lòng chọn một cuộc trò chuyện trước');
    return;
  }

  const fileName = `voice-${Date.now()}.webm`;
  const voiceFile = new File([blob], fileName, {
    type: blob.type || 'audio/webm'
  });

  const formData = new FormData();
  formData.append('file', voiceFile);
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
      const eventName =
        currentConversationType === 'group' ? 'send_group_message' : 'send_message';

      const messageData = {
        content: JSON.stringify({
          type: 'audio',
          name: fileName,
          url: result.file_url
        }),
        message_type: 'audio',
        reply_to_id: replyingToId
      };

      if (currentConversationType === 'group') {
        messageData.group_id = currentConversationId;
      } else {
        messageData.conversation_id = currentConversationId;
        messageData.conversation_type = currentConversationType;
      }

      socket.emit(eventName, messageData);
      cancelReply();
    } else {
      alert('Upload voice thất bại: ' + (result.error || 'Unknown error'));
    }
  } catch (err) {
    console.error('Upload voice error:', err);
    alert('Có lỗi khi upload voice message');
  }
}

// ====== STICKER ======

function sendSticker(stickerCode) {
  if (!currentConversationId) {
    alert('Vui lòng chọn một cuộc trò chuyện trước');
    return;
  }

  const eventName =
    currentConversationType === 'group' ? 'send_group_message' : 'send_message';

  const messageData = {
    content: stickerCode,
    message_type: 'sticker',
    reply_to_id: replyingToId
  };

  if (currentConversationType === 'group') {
    messageData.group_id = currentConversationId;
  } else {
    messageData.conversation_id = currentConversationId;
    messageData.conversation_type = currentConversationType;
  }

  socket.emit(eventName, messageData);
  cancelReply();
}

// ====== HIỂN THỊ TIN NHẮN ======

// ====== HIỂN THỊ TIN NHẮN ======
// đặt gần đầu displayMessage, sau khi khai báo detectedType:
let locationMapUrl = null;

export function displayMessage(message) {
  const messagesContainer = document.getElementById('messages');
  if (!messagesContainer) return;

  const userId = getUserId();
  const isMe = message.sender_id === userId;
  const messageId = message.message_id || message._id || message.id || '';

  const messageElement = document.createElement('div');
  messageElement.className = `message ${isMe ? 'sent me' : 'received'}`;
  if (messageId) messageElement.dataset.id = messageId;
  if (message.sender_id) messageElement.dataset.senderId = message.sender_id;

  const senderName = message.sender_name || 'Unknown';
  const timeLabel = formatTime(message.timestamp);

  // ===== 1. PARSE PAYLOAD & XÁC ĐỊNH KIỂU =====
  let payload = null;
  let detectedType = message.message_type || 'text';
  let locationMapUrl = null; // URL map cho tin nhắn dạng location

  if (message.content) {
    if (typeof message.content === 'object') {
      payload = message.content;
      if (!detectedType && payload.type) {
        detectedType = payload.type;
      }
    } else if (typeof message.content === 'string') {
      const trimmed = message.content.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          payload = JSON.parse(trimmed);
          if (!detectedType && payload.type) {
            detectedType = payload.type; // audio / image / file / location...
          }
        } catch (e) {
          // parse lỗi thì kệ, coi như text
          payload = null;
        }
      }
    }
  }

  // Ưu tiên type trong payload nếu có
  if (payload && payload.type) {
    detectedType = payload.type;
  }

  console.log('[displayMessage] type=', detectedType, 'payload=', payload, 'raw=', message.content);

  // ===== 2. TRẠNG THÁI MESSAGE =====
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

  // ===== 3. BUILD NỘI DUNG CHÍNH =====
  let mainContentHTML = '';

  if (detectedType === 'file') {
    const fileInfo = payload || {};
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
  } else if (detectedType === 'image') {
    const imageInfo = payload || {};
    const imageName = imageInfo.name || 'Hình ảnh';
    const thumbUrl = imageInfo.thumbnail || imageInfo.url || '';
    const fullUrl = imageInfo.url || '';
    mainContentHTML = `
      <div class="image-message">
        <div class="image-info">
          <i class="fi fi-rr-picture"></i> ${escapeHtml(imageName)}
        </div>
        ${
          thumbUrl
            ? `<img src="${thumbUrl}" class="uploaded-image" alt="${escapeHtml(imageName)}">`
            : ''
        }
        ${fullUrl ? `<a href="${fullUrl}" target="_blank">Xem ảnh gốc</a>` : ''}
      </div>
    `;
  } else if (detectedType === 'audio') {
    const audioInfo = payload || {};
    const audioUrl = audioInfo.url || '';
    const audioName = audioInfo.name || 'Tin nhắn thoại';
    mainContentHTML = `
      <div class="audio-message">
        <div class="audio-info">
          <i class="fas fa-microphone"></i> ${escapeHtml(audioName)}
        </div>
        ${
          audioUrl
            ? `<audio controls src="${audioUrl}" class="voice-audio"></audio>`
            : '<span>Không tìm thấy file audio</span>'
        }
      </div>
    `;
} else if (detectedType === 'location') {
    const loc = payload || {};
    const lat = loc.lat || loc.latitude;
    const lng = loc.lng || loc.longitude;
    const address = loc.address || loc.name || 'Vị trí đã chia sẻ';
    
    let googleMapsUrl = '#';
    if (lat && lng) {
        googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
        // Cập nhật biến global locationMapUrl để click vào bubble cũng mở map (nếu muốn)
        locationMapUrl = googleMapsUrl; 
    }

    mainContentHTML = `
      <div class="location-card">
        <div class="location-header">
          <div class="loc-icon-circle">
            <i class="fas fa-map-marker-alt"></i>
          </div>
          <div class="loc-info">
            <span class="loc-title">${escapeHtml(address)}</span>
            ${lat && lng ? `<span class="loc-coords">${parseFloat(lat).toFixed(5)}, ${parseFloat(lng).toFixed(5)}</span>` : ''}
          </div>
        </div>
        
        <a href="${googleMapsUrl}" target="_blank" class="location-footer-link" onclick="event.stopPropagation()">
           <span>Xem trên Google Maps</span>
           <i class="fi fi-rr-arrow-right"></i>
        </a>
      </div>
    `;
    }
   else if (detectedType === 'sticker') {
    mainContentHTML = `
      <div class="sticker-message">${getStickerHTML(message.content)}</div>
    `;
  } else {
    // Text bình thường (hoặc JSON parse lỗi)
    const text = escapeHtml(
      typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content || '')
    );
    mainContentHTML = `
      <div class="message-text">${text}</div>
    `;
  }

  // 🔥 BỌC HỘP QUÀ NẾU CÓ gift_style
  if (message.gift_style) {
    mainContentHTML = `
      <div class="gift-wrap gift-style-${message.gift_style}" 
           onclick="window.handleOpenGift(this, '${messageId}', '${currentConversationType}')">
        <div class="gift-lid"></div>
        <div class="gift-content-real">
          ${mainContentHTML}
        </div>
      </div>
    `;
  }

  // ===== 4. REPLY QUOTE (nếu có) =====
  let replyQuoteHTML = '';
  if (message.reply_context) {
    const reply = message.reply_context;
    const replySender = reply.sender_name || 'Unknown';
    let replyText = reply.content || '';

    // parse reply nếu là JSON
    if (replyText && typeof replyText === 'object') {
      const data = replyText;
      if (data.type === 'file') replyText = data.name || 'File';
      else if (data.type === 'image') replyText = data.name || 'Hình ảnh';
      else if (data.type === 'audio') replyText = data.name || 'Tin nhắn thoại';
    } else if (typeof replyText === 'string' && replyText.trim().startsWith('{')) {
      try {
        const data = JSON.parse(replyText);
        if (data.type === 'file') replyText = data.name || 'File';
        else if (data.type === 'image') replyText = data.name || 'Hình ảnh';
        else if (data.type === 'audio') replyText = data.name || 'Tin nhắn thoại';
      } catch (e) {
        // ignore
      }
    }

    replyText = String(replyText).replace(/\r?\n/g, ' ').trim();
    if (replyText.length > 80) replyText = replyText.slice(0, 80) + '...';

    replyQuoteHTML = `
      <div class="message-reply-quote" data-reply-id="${reply.message_id || ''}">
        <span class="reply-sender">${escapeHtml(replySender)}</span>
        <span class="reply-text-short">${escapeHtml(replyText)}</span>
      </div>
    `;
  }

  // ===== 5. META (time + status) =====
  const editedBadgeHTML = message.edited
    ? `<span class="edited-badge">(đã chỉnh sửa)</span>`
    : '';

  const metaHTML = `
    <div class="message-status-container">
      <span class="message-time">${timeLabel}</span>
      ${editedBadgeHTML}
      ${statusText ? `<span class="message-status ${statusClass}">${statusText}</span>` : ''}
    </div>
  `;

  // ===== 6. GOM TẤT CẢ LẠI =====
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

  // Nút Reply
  if (!isDeleted) {
    const replyBtn = messageElement.querySelector('.btn-reply');
    if (replyBtn) {
      replyBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // ⛔ không cho click này mở Google Maps
        const previewText = buildReplyPreviewFromMessage(message);
        enableReplyMode(messageId, previewText, senderName);
      });
    }
  }

  // Nếu là tin nhắn location và có URL, cho bấm cả tin nhắn để mở Google Maps
  if (locationMapUrl) {
    messageElement.style.cursor = 'pointer';

    messageElement.addEventListener('click', (e) => {
      // Đừng mở map nếu người ta bấm vào khu action (reply, menu...)
      if (e.target.closest('.message-actions')) return;
      if (e.target.closest('.message-reply-quote')) return; // click vào quote chỉ để jump tin gốc

      window.open(locationMapUrl, '_blank', 'noopener');
    });
  }

  // Click vào quote để scroll tới tin gốc
  const replyQuoteEl = messageElement.querySelector('.message-reply-quote');
  if (replyQuoteEl) {
    replyQuoteEl.addEventListener('click', (e) => {
      e.stopPropagation(); // tránh mở Google Maps
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



// ====== UTILS ======

function formatFileSize(bytes) {
  if (!bytes) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getStickerHTML(stickerCode) {
  const stickerMap = {
    sticker1: '😀',
    sticker2: '😂',
    sticker3: '😍',
    sticker4: '🤔',
    sticker5: '👍',
    sticker6: '❤️'
  };
  return `<span class="sticker">${stickerMap[stickerCode] || stickerCode}</span>`;
}

function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getUserId() {
  const userAvatar = document.querySelector('.user-avatar');
  return userAvatar ? userAvatar.dataset.userId : null;
}

// Parse JSON trong content, hỗ trợ cả string & object
function parseMessagePayload(message) {
  if (!message || message.content == null) return null;
  const raw = message.content;

  if (typeof raw === 'object') {
    return raw;
  }

  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;

  try {
    return JSON.parse(trimmed);
  } catch (e) {
    console.warn('Không parse được JSON trong content:', raw, e);
    return null;
  }
}

function getEffectiveType(message, payload) {
  // Ưu tiên message.message_type nếu có & không phải text
  if (message.message_type && message.message_type !== 'text') {
    return message.message_type;
  }
  // Fallback: type trong payload JSON
  if (payload && payload.type) {
    return payload.type; // audio | image | file | sticker...
  }
  return 'text';
}

function buildReplyPreviewFromMessage(message) {
  if (!message) return '';
  const payload = parseMessagePayload(message);
  const type = getEffectiveType(message, payload);

  if (type === 'file' || type === 'image') {
    const data = payload || {};
    if (data.type === 'file') return data.name || 'File';
    if (data.type === 'image') return data.name || 'Hình ảnh';
    return type === 'file' ? 'File đính kèm' : 'Hình ảnh';
  }

  // --- SỬA Ở ĐÂY: TRẢ VỀ CHỮ THAY VÌ TÊN FILE ---
  if (type === 'audio') {
    return '🎤 [Tin nhắn thoại]'; 
  }
  // ---------------------------------------------
if (type === 'location') {
    return '📍 [Vị trí đã chia sẻ]';
  }

  if (type === 'sticker') {
    return 'Sticker';
  }

  let text = message.content || '';
  text = String(text).replace(/\r?\n/g, ' ').trim();
  if (text.length > 80) text = text.slice(0, 80) + '...';
  return text;
}

// ====== FORMAT TIME ======

function formatTime(timestamp) {
  if (!timestamp) return '';
  try {
    console.log('[DEBUG] formatTime timestamp:', timestamp);
    // Backend đã gửi giờ VN, frontend dùng moment() bình thường
    const m = moment(timestamp);
    const now = moment();
    console.log('[DEBUG] moment parsed (local):', m.format(), 'now:', now.format());
    console.log('[DEBUG] diff minutes:', now.diff(m, 'minutes'));

    if (!m.isValid()) return 'Vừa xong';

    const diffMinutes = now.diff(m, 'minutes');
    const diffHours = now.diff(m, 'hours');

    if (diffMinutes < 1) return 'Vừa xong';
    if (diffMinutes < 60) return `${diffMinutes} phút trước`;
    if (diffHours < 24) return m.format('HH:mm');

    if (now.clone().subtract(1, 'day').isSame(m, 'day')) {
      return `Hôm qua ${m.format('HH:mm')}`;
    }

    return m.format('DD/MM HH:mm');
  } catch (error) {
    console.error('Error formatting time:', error);
    return 'Vừa xong';
  }
}

// ====== SOCKET LISTENERS CHO TYPING INDICATOR ======

// Private chat: nhận "đang nhập"
socket.on('typing', (data) => {
  if (!data) return;
  if (data.conversation_id !== currentConversationId) return;

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
// --- THÊM VÀO CUỐI FILE chat_input.js ---

window.handleOpenGift = function(element, messageId, conversationType) {
    // Nếu đã mở rồi thì không làm gì (hoặc toggle tùy bạn)
    if (element.classList.contains('is-open')) return;

    // 1. Hiệu ứng mở ngay lập tức (UI)
    element.classList.add('is-open');

    // 2. Gọi API báo server là "Tui mở rồi nha"
    fetch('/mark_gift_opened', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message_id: messageId,
            conversation_type: conversationType
        })
    }).catch(err => console.error("Lỗi lưu trạng thái mở quà:", err));
};

// Các hàm tiện ích có thể cần (ví dụ: gửi tin nhắn, xử lý file... nếu chúng ở đây)
// import { sendMessage } from './socket/chat.js'; 

/**
 * 1. Logic ẩn/hiện Action Menu (+)
 */
export function setupActionMenuToggle() {
    const toggleBtn = document.getElementById('btn-toggle-actions');
    const menu = document.getElementById('action-buttons-menu');

    if (!toggleBtn || !menu) return;

    // Sự kiện click nút Toggle (+)
    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation(); 
        
        // Toggle class 'expanded'
        menu.classList.toggle('expanded');
        
        // Thay đổi icon từ '+' sang 'x' hoặc ngược lại
        const icon = toggleBtn.querySelector('i');
        if (icon) {
            if (menu.classList.contains('expanded')) {
                icon.className = 'fas fa-times'; // X
            } else {
                icon.className = 'fas fa-plus'; // +
            }
        }
    });

    // Ẩn menu khi click ra khỏi khu vực menu
    document.addEventListener('click', (e) => {
        if (menu.classList.contains('expanded') && !menu.contains(e.target) && e.target !== toggleBtn) {
            menu.classList.remove('expanded');
            const icon = toggleBtn.querySelector('i');
            if (icon) icon.className = 'fas fa-plus';
        }
    });
}


/**
 * 2. Logic Kích hoạt/Thoát Chế độ Vẽ Chú thích
 */
function toggleDrawingMode(activate = true) {
    const chatArea = document.querySelector('.chat-area');
    const inputArea = document.querySelector('.message-input');
    const canvas = document.getElementById('chat-drawing-canvas');
    const toolbar = document.getElementById('chat-drawing-toolbar');

    if (activate) {
        // Ẩn Input và các thành phần liên quan
        inputArea.classList.add('hidden');
        document.getElementById('recording-indicator').classList.add('hidden');
        
        // Hiển thị Canvas và Toolbar
        toolbar.classList.remove('hidden');
        chatArea.classList.add('drawing-mode-active'); 
        
        // Đặt kích thước Canvas bằng với khu vực Chat Area
        canvas.width = chatArea.clientWidth;
        // Chiều cao cần trừ đi kích thước của header và input bar (hoặc đặt cố định nếu chat-area là full height)
        canvas.height = chatArea.clientHeight; 

        // Khởi tạo Engine Vẽ (Cần code chi tiết ở đây)
        // window.initDrawingEngine(canvas); 

        console.log("Chế độ Vẽ Chú thích đã được kích hoạt.");
        
        // Đóng menu hành động nếu nó đang mở
        const menu = document.getElementById('action-buttons-menu');
        menu.classList.remove('expanded');
        document.getElementById('btn-toggle-actions').querySelector('i').className = 'fas fa-plus';
        
    } else {
        // Thoát chế độ vẽ
        inputArea.classList.remove('hidden');
        toolbar.classList.add('hidden');
        chatArea.classList.remove('drawing-mode-active');
        
        // Xóa các nét vẽ trên canvas (nếu cần)
        // const ctx = canvas.getContext('2d');
        // ctx.clearRect(0, 0, canvas.width, canvas.height); 
        
        console.log("Chế độ Vẽ Chú thích đã thoát.");
    }
}


/**
 * 3. Thiết lập Event Listeners cho nút Vẽ
 */
export function setupDrawingListeners() {
    const btnDrawToggle = document.getElementById('btn-drawing-tool');
    const btnExitDraw = document.getElementById('chat-btn-exit-draw');
    // const btnSendDraw = document.getElementById('chat-btn-send-draw'); 

    if (btnDrawToggle) {
        btnDrawToggle.addEventListener('click', () => {
            toggleDrawingMode(true);
        });
    }
    
    if (btnExitDraw) {
        btnExitDraw.addEventListener('click', () => {
            toggleDrawingMode(false);
        });
    }
    
    // Logic cho nút Gửi (chat-btn-send-draw) sẽ được code sau
}


// --- 4. Khởi tạo khi DOM đã load ---
document.addEventListener('DOMContentLoaded', () => {
    // Khởi tạo logic Action Menu
    setupActionMenuToggle(); 
    
    // Khởi tạo logic Drawing Mode
    setupDrawingListeners(); 
});