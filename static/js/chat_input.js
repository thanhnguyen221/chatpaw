// static/js/chat_input.js
import { socket } from "./socket/index.js";
import { macPreview } from "./mac-file-preview.js";

// Make macPreview available globally for inline event handlers
window.macPreview = macPreview;

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
      conversation_id: currentConversationId,
      conversation_type: 'group'
    });
  } else {
    socket.emit('typing', {
      conversation_id: currentConversationId,
      conversation_type: 'private'
    });
  }
}

function emitStopTyping() {
  if (!currentConversationId) return;

  if (currentConversationType === 'group') {
    socket.emit('group_stop_typing', {
      group_id: currentConversationId,
      conversation_id: currentConversationId,
      conversation_type: 'group'
    });
  } else {
    socket.emit('stop_typing', {
      conversation_id: currentConversationId,
      conversation_type: 'private'
    });
  }
}

function showTypingIndicator(username, fullName) {
  const indicator = document.getElementById('typing-indicator');
  if (!indicator) return;

  const textEl = indicator.querySelector('.typing-text');
  const displayName = fullName || username;
  if (textEl) {
    textEl.innerText = displayName ? `${displayName} đang nhập...` : 'Đang nhập...';
  }

  indicator.classList.remove('hidden');
}

function hideTypingIndicator() {
  const indicator = document.getElementById('typing-indicator');
  if (!indicator) return;
  indicator.classList.add('hidden');
}

// ====== CÁC HÀM XỬ LÝ REPLY ======

export function enableReplyMode(messageId, content, username, fullName) {
  replyingToId = messageId;
  const preview = document.getElementById('reply-preview');

  if (preview) {
    const replyUserEl = document.getElementById('reply-to-user');
    const replyTextEl = document.getElementById('reply-text-content');
    const replyIdInput = document.getElementById('reply-message-id');

    const displayName = fullName || username;
    if (replyUserEl) replyUserEl.innerText = `Đang trả lời ${displayName}`;
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
  setupMentionLogic();

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

  console.log('[ChatInput] initFileSharing - sendBtn:', sendBtn, 'messageInput:', messageInput);

  if (!sendBtn) {
    console.error('[ChatInput] ERROR: Cannot find #send button!');
  }
  if (!messageInput) {
    console.error('[ChatInput] ERROR: Cannot find #message input!');
  }

  const handleSendText = () => {
    console.log('[ChatInput] handleSendText called - currentConversationId:', currentConversationId, 'type:', currentConversationType);
    if (!messageInput) {
      console.error('[ChatInput] ERROR: messageInput is null!');
      return;
    }
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

      console.log('[ChatInput] Sending message:', msgData);
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
    } else {
      console.log('[ChatInput] Cannot send - content:', content, 'currentConversationId:', currentConversationId);
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
  // --- XỬ LÝ TAG TÊN (@MENTION) ---


// --- TRONG FILE static/js/chat_input.js ---

function setupMentionLogic() {
    const input = document.getElementById('message');
    if (!input) return;

    // Tìm khung cha để neo bảng gợi ý
    const inputContainer = input.closest('.chat-input-area') || input.parentNode;
    if (inputContainer) inputContainer.style.position = 'relative';

    // Tạo bảng gợi ý
    let suggestionBox = document.getElementById('mention-suggestions');
    if (!suggestionBox) {
        suggestionBox = document.createElement('div');
        suggestionBox.id = 'mention-suggestions';
        if (inputContainer) inputContainer.appendChild(suggestionBox);
        else document.body.appendChild(suggestionBox);
    }

    input.addEventListener('keyup', (e) => {
        if (!window.currentGroupMembers) return; // Biến này lấy từ group.js

        const val = input.value;
        const cursorPos = input.selectionStart;
        
        // Lấy từ đang gõ tại con trỏ
        const textBeforeCursor = val.substring(0, cursorPos);
        const words = textBeforeCursor.split(/\s+/);
        const currentWord = words[words.length - 1];

        // Nếu đang gõ @...
        if (currentWord.startsWith('@')) {
            const query = currentWord.substring(1).toLowerCase();
            
            // 1. Lọc user trùng khớp
            let matches = window.currentGroupMembers.filter(user => 
                user.username.toLowerCase().includes(query)
            );

            // 2. Thêm lựa chọn @all vào đầu nếu khớp
            if ('all'.includes(query)) {
                matches.unshift({
                    username: 'all',
                    isAll: true, // Đánh dấu là nút đặc biệt
                    avatar: 'https://cdn-icons-png.flaticon.com/512/992/992700.png' 
                });
            }

            if (matches.length > 0) {
                showSuggestions(matches, input, currentWord, suggestionBox);
            } else {
                suggestionBox.style.display = 'none';
            }
        } else {
            suggestionBox.style.display = 'none';
        }
    });

    // Ẩn khi click ra ngoài
    document.addEventListener('click', (e) => {
        if (suggestionBox && e.target !== suggestionBox && !suggestionBox.contains(e.target)) {
            suggestionBox.style.display = 'none';
        }
    });
}

function showSuggestions(users, input, currentWord, box) {
    box.innerHTML = '';
    box.style.display = 'block';

    users.forEach(user => {
        const item = document.createElement('div');
        item.className = user.isAll ? 'suggestion-item item-all' : 'suggestion-item';
        
        const displayName = user.isAll ? 'Nhắc tất cả mọi người (@all)' : user.username;
        const avatarSrc = user.avatar || '/static/img/default-avatar.png';

        item.innerHTML = `
            <img src="${avatarSrc}">
            <span>${displayName}</span>
        `;

        item.onclick = () => {
            const val = input.value;
            const cursorPos = input.selectionStart;
            const textBefore = val.substring(0, cursorPos - currentWord.length);
            const textAfter = val.substring(cursorPos);
            
            // Chèn tên: nếu là @all thì chèn "all", nếu user thì chèn username
            const insertName = user.isAll ? 'all' : user.username;
            
            input.value = textBefore + '@' + insertName + ' ' + textAfter;
            box.style.display = 'none';
            input.focus();
        };
        box.appendChild(item);
    });
}

// GỌI HÀM NÀY KHI KHỞI TẠO
setupMentionLogic();

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



  // Sticker mapping: code -> emoji (fallback)
  const stickerMap = {
    'sticker1': '😀',
    'sticker2': '😂',
    'sticker3': '😍',
    'sticker4': '🤔',
    'sticker5': '👍',
    'sticker6': '❤️',
    'sticker7': '🎉',
    'sticker8': '😎',
    'sticker9': '🥰',
    'sticker10': '😭',
    'sticker11': '🔥',
    'sticker12': '💯'
  };

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
      // Get emoji from data-emoji attribute or fallback to mapping
      const emoji = sticker.getAttribute('data-emoji') || stickerMap[sticker.getAttribute('data-sticker')];
      if (emoji) {
        sendSticker(emoji);
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

  // --- [THÊM VÀO CUỐI HÀM initFileSharing TRONG chat_input.js] ---

  // 1. XỬ LÝ LOGIC TẠO POLL (BÌNH CHỌN)
  const btnPoll = document.getElementById('btn-create-poll'); // Nút mở modal
  const pollModal = document.getElementById('poll-modal');    // Modal
  const btnAddOption = document.getElementById('btn-add-poll-option'); // Nút thêm dòng
  const btnSubmitPoll = document.getElementById('btn-submit-poll');    // Nút tạo
  const pollOptionsList = document.getElementById('poll-options-list');
  const closePollBtn = document.querySelector('.close-poll-modal');

  if (btnPoll && pollModal) {
    // Mở modal
    btnPoll.addEventListener('click', (e) => {
      e.stopPropagation();
      pollModal.style.display = 'flex';
      // Reset form mỗi khi mở
      document.getElementById('poll-question').value = '';
      pollOptionsList.innerHTML = `
          <input type="text" class="poll-option-input" placeholder="Lựa chọn 1">
          <input type="text" class="poll-option-input" placeholder="Lựa chọn 2">
      `;
      document.getElementById('poll-question').focus();
    });

    // Đóng modal
    if (closePollBtn) {
      closePollBtn.addEventListener('click', () => {
        pollModal.style.display = 'none';
      });
    }

    // Thêm dòng lựa chọn mới
    if (btnAddOption) {
      btnAddOption.addEventListener('click', () => {
        if (pollOptionsList.children.length >= 10) {
          alert("Tối đa 10 lựa chọn thôi!");
          return;
        }
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'poll-option-input';
        input.placeholder = `Lựa chọn ${pollOptionsList.children.length + 1}`;
        pollOptionsList.appendChild(input);
        input.focus();
      });
    }

    // Gửi bình chọn (Submit)
    if (btnSubmitPoll) {
      btnSubmitPoll.addEventListener('click', () => {
        const question = document.getElementById('poll-question').value.trim();
        // Lấy các ô input, bỏ dòng trống
        const options = Array.from(document.querySelectorAll('.poll-option-input'))
                             .map(inp => inp.value.trim())
                             .filter(val => val !== "");

        // Validate
        if (!question) {
          alert("Vui lòng nhập câu hỏi!");
          return;
        }
        if (options.length < 2) {
          alert("Cần ít nhất 2 lựa chọn!");
          return;
        }
        
        // Lấy groupId (được lưu từ group.js vào window)
        const groupId = window.currentGroupId; 
        if (!groupId) {
            alert("Chỉ tạo được bình chọn trong nhóm!");
            return;
        }

        // Tạo cấu trúc dữ liệu Poll chuẩn
        const pollPayload = {
            question: question,
            options: options.map((txt, idx) => ({ 
                id: idx, 
                text: txt, 
                voters: [] // Danh sách người đã vote
            }))
        };

        // Gửi qua socket (Dùng chung event send_group_message)
        socket.emit('send_group_message', {
            group_id: groupId,
            content: JSON.stringify(pollPayload), // Chuyển object thành chuỗi
            message_type: 'poll' // Đánh dấu là loại tin nhắn 'poll'
        });

        // Đóng modal
        pollModal.style.display = 'none';
      });
    }
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
          type: result.is_archive ? 'archive' : 'file',
          name: file.name,
          size: file.size,
          url: result.file_url,
          archive_data: result.is_archive ? result.archive_data : null
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

  console.log('[DEBUG] Uploading image:', file.name, 'Size:', file.size);

  const formData = new FormData();
  formData.append('image', file);
  formData.append('conversation_id', currentConversationId);
  formData.append('conversation_type', currentConversationType);

  try {
    console.log('[DEBUG] Sending image upload request to /upload_image');
    
    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout for ngrok
    
    const response = await fetch('/upload_image', {
      method: 'POST',
      body: formData,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    console.log('[DEBUG] Image upload response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[DEBUG] Upload error response:', errorText);
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    const result = await response.json();
    console.log('[DEBUG] Image upload result:', result);

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
      console.error('[DEBUG] Image upload failed:', result.error);
      alert('Upload hình ảnh thất bại: ' + (result.error || 'Unknown error'));
    }
  } catch (err) {
    console.error('[DEBUG] Upload image error:', err);
    if (err.name === 'AbortError') {
      alert('Upload timeout - file quá lớn hoặc kết nối chậm');
    } else if (err.message.includes('Failed to fetch')) {
      alert('Không thể kết nối đến server. Kiểm tra ngrok hoặc mạng.');
    } else {
      alert('Có lỗi khi upload hình ảnh: ' + err.message);
    }
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
  
  // Kiểm tra HTTPS
  const isHttps = location.protocol === 'https:' || location.hostname === 'localhost';
  if (!isHttps) {
    alert('⚠️ Chia sẻ vị trí yêu cầu HTTPS.\n\nVui lòng:\n• Truy cập qua https:// hoặc localhost\n• Hoặc nhập vị trí thủ công');
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

  if (detectedType === 'file' || detectedType === 'archive') {
    const fileInfo = payload || {};
    const fileUrl = fileInfo.url || '#';
    const fileName = fileInfo.name || 'File';
    const fileSize = fileInfo.size || 0;
    const isArchive = detectedType === 'archive' || fileName.match(/\.(zip|rar|7z|tar|gz)$/i);
    const archiveData = fileInfo.archive_data || null;
    
    // Use macOS-style file attachment with inline preview
    mainContentHTML = `
      <div class="mac-file-attachment" 
           data-file-url="${escapeHtml(fileUrl)}" 
           data-file-name="${escapeHtml(fileName)}" 
           data-file-size="${fileSize}"
           data-is-archive="${isArchive}"
           data-archive-data='${archiveData ? escapeHtml(JSON.stringify(archiveData)) : ''}'>
        <div class="mac-file-icon ${macPreview.getFileIconClass(fileName)}">
          <i class="fas ${macPreview.getFileIcon(fileName)}"></i>
        </div>
        <div class="mac-file-info">
          <div class="mac-file-name">${escapeHtml(fileName)}</div>
          <div class="mac-file-meta">
            ${formatFileSize(fileSize)}${isArchive ? ' <span class="archive-badge"><i class="fas fa-folder-tree"></i> Project</span>' : ''}
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
      <div class="mac-file-inline-preview" id="preview-${messageId}" style="display: none;">
        <div class="mac-file-inline-content"></div>
      </div>
    `;
  } else if (detectedType === 'image') {
    const imageInfo = payload || {};
    const imageName = imageInfo.name || 'Hình ảnh';
    const fullUrl = imageInfo.url || '';
    mainContentHTML = `
      <div class="image-message">
        ${fullUrl
            ? `<img src="${fullUrl}" class="uploaded-image" alt="${escapeHtml(imageName)}" onclick="window.openImageModal && window.openImageModal('${fullUrl}')">`
            : ''
        }
        ${fullUrl ? `
          <div class="image-actions">
            <a href="${fullUrl}" target="_blank" class="view-original">Xem ảnh gốc</a>
          </div>
        ` : ''}
      </div>
    `;
  } else if (detectedType === 'audio') {
    const audioInfo = payload || {};
    const audioUrl = audioInfo.url || '';
    const audioName = audioInfo.name || 'Tin nhắn thoại';
    mainContentHTML = `
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

function loadInlinePreview(container, fileUrl, fileName) {
    const contentEl = container.querySelector('.mac-file-inline-content');
    if (!contentEl) return;
    
    const ext = fileName.split('.').pop().toLowerCase();
    
    // Show loading
    contentEl.innerHTML = '<div class="mac-preview-loading"><div class="mac-preview-spinner"></div></div>';
    
    switch (true) {
        // PDF
        case ext === 'pdf':
            const pdfUrl = fileUrl.startsWith('http') ? fileUrl : window.location.origin + fileUrl;
            contentEl.innerHTML = `<iframe src="${pdfUrl}#toolbar=1" style="width: 100%; height: 400px; border: none;"></iframe>`;
            break;
            
        // Images
        case ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext):
            contentEl.innerHTML = `<img src="${fileUrl}" style="max-width: 100%; max-height: 300px; border-radius: 8px; display: block; margin: 0 auto;">`;
            break;
            
        // Videos
        case ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext):
            contentEl.innerHTML = `
                <video controls style="width: 100%; max-height: 300px; border-radius: 8px;">
                    <source src="${fileUrl}" type="video/${ext === 'mov' ? 'quicktime' : ext}">
                </video>`;
            break;
            
        // Audio
        case ['mp3', 'wav', 'ogg', 'm4a'].includes(ext):
            contentEl.innerHTML = `
                <audio controls style="width: 100%;">
                    <source src="${fileUrl}" type="audio/${ext === 'mp3' ? 'mpeg' : ext}">
                </audio>`;
            break;
            
        // Text files
        case ['txt', 'md', 'js', 'py', 'html', 'css', 'json', 'xml'].includes(ext):
            fetch(fileUrl)
                .then(r => r.text())
                .then(text => {
                    const limitedText = text.length > 3000 ? text.substring(0, 3000) + '\n\n[...]' : text;
                    contentEl.innerHTML = `<pre class="mac-file-inline-text">${escapeHtml(limitedText)}</pre>`;
                })
                .catch(() => {
                    contentEl.innerHTML = '<div class="mac-preview-error">Không thể đọc file</div>';
                });
            break;
            
        // Office documents
        case ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext):
            const viewerUrl = `https://docs.google.com/gview?embedded=1&url=${encodeURIComponent(fileUrl)}`;
            contentEl.innerHTML = `<iframe src="${viewerUrl}" style="width: 100%; height: 400px; border: none;"></iframe>`;
            break;
            
        // Default
        default:
            contentEl.innerHTML = `
                <div style="text-align: center; padding: 20px;">
                    <i class="fas fa-file" style="font-size: 48px; color: #86868b; margin-bottom: 12px;"></i>
                    <div style="color: #1d1d1f; font-weight: 500;">${fileName}</div>
                    <div style="color: #86868b; font-size: 13px; margin-top: 8px;">Không hỗ trợ xem trước trực tiếp</div>
                </div>`;
    }
}

function formatFileSize(bytes) {
  if (!bytes) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getStickerHTML(stickerContent) {
  // Mapping emoji to animation classes (like Zalo)
  const animationMap = {
    '😀': 'bounce',
    '😂': 'shake',
    '😍': 'heartbeat',
    '🤔': 'wobble',
    '👍': 'tada',
    '❤️': 'pulse',
    '🎉': 'party',
    '😎': 'swing',
    '🥰': 'pulse',
    '😭': 'shake',
    '🔥': 'flame',
    '💯': 'bounce'
  };

  const animationClass = animationMap[stickerContent] || 'bounce';
  
  // Return animated emoji HTML
  return `<span class="sticker-emoji ${animationClass}">${stickerContent}</span>`;
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
    console.log('[DEBUG] formatTime timestamp:', timestamp, 'type:', typeof timestamp);
    // Backend đã gửi giờ VN, moment đang có default timezone Asia/Ho_Chi_Minh
    // Cần parse as local time để không bị áp timezone lại
    const m = moment(timestamp, moment.ISO_8601, true);
    const now = moment();
    console.log('[DEBUG] moment parsed (local):', m.format(), 'now:', now.format());
    console.log('[DEBUG] parsed hour:', m.hour(), 'now hour:', now.hour());
    console.log('[DEBUG] diff minutes:', now.diff(m, 'minutes'));

    if (!m.isValid()) return 'Vừa xong';

    const diffMinutes = now.diff(m, 'minutes');
    const diffHours = now.diff(m, 'hours');

    // Luôn hiển thị giờ cho tin nhắn trong nhóm
    if (diffMinutes < 1) return m.format('HH:mm');
    if (diffMinutes < 60) return m.format('HH:mm');
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

// Export để các file khác có thể dùng
window.formatTime = formatTime;

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
let drawingContext = null;
let isDrawing = false;
let currentColor = '#000000';
let currentLineWidth = 3;

function toggleDrawingMode(activate = true) {
    const chatArea = document.querySelector('.chat-area');
    const inputArea = document.querySelector('.message-input');
    const canvas = document.getElementById('chat-drawing-canvas');
    const toolbar = document.getElementById('chat-drawing-toolbar');

    if (!canvas || !toolbar) {
        console.error('[Drawing] Canvas hoặc toolbar không tồn tại');
        alert('Lỗi: Không tìm thấy canvas vẽ');
        return;
    }

    if (activate) {
        // Ẩn Input và các thành phần liên quan
        inputArea.classList.add('hidden');
        const recIndicator = document.getElementById('recording-indicator');
        if (recIndicator) recIndicator.classList.add('hidden');
        
        // Hiển thị Canvas và Toolbar
        toolbar.classList.remove('hidden');
        canvas.classList.remove('hidden');
        chatArea.classList.add('drawing-mode-active'); 
        
        // Đặt kích thước Canvas
        const messagesContainer = document.getElementById('messages');
        canvas.width = chatArea.clientWidth;
        canvas.height = messagesContainer ? messagesContainer.clientHeight : chatArea.clientHeight - 100;

        // Khởi tạo context vẽ
        drawingContext = canvas.getContext('2d');
        drawingContext.lineCap = 'round';
        drawingContext.lineJoin = 'round';
        drawingContext.strokeStyle = currentColor;
        drawingContext.lineWidth = currentLineWidth;

        // Khởi tạo sự kiện vẽ
        initDrawingEvents(canvas);

        console.log("[Drawing] Chế độ vẽ đã kích hoạt");
        
        // Đóng menu hành động
        const menu = document.getElementById('action-buttons-menu');
        if (menu) menu.classList.remove('expanded');
        const toggleBtn = document.getElementById('btn-toggle-actions');
        if (toggleBtn) {
            const icon = toggleBtn.querySelector('i');
            if (icon) icon.className = 'fas fa-plus';
        }
        
    } else {
        // Thoát chế độ vẽ
        inputArea.classList.remove('hidden');
        toolbar.classList.add('hidden');
        canvas.classList.add('hidden');
        chatArea.classList.remove('drawing-mode-active');
        
        // Xóa canvas
        if (drawingContext) {
            drawingContext.clearRect(0, 0, canvas.width, canvas.height);
        }
        
        // Hủy sự kiện vẽ
        removeDrawingEvents(canvas);
        
        console.log("[Drawing] Chế độ vẽ đã thoát");
    }
}

// Khởi tạo sự kiện vẽ
function initDrawingEvents(canvas) {
    // Mouse events
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);
    
    // Touch events cho mobile
    canvas.addEventListener('touchstart', handleTouch);
    canvas.addEventListener('touchmove', handleTouchMove);
    canvas.addEventListener('touchend', stopDrawing);
}

function removeDrawingEvents(canvas) {
    canvas.removeEventListener('mousedown', startDrawing);
    canvas.removeEventListener('mousemove', draw);
    canvas.removeEventListener('mouseup', stopDrawing);
    canvas.removeEventListener('mouseout', stopDrawing);
    canvas.removeEventListener('touchstart', handleTouch);
    canvas.removeEventListener('touchmove', handleTouchMove);
    canvas.removeEventListener('touchend', stopDrawing);
}

function startDrawing(e) {
    isDrawing = true;
    const canvas = document.getElementById('chat-drawing-canvas');
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    drawingContext.beginPath();
    drawingContext.moveTo(x, y);
}

function draw(e) {
    if (!isDrawing) return;
    
    const canvas = document.getElementById('chat-drawing-canvas');
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    drawingContext.lineTo(x, y);
    drawingContext.stroke();
}

function stopDrawing() {
    if (isDrawing) {
        isDrawing = false;
        drawingContext.beginPath();
    }
}

function handleTouch(e) {
    e.preventDefault();
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent('mousedown', {
        clientX: touch.clientX,
        clientY: touch.clientY
    });
    startDrawing(mouseEvent);
}

function handleTouchMove(e) {
    e.preventDefault();
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent('mousemove', {
        clientX: touch.clientX,
        clientY: touch.clientY
    });
    draw(mouseEvent);
}

// Thay đổi màu vẽ
function setDrawingColor(color) {
    currentColor = color;
    if (drawingContext) {
        drawingContext.strokeStyle = color;
    }
}

// Thay đổi độ dày nét vẽ
function setLineWidth(width) {
    currentLineWidth = width;
    if (drawingContext) {
        drawingContext.lineWidth = width;
    }
}

// Xóa canvas
function clearCanvas() {
    const canvas = document.getElementById('chat-drawing-canvas');
    if (canvas && drawingContext) {
        drawingContext.clearRect(0, 0, canvas.width, canvas.height);
    }
}

// Gửi ảnh vẽ
async function sendDrawing() {
    const canvas = document.getElementById('chat-drawing-canvas');
    if (!canvas) return;
    
    if (!currentConversationId) {
        alert('Vui lòng chọn một cuộc trò chuyện trước');
        return;
    }
    
    try {
        // Chuyển canvas thành blob
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const file = new File([blob], `drawing-${Date.now()}.png`, { type: 'image/png' });
        
        // Upload như ảnh bình thường
        const formData = new FormData();
        formData.append('image', file);
        formData.append('conversation_id', currentConversationId);
        formData.append('conversation_type', currentConversationType);
        
        const response = await fetch('/upload_image', {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (result.success) {
            const eventName = currentConversationType === 'group' ? 'send_group_message' : 'send_message';
            
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
            
            // Thoát chế độ vẽ
            toggleDrawingMode(false);
        } else {
            alert('Upload ảnh vẽ thất bại: ' + (result.error || 'Unknown error'));
        }
    } catch (err) {
        console.error('Send drawing error:', err);
        alert('Có lỗi khi gửi ảnh vẽ');
    }
}


/**
 * 3. Thiết lập Event Listeners cho nút Vẽ
 */
export function setupDrawingListeners() {
    const btnDrawToggle = document.getElementById('btn-drawing-tool');
    const btnExitDraw = document.getElementById('chat-btn-exit-draw');
    const btnSendDraw = document.getElementById('chat-btn-send-draw');
    const btnClearDraw = document.getElementById('chat-btn-clear-draw');
    const colorPicker = document.getElementById('chat-draw-color');
    const widthSlider = document.getElementById('chat-draw-width');

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
    
    // Nút gửi ảnh vẽ
    if (btnSendDraw) {
        btnSendDraw.addEventListener('click', () => {
            sendDrawing();
        });
    }
    
    // Nút xóa canvas
    if (btnClearDraw) {
        btnClearDraw.addEventListener('click', () => {
            clearCanvas();
        });
    }
    
    // Chọn màu
    if (colorPicker) {
        colorPicker.addEventListener('change', (e) => {
            setDrawingColor(e.target.value);
        });
    }
    
    // Chọn độ dày nét vẽ
    if (widthSlider) {
        widthSlider.addEventListener('input', (e) => {
            setLineWidth(parseInt(e.target.value));
        });
    }
}


// --- 4. Khởi tạo khi DOM đã load ---
document.addEventListener('DOMContentLoaded', () => {
    // Khởi tạo logic Action Menu
    setupActionMenuToggle(); 
    
    // Khởi tạo logic Drawing Mode
    setupDrawingListeners();
    
    // Event delegation for file attachment clicks
    const messagesContainer = document.getElementById('messages');
    if (messagesContainer) {
        messagesContainer.addEventListener('click', (e) => {
            // Handle preview button click - open Mac-style preview
            const previewBtn = e.target.closest('.mac-file-preview-btn');
            if (previewBtn) {
                e.preventDefault();
                e.stopPropagation();
                const fileAttachment = previewBtn.closest('.mac-file-attachment');
                if (!fileAttachment) return;
                
                const fileUrl = fileAttachment.getAttribute('data-file-url');
                const fileName = fileAttachment.getAttribute('data-file-name');
                const fileSize = parseInt(fileAttachment.getAttribute('data-file-size')) || 0;
                const isArchive = fileAttachment.getAttribute('data-is-archive') === 'true';
                const archiveDataStr = fileAttachment.getAttribute('data-archive-data');
                let archiveData = null;
                if (archiveDataStr && isArchive) {
                    try {
                        archiveData = JSON.parse(archiveDataStr);
                    } catch (e) {
                        console.error('Failed to parse archive data:', e);
                    }
                }
                
                // Open Mac-style preview
                if (window.macPreview) {
                    window.macPreview.currentFile = { 
                        url: fileUrl, 
                        name: fileName, 
                        size: fileSize,
                        archiveData: archiveData,
                        isArchive: isArchive
                    };
                    window.macPreview.open(fileUrl, fileName, fileSize);
                }
                return;
            }
            
            // Handle open button click - open in new tab
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
            
            // Handle download button click
            const downloadBtn = e.target.closest('.mac-file-download-btn');
            if (downloadBtn) {
                e.preventDefault();
                e.stopPropagation();
                const fileAttachment = downloadBtn.closest('.mac-file-attachment');
                if (!fileAttachment) return;
                
                const fileUrl = fileAttachment.getAttribute('data-file-url');
                const fileName = fileAttachment.getAttribute('data-file-name');
                
                // Trigger download
                const link = document.createElement('a');
                link.href = fileUrl;
                link.download = fileName;
                link.target = '_blank';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                return;
            }
            
            // Handle clicking on the attachment itself - open Mac-style preview
            const fileAttachment = e.target.closest('.mac-file-attachment');
            if (fileAttachment && !e.target.closest('.mac-file-actions')) {
                e.preventDefault();
                e.stopPropagation();
                
                const fileUrl = fileAttachment.getAttribute('data-file-url');
                const fileName = fileAttachment.getAttribute('data-file-name');
                const fileSize = parseInt(fileAttachment.getAttribute('data-file-size')) || 0;
                
                // Open Mac-style preview
                if (window.macPreview) {
                    const isArchive = fileAttachment.getAttribute('data-is-archive') === 'true';
                    const archiveDataStr = fileAttachment.getAttribute('data-archive-data');
                    let archiveData = null;
                    if (archiveDataStr && isArchive) {
                        try {
                            archiveData = JSON.parse(archiveDataStr);
                        } catch (e) {
                            console.error('Failed to parse archive data:', e);
                        }
                    }
                    window.macPreview.currentFile = { 
                        url: fileUrl, 
                        name: fileName, 
                        size: fileSize,
                        archiveData: archiveData,
                        isArchive: isArchive
                    };
                    window.macPreview.open(fileUrl, fileName, fileSize);
                }
            }
        });
    }
});