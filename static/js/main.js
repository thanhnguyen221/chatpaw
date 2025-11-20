// static/js/main.js
import { socket } from './socket/index.js';

import {
  setupChatEvents,
  setupConversationClickEvents,
  setupSendMessage,
  setupMessageStatus,
  setupMessageContextMenu 
} from './socket/chat.js';

// Bạn bè
import {
  setupFriendEvents,
  setupContactClickEvents,
  setupSearchInput,
  fetchFriendRequests,
  fetchFriends
} from './socket/friends.js';

// Người dùng
import './socket/user.js';

// Chat nhóm
import {
  setupCreateGroupHandler,
  setupGroupMessageSending,
  setupGroupSocketEvents,
  openGroupChat,
  addGroupToList,
  setupGroupClickEvents 
} from './socket/group.js';

// QUAN TRỌNG: Import từ chat_input.js
import { initFileSharing, setCurrentConversation as setFileConversation } from './chat_input.js';

// --- LƯU Ý: ĐÃ XÓA IMPORT CALL.JS CŨ ĐỂ TRÁNH LỖI ---

// ====== DOM đã sẵn sàng ======
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Main] DOM loaded');

  initializeTimeUtils();
  
  // Khởi tạo các module
  setupChatEvents();
  initFileSharing();
  setupFriendEvents();
  setupContactClickEvents();
  
  // Gắn callback khi mở hội thoại
  setupConversationClickEvents(onOpenConversation);
  
  setupSendMessage();
  setupSearchInput();
  fetchFriendRequests();
  setupCreateGroupHandler();
  setupGroupMessageSending();
  setupGroupSocketEvents();
  setupMessageStatus(); 
  setupMessageActions();
  
  // Setup sự kiện click nhóm
  setupGroupClickEvents();

  setupTabSwitching();
  
  // ĐÃ XÓA: bindCallUI(); (Không dùng nữa)

  if (typeof setupMessageContextMenu === 'function') {
    console.log('[Main] Setting up message context menu...');
    setupMessageContextMenu();
  } else {
    console.error('[Main] setupMessageContextMenu function not found!');
  }

  // Socket Events cơ bản
  socket.on('connect', () => {
    console.log('✅ Connected to server, setting user online');
    socket.emit('user_online');
  });

  window.addEventListener('beforeunload', () => {
    socket.emit('user_offline');
  });

  socket.on('friend_online_status', (data) => {
    console.log('[Online Status] Friend status changed:', data);
    updateFriendOnlineStatus(data.user_id, data.is_online);
  });

  socket.on('online_status_update', (onlineStatus) => {
    updateAllFriendsOnlineStatus(onlineStatus);
  });

  socket.emit('get_online_status');
});


// ====== CÁC HÀM TIỆN ÍCH & LOGIC CHUYỂN TAB ======

function formatConversationTime(timestamp) {
  if (!timestamp) return '';
  try {
    const messageDate = new Date(timestamp);
    const now = new Date();
    if (isNaN(messageDate.getTime())) return 'Vừa xong';

    const diffMs = now - messageDate;
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMinutes < 1) return 'Vừa xong';
    if (diffMinutes < 60) return `${diffMinutes}p`;
    if (diffHours < 24) return `${diffHours}g`;
    if (diffDays === 1) return 'Hôm qua';
    if (messageDate.getFullYear() === now.getFullYear()) {
      return `${messageDate.getDate().toString().padStart(2,'0')}/${(messageDate.getMonth()+1).toString().padStart(2,'0')}`;
    } else {
      return `${messageDate.getDate()}/${messageDate.getMonth()+1}/${messageDate.getFullYear().toString().slice(-2)}`;
    }
  } catch (error) { return 'Vừa xong'; }
}

function initializeTimeUtils() {
  document.querySelectorAll('.conversation-time').forEach(el => {
    const isoTime = el.dataset.time;
    if (isoTime) el.textContent = formatConversationTime(isoTime);
  });
}

let groupsLoading = false;
async function loadUserGroups() {
  if (groupsLoading) return;
  try {
    groupsLoading = true;
    const response = await fetch('/user_groups');
    const data = await response.json();
    const groupsList = document.getElementById('groups-list');
    
    if (!groupsList) return;
    groupsList.innerHTML = '';

    data.groups.forEach(group => {
      addGroupToList(group._id, group.name, group.avatar);
    });
  } catch (err) {
    console.error('Lỗi tải danh sách nhóm:', err);
  } finally {
    groupsLoading = false;
  }
}

// Gắn openGroupChat vào global
window.openGroupChat = (groupId, groupName) => {
  openGroupChat(groupId, groupName);
  onOpenConversation(groupId, 'group');
};

function setupTabSwitching() {
  let currentTab = 'conversations';
  
  document.querySelectorAll('.mini-sidebar button').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (currentTab === tab) return;
      currentTab = tab;

      document.querySelectorAll('.tab-section').forEach(sec => sec.classList.remove('active'));
      const selected = document.getElementById('tab-' + tab);
      if (selected) selected.classList.add('active');

      if (tab === 'contacts') fetchFriends();
      else if (tab === 'requests') fetchFriendRequests();
      else if (tab === 'groups') loadUserGroups();
    });
  });
}

/**
 * Callback được gọi khi mở 1 hội thoại.
 */
function onOpenConversation(conversationId, conversationType = 'private') {
  console.log(`[Main] Opening conversation: ${conversationId}, type: ${conversationType}`);
  
  // QUAN TRỌNG: Set conversation cho module file sharing
  setFileConversation(conversationId, conversationType);

  // ĐÃ XÓA: setCallConversation(conversationId); (Không cần nữa)
  // ĐÃ XÓA: toggleCallButtons(...) (Không cần nữa)
}

// ===== Sticker panel toggle =====
const showStickersBtn = document.getElementById("show-stickers");
const stickerPanel = document.getElementById("sticker-panel");
const closeStickersBtn = document.getElementById("close-stickers");

if(showStickersBtn) showStickersBtn.addEventListener("click", () => stickerPanel.style.display = "block");
if(closeStickersBtn) closeStickersBtn.addEventListener("click", () => stickerPanel.style.display = "none");

document.addEventListener("click", (e) => {
  if (stickerPanel && !stickerPanel.contains(e.target) && e.target !== showStickersBtn) {
    stickerPanel.style.display = "none";
  }
});

function updateFriendOnlineStatus(friendId, isOnline) {
  const friendElement = document.querySelector(`[data-user-id="${friendId}"]`);
  if (friendElement) {
    const onlineIndicator = friendElement.querySelector('.online-indicator'); // Hoặc .contact-status
    // Tùy vào HTML của bạn, nếu dùng span class="online-dot"
    const statusDiv = friendElement.querySelector('.contact-status');
    if(statusDiv) statusDiv.innerHTML = isOnline ? '<span class="online-dot"></span>' : '';
  }
  
  // Cập nhật trong danh sách hội thoại
  // Lưu ý: Cần đảm bảo item hội thoại có data-friend-id hoặc logic tương tự
}

function updateAllFriendsOnlineStatus(onlineStatus) {
  Object.keys(onlineStatus).forEach(friendId => {
    updateFriendOnlineStatus(friendId, onlineStatus[friendId].online);
  });
}

function setupMessageActions() {
  console.log('Message actions initialized');
}

// Export globals
window.pinMessage = window.pinMessage || function(){};
window.unpinMessage = window.unpinMessage || function(){};
window.editMessage = window.editMessage || function(){};
window.deleteMessage = window.deleteMessage || function(){};
window.startEditMessage = window.startEditMessage || function(){};