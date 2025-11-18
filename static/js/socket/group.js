import { socket } from "./index.js";
import { setCurrentConversation } from '../chat_input.js';

// --- DEFAULT AVATARS (fallback) ---
const defaultGroupAvatar = window.defaultGroupAvatar || '/static/img/default-group.png';
// ------------------------------------

let currentGroupId = null;
let groupClickHandlerAttached = false; 

function resetPrivateChat() {
  // QUAN TRỌNG: Chỉ reset nếu đang có conversation private
  if (window.currentConversation) {
    socket.emit('leave_conversation', { conversation_id: window.currentConversation });
    window.currentConversation = null;
  }
  
  // Reset UI cho chat cá nhân
  document.querySelectorAll('.conversation-item').forEach(el => {
    el.classList.remove('active');
  });

  // QUAN TRỌNG: Clear current conversation trong module chat
  if (window.chatModule && typeof window.chatModule.resetCurrentConversation === 'function') {
    window.chatModule.resetCurrentConversation();
  }
}

export function setupGroupSocketEvents() {
  // Trong setupGroupSocketEvents
  socket.on('user_left_group', (data) => {
    if (data.user_id === window.session.user_id) {
      if (currentGroupId === data.group_id) {
        currentGroupId = null;
        document.querySelector('.chat-header h2').textContent = 'Messages';
        document.getElementById('animation-screen').style.display = 'flex';
        // đảm bảo ẩn messages nếu có
        document.getElementById('messages').style.display = 'none';
        // ẩn sidebar + overlay
        closeManageSidebar();
      }
      document.querySelector(`.group-item[data-id="${data.group_id}"]`)?.remove();
    } else {
      if (currentGroupId === data.group_id) {
        openManageGroupModal(data.group_id); // refresh modal
      }
    }
  });
  socket.on('group_history', (data) => {
    console.log('[Socket] Nhận lịch sử tin nhắn:', data);
    // KIỂM TRA KỸ: chỉ xử lý nếu đang ở đúng group
    if (currentGroupId && String(currentGroupId) === String(data.group_id)) {
      const messagesContainer = document.getElementById('messages');
      if (messagesContainer) {
        // KHÔNG clear messages nếu đang có loading
        if (!messagesContainer.classList.contains('loading')) {
          messagesContainer.innerHTML = '';
          data.messages.forEach(message => {
            appendGroupMessage(message);
          });
        }
      }
    }
  });

  socket.on('group_name_updated', (data) => {
    const groupNameEl = document.querySelector(`.group-item[data-id="${data.group_id}"] .group-name`);
    if (groupNameEl) groupNameEl.textContent = data.new_name;
  
    if (data.group_id === currentGroupId) {
      const headerH2 = document.querySelector('.chat-header h2');
      if (headerH2) headerH2.textContent = data.new_name;
  
      // Nếu sidebar đang mở cho chính nhóm đó, cập nhật input
      const sidebar = document.getElementById('manage-group-sidebar');
      if (sidebar && sidebar.dataset.groupId === data.group_id) {
        const editInput = document.getElementById('edit-group-name');
        if (editInput) editInput.value = data.new_name;
      }
    }
  });
  
  socket.on('group_member_added', (data) => {
    if (data.group_id === currentGroupId) {
      openManageGroupModal(data.group_id); // Làm mới modal
      alert(`Đã thêm thành viên mới: ${data.user_id}`);
    }
  });
  socket.on('group_member_removed', (data) => {
    if (data.group_id === currentGroupId) {
      // Nếu modal đang mở, làm mới nó
      if (document.getElementById('manage-group-sidebar').style.display === 'block') {
        openManageGroupModal(data.group_id);
      }
      if (data.user_id === window.session.user_id) {
        // Reset view nếu đang mở nhóm đó
        if (String(currentGroupId) === String(data.group_id)) {
          currentGroupId = null;
          const headerH2 = document.querySelector('.chat-header h2');
          if (headerH2) headerH2.textContent = 'Messages';
          const animation = document.getElementById('animation-screen');
          if (animation) animation.style.display = 'flex';
          const messages = document.getElementById('messages');
          if (messages) messages.style.display = 'none';
          closeManageSidebar();
        }
      
        // Xoá group khỏi sidebar (nếu còn)
        const removedEl = document.querySelector(`.group-item[data-id="${data.group_id}"]`);
        if (removedEl) removedEl.remove();
      }
    }
  });

  // Tin nhắn nhóm mới
  socket.on('group_message', (data) => {
    console.log('[Socket] Nhận tin nhắn nhóm:', data);
    // Đảm bảo chỉ append khi đang ở đúng group
    if (currentGroupId && String(currentGroupId) === String(data.group_id)) {
      appendGroupMessage(data);
    }
  });

  // Nhóm mới được tạo
  socket.on('group_created', (group) => {
    console.log('[Socket] Nhóm mới được tạo:', group);
    addGroupToList(group._id, group.name);
  });

  socket.on('group_removed', (groupId) => {
    console.log(`[Socket] Bạn đã bị xóa khỏi nhóm ${groupId}`);
    if (currentGroupId === groupId) {
      document.querySelector('.chat-header h2').textContent = 'Messages';
      currentGroupId = null;
      // đóng sidebar/overlay nếu đang mở
      closeManageSidebar();
    }
    document.querySelector(`.group-item[data-id="${groupId}"]`)?.remove();
  });
  
}
function removeGroupMember(groupId, userId) {
  // Xóa thành viên ngay lập tức khỏi giao diện
  const memberItem = document.querySelector(`.remove-member-btn[data-user-id="${userId}"]`).closest('.group-member-item');
  if (memberItem) {
    memberItem.remove();
  }
  
  // Gửi yêu cầu xóa đến server
  socket.emit('remove_group_member', {
    group_id: groupId,
    user_id: userId
  });
}
function openManageGroupModal(groupId) {
  const modal = document.getElementById('manage-group-sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (!modal) return;

  // fallback avatar nếu bạn chưa khai báo global
  const fallbackGroupAvatar = window.defaultGroupAvatar || '/static/img/default-group.png';

  modal.dataset.groupId = groupId;

  fetch(`/group_info/${groupId}`)
    .then(response => response.json())
    .then(groupInfo => {
      const isAdmin = groupInfo.current_user_role === 'admin';
      const groupName = groupInfo.name;
      const isCreatorOfGroup = groupInfo.created_by === window.session.user_id;

      // cập nhật tên, ẩn/hiện section
      const editNameInput = document.getElementById('edit-group-name');
      if (editNameInput) editNameInput.value = groupName;
      const nameEditSection = document.getElementById('group-name-edit-section');
      if (nameEditSection) nameEditSection.style.display = isAdmin ? 'block' : 'none';
      const addMemberSection = document.getElementById('add-member-section');
      if (addMemberSection) addMemberSection.style.display = isAdmin ? 'block' : 'none';

      // render danh sách thành viên (reset nội dung trước)
      const membersContainer = document.getElementById('group-members-list');
      if (membersContainer) membersContainer.innerHTML = '';

      (groupInfo.members || []).forEach(member => {
        const memberEl = document.createElement('div');
        memberEl.className = 'group-member-item';

        const isMe = member._id === window.session.user_id;
        const isCreator = member.is_creator;

        let actionsHTML = '';
        if (isAdmin && !isMe && !isCreator) {
          actionsHTML += `
            <button class="remove-member-btn" data-user-id="${member._id}" title="Xoá thành viên">❌</button>
          `;
        }

        memberEl.innerHTML = `
          <img src="${member.avatar || (window.defaultUserAvatar || '/static/img/default-avatar.png')}" 
               alt="${member.username}" class="member-avatar">
          <span class="member-username">${member.username}</span>
          ${isCreator ? '<span class="creator-badge">Trưởng nhóm</span>' : ''}
          ${actionsHTML}
        `;
        membersContainer.appendChild(memberEl);
      });

      // Gắn event xóa thành viên (chắc chắn chỉ 1 lần vì container đã reset innerHTML)
      if (isAdmin && membersContainer) {
        membersContainer.querySelectorAll('.remove-member-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const userId = btn.dataset.userId;
            if (confirm('Bạn có chắc muốn xóa thành viên này khỏi nhóm?')) {
              removeGroupMember(groupId, userId);
            }
          });
        });
      }

      // Nút rời nhóm: nếu đã có thì cập nhật dataset và gỡ listener cũ, nếu chưa có thì tạo
      if (groupInfo.members.some(m => m._id === window.session.user_id)) {
        let leaveBtn = document.getElementById('leave-group-btn-fixed');
        if (!leaveBtn) {
          leaveBtn = document.createElement('button');
          leaveBtn.id = 'leave-group-btn-fixed';
          leaveBtn.className = 'leave-group-btn';
          modal.appendChild(leaveBtn);
        }
        // set lại thuộc tính và sự kiện mới (tránh chồng listener)
        leaveBtn.dataset.groupId = groupId;
        leaveBtn.textContent = ' Rời nhóm';
        leaveBtn.title = 'Rời nhóm';
        leaveBtn.onclick = () => {
          if (!confirm('Bạn có chắc muốn rời nhóm này?')) return;
        
          // Gửi yêu cầu rời nhóm
          socket.emit('leave_group', { group_id: groupId }, (ack) => {
            // nếu server trả lỗi bạn có thể hiển thị ở đây (tùy server)
            if (ack && ack.error) {
              alert('Rời nhóm thất bại: ' + ack.error);
            }
          });
        
          // Cập nhật UI ngay lập tức (optimistic update)
          try {
            const groupEl = document.querySelector(`.group-item[data-id="${groupId}"]`);
            if (groupEl) groupEl.remove();
        
            if (String(currentGroupId) === String(groupId)) {
              currentGroupId = null;
              const headerH2 = document.querySelector('.chat-header h2');
              if (headerH2) headerH2.textContent = 'Messages';
              const animation = document.getElementById('animation-screen');
              if (animation) animation.style.display = 'flex';
              const messages = document.getElementById('messages');
              if (messages) messages.style.display = 'none';
            }
          } catch (err) {
            console.warn('UI update khi rời nhóm gặp lỗi:', err);
          }
        
          closeManageSidebar();
        };
        
      } else {
        // nếu không phải thành viên thì xoá nút rời (nếu tồn tại)
        const existingLeave = document.getElementById('leave-group-btn-fixed');
        if (existingLeave) existingLeave.remove();
      }

      // Avatar nhóm (chỉ cho phép "Thay đổi avatar" nếu admin hoặc creator)
      const canChangeAvatar = isAdmin || isCreatorOfGroup;
      const avatarPreview = document.createElement('div');
      avatarPreview.id = 'group-avatar-preview';
      avatarPreview.innerHTML = `
        <img src="${groupInfo.avatar || fallbackGroupAvatar}" 
             alt="${groupInfo.name || 'Group'}" 
             id="group-avatar-img">
        ${canChangeAvatar ? '<button id="change-group-avatar">Thay đổi avatar</button>' : ''}
        <input type="file" id="group-avatar-upload" accept="image/*" style="display:none">
      `;

      // replace hoặc prepend để tránh tạo nhiều lần
      const existingPreview = modal.querySelector('#group-avatar-preview');
      if (existingPreview) {
        existingPreview.replaceWith(avatarPreview);
      } else {
        modal.prepend(avatarPreview);
      }

      // CHÚ Ý: gắn event nếu phần tử tồn tại (kiểm tra null trước khi addEventListener)
      const changeBtn = modal.querySelector('#change-group-avatar');
      const uploadInput = modal.querySelector('#group-avatar-upload');
      if (changeBtn && uploadInput) {
        changeBtn.addEventListener('click', () => uploadInput.click());
      }

      if (uploadInput) {
        // đảm bảo không gắn nhiều lần: thay thế handler cũ
        uploadInput.onchange = function () {
          if (this.files && this.files[0]) {
            const reader = new FileReader();
            reader.onload = function (e) {
              const img = document.getElementById('group-avatar-img');
              if (img) img.src = e.target.result;

              socket.emit('update_group_avatar', {
                group_id: groupId,
                new_avatar: e.target.result
              }, (response) => {
                if (!response || !response.ok) {
                  alert('Cập nhật avatar thất bại: ' + (response && response.error ? response.error : 'Lỗi không xác định'));
                }
              });
            };
            reader.readAsDataURL(this.files[0]);
          }
        };
      }

      // SHOW sidebar (kiểm tra tồn tại overlay)
      modal.classList.add('active');
      if (overlay) overlay.classList.add('show');
    })
    .catch(error => {
      console.error('Lỗi tải thông tin nhóm:', error);
      alert('Không thể tải thông tin nhóm');
    });
}
export function openGroupChat(groupId, groupName) {
  console.log(`[Group] Opening group chat: ${groupId}`);
  
  // QUAN TRỌNG: Kiểm tra nếu đang mở cùng group thì không làm gì
  if (currentGroupId && String(currentGroupId) === String(groupId)) {
    console.log(`[Group] Group ${groupId} is already open, skipping...`);
    return;
  }
  
  // QUAN TRỌNG: Reset chat cá nhân trước
  resetPrivateChat();
  
  currentGroupId = groupId;
  
  // QUAN TRỌNG: Set conversation cho file sharing
  if (typeof setCurrentConversation === 'function') {
    setCurrentConversation(groupId, 'group');
  }
  
  // Cập nhật UI NGAY LẬP TỨC - chỉ một lần
  const header = document.querySelector('.chat-header');
  const animationScreen = document.getElementById('animation-screen');
  const messagesDiv = document.getElementById('messages');
  
  // Ẩn animation và hiển thị loading
  if (animationScreen) {
    animationScreen.style.display = 'none';
  }
  
  if (messagesDiv) {
    messagesDiv.style.display = 'block';
    messagesDiv.innerHTML = '<div class="loading">Đang tải tin nhắn...</div>';
  }

  // Cập nhật header TẠM THỜI với thông tin cơ bản
  if (header) {
    header.innerHTML = `
      <div class="group-header">
        <img src="${defaultGroupAvatar}" 
            alt="${groupName}" 
            class="group-avatar-small">
        <div class="group-name-wrap">
          <h2 title="${escapeHtml(groupName)}">${groupName}</h2>
        </div>
      </div>
      <button id="manage-group-btn" class="btn-manage" title="Quản lý nhóm">
        <i class="fi fi-br-bars-staggered"></i>
      </button>
    `;
    
    // Gắn sự kiện manage button
    const manageBtn = document.getElementById('manage-group-btn');
    if (manageBtn) {
      manageBtn.addEventListener('click', () => {
        openManageGroupModal(groupId);
      });
    }
  }

  // QUAN TRỌNG: Join group
  console.log(`[Group] Joining group: ${groupId}`);
  socket.emit('join_group', { group_id: groupId });

  // THAY ĐỔI QUAN TRỌNG: Load tuần tự thay vì song song
  loadGroupDataSequentially(groupId, groupName);
}

// THÊM HÀM MỚI: Load dữ liệu tuần tự để tránh giật
async function loadGroupDataSequentially(groupId, groupName) {
  try {
    console.log(`[Group] Starting sequential load for ${groupId}`);
    
    // Bước 1: Load thông tin nhóm
    const groupInfo = await fetch(`/group_info/${groupId}`).then(res => res.json());
    
    // Kiểm tra xem có còn ở group này không
    if (!currentGroupId || String(currentGroupId) !== String(groupId)) {
      console.log(`[Group] User switched group during load, ignoring results for ${groupId}`);
      return;
    }
    
    // Cập nhật header với thông tin đầy đủ
    updateGroupHeader(groupId, groupName, groupInfo);
    
    // Bước 2: Load tin nhắn
    const messagesData = await fetch(`/group_message?group_id=${groupId}&_=${Date.now()}`).then(res => res.json());
    
    // Kiểm tra lại
    if (!currentGroupId || String(currentGroupId) !== String(groupId)) {
      console.log(`[Group] User switched group during messages load, ignoring results for ${groupId}`);
      return;
    }
    
    // Hiển thị tin nhắn
    displayGroupMessages(messagesData);
    
    console.log(`[Group] Successfully loaded group ${groupId} with ${messagesData.messages?.length || 0} messages`);
    
  } catch (err) {
    console.error('Error loading group chat:', err);
    handleGroupLoadError(groupId, err);
  }
}

// THÊM: Hàm cập nhật header
function updateGroupHeader(groupId, groupName, groupInfo) {
  const header = document.querySelector('.chat-header');
  if (!header) return;
  
  const groupAvatar = groupInfo.avatar || defaultGroupAvatar;
  const avatarWithCacheBust = groupAvatar.startsWith('http') 
      ? `${groupAvatar}?t=${Date.now()}`
      : groupAvatar;

  header.innerHTML = `
    <div class="group-header">
      <img src="${avatarWithCacheBust}" 
          alt="${groupName}" 
          class="group-avatar-small">
      <div class="group-name-wrap">
        <h2 title="${escapeHtml(groupName)}">${groupName}</h2>
      </div>
    </div>
    <button id="manage-group-btn" class="btn-manage" title="Quản lý nhóm">
      <i class="fi fi-br-bars-staggered"></i>
    </button>
  `;
  
  // Gắn sự kiện manage button
  const manageBtn = document.getElementById('manage-group-btn');
  if (manageBtn) {
    manageBtn.addEventListener('click', () => {
      openManageGroupModal(groupId);
    });
  }
}

// THÊM: Hàm hiển thị tin nhắn
function displayGroupMessages(messagesData) {
  const messagesDiv = document.getElementById('messages');
  if (!messagesDiv) return;
  
  messagesDiv.innerHTML = '';
  
  if (messagesData.messages && messagesData.messages.length > 0) {
    // Sử dụng document fragment để tối ưu render
    const fragment = document.createDocumentFragment();
    messagesData.messages.forEach(msg => {
      const messageEl = createGroupMessageElement(msg);
      if (messageEl) fragment.appendChild(messageEl);
    });
    messagesDiv.appendChild(fragment);
  } else {
    messagesDiv.innerHTML = '<div class="no-messages">Chưa có tin nhắn nào trong nhóm</div>';
  }
  
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// THÊM: Hàm xử lý lỗi
function handleGroupLoadError(groupId, error) {
  if (currentGroupId === groupId) {
    currentGroupId = null;
    
    const messagesDiv = document.getElementById('messages');
    if (messagesDiv) {
      messagesDiv.innerHTML = '<div class="error">Lỗi tải thông tin nhóm</div>';
    }
    
    const animationScreen = document.getElementById('animation-screen');
    if (animationScreen) {
      animationScreen.style.display = 'flex';
    }
  }
}
// Đảm bảo hàm này cũng được export
export function selectGroup(groupId, groupName) {
  console.log(`[Group] Chọn nhóm: ${groupId} - ${groupName}`);
  
  // Leave room cũ nếu có
  if (currentGroupId) {
    socket.emit('leave_conversation', { conversation_id: currentGroupId });
    console.log(`[Group] Rời khỏi nhóm cũ: ${currentGroupId}`);
  }
  
  // Cập nhật currentGroupId
  currentGroupId = groupId;
  
  // Join room mới
  socket.emit('join_group', { group_id: groupId });
  console.log(`[Group] Tham gia nhóm mới: ${groupId}`);
  
  // Cập nhật UI
  const headerH2 = document.querySelector('.chat-header h2');
  if (headerH2) headerH2.textContent = groupName;
  
  const animationScreen = document.getElementById('animation-screen');
  if (animationScreen) animationScreen.style.display = 'none';
  
  const messagesDiv = document.getElementById('messages');
  if (messagesDiv) {
    messagesDiv.style.display = 'block';
    messagesDiv.innerHTML = ''; // Clear messages khi chuyển group
  }
}

export function setupCreateGroupHandler() {
  const createBtn = document.getElementById('create-group-btn');
  if (!createBtn) return;

  createBtn.addEventListener('click', () => {
    document.getElementById('create-group-modal').style.display = 'block';
    loadFriendsForGroupCreation();
  });

  document.querySelector('#create-group-modal .close').addEventListener('click', () => {
    document.getElementById('create-group-modal').style.display = 'none';
  });

  const confirmBtn = document.getElementById('confirm-create-group');
  confirmBtn.addEventListener('click', async () => {
    const groupName = document.getElementById('group-name').value.trim();
    
    const selectedMembers = Array.from(
      document.querySelectorAll('.friend-selector:checked')
    ).map(el => el.dataset.userId);

    if (!groupName) {
      alert('Vui lòng nhập tên nhóm');
      return;
    }

    if (selectedMembers.length === 0) {
      alert('Vui lòng chọn ít nhất một thành viên');
      return;
    }

    try {
      const response = await fetch('/create_group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: groupName,
          members: selectedMembers
        })
      });

      const result = await response.json();
      if (result.group_id) {
        addGroupToList(result.group_id, groupName);
        document.getElementById('create-group-modal').style.display = 'none';
        
        // Reset form
        document.getElementById('group-name').value = '';
        document.querySelectorAll('.friend-selector:checked').forEach(el => {
          el.checked = false;
        });
      } else {
        alert('Tạo nhóm thất bại: ' + (result.error || 'Lỗi không xác định'));
      }
    } catch (err) {
      console.error('Lỗi tạo nhóm:', err);
      alert('Đã xảy ra lỗi khi tạo nhóm');
    }
  });
}

async function loadFriendsForGroupCreation() {
  try {
    const response = await fetch('/get_friends');
    const data = await response.json();
    const container = document.getElementById('group-members-selector');
    container.innerHTML = '';

    data.friends.forEach(friend => {
      const friendElement = document.createElement('div');
      friendElement.className = 'friend-selector-item';
      friendElement.innerHTML = `
        <input type="checkbox" class="friend-selector" 
               data-user-id="${friend._id}" id="friend-${friend._id}">
        <label for="friend-${friend._id}">
          <img src="${friend.avatar}" alt="${friend.username}" class="friend-avatar">
          <span>${friend.username}</span>
        </label>
      `;
      container.appendChild(friendElement);
    });
  } catch (err) {
    console.error('Lỗi tải danh sách bạn bè:', err);
  }
}
export function addGroupToList(groupId, groupName, avatarUrl) {
  const existingGroup = document.querySelector(`.group-item[data-id="${groupId}"]`);
  
  if (existingGroup) {
    const avatarImg = existingGroup.querySelector('.group-avatar img');
    if (avatarImg && avatarUrl) {
      avatarImg.src = avatarUrl + '?_=' + Date.now();
    }
    const nameElement = existingGroup.querySelector('.group-name');
    if (nameElement && groupName) {
      nameElement.textContent = groupName;
    }
    return;
  }

  // Nếu chưa tồn tại, tạo nhóm mới
  const groupsList = document.getElementById('groups-list');
  const groupElement = document.createElement('div');
  groupElement.className = 'group-item';
  groupElement.dataset.id = groupId;

  const avatarToShow = avatarUrl || defaultGroupAvatar;

  groupElement.innerHTML = `
    <div class="group-avatar">
        <img src="${avatarToShow}" 
             alt="${groupName}" 
             class="group-avatar-img">
    </div>
    <div class="group-info">
        <div class="group-name">${groupName}</div>
    </div>
  `;

  // SỬA: Sử dụng event delegation thay vì gắn trực tiếp
  groupElement.addEventListener('click', handleGroupClick);
  
  groupsList.appendChild(groupElement);
}
export function setupGroupMessageSending() {
  const messageInput = document.getElementById('message');
  const sendButton = document.getElementById('send');

  function sendGroupMessage() {
    const content = messageInput.value.trim();
    
    // KIỂM TRA KỸ: chỉ gửi nếu đang ở group và có nội dung
    if (!content || !currentGroupId) {
      console.log('[Group] Cannot send message - no content or not in group');
      return;
    }

    // KIỂM TRA THÊM: đảm bảo đang không ở private conversation
    if (window.currentConversation) {
      console.log('[Group] Warning: Still in private conversation, resetting...');
      resetPrivateChat();
    }

    console.log(`[Group] Sending message to group: ${currentGroupId}`);
    
    socket.emit('send_group_message', {
      group_id: currentGroupId,
      content: content
    });
    messageInput.value = '';
  }

  sendButton.addEventListener('click', sendGroupMessage);
  messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      sendGroupMessage();
    }
  });
}
function loadGroupMessages(groupId) {
  // Kiểm tra nghiêm ngặt hơn
  if (!currentGroupId || String(currentGroupId) !== String(groupId)) {
    console.log(`[Group] Not loading messages for ${groupId} - current group is ${currentGroupId}`);
    return;
  }
  
  const messagesContainer = document.getElementById('messages');
  if (!messagesContainer) return;
  
  // THÊM: Kiểm tra nếu đang loading thì không load lại
  if (messagesContainer.classList.contains('loading')) {
    console.log('[Group] Messages are already loading, skipping...');
    return;
  }
  
  messagesContainer.classList.add('loading');
  messagesContainer.innerHTML = '<div class="loading">Đang tải tin nhắn...</div>';
  
  // THÊM: Sử dụng cache buster để tránh cache
  fetch(`/group_message?group_id=${groupId}&_=${Date.now()}`)
    .then(response => {
      if (!response.ok) {
        throw new Error('Không thể tải tin nhắn nhóm');
      }
      return response.json();
    })
    .then(data => {
      messagesContainer.classList.remove('loading');
      
      // Kiểm tra lại xem có còn ở group này không
      if (!currentGroupId || String(currentGroupId) !== String(groupId)) {
        console.log(`[Group] Ignoring loaded messages for ${groupId} - user switched group`);
        return;
      }
      
      messagesContainer.innerHTML = '';
      
      if (data.messages && data.messages.length > 0) {
        // THÊM: Sử dụng document fragment để tối ưu render
        const fragment = document.createDocumentFragment();
        data.messages.forEach(msg => {
          const messageEl = createGroupMessageElement(msg);
          if (messageEl) fragment.appendChild(messageEl);
        });
        messagesContainer.appendChild(fragment);
      } else {
        messagesContainer.innerHTML = '<div class="no-messages">Chưa có tin nhắn nào trong nhóm</div>';
      }
      
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    })
    .catch(error => {
      console.error("Lỗi tải tin nhắn nhóm: ", error);
      messagesContainer.classList.remove('loading');
      if (currentGroupId === groupId) {
        messagesContainer.innerHTML = `<div class="error">${error.message}</div>`;
      }
    });
}
export function resetGroupChat() {
  if (currentGroupId) {
    socket.emit('leave_conversation', { conversation_id: currentGroupId });
    currentGroupId = null;
  }
}
function createGroupMessageElement(messageData) {
  const messageEl = document.createElement('div');
  const isCurrentUser = messageData.sender_id === window.session.user_id;
  messageEl.className = isCurrentUser ? 'message sent' : 'message received';

  const avatarSrc = messageData.sender_avatar || window.defaultUserAvatar || '/static/img/default-avatar.png';
  const timeString = formatTime(messageData.timestamp);

  let messageType = messageData.message_type || 'text';
  let parsedContent = messageData.content;

  // ... (phần xử lý message type giữ nguyên)

  let messageContent = '';

  if (messageType === 'file') {
    const fileInfo = parsedContent;
    messageContent = `
      <div class="file-message">
        <div class="file-info">
          <div class="file-icon"><i class="fi fi-rr-file"></i></div>
          <div class="file-details">
            <div class="file-name">${escapeHtml(fileInfo.name)}</div>
            <div class="file-size">${formatFileSize(fileInfo.size)}</div>
          </div>
        </div>
        <a href="${fileInfo.url}" class="file-download" download="${escapeHtml(fileInfo.name)}">
          <i class="fi fi-rr-download"></i> Tải xuống
        </a>
      </div>
    `;
  } else if (messageType === 'image') {
    const imageInfo = parsedContent;
    messageContent = `
      <div class="image-message">
        <div class="image-info">
          <i class="fi fi-rr-picture"></i> ${escapeHtml(imageInfo.name)}
        </div>
        <img src="${imageInfo.thumbnail || imageInfo.url}" 
             class="uploaded-image" 
             alt="${escapeHtml(imageInfo.name)}"
             onclick="openImageModal('${imageInfo.url}')">
        <div class="image-actions">
          <a href="${imageInfo.url}" target="_blank" class="view-original">
            <i class="fi fi-rr-external-link"></i> Xem ảnh gốc
          </a>
        </div>
      </div>
    `;
  } else if (messageType === 'sticker') {
    messageContent = `
      <div class="sticker-message">${getStickerHTML(parsedContent)}</div>
    `;
  } else {
    messageContent = `
      <div class="message-text">${escapeHtml(messageData.content)}</div>
    `;
  }

  messageEl.innerHTML = `
    ${!isCurrentUser ? `<img src="${avatarSrc}" alt="${messageData.sender_name}" class="message-avatar">` : ''}
    <div class="message-content-container">
      <div class="message-content-wrapper">
        <div class="message-bubble">
          ${!isCurrentUser ? `<div class="message-header"><span class="sender-name">${messageData.sender_name}</span></div>` : ''}
          ${messageContent}
        </div>
        <span class="message-time">${timeString}</span>
      </div>
    </div>
    ${isCurrentUser ? `<img src="${avatarSrc}" alt="${messageData.sender_name}" class="message-avatar">` : ''}
  `;

  return messageEl;
}
function appendGroupMessage(messageData) {
  const messagesContainer = document.getElementById('messages');
  if (!messagesContainer) return;

  const messageEl = document.createElement('div');
  const isCurrentUser = messageData.sender_id === window.session.user_id;
  messageEl.className = isCurrentUser ? 'message sent' : 'message received';

  // Sử dụng avatar từ messageData, fallback về default nếu không có
  const avatarSrc = messageData.sender_avatar || window.defaultUserAvatar || '/static/img/default-avatar.png';
  
  // Format timestamp
  const timeString = formatTime(messageData.timestamp);

  // QUAN TRỌNG: Xác định message_type và parse content - PHIÊN BẢN MỚI
  let messageType = messageData.message_type || 'text';
  let parsedContent = messageData.content;

  console.log('[DEBUG] Processing message:', { 
    messageType, 
    content: messageData.content,
    hasMessageType: !!messageData.message_type
  });

  // TRƯỜNG HỢP 1: Nếu message_type đã được set đúng
  if (messageType === 'file' || messageType === 'image') {
    if (typeof messageData.content === 'string') {
      try {
        parsedContent = JSON.parse(messageData.content);
        console.log('[DEBUG] Parsed content for file/image:', parsedContent);
      } catch (e) {
        console.error('Error parsing file/image content:', e);
        // Fallback: xử lý như text
        messageType = 'text';
      }
    }
  }
  // TRƯỜNG HỢP 2: Nếu không có message_type hoặc là text, thử detect
  else if (!messageData.message_type || messageType === 'text') {
    // Thử parse JSON để xem có phải file/image không
    if (typeof messageData.content === 'string') {
      try {
        const testParse = JSON.parse(messageData.content);
        if (testParse && typeof testParse === 'object') {
          if (testParse.type === 'file') {
            messageType = 'file';
            parsedContent = testParse;
            console.log('[DEBUG] Detected file message:', parsedContent);
          } else if (testParse.type === 'image') {
            messageType = 'image';
            parsedContent = testParse;
            console.log('[DEBUG] Detected image message:', parsedContent);
          }
        }
      } catch (e) {
        // Không phải JSON, kiểm tra sticker
        const stickerCodes = ['sticker1', 'sticker2', 'sticker3', 'sticker4', 'sticker5', 'sticker6'];
        if (stickerCodes.includes(messageData.content)) {
          messageType = 'sticker';
          console.log('[DEBUG] Detected sticker message:', messageData.content);
        }
      }
    }
  }

  // Xử lý các loại tin nhắn đặc biệt
  let messageContent = '';

  if (messageType === 'file') {
    const fileInfo = parsedContent;
    console.log('[DEBUG] Rendering file message:', fileInfo);
    
    messageContent = `
      <div class="file-message">
        <div class="file-info">
          <div class="file-icon"><i class="fi fi-rr-file"></i></div>
          <div class="file-details">
            <div class="file-name">${escapeHtml(fileInfo.name)}</div>
            <div class="file-size">${formatFileSize(fileInfo.size)}</div>
          </div>
        </div>
        <a href="${fileInfo.url}" class="file-download" download="${escapeHtml(fileInfo.name)}">
          <i class="fi fi-rr-download"></i> Tải xuống
        </a>
      </div>
    `;
  } else if (messageType === 'image') {
    const imageInfo = parsedContent;
    console.log('[DEBUG] Rendering image message:', imageInfo);
    
    messageContent = `
      <div class="image-message">
        <div class="image-info">
          <i class="fi fi-rr-picture"></i> ${escapeHtml(imageInfo.name)}
        </div>
        <img src="${imageInfo.thumbnail || imageInfo.url}" 
             class="uploaded-image" 
             alt="${escapeHtml(imageInfo.name)}"
             onclick="openImageModal('${imageInfo.url}')">
        <div class="image-actions">
          <a href="${imageInfo.url}" target="_blank" class="view-original">
            <i class="fi fi-rr-external-link"></i> Xem ảnh gốc
          </a>
        </div>
      </div>
    `;
  } else if (messageType === 'sticker') {
    messageContent = `
      <div class="sticker-message">${getStickerHTML(parsedContent)}</div>
    `;
  } else {
    // Tin nhắn text thông thường - HIỂN THỊ TRỰC TIẾP, KHÔNG PARSE JSON
    messageContent = `
      <div class="message-text">${escapeHtml(messageData.content)}</div>
    `;
  }

  messageEl.innerHTML = `
    ${!isCurrentUser ? `<img src="${avatarSrc}" alt="${messageData.sender_name}" class="message-avatar">` : ''}
    <div class="message-content-container">
      <div class="message-content-wrapper">
        <div class="message-bubble">
          ${!isCurrentUser ? `<div class="message-header"><span class="sender-name">${messageData.sender_name}</span></div>` : ''}
          ${messageContent}
        </div>
        <span class="message-time">${timeString}</span>
      </div>
    </div>
    ${isCurrentUser ? `<img src="${avatarSrc}" alt="${messageData.sender_name}" class="message-avatar">` : ''}
  `;

  messagesContainer.appendChild(messageEl);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}
// Thêm hàm mở modal xem ảnh lớn
function openImageModal(imageUrl) {
  const modal = document.createElement('div');
  modal.className = 'image-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.8);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
    cursor: pointer;
  `;
  
  modal.innerHTML = `
    <img src="${imageUrl}" style="max-width: 90%; max-height: 90%; object-fit: contain;">
    <button style="position: absolute; top: 20px; right: 20px; background: #fff; border: none; border-radius: 50%; width: 40px; height: 40px; font-size: 20px; cursor: pointer;">×</button>
  `;
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.tagName === 'BUTTON') {
      document.body.removeChild(modal);
    }
  });
  
  document.body.appendChild(modal);
}
// Thêm các hàm utility nếu chưa có
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

function escapeHtml(unsafe = '') {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

document.getElementById('add-member-input').addEventListener('input', (e) => {
  const term = e.target.value.trim();
  if (term.length < 2) return;
  
  fetch(`/search_friends?q=${term}`)
    .then(response => response.json())
    .then(data => {
      const container = document.getElementById('add-member-results');
      container.innerHTML = '';
      
      data.results.forEach(user => {
        const userEl = document.createElement('div');
        userEl.className = 'search-result-item';
        userEl.innerHTML = `
          <img src="${user.avatar}" alt="${user.username}" class="avatar-small">
          <span>${user.username}</span>
          <button class="select-member-btn" data-user-id="${user._id}">
            Chọn
          </button>
        `;
        container.appendChild(userEl);
        
        // Gắn sự kiện chọn thành viên
        userEl.querySelector('.select-member-btn').addEventListener('click', () => {
          addMemberToGroup(groupId, user._id);
        });
      });
    });
});

socket.on('group_history', (data) => {
  if (data.group_id === currentGroupId) {
      const messagesEl = document.getElementById('messages');
      messagesEl.innerHTML = '';
      
      data.messages.forEach(msg => {
          appendGroupMessage(msg);
      });
  }
});
function formatTime(dateString) {
  if (!dateString) return '';
  
  try {
    const date = new Date(dateString);
    const now = new Date();
    
    if (isNaN(date.getTime())) return '';

    // SỬA: Tính chênh lệch thời gian bằng milliseconds UTC
    const dateUTC = date.getTime();
    const nowUTC = now.getTime();
    const diffMs = nowUTC - dateUTC;
    
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
    } else if (date.getFullYear() === now.getFullYear()) {
      const day = date.getDate().toString().padStart(2, '0');
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      return `${day}/${month}`;
    } else {
      const day = date.getDate().toString().padStart(2, '0');
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const year = date.getFullYear();
      return `${day}/${month}/${year}`;
    }
  } catch (error) {
    console.error('Error formatting time:', error);
    return '';
  }
}
function addMemberToGroup(groupId, userId) {
  socket.emit('add_group_member', {
    group_id: groupId,
    user_id: userId
  });
  
  // Hiển thị thông báo tải
  const membersList = document.getElementById('group-members-list');
  const newMemberEl = document.createElement('div');
  newMemberEl.className = 'group-member-item loading';
  newMemberEl.innerHTML = `
    <div class="loading-spinner"></div>
    <span>Đang thêm thành viên...</span>
  `;
  membersList.appendChild(newMemberEl);
}

function setupAddMemberSearch() {
  const addMemberInput = document.getElementById('add-member-input');
  if (!addMemberInput) return;

  addMemberInput.addEventListener('input', debounce((e) => {
    const term = e.target.value.trim();
    if (term.length < 2) {
      document.getElementById('add-member-results').innerHTML = '';
      return;
    }
    
    const groupId = document.getElementById('manage-group-sidebar').dataset.groupId;
    
    fetch(`/search_friends?q=${term}`)
      .then(response => response.json())
      .then(data => {
        const container = document.getElementById('add-member-results');
        container.innerHTML = '';
        
        data.results.forEach(user => {
          const userEl = document.createElement('div');
          userEl.className = 'search-result-item';
          userEl.innerHTML = `
            <img src="${user.avatar}" alt="${user.username}" class="avatar-small">
            <span>${user.username}</span>
            <button class="select-member-btn" data-user-id="${user._id}">
              Chọn
            </button>
          `;
          container.appendChild(userEl);
          
          userEl.querySelector('.select-member-btn').addEventListener('click', () => {
            addMemberToGroup(groupId, user._id);
          });
        });
      });
  }, 300));
}

// Gọi hàm setup khi DOM sẵn sàng
document.addEventListener('DOMContentLoaded', () => {
  setupAddMemberSearch();
});

// Thêm sự kiện tìm kiếm
document.getElementById('add-member-input').addEventListener('input', debounce(function(e) {
  const term = e.target.value.trim();
  if (term.length < 2) {
    document.getElementById('add-member-results').innerHTML = '';
    return;
  }
  
  const groupId = document.getElementById('manage-group-sidebar').dataset.groupId;
  
  fetch(`/search_friends?q=${term}`)
    .then(response => response.json())
    .then(data => {
      const container = document.getElementById('add-member-results');
      container.innerHTML = '';
      
      data.results.forEach(user => {
        // Kiểm tra đã là thành viên chưa
        const isMember = Array.from(document.querySelectorAll('.group-member-item'))
          .some(el => el.querySelector('span').textContent === user.username);
        
        if (!isMember) {
          const userEl = document.createElement('div');
          userEl.className = 'search-result-item';
          userEl.innerHTML = `
            <img src="${user.avatar}" alt="${user.username}" class="avatar-small">
            <span>${user.username}</span>
            <button class="select-member-btn" data-user-id="${user._id}">
              Chọn
            </button>
          `;
          container.appendChild(userEl);
          
          userEl.querySelector('.select-member-btn').addEventListener('click', () => {
            addMemberToGroup(groupId, user._id);
            e.target.value = ''; // Xóa input
            container.innerHTML = ''; // Xóa kết quả
          });
        }
      });
    });
}, 300));
document.getElementById('cancel-create-group').addEventListener('click', function() {
  document.getElementById('create-group-modal').style.display = 'none';
});

// Hàm debounce
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}
document.addEventListener('DOMContentLoaded', () => {
  const manageBtn = document.getElementById("manage-group-button");
  const sidebar = document.getElementById("manage-group-sidebar");
  const overlay = document.getElementById("sidebar-overlay");

  if (manageBtn && sidebar && overlay) {
    manageBtn.addEventListener("click", () => {
      sidebar.classList.add('active');
      overlay.classList.add('show');
      // đảm bảo remove inline style nếu có
      sidebar.style.display = '';
      overlay.style.display = '';
    });
  }

  const closeBtn = document.getElementById("close-manage-sidebar");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      closeManageSidebar();
    });
  }

  // khi click overlay cũng đóng sidebar
  if (overlay) {
    overlay.addEventListener('click', closeManageSidebar);
  }
});

function closeManageSidebar() {
  const modal = document.getElementById('manage-group-sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (modal) {
    // xóa class active, và fallback về style
    modal.classList.remove('active');
    modal.style.display = ''; // reset nếu có style inline cũ
    delete modal.dataset.groupId;
  }
  if (overlay) {
    overlay.classList.remove('show');
    overlay.style.display = 'none';
  }
}
document.getElementById('save-group-name')?.addEventListener('click', async (e) => {
  e.preventDefault();
  const sidebar = document.getElementById('manage-group-sidebar');
  const groupId = sidebar?.dataset.groupId;
  const input = document.getElementById('edit-group-name');
  const newName = input?.value.trim();

  if (!groupId || !newName) {
    alert('Vui lòng nhập tên nhóm mới');
    return;
  }

  try {
    // Sử dụng socket.emit thay vì fetch
    socket.emit('update_group_name', {
      group_id: groupId,
      new_name: newName
    }, (response) => {
      if (response && response.ok) {
        // Cập nhật UI ngay lập tức
        const groupNameEl = document.querySelector(`.group-item[data-id="${groupId}"] .group-name`);
        if (groupNameEl) groupNameEl.textContent = newName;
        
        if (currentGroupId === groupId) {
          const headerH2 = document.querySelector('.chat-header h2');
          if (headerH2) headerH2.textContent = newName;
        }
        
        // Đóng sidebar sau khi cập nhật thành công
        closeManageSidebar();
      } else {
        alert(response.error || 'Đổi tên nhóm thất bại');
      }
    });
  } catch (err) {
    console.error('Lỗi đổi tên nhóm:', err);
    alert('Lỗi khi đổi tên nhóm');
  }
});
socket.on('group_avatar_updated', (data) => {
  console.log('[Socket] group_avatar_updated received:', data);

  const gid = String(data.group_id);

  // 1) Cập nhật trong danh sách groups (sidebar)
  addGroupToList(gid, null, data.new_avatar);

  // Xử lý cache bust cho avatar
  let displayAvatar = data.new_avatar;
  if (typeof displayAvatar === 'string' && displayAvatar.startsWith('http')) {
    displayAvatar += '?_=' + Date.now();
  }

  // 2) Nếu đang mở nhóm đó, cập nhật header avatar
  if (gid === String(currentGroupId)) {
    const headerImgEl = document.querySelector('.chat-header .group-avatar img');
    if (headerImgEl) {
      headerImgEl.src = displayAvatar;
    }

    // cập nhật trong modal quản lý nhóm nếu đang mở
    const modalImg = document.getElementById('group-avatar-img');
    if (modalImg) {
      modalImg.src = displayAvatar;
    }
  }

  // 3) Cập nhật trong danh sách nhóm (sidebar)
  const groupItem = document.querySelector(`.group-item[data-id="${gid}"] .group-avatar-img`);
  if (groupItem) {
    groupItem.src = displayAvatar;
  }
});
// Thêm vào cuối file group.js
window.openImageModal = function(imageUrl) {
  const modal = document.createElement('div');
  modal.className = 'image-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.8);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
    cursor: pointer;
  `;
  
  modal.innerHTML = `
    <img src="${imageUrl}" style="max-width: 90%; max-height: 90%; object-fit: contain;">
    <button style="position: absolute; top: 20px; right: 20px; background: #fff; border: none; border-radius: 50%; width: 40px; height: 40px; font-size: 20px; cursor: pointer;">×</button>
  `;
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.tagName === 'BUTTON') {
      document.body.removeChild(modal);
    }
  });
  
  document.body.appendChild(modal);
};
function handleGroupClick() {
  const groupId = this.dataset.id;
  const groupName = this.querySelector('.group-name').textContent;
  
  console.log(`[Group] Group clicked: ${groupId}`);
  
  // THÊM: Debounce - chống click nhiều lần
  if (this.classList.contains('clicked')) {
    console.log(`[Group] Group ${groupId} is already being processed, skipping...`);
    return;
  }
  
  this.classList.add('clicked');
  
  setTimeout(() => {
    this.classList.remove('clicked');
  }, 1000);
  
  openGroupChat(groupId, groupName);
}

// THÊM HÀM MỚI: Setup group click events một lần duy nhất
export function setupGroupClickEvents() {
  if (groupClickHandlerAttached) {
    console.log('[Group] Group click events already attached, skipping...');
    return;
  }
  
  // Sử dụng event delegation cho các group item mới được thêm sau này
  document.addEventListener('click', (e) => {
    const groupItem = e.target.closest('.group-item');
    if (groupItem) {
      const groupId = groupItem.dataset.id;
      const groupName = groupItem.querySelector('.group-name').textContent;
      
      // Debounce check
      if (groupItem.classList.contains('processing')) return;
      groupItem.classList.add('processing');
      
      setTimeout(() => {
        groupItem.classList.remove('processing');
      }, 500);
      
      openGroupChat(groupId, groupName);
    }
  });
  
  groupClickHandlerAttached = true;
  console.log('[Group] Group click events attached');
}
