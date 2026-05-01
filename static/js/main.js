// static/js/main.js
import { socket } from './socket/index.js';

import {
  setupChatEvents,
  setupConversationClickEvents,
  setupSendMessage,
  setupMessageStatus,
  setupMessageContextMenu,
  setupConversationContextMenu
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
  setupGroupClickEvents,
  setupGroupSidebarContextMenu
} from './socket/group.js';

// QUAN TRỌNG: Import từ chat_input.js
import { initFileSharing, setCurrentConversation as setFileConversation } from './chat_input.js';

// --- LƯU Ý: ĐÃ XÓA IMPORT CALL.JS CŨ ĐỂ TRÁNH LỖI ---

// ====== DOM đã sẵn sàng ======
// ====== DOM đã sẵn sàng ======
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Main] DOM loaded');
  try {
    initializeTimeUtils();
    console.log('[Main] initializeTimeUtils OK');

    setupChatEvents();
    console.log('[Main] setupChatEvents OK');

    initFileSharing();
    console.log('[Main] initFileSharing OK');

    setupFriendEvents();
    console.log('[Main] setupFriendEvents OK');

    setupContactClickEvents();
    console.log('[Main] setupContactClickEvents OK');
    
    setupConversationClickEvents(onOpenConversation);
    console.log('[Main] setupConversationClickEvents OK');
    
    setupSendMessage();
    console.log('[Main] setupSendMessage OK');

    setupSearchInput();
    console.log('[Main] setupSearchInput OK');

    fetchFriendRequests();
    console.log('[Main] fetchFriendRequests OK');

    setupCreateGroupHandler();
    console.log('[Main] setupCreateGroupHandler OK');

    setupGroupMessageSending();
    console.log('[Main] setupGroupMessageSending OK');

    setupGroupSocketEvents();
    console.log('[Main] setupGroupSocketEvents OK');

    setupMessageStatus(); 
    console.log('[Main] setupMessageStatus OK');

    setupMessageActions();
    console.log('[Main] setupMessageActions OK');
    
    // Gắn context menu chuột phải cho tin nhắn
    setupMessageContextMenu();
    console.log('[Main] setupMessageContextMenu OK');
    
    // 13/12/2025 - Gắn context menu chuột phải cho từng hội thoại 1v1 trong sidebar
    setupConversationContextMenu();
    console.log('[Main] setupConversationContextMenu OK');
    // 13/12/2025 - Gắn context menu chuột phải cho item nhóm trong sidebar
    setupGroupSidebarContextMenu();
    console.log('[Main] setupGroupSidebarContextMenu OK');

    setupGroupClickEvents();
    console.log('[Main] setupGroupClickEvents OK');

    setupTabSwitching();
    console.log('[Main] setupTabSwitching OK');

    // 🔥 [MỚI] TỰ ĐỘNG JOIN PHÒNG CÁ NHÂN (Để nhận cuộc gọi 1v1 bất cứ lúc nào)
    socket.on('connect', () => {
        console.log('✅ [Main] Socket connected');
        
        // Lấy ID của chính mình từ giao diện (Avatar góc trái)
        const userAvatar = document.querySelector('.user-avatar');
        const myId = userAvatar ? userAvatar.dataset.userId : null;

        if (myId) {
            console.log('🔗 Joining private user room:', myId);
            socket.emit('join_user_room', { user_id: myId });
        }
    });
  } catch (e) {
    console.error('[Main] Initialization failed:', e);
  }
});



// ====== CÁC HÀM TIỆN ÍCH & LOGIC CHUYỂN TAB ======

function formatConversationTime(timestamp) {
  if (!timestamp) return '';
  try {
    const m = moment(timestamp).tz('Asia/Ho_Chi_Minh');
    const now = moment().tz('Asia/Ho_Chi_Minh');

    if (!m.isValid()) return 'Vừa xong';

    const diffMinutes = now.diff(m, 'minutes');
    const diffHours   = now.diff(m, 'hours');
    const diffDays    = now.diff(m, 'days');

    if (diffMinutes < 1) return 'Vừa xong';
    if (diffMinutes < 60) return `${diffMinutes}p`;
    if (diffHours   < 24) return `${diffHours}g`;
    if (diffDays === 1)   return 'Hôm qua';

    if (now.isSame(m, 'year')) {
      return m.format('DD/MM');
    }
    return m.format('DD/MM/YY');
  } catch (error) {
    console.error('Error formatConversationTime:', error);
    return 'Vừa xong';
  }
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
    console.log('[DEBUG] loadUserGroups data:', data);
    const groupsList = document.getElementById('groups-list');
    
    if (!groupsList) return;
    groupsList.innerHTML = '';

    if (!data.groups) {
      console.error('[DEBUG] No data.groups in response');
      return;
    }
    data.groups.forEach(group => {
      addGroupToList(
        group._id,
        group.name,
        group.avatar,
        group.last_message,
        group.last_sender_id,
        group.last_sender_name,
        typeof group.unread_count === 'number' ? group.unread_count : 0
      );
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
  
  // Handle tab buttons in sidebar
  document.querySelectorAll('.sidebar-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (currentTab === tab) return;
      currentTab = tab;

      // Update active state on tab buttons
      document.querySelectorAll('.sidebar-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Show corresponding panel section
      document.querySelectorAll('.panel-section').forEach(sec => {
        sec.classList.remove('active');
        sec.style.display = 'none';
      });
      const selectedPanel = document.getElementById('tab-' + tab);
      if (selectedPanel) {
        selectedPanel.style.display = 'block';
        selectedPanel.classList.add('active');
      }

      // Load data based on tab
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
// ====== GLOBAL IN-APP NOTIFICATION (GIỐNG MESSENGER) ======
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

window.showInAppNotification = function({ 
  title, 
  messagePreview, 
  conversationId, 
  conversationType = 'private' 
}) {
  // Tạo khung notification dùng lại style .error-message
  const notif = document.createElement('div');
  notif.className = 'error-message in-app-notification';
  notif.style.cursor = 'pointer';

  notif.innerHTML = `
    <div style="font-weight:600; margin-bottom:4px;">
      ${escapeHtml(title || 'Tin nhắn mới')}
    </div>
    <div style="font-size:13px; opacity:0.9;">
      ${escapeHtml(messagePreview || '')}
    </div>
  `;

  // Khi click -> chuyển đúng tab + mở đúng hội thoại
  notif.addEventListener('click', () => {
    notif.remove();

    // Mở đúng tab trước
    const tabBtn = document.querySelector(
      conversationType === 'group'
        ? '.mini-sidebar button[data-tab="groups"]'
        : '.mini-sidebar button[data-tab="conversations"]'
    );
    if (tabBtn) tabBtn.click();

    if (conversationType === 'group') {
      if (window.openGroupChat) {
        window.openGroupChat(conversationId, title || 'Nhóm');
      }
    } else {
      const convItem = document.querySelector(
        `.conversation-item[data-id="${conversationId}"]`
      );
      if (convItem) convItem.click();
    }
  });

  document.body.appendChild(notif);

  // Tự ẩn sau 5 giây
  setTimeout(() => {
    if (notif && notif.parentNode) {
      notif.remove();
    }
  }, 5000);

  maybeShowBrowserNotification({
    title,
    messagePreview,
    conversationId,
    conversationType
  });
}

function maybeShowBrowserNotification({ title, messagePreview, conversationId, conversationType }) {
  if (typeof Notification === 'undefined') return;
  if (!document.hidden) return;

  const bodyText = messagePreview || (conversationType === 'group' ? 'Tin nhắn mới trong nhóm' : 'Tin nhắn mới');
  const icon = conversationType === 'group'
    ? (window.defaultGroupAvatar || '/static/img/default-group.png')
    : (window.defaultUserAvatar || '/static/img/default-avatar.png');

  const show = () => {
    try {
      const n = new Notification(title || 'PAW TALK', {
        body: bodyText,
        icon,
        tag: `chat-${conversationType}-${conversationId || ''}`
      });

      n.onclick = () => {
        window.focus();

        const tabBtn = document.querySelector(
          conversationType === 'group'
            ? '.mini-sidebar button[data-tab="groups"]'
            : '.mini-sidebar button[data-tab="conversations"]'
        );
        if (tabBtn) tabBtn.click();

        if (conversationType === 'group') {
          if (window.openGroupChat) {
            window.openGroupChat(conversationId, title || 'Nhóm');
          }
        } else {
          const convItem = document.querySelector(
            `.conversation-item[data-id="${conversationId}"]`
          );
          if (convItem) convItem.click();
        }

        n.close();
      };
    } catch (e) {
      console.warn('Browser notification error:', e);
    }
  };

  if (Notification.permission === 'granted') {
    show();
  } else if (Notification.permission === 'default') {
    try {
      Notification.requestPermission().then((perm) => {
        if (perm === 'granted') show();
      });
    } catch (e) {
      console.warn('Request notification permission error:', e);
    }
  }
}

// Export globals
window.editMessage = window.editMessage || function(){};
window.deleteMessage = window.deleteMessage || function(){};
window.startEditMessage = window.startEditMessage || function(){};