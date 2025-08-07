
// Chat cá nhân
import {
  setupChatEvents,
  setupConversationClickEvents,
  setupSendMessage
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
  openGroupChat
} from './socket/group.js';

// ====== DOM đã sẵn sàng ======
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Main] DOM loaded');

  // Kích hoạt socket chat cá nhân
  setupChatEvents();

  // Kích hoạt socket bạn bè
  setupFriendEvents();

  // Gắn sự kiện DOM bạn bè
  setupContactClickEvents();
  setupConversationClickEvents();
  setupSendMessage();
  setupSearchInput();

  // Lấy lời mời kết bạn ban đầu
  fetchFriendRequests();

  // Gắn chức năng nhóm
  setupCreateGroupHandler();
  setupGroupMessageSending();
  setupGroupSocketEvents();

  // Gắn chức năng chuyển tab sidebar
  setupTabSwitching();
  document.querySelector('[data-tab="groups"]').addEventListener('click', loadUserGroups);
});
async function loadUserGroups() {
  try {
    const response = await fetch('/user_groups');
    const data = await response.json();
    const groupsList = document.getElementById('groups-list');
    groupsList.innerHTML = '';

    data.groups.forEach(group => {
      const groupElement = document.createElement('div');
      groupElement.className = 'group-item';
      groupElement.dataset.id = group._id;
      groupElement.innerHTML = `
        <div class="group-avatar">
          <i class="fi fi-rr-users-alt"></i>
        </div>
        <div class="group-info">
          <div class="group-name">${group.name}</div>
          <div class="group-members">${group.member_count} thành viên</div>
        </div>
      `;
      
      groupElement.addEventListener('click', () => {
        openGroupChat(group._id, group.name);
      });
      
      groupsList.appendChild(groupElement);
    });
  } catch (err) {
    console.error('Lỗi tải danh sách nhóm:', err);
  }
}
// Gắn openGroupChat vào global để gọi từ HTML
window.openGroupChat = openGroupChat;


// ===== MINI SIDEBAR: chuyển tab =====
function setupTabSwitching() {
  document.querySelectorAll('.mini-sidebar button').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      console.log(`[TabSwitch] Switching to ${tab}`);

      // Ẩn tất cả tab
      document.querySelectorAll('.tab-section').forEach(sec => {
        sec.classList.remove('active');
      });

      // Hiện tab được chọn
      const selected = document.getElementById('tab-' + tab);
      setTimeout(() => selected?.classList.add('active'), 50);

      // Fetch dữ liệu theo tab
      if (tab === 'contacts') {
        console.log('[TabSwitch] Fetching friends');
        fetchFriends();
      }

      if (tab === 'requests') {
        fetchFriendRequests();
      }
    });
  });
}
