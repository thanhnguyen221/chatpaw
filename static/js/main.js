// static/js/main.js
import { socket } from './socket/index.js';

import {
  setupChatEvents,
  setupConversationClickEvents,
  setupSendMessage,
  setupMessageStatus
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

// Chat nhóm - SỬA LỖI IMPORT Ở ĐÂY
import {
  setupCreateGroupHandler,
  setupGroupMessageSending,
  setupGroupSocketEvents,
  openGroupChat,  // ĐẢM BẢO CÓ DÒNG NÀY
  addGroupToList,
  selectGroup     // THÊM NẾU CẦN
} from './socket/group.js';

// QUAN TRỌNG: Import từ chat_input.js
import { initFileSharing, setCurrentConversation as setFileConversation } from './chat_input.js';

// Video call (WebRTC signaling)
import { bindCallUI, setCurrentConversation as setCallConversation } from './socket/call.js';
// ====== DOM đã sẵn sàng ======
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Main] DOM loaded');

  initializeTimeUtils();
  
  // Khởi tạo các module
  setupChatEvents();
  initFileSharing();
  setupFriendEvents();
  setupContactClickEvents();
  setupConversationClickEvents(onOpenConversation);
  setupSendMessage();
  setupSearchInput();
  fetchFriendRequests();
  setupCreateGroupHandler();
  setupGroupMessageSending();
  setupGroupSocketEvents();
  setupMessageStatus(); 
  
  // QUAN TRỌNG: Chỉ setup group click events một lần
  setupGroupClickEvents();

  setupTabSwitching();
  bindCallUI();
  
// THÊM: Gửi sự kiện user online khi kết nối - SỬA: không cần truyền data
socket.on('connect', () => {
  console.log('✅ Connected to server, setting user online');
  socket.emit('user_online'); // Không truyền data
});

// THÊM: Gửi sự kiện user offline trước khi đóng tab/trình duyệt
window.addEventListener('beforeunload', () => {
  console.log('🔄 Setting user offline before unload');
  socket.emit('user_offline'); // Không truyền data
});

// THÊM: Lắng nghe cập nhật trạng thái online của bạn bè
socket.on('friend_online_status', (data) => {
  console.log('[Online Status] Friend status changed:', data);
  updateFriendOnlineStatus(data.user_id, data.is_online);
});

// THÊM: Lắng nghe cập nhật danh sách trạng thái online
socket.on('online_status_update', (onlineStatus) => {
  console.log('[Online Status] Received online status update:', onlineStatus);
  updateAllFriendsOnlineStatus(onlineStatus);
});

// THÊM: Yêu cầu trạng thái online khi load trang
socket.emit('get_online_status');
});

// Gọi hàm setup group click events khi DOM ready
document.addEventListener('DOMContentLoaded', setupGroupClickEvents);
// ====== TIME FORMATTING UTILITIES ======

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

function initializeTimeUtils() {
  console.log('Initializing time utils...');
  
  // Format lại tất cả thời gian ban đầu
  document.querySelectorAll('.conversation-time').forEach(el => {
    const isoTime = el.dataset.time;
    if (isoTime) {
      const formatted = formatConversationTime(isoTime);
      if (formatted) {
        el.textContent = formatted;
      }
    }
  });
}

// ====== END TIME FORMATTING UTILITIES ======
let groupsLoading = false;

async function loadUserGroups() {
  // Kiểm tra nếu đang loading thì không load lại
  if (groupsLoading) {
    console.log('[Main] Groups already loading, skipping...');
    return;
  }
  
  try {
    groupsLoading = true;
    console.log('[Main] Loading user groups...');
    
    const response = await fetch('/user_groups');
    const data = await response.json();
    const groupsList = document.getElementById('groups-list');
    
    if (!groupsList) {
      console.error('[Main] Groups list element not found');
      return;
    }
    
    // Clear chỉ khi có dữ liệu mới
    groupsList.innerHTML = '';

    data.groups.forEach(group => {
      addGroupToList(group._id, group.name, group.avatar);
    });
    
    console.log(`[Main] Loaded ${data.groups.length} groups`);
  } catch (err) {
    console.error('Lỗi tải danh sách nhóm:', err);
  } finally {
    groupsLoading = false;
  }
}

// Gắn openGroupChat vào global để gọi từ HTML - ĐẢM BẢO HÀM NÀY TỒN TẠI
window.openGroupChat = (groupId, groupName) => {
  // Hàm cũ của bạn
  openGroupChat(groupId, groupName);

  // Sau khi mở group chat, set conversation cho file sharing và call
  onOpenConversation(groupId, 'group');
};
// ===== MINI SIDEBAR: chuyển tab =====
// Trong setupTabSwitching
function setupTabSwitching() {
  let currentTab = 'conversations'; // Tab mặc định
  
  document.querySelectorAll('.mini-sidebar button').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      
      // Nếu đang ở cùng tab thì không làm gì
      if (currentTab === tab) return;
      
      currentTab = tab;
      console.log(`[TabSwitch] Switching to ${tab}`);

      // Ẩn tất cả tab
      document.querySelectorAll('.tab-section').forEach(sec => {
        sec.classList.remove('active');
      });

      // Hiện tab được chọn
      const selected = document.getElementById('tab-' + tab);
      if (selected) {
        selected.classList.add('active');
      }

      // Fetch dữ liệu theo tab
      if (tab === 'contacts') {
        console.log('[TabSwitch] Fetching friends');
        fetchFriends();
      } else if (tab === 'requests') {
        fetchFriendRequests();
      } else if (tab === 'groups') {
        console.log('[TabSwitch] Loading groups');
        loadUserGroups();
      }
    });
  });
}
/**
 * Callback được gọi khi mở 1 hội thoại.
 * @param {string} conversationId
 * @param {('private'|'group')} conversationType
 */
function onOpenConversation(conversationId, conversationType = 'private') {
  console.log(`[Main] Opening conversation: ${conversationId}, type: ${conversationType}`);
  
  // QUAN TRỌNG: Set conversation cho module file sharing
  setFileConversation(conversationId, conversationType);

  // Set conversation cho module call
  setCallConversation(conversationId);

  // Ẩn/hiện nút call tuỳ theo loại phòng
  toggleCallButtons(conversationType === 'private');
}

function toggleCallButtons(enable) {
  const startBtn = document.getElementById('start-video-call');
  const endBtn = document.getElementById('end-video-call');

  if (!startBtn || !endBtn) return;

  // Khi chưa trong cuộc gọi, chỉ hiển thị nút "start"
  if (enable) {
    if (startBtn.style.display === 'none' && endBtn.style.display === 'none') {
      // đang trạng thái trung lập, mở start
      startBtn.style.display = 'inline-block';
      endBtn.style.display = 'none';
    } else if (endBtn.style.display === 'inline-block') {
      // đang trong call, giữ nguyên end
      // no-op
    } else {
      startBtn.style.display = 'inline-block';
      endBtn.style.display = 'none';
    }
    startBtn.disabled = false;
  } else {
    // Không cho phép call ở group (nếu bạn muốn cho phép, hãy bật enable = true ở onOpenConversation)
    startBtn.style.display = 'none';
    endBtn.style.display = 'none';
    startBtn.disabled = true;
  }
}

// THÊM HÀM NÀY NẾU CHƯA CÓ - để xử lý khi click vào group item
function setupGroupClickEvents() {
  document.addEventListener('click', (e) => {
    const groupItem = e.target.closest('.group-item');
    if (groupItem) {
      const groupId = groupItem.dataset.id;
      const groupName = groupItem.querySelector('.group-name').textContent;
      openGroupChat(groupId, groupName);
    }
  });
}

// Gọi hàm setup group click events khi DOM ready
document.addEventListener('DOMContentLoaded', setupGroupClickEvents);

// ===== Sticker panel toggle =====
const showStickersBtn = document.getElementById("show-stickers");
const stickerPanel = document.getElementById("sticker-panel");
const closeStickersBtn = document.getElementById("close-stickers");

// Nhấn icon mặt cười → mở panel
showStickersBtn.addEventListener("click", () => {
  stickerPanel.style.display = "block";
});

// Nhấn nút X → đóng panel
closeStickersBtn.addEventListener("click", () => {
  stickerPanel.style.display = "none";
});

// Click ngoài panel → đóng panel
document.addEventListener("click", (e) => {
  if (!stickerPanel.contains(e.target) && e.target !== showStickersBtn) {
    stickerPanel.style.display = "none";
  }
});
function updateFriendOnlineStatus(friendId, isOnline) {
  // Cập nhật trong danh sách bạn bè
  const friendElement = document.querySelector(`[data-user-id="${friendId}"]`);
  if (friendElement) {
    const onlineIndicator = friendElement.querySelector('.online-indicator');
    if (onlineIndicator) {
      onlineIndicator.style.display = isOnline ? 'block' : 'none';
    }
  }
  
  // Cập nhật trong danh sách hội thoại
  const conversationElement = document.querySelector(`.conversation-item[data-friend-id="${friendId}"]`);
  if (conversationElement) {
    const onlineIndicator = conversationElement.querySelector('.online-indicator');
    if (onlineIndicator) {
      onlineIndicator.style.display = isOnline ? 'block' : 'none';
    }
  }
}

// THÊM: Hàm cập nhật tất cả trạng thái online
function updateAllFriendsOnlineStatus(onlineStatus) {
  Object.keys(onlineStatus).forEach(friendId => {
    updateFriendOnlineStatus(friendId, onlineStatus[friendId].online);
  });
}
