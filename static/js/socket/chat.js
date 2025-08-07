import { socket } from "./index.js";

let currentConversation = null;

// Thiết lập các sự kiện socket liên quan đến chat
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
    if (data.participants.includes(getUserId())) {
      addNewConversationToList(data.conversation_id);
      if (!currentConversation) {
        joinConversation(data.conversation_id);
      }
    }
  });

  socket.on('conversation_ready', (data) => {
    joinConversation(data.conversation_id);
  });
}

export function setupConversationClickEvents() {
  document.querySelectorAll('.conversation-item').forEach(el => {
    el.addEventListener('click', () => {
      const conversationId = el.dataset.id;
      document.getElementById('animation-screen').classList.add('hidden');
      joinConversation(conversationId);
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
  if (currentConversation === conversationId) return;

  if (currentConversation) {
    socket.emit('leave_conversation', { conversation_id: currentConversation });
  }

  currentConversation = conversationId;
  socket.emit('join_conversation', { conversation_id: conversationId });

  document.querySelectorAll('.conversation-item').forEach(el => {
    el.classList.remove('active');
    if (el.dataset.id === conversationId) {
      el.classList.add('active');
    }
  });

  fetch(`/conversation/${conversationId}`)
    .then(res => res.json())
    .then(data => {
      const messagesEl = document.getElementById('messages');
      messagesEl.innerHTML = '';

      if (!data.messages) return;

      data.messages.forEach(msg => addMessageToUI(msg));
      messagesEl.scrollTop = messagesEl.scrollHeight;

      const selectedConversation = document.querySelector(`.conversation-item[data-id="${conversationId}"] .conversation-name`);
      if (selectedConversation) {
        document.querySelector('.chat-header h2').textContent = selectedConversation.textContent;
      }
    })
    .catch(err => console.error('Error loading messages:', err));
}

export function addMessageToUI(msg) {
  const myId = getUserId();
  const isMe = msg.sender_id === myId;
  const messagesEl = document.getElementById('messages');

  const messageEl = document.createElement('div');
  messageEl.classList.add('message', isMe ? 'sent' : 'received');

  const headerEl = document.createElement('div');
  headerEl.classList.add('message-header');

  if (!isMe) {
    const nameEl = document.createElement('strong');
    nameEl.textContent = msg.sender_name || 'Người gửi';
    headerEl.appendChild(nameEl);
  }

  const timeEl = document.createElement('small');
  timeEl.textContent = formatMessageTime(msg.timestamp);
  headerEl.appendChild(timeEl);

  const contentEl = document.createElement('div');
  contentEl.classList.add('message-content');
  contentEl.textContent = msg.content;

  messageEl.appendChild(headerEl);
  messageEl.appendChild(contentEl);
  messagesEl.appendChild(messageEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function formatMessageTime(timestamp) {
  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return 'Vừa xong';
  }
}

// ✅ SỬA HÀM updateConversationList đúng cú pháp và tránh null
export function updateConversationList(conversationId, lastMessage, conversationName = 'Cuộc trò chuyện') {
  let conversationEl = document.querySelector(`.conversation-item[data-id="${conversationId}"]`);

  if (!conversationEl) {
    // Nếu chưa có thì tạo mới
    addNewConversationToList(conversationId);
    return;
  }

  const previewEl = conversationEl.querySelector('.conversation-preview');
  if (previewEl && lastMessage?.content) {
    previewEl.textContent = lastMessage.content.length > 30
      ? lastMessage.content.substring(0, 30) + '...'
      : lastMessage.content;
  }

  const timeEl = conversationEl.querySelector('.conversation-time');
  if (timeEl && lastMessage?.timestamp) {
    timeEl.textContent = formatMessageTime(lastMessage.timestamp);
  }
}

export function addNewConversationToList(conversationId) {
  fetch(`/conversation_info/${conversationId}`)
    .then(res => res.json())
    .then(data => {
      const convEl = document.createElement('div');
      convEl.className = 'conversation-item';
      convEl.dataset.id = conversationId;
      convEl.innerHTML = `
        <div class="conversation-avatar">
          <img src="${data.friend_avatar}" alt="${data.friend_name}">
        </div>
        <div class="conversation-info">
          <div class="conversation-name">${data.friend_name}</div>
          <div class="conversation-preview">${data.last_message || 'Bắt đầu trò chuyện'}</div>
          <div class="conversation-time">${formatMessageTime(data.last_message_time)}</div>
        </div>
      `;
      convEl.addEventListener('click', () => joinConversation(conversationId));
      document.getElementById('conversations').prepend(convEl);
    });
}

export function getUserId() {
  const userAvatar = document.querySelector('.user-avatar');
  return userAvatar ? userAvatar.dataset.userId : null;
}

document.addEventListener('DOMContentLoaded', () => {
  moment.locale('vi');
  document.querySelectorAll('.conversation-time').forEach(el => {
    const isoTime = el.textContent.trim();
    if (isoTime && isoTime.includes('T')) {
      const m = moment(isoTime);
      if (m.isValid()) el.textContent = m.fromNow();
    }
  });
});
