import { socket } from "./index.js";
import { setCurrentConversation } from '../chat_input.js';
import { setupChatInteractions } from './chat_interactions.js';

// --- DEFAULT AVATARS (fallback) ---
const defaultGroupAvatar = window.defaultGroupAvatar || '/static/img/default-group.png';
// ------------------------------------

let currentGroupId = null;
let groupClickHandlerAttached = false; 
let groupContextMenuAttached = false; 

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

  // [MỚI] Hiển thị thông báo nổi (Toast) khi có người Tham gia/Từ chối
  socket.on('call:notification', (data) => {
      // data.message ví dụ: "🔴 Nguyễn Văn A đã từ chối cuộc gọi"
      
      const toast = document.createElement('div');
      toast.textContent = data.message;
      toast.style.cssText = `
          position: fixed; bottom: 100px; left: 50%; transform: translateX(-50%);
          background: rgba(0, 0, 0, 0.8); color: white; padding: 10px 20px;
          border-radius: 30px; z-index: 10000; font-size: 14px;
          box-shadow: 0 4px 10px rgba(0,0,0,0.3);
          animation: fadeInOut 3s forwards;
          display: flex; align-items: center; gap: 8px;
      `;
      document.body.appendChild(toast);

      // Tự xóa sau 3s
      setTimeout(() => toast.remove(), 3000);
  });

  // [MỚI] Đổi trạng thái nút Gọi thành "Tham gia" nếu cuộc gọi đang diễn ra
  socket.on('call:status_update', (data) => {
      // Chỉ đổi nếu đang mở đúng nhóm đó
      if (currentGroupId && String(currentGroupId) === String(data.conversation_id)) {
          // Hàm updateCallButtonState cần được định nghĩa hoặc import trong group.js
          if (typeof updateCallButtonState === 'function') {
            updateCallButtonState(data.is_active);
          }
      }
  });

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
        if (typeof closeManageSidebar === 'function') closeManageSidebar();
      }
      document.querySelector(`.group-item[data-id="${data.group_id}"]`)?.remove();
    } else {
      if (currentGroupId === data.group_id) {
        if (typeof openManageGroupModal === 'function') openManageGroupModal(data.group_id); // refresh modal
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
      if (typeof openManageGroupModal === 'function') openManageGroupModal(data.group_id); // Làm mới modal
      alert(`Đã thêm thành viên mới: ${data.user_id}`);
    }
  });

  socket.on('group_member_removed', (data) => {
    if (data.group_id === currentGroupId) {
      const sidebar = document.getElementById('manage-group-sidebar');
      // Nếu modal đang mở, làm mới nó
      if (document.getElementById('manage-group-sidebar').style.display === 'block') {
         if (typeof openManageGroupModal === 'function') openManageGroupModal(data.group_id);
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
          if (typeof closeManageSidebar === 'function') closeManageSidebar();
        }
      
        // Xoá group khỏi sidebar (nếu còn)
        const removedEl = document.querySelector(`.group-item[data-id="${data.group_id}"]`);
        if (removedEl) removedEl.remove();
      }
    }
  });

  // Tin nhắn nhóm mới (Sự kiện cũ - Giữ nguyên để tương thích ngược)
    socket.on('group_message', (data) => {
    console.log('[Socket] Nhận tin nhắn nhóm (group_message):', data);

    const myId = window.session?.user_id;
    const isMyMessage = String(data.sender_id) === String(myId);
    const isCurrentGroup =
      currentGroupId && String(currentGroupId) === String(data.group_id);

    if (isCurrentGroup) {
      appendGroupMessage(data);
      return;
    }

    if (!isMyMessage && typeof window.showInAppNotification === 'function') {
      let groupName = 'Nhóm';
      const groupItem = document.querySelector(
        `.group-item[data-id="${data.group_id}"]`
      );
      if (groupItem) {
        const nameEl = groupItem.querySelector('.group-name');
        if (nameEl && nameEl.textContent.trim()) {
          groupName = nameEl.textContent.trim();
        }
      }

      const preview = getMessagePreview({
        content: data.content,
        message_type: data.message_type,
      });

      window.showInAppNotification({
        title: groupName,
        messagePreview: `${data.sender_name || 'Ai đó'}: ${preview}`,
        conversationId: data.group_id,
        conversationType: 'group',
      });
    }
  });


  // [QUAN TRỌNG - THÊM MỚI] Sự kiện receive_message chuẩn từ Backend cập nhật
   socket.on('receive_message', (data) => {
    // Dùng cho cả group và private, nên mình chỉ xử lý nếu là group
    const targetGroupId = data.group_id || data.conversation_id;
    const isGroupMessage = data.conversation_type === 'group' || !!data.group_id;

    if (!isGroupMessage) return;

    const myId = window.session?.user_id;
    const isMyMessage = String(data.sender_id) === String(myId);
    const isCurrentGroup =
      currentGroupId && String(currentGroupId) === String(targetGroupId);

    // 1. Nếu đang mở đúng group -> append như bình thường
    if (isCurrentGroup) {
      console.log('[Socket] Nhận tin nhắn nhóm (receive_message):', data);
      appendGroupMessage(data);
      return;
    }

    // 2. Nếu KHÔNG ở group đó và tin nhắn không phải của mình -> hiện notification
    if (!isMyMessage && typeof window.showInAppNotification === 'function') {
      // Lấy tên nhóm từ data hoặc từ sidebar
      let groupName = data.group_name || 'Nhóm';
      const groupItem = document.querySelector(
        `.group-item[data-id="${targetGroupId}"]`
      );
      if (groupItem) {
        const nameEl = groupItem.querySelector('.group-name');
        if (nameEl && nameEl.textContent.trim()) {
          groupName = nameEl.textContent.trim();
        }
      }

      // Lấy đoạn preview nội dung (tận dụng getMessagePreview đã viết ở cuối file)
      const preview = getMessagePreview({
        content: data.content,
        message_type: data.message_type,
      });

      window.showInAppNotification({
        title: groupName,
        messagePreview: `${data.sender_name || 'Ai đó'}: ${preview}`,
        conversationId: targetGroupId,
        conversationType: 'group',
      });
    }
  });


  // Nhóm mới được tạo
  socket.on('group_created', (group) => {
    console.log('[Socket] Nhóm mới được tạo:', group);
    // Đảm bảo hàm addGroupToList tồn tại
    if (typeof addGroupToList === 'function') {
        addGroupToList(group._id, group.name);
    }
  });

  socket.on('group_removed', (groupId) => {
    console.log(`[Socket] Bạn đã bị xóa khỏi nhóm ${groupId}`);
    if (currentGroupId === groupId) {
      document.querySelector('.chat-header h2').textContent = 'Messages';
      currentGroupId = null;
      // đóng sidebar/overlay nếu đang mở
      if (typeof closeManageSidebar === 'function') closeManageSidebar();
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
  
  // Nếu đang mở đúng group rồi thì thôi
  if (currentGroupId && String(currentGroupId) === String(groupId)) {
    console.log(`[Group] Group ${groupId} is already open, skipping...`);
    return;
  }
  
  // Reset chat cá nhân trước khi vào group
  resetPrivateChat();
  
  currentGroupId = groupId;
  
  // Set conversation cho file sharing
  if (typeof setCurrentConversation === 'function') {
    setCurrentConversation(groupId, 'group');
  }

  // UI: ẩn màn hình animation, show khung messages
  const header = document.querySelector('.chat-header');
  const animationScreen = document.getElementById('animation-screen');
  const messagesDiv = document.getElementById('messages');
  
  if (animationScreen) {
    animationScreen.style.display = 'none';
  }
  
  if (messagesDiv) {
    messagesDiv.style.display = 'block';
    messagesDiv.innerHTML = '<div class="loading">Đang tải tin nhắn...</div>';
  }

  // Header tạm thời
  if (header) {
    header.innerHTML = `
      <div class="group-header">
        <img src="${defaultGroupAvatar}" 
            alt="${groupName}" 
            class="group-avatar-small">
        <div class="group-name-wrap">
          <h2 title="${escapeHtml(groupName)}">${escapeHtml(groupName)}</h2>
        </div>
      </div>
      <button id="manage-group-btn" class="btn-manage" title="Quản lý nhóm">
        <i class="fi fi-br-bars-staggered"></i>
      </button>
    `;
    
    const manageBtn = document.getElementById('manage-group-btn');
    if (manageBtn) {
      manageBtn.addEventListener('click', () => {
        openManageGroupModal(groupId);
      });
    }
  }

  // Join group room
  console.log(`[Group] Joining group: ${groupId}`);
  socket.emit('join_group', { group_id: groupId });

  // Gắn context menu cho message group (chỉ 1 lần nhờ flag)
  setupGroupMessageContextMenu();

  // Load tin nhắn ghim 1 lần duy nhất
  console.log(`[Group] Loading pinned message for group: ${groupId}`);
  loadGroupPinnedMessage(groupId);

  // Load dữ liệu chi tiết (info + messages) tuần tự
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

function updateGroupHeader(groupId, groupName, groupInfo) {
    const header = document.querySelector('.chat-header');
    const avatarUrl = groupInfo.avatar || defaultGroupAvatar;
    
    // Cache bust avatar để tránh lưu cache cũ
    const displayAvatar = avatarUrl.startsWith('http') ? `${avatarUrl}?t=${Date.now()}` : avatarUrl;

    // 1. CẬP NHẬT HTML HEADER (Thêm nút id="btn-group-call")
    header.innerHTML = `
      <div class="group-header">
        <img src="${displayAvatar}" alt="${groupName}" class="group-avatar-small">
        <div class="group-name-wrap">
          <h2 title="${escapeHtml(groupName)}">${escapeHtml(groupName)}</h2>
          <span style="font-size: 0.8rem; color: #888;">${groupInfo.members ? groupInfo.members.length : 0} thành viên</span>
        </div>
      </div>
      
      <div class="header-actions" style="display: flex; gap: 10px; align-items: center;">
          <button id="btn-group-call" class="btn-icon" title="Gọi nhóm" style="font-size: 1.2rem; border:none; background:none; cursor:pointer; color: #555;">
            <i class="fas fa-video"></i>
          </button>

          <button id="manage-group-btn" class="btn-manage" title="Quản lý nhóm">
            <i class="fi fi-br-bars-staggered"></i>
          </button>
      </div>
    `;

    // 2. GẮN SỰ KIỆN CHO NÚT GỌI
    const btnCall = document.getElementById('btn-group-call');
    if (btnCall) {
        btnCall.addEventListener('click', () => {
            console.log("[Group] Bấm nút gọi nhóm:", groupId);

            // Gửi thông báo mời cho mọi người trong nhóm
            socket.emit('call:invite_group', { 
                conversation_id: groupId, 
                conversation_type: 'group' 
            });
            
            // Gọi hàm mở Overlay (Hàm này nằm bên file group_call.js và đã được gán vào window)
            if (window.startGroupCall) {
    window.startGroupCall(groupId, 'group');
} else {

                console.error("Lỗi: Không tìm thấy hàm window.startGroupCall. Hãy kiểm tra file group_call.js");
                alert("Chưa tải được chức năng gọi video.");
            }
        });
    }

    // 3. GẮN SỰ KIỆN NÚT QUẢN LÝ (Giữ nguyên logic cũ)
    const manageBtn = document.getElementById('manage-group-btn');
    if (manageBtn) {
        manageBtn.addEventListener('click', () => openManageGroupModal(groupId));
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
  
  // KHÔNG emit leave_group nữa, chỉ log nếu đổi nhóm
  if (currentGroupId && String(currentGroupId) !== String(groupId)) {
    console.log(`[Group] Switch from group ${currentGroupId} to ${groupId}`);
  }

  currentGroupId = groupId;
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
  
  // Chỉ gửi nếu đang ở group và có nội dung
  if (!content || !currentGroupId) {
    console.log('[Group] Cannot send message - no content or not in group');
    return;
  }

  // Nếu vẫn còn state private thì reset
  if (window.currentConversation) {
    console.log('[Group] Warning: Still in private conversation, resetting...');
    resetPrivateChat();
  }

  // LẤY REPLY CONTEXT TỪ .reply-preview (nếu đang reply)
  let reply_context = null;
  const preview = document.querySelector('.reply-preview');

  if (preview && !preview.classList.contains('hidden') && preview.dataset.messageId) {
    reply_context = {
      message_id: preview.dataset.messageId,
      sender_name: preview.dataset.senderName || null,
      sender_id: preview.dataset.senderId || null,
      content: preview.dataset.messageText || ''
    };
  }

  console.log('[Group] Sending message to group:', {
    group_id: currentGroupId,
    content,
    reply_context
  });

  socket.emit('send_group_message', {
    group_id: currentGroupId,
    content,
    reply_context // 👈 GỬI KÈM
  });

  // Clear input
  messageInput.value = '';

  // Nếu chat_input.js có hàm tắt reply mode thì gọi luôn (không có thì thôi, không sao)
  if (window.disableReplyMode) {
    window.disableReplyMode();
  }
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
  // Chỉ reset state phía client, KHÔNG báo server là rời nhóm
  currentGroupId = null;
}


function createGroupMessageElement(messageData) {
  // 0. Tin nhắn hệ thống
  if (messageData.message_type === 'system' || messageData.sender_id === 'system') {
    const div = document.createElement('div');
    div.className = 'system-message';
    div.style.cssText = 'text-align: center; margin: 15px 0; color: #888; font-size: 0.85rem; font-style: italic; background: rgba(0,0,0,0.05); padding: 5px; border-radius: 10px; width: fit-content; margin-left: auto; margin-right: auto;';
    div.innerHTML = `<span>${escapeHtml(messageData.content || '')}</span>`;
    return div;
  }

  const messageEl = document.createElement('div');
  const myId = window.session?.user_id;
  const isCurrentUser = String(messageData.sender_id) === String(myId);

  messageEl.className = isCurrentUser ? 'message sent' : 'message received';

  const msgId = messageData.message_id || messageData._id;
  messageEl.dataset.id = msgId;
  messageEl.dataset.messageId = msgId;
  messageEl.dataset.senderName = messageData.sender_name || '';
  messageEl.dataset.conversationType = 'group';

  const avatarSrc = messageData.sender_avatar || window.defaultUserAvatar || '/static/img/default-avatar.png';
  const timeString = formatTime(messageData.timestamp);

  // 1. XÁC ĐỊNH LOẠI NỘI DUNG
  let messageType = messageData.message_type || 'text';
  let parsedContent = messageData.content;

  if (typeof messageData.content === 'string') {
    const trimmed = messageData.content.trim();
    if (trimmed.startsWith('{')) {
      try {
        const test = JSON.parse(trimmed);
        if (test && (test.type === 'file' || test.type === 'image')) {
          messageType = test.type;
          parsedContent = test;
        }
      } catch (e) {
        messageType = 'text';
      }
    } else {
      const stickerCodes = ['sticker1','sticker2','sticker3','sticker4','sticker5','sticker6'];
      if (stickerCodes.includes(trimmed)) messageType = 'sticker';
    }
  }

  // 2. KHUNG TRÍCH DẪN (REPLY)
  let replyBlock = '';
  if (messageData.reply_context) {
    const isMyQuote = String(messageData.reply_context.sender_id) === String(myId);
    let quoteText = messageData.reply_context.content || '';

    try {
      if (typeof quoteText === 'string' && quoteText.trim().startsWith('{')) {
        const qObj = JSON.parse(quoteText);
        if (qObj.type === 'image') quoteText = '📷 [Hình ảnh]';
        else if (qObj.type === 'file') quoteText = `📎 [File] ${qObj.name || ''}`;
      } else {
        const stickerCodes = ['sticker1','sticker2','sticker3','sticker4','sticker5','sticker6'];
        if (stickerCodes.includes(quoteText)) {
          quoteText = '😊 [Sticker]';
        }
      }
    } catch (e) {}

    replyBlock = `
      <div class="message-reply-quote" onclick="window.scrollToMessage('${messageData.reply_context.message_id}')">
        <div class="reply-decoration"></div>
        <div class="reply-info">
          <div class="reply-sender">
            ${isMyQuote ? 'Chính bạn' : (messageData.reply_context.sender_name || 'Unknown')}
          </div>
          <div class="reply-text-short">
            ${escapeHtml(quoteText)}
          </div>
        </div>
      </div>
    `;
  }

  // 3. NỘI DUNG CHÍNH
  let messageContent = '';

  if (messageType === 'file') {
    const fileInfo = parsedContent || {};
    messageContent = `
      <div class="file-message">
        <div class="file-info">
          <div class="file-icon"><i class="fi fi-rr-file"></i></div>
          <div class="file-details">
            <div class="file-name">${escapeHtml(fileInfo.name || 'File')}</div>
            <div class="file-size">${formatFileSize(fileInfo.size || 0)}</div>
          </div>
        </div>
        <a href="${fileInfo.url || '#'}" class="file-download" download>
          Tải xuống
        </a>
      </div>
    `;
  } else if (messageType === 'image') {
    const imageInfo = parsedContent || {};
    messageContent = `
      <div class="image-message">
        <div class="image-info">
          <i class="fi fi-rr-picture"></i> ${escapeHtml(imageInfo.name || 'Hình ảnh')}
        </div>
        <img src="${imageInfo.thumbnail || imageInfo.url}" 
             class="uploaded-image" 
             alt="${escapeHtml(imageInfo.name || '')}"
             onclick="window.openImageModal && window.openImageModal('${imageInfo.url}')">
        <div class="image-actions">
          <a href="${imageInfo.url}" target="_blank" class="view-original">
            Xem ảnh gốc
          </a>
        </div>
      </div>
    `;
  } else if (messageType === 'sticker') {
    messageContent = `
      <div class="sticker-message">${getStickerHTML(messageData.content)}</div>
    `;
  } else {
    messageContent = `
      <div class="message-text">${escapeHtml(messageData.content || '')}</div>
    `;
  }

  // 4. LẮP RÁP HTML THEO CẤU TRÚC MỚI (CÓ .message-content + NÚT REPLY)
  messageEl.innerHTML = `
    ${!isCurrentUser ? `
      <img src="${avatarSrc}" alt="${messageData.sender_name || ''}" 
           class="message-avatar" title="${messageData.sender_name || ''}">
    ` : ''}

    <div class="message-content-container">
      ${!isCurrentUser ? `<div class="sender-info">${messageData.sender_name || ''}</div>` : ''}

      <div class="message-content-wrapper">
        <div class="message-content">
          <div class="message-bubble">
            ${replyBlock}
            ${messageContent}
          </div>
          <div class="message-status-container">
            <span class="message-time" title="${messageData.timestamp || ''}">
              ${timeString}
            </span>
          </div>
        </div>

        <div class="message-actions">
          <button class="message-action-btn reply-btn" title="Trả lời">
            <i class="fas fa-reply"></i>
          </button>
        </div>
      </div>
    </div>

    ${isCurrentUser ? `
      <img src="${avatarSrc}" alt="${messageData.sender_name || ''}" 
           class="message-avatar" title="${messageData.sender_name || ''}">
    ` : ''}
  `;

  messageEl.classList.add('message-item');
  return messageEl;
}


// ====== HÀM HIỂN THỊ TIN NHẮN NHÓM (ĐỒNG BỘ VỚI PRIVATE + SWIPE/REPLY) ======
function appendGroupMessage(messageData) {
  const messagesContainer = document.getElementById('messages');
  if (!messagesContainer) return;

  // Tin nhắn hệ thống
  if (messageData.message_type === 'system' || messageData.sender_id === 'system') {
    const systemEl = document.createElement('div');
    systemEl.className = 'system-message';
    systemEl.style.cssText = 'text-align: center; margin: 15px 0; color: #888; font-size: 0.85rem; font-style: italic; background: rgba(0,0,0,0.05); padding: 5px; border-radius: 10px; width: fit-content; margin-left: auto; margin-right: auto;';
    systemEl.innerHTML = `<span>${escapeHtml(messageData.content || '')}</span>`;
    messagesContainer.appendChild(systemEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return;
  }

  const messageEl = document.createElement('div');
  const myId = window.session?.user_id;
  const isCurrentUser = String(messageData.sender_id) === String(myId);

  messageEl.className = isCurrentUser ? 'message sent' : 'message received';

  const msgId = messageData.message_id || messageData._id;
  messageEl.dataset.id = msgId;
  messageEl.dataset.messageId = msgId;
  messageEl.dataset.senderName = messageData.sender_name || '';
  messageEl.dataset.conversationType = 'group';

  const avatarSrc = messageData.sender_avatar || window.defaultUserAvatar || '/static/img/default-avatar.png';
  const timeString = formatTime(messageData.timestamp);

  // 1. LOẠI NỘI DUNG
  let messageType = messageData.message_type || 'text';
  let parsedContent = messageData.content;

  if (typeof messageData.content === 'string') {
    const trimmed = messageData.content.trim();
    if (trimmed.startsWith('{')) {
      try {
        const test = JSON.parse(trimmed);
        if (test && (test.type === 'file' || test.type === 'image')) {
          messageType = test.type;
          parsedContent = test;
        }
      } catch (e) {
        messageType = 'text';
      }
    } else {
      const stickerCodes = ['sticker1','sticker2','sticker3','sticker4','sticker5','sticker6'];
      if (stickerCodes.includes(trimmed)) messageType = 'sticker';
    }
  }

  // 2. KHUNG TRÍCH DẪN (REPLY)
  let replyBlock = '';
  if (messageData.reply_context) {
    const isMyQuote = String(messageData.reply_context.sender_id) === String(myId);
    let quoteText = messageData.reply_context.content || '';

    try {
      if (typeof quoteText === 'string' && quoteText.trim().startsWith('{')) {
        const qObj = JSON.parse(quoteText);
        if (qObj.type === 'image') quoteText = '📷 [Hình ảnh]';
        else if (qObj.type === 'file') quoteText = `📎 [File] ${qObj.name || ''}`;
      } else {
        const stickerCodes = ['sticker1','sticker2','sticker3','sticker4','sticker5','sticker6'];
        if (stickerCodes.includes(quoteText)) {
          quoteText = '😊 [Sticker]';
        }
      }
    } catch (e) {}

    replyBlock = `
      <div class="message-reply-quote" onclick="window.scrollToMessage('${messageData.reply_context.message_id}')">
        <div class="reply-decoration"></div>
        <div class="reply-info">
          <div class="reply-sender">
            ${isMyQuote ? 'Chính bạn' : (messageData.reply_context.sender_name || 'Unknown')}
          </div>
          <div class="reply-text-short">
            ${escapeHtml(quoteText)}
          </div>
        </div>
      </div>
    `;
  }

  // 3. NỘI DUNG CHÍNH
  let messageContent = '';
  if (messageType === 'file') {
    const fileInfo = parsedContent || {};
    messageContent = `
      <div class="file-message">
        <div class="file-info">
          <div class="file-icon"><i class="fi fi-rr-file"></i></div>
          <div class="file-details">
            <div class="file-name">${escapeHtml(fileInfo.name || 'File')}</div>
            <div class="file-size">${formatFileSize(fileInfo.size || 0)}</div>
          </div>
        </div>
        <a href="${fileInfo.url || '#'}" class="file-download" download>
          Tải
        </a>
      </div>`;
  } else if (messageType === 'image') {
    const imageInfo = parsedContent || {};
    messageContent = `
      <div class="image-message">
        <div class="image-info"><i class="fi fi-rr-picture"></i> ${escapeHtml(imageInfo.name || 'Hình ảnh')}</div>
        <img src="${imageInfo.thumbnail || imageInfo.url}" 
             class="uploaded-image" 
             alt="${escapeHtml(imageInfo.name || '')}"
             onclick="window.openImageModal && window.openImageModal('${imageInfo.url}')">
        <div class="image-actions">
          <a href="${imageInfo.url}" target="_blank" class="view-original">
            Xem ảnh gốc
          </a>
        </div>
      </div>`;
  } else if (messageType === 'sticker') {
    messageContent = `<div class="sticker-message">${getStickerHTML(messageData.content)}</div>`;
  } else {
    messageContent = `<div class="message-text">${escapeHtml(messageData.content || '')}</div>`;
  }

  // 4. LẮP RÁP THEO CẤU TRÚC MỚI
  messageEl.innerHTML = `
    ${!isCurrentUser ? `
      <img src="${avatarSrc}" alt="${messageData.sender_name || ''}" 
           class="message-avatar" title="${messageData.sender_name || ''}">
    ` : ''}

    <div class="message-content-container">
      ${!isCurrentUser ? `<div class="sender-info">${messageData.sender_name || ''}</div>` : ''}

      <div class="message-content-wrapper">
        <div class="message-content">
          <div class="message-bubble">
            ${replyBlock}
            ${messageContent}
          </div>
          <div class="message-status-container">
            <span class="message-time" title="${messageData.timestamp || ''}">
              ${timeString}
            </span>
          </div>
        </div>

        <div class="message-actions">
          <button class="message-action-btn reply-btn" title="Trả lời">
            <i class="fas fa-reply"></i>
          </button>
        </div>
      </div>
    </div>

    ${isCurrentUser ? `
      <img src="${avatarSrc}" alt="${messageData.sender_name || ''}" 
           class="message-avatar" title="${messageData.sender_name || ''}">
    ` : ''}
  `;

  messageEl.classList.add('message-item');
  messagesContainer.appendChild(messageEl);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
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

/*document.getElementById('add-member-input').addEventListener('input', (e) => {
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
});*/


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

  addMemberInput.addEventListener('input', debounce(function(e) {
    const term = e.target.value.trim();
    if (term.length < 2) {
      const resultsEl = document.getElementById('add-member-results');
      if (resultsEl) resultsEl.innerHTML = '';
      return;
    }

    const sidebar = document.getElementById('manage-group-sidebar');
    const groupId = sidebar?.dataset.groupId;
    if (!groupId) return;
    
    fetch(`/search_friends?q=${term}`)
      .then(response => response.json())
      .then(data => {
        const container = document.getElementById('add-member-results');
        if (!container) return;

        container.innerHTML = '';
        
        data.results.forEach(user => {
          // kiểm tra đã là thành viên chưa (dùng class .member-username cho chắc)
          const isMember = Array.from(document.querySelectorAll('.group-member-item'))
            .some(el => el.querySelector('.member-username')?.textContent === user.username);
          
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
              addMemberInput.value = ''; // Xóa input
              container.innerHTML = '';  // Xóa kết quả
            });
          }
        });
      });
  }, 300));
}


// Gọi hàm setup khi DOM sẵn sàng
document.addEventListener('DOMContentLoaded', () => {
  setupAddMemberSearch();
});

// Thêm sự kiện tìm kiếm

document.getElementById('cancel-create-group')?.addEventListener('click', function() {
  const modal = document.getElementById('create-group-modal');
  if (modal) modal.style.display = 'none';
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
    const headerImgEl = document.querySelector('.chat-header .group-avatar-small');
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

// ====== PINNED MESSAGE FUNCTIONS FOR GROUP ======
let pinnedGroupMessage = null;

async function loadGroupPinnedMessage(groupId) {
  try {
    if (!groupId) {
      console.error('Group ID is required to load pinned message');
      hideGroupPinnedMessage();
      return;
    }
    
    const response = await fetch(`/get_pinned_message/${groupId}?type=group`);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.pinned_message) {
      console.log('Loaded pinned message for group:', data.pinned_message);
      pinnedGroupMessage = data.pinned_message;
      displayGroupPinnedMessage(pinnedGroupMessage);
    } else {
      console.log('No pinned message found for group');
      hideGroupPinnedMessage();
    }
  } catch (error) {
    console.error('Error loading pinned message for group:', error);
    hideGroupPinnedMessage();
  }
}
function displayGroupPinnedMessage(message) {
  let pinnedSection = document.getElementById('pinned-message-section');
  
  if (!pinnedSection) {
    pinnedSection = document.createElement('div');
    pinnedSection.id = 'pinned-message-section';
    pinnedSection.className = 'pinned-message-section';
    
    const messagesContainer = document.getElementById('messages');
    if (messagesContainer && messagesContainer.parentNode) {
      messagesContainer.parentNode.insertBefore(pinnedSection, messagesContainer);
    } else {
      console.error('Messages container not found');
      return;
    }
  }
  
  // SỬA: Đảm bảo message tồn tại trước khi sử dụng
  if (!message) {
    console.error('Pinned message is null or undefined');
    hideGroupPinnedMessage();
    return;
  }
  
  const previewText = getMessagePreview({
    content: message.content,
    message_type: message.message_type
  });
  
  // SỬA: Đảm bảo các thuộc tính tồn tại
  const senderAvatar = message.sender_avatar || window.defaultUserAvatar || '/static/img/default-avatar.png';
  const senderName = message.sender_name || 'Unknown';
  
  pinnedSection.innerHTML = `
    <div class="pinned-message-header">
      <i class="fi fi-rr-pin"></i>
      <span>Tin nhắn được ghim</span>
      <button class="unpin-btn" onclick="unpinGroupMessage()">
        <i class="fi fi-rr-cross"></i>
      </button>
    </div>
    <div class="pinned-message-content" onclick="scrollToGroupPinnedMessage('${message.message_id}')">
      <img src="${senderAvatar}" class="pinned-sender-avatar" alt="${senderName}">
      <div class="pinned-message-info">
        <div class="pinned-sender-name">${senderName}</div>
        <div class="pinned-message-text">${previewText}</div>
      </div>
    </div>
  `;
  
  pinnedSection.style.display = 'block';
  pinnedGroupMessage = message;
}
function hideGroupPinnedMessage() {
  const pinnedSection = document.getElementById('pinned-message-section');
  if (pinnedSection) {
    pinnedSection.style.display = 'none';
  }
  pinnedGroupMessage = null;
}

export async function pinGroupMessage(messageId) {
  if (!currentGroupId || !messageId) return;
  
  try {
    const response = await fetch('/pin_message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message_id: messageId,
        conversation_id: currentGroupId,
        conversation_type: 'group'
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      socket.emit('pin_message', {
        message_id: messageId,
        conversation_id: currentGroupId,
        conversation_type: 'group'
      });
      alert('Đã ghim tin nhắn');
    } else {
      alert('Lỗi khi ghim tin nhắn: ' + data.error);
    }
  } catch (error) {
    console.error('Error pinning group message:', error);
    alert('Lỗi khi ghim tin nhắn');
  }
}

export async function unpinGroupMessage() {
  if (!currentGroupId) return;
  
  try {
    const response = await fetch('/unpin_message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: currentGroupId,
        conversation_type: 'group'
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      socket.emit('unpin_message', {
        conversation_id: currentGroupId,
        conversation_type: 'group'
      });
      hideGroupPinnedMessage();
    } else {
      alert('Lỗi khi bỏ ghim: ' + data.error);
    }
  } catch (error) {
    console.error('Error unpinning group message:', error);
    alert('Lỗi khi bỏ ghim');
  }
}

// ====== MESSAGE EDIT/DELETE FUNCTIONS FOR GROUP ======
export async function editGroupMessage(messageId, newContent) {
  if (!messageId || !newContent) return;
  
  try {
    const response = await fetch('/edit_message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message_id: messageId,
        new_content: newContent,
        conversation_type: 'group'
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      socket.emit('message_edited', {
        message_id: messageId,
        conversation_id: currentGroupId,
        conversation_type: 'group',
        new_content: newContent
      });
      updateGroupMessageUI(messageId, newContent);
    } else {
      alert('Lỗi khi sửa tin nhắn: ' + data.error);
    }
  } catch (error) {
    console.error('Error editing group message:', error);
    alert('Lỗi khi sửa tin nhắn');
  }
}

export async function deleteGroupMessage(messageId) {
  if (!messageId) return;
  
  if (!confirm('Bạn có chắc muốn xóa tin nhắn này?')) return;
  
  try {
    const response = await fetch('/delete_message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message_id: messageId,
        conversation_type: 'group'
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      socket.emit('message_deleted', {
        message_id: messageId,
        conversation_id: currentGroupId,
        conversation_type: 'group'
      });
      removeGroupMessageUI(messageId);
    } else {
      alert('Lỗi khi xóa tin nhắn: ' + data.error);
    }
  } catch (error) {
    console.error('Error deleting group message:', error);
    alert('Lỗi khi xóa tin nhắn');
  }
}

function updateGroupMessageUI(messageId, newContent) {
  const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
  if (messageElement) {
    const messageText = messageElement.querySelector('.message-text');
    if (messageText) {
      messageText.innerHTML = escapeHtml(newContent) + ' <span class="edited-badge">(đã chỉnh sửa)</span>';
    }
  }
}

function removeGroupMessageUI(messageId) {
  const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
  if (messageElement) {
    messageElement.remove();
  }
}

export function setupGroupMessageContextMenu() {
  // Chỉ gắn listener 1 lần
  if (groupContextMenuAttached) {
    console.log('[Group Context Menu] Already attached, skipping...');
    return;
  }
  groupContextMenuAttached = true;
  console.log('[Group Context Menu] Setting up group message context menu...');

  // Right-click
  document.addEventListener('contextmenu', (e) => {
    // 👉 Không ở trong group thì bỏ qua, để chat private xử lý
    if (!currentGroupId) return;

    const messageElement = e.target.closest('.message');
    if (!messageElement || !messageElement.dataset.messageId) return;

    e.preventDefault();

    const messageId = messageElement.dataset.messageId;
    const isMyMessage = messageElement.classList.contains('sent');

    showGroupMessageContextMenu(e.clientX, e.clientY, messageId, isMyMessage);
  });

  // Ẩn menu khi click ra ngoài
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#message-context-menu')) {
      hideGroupMessageContextMenu();
    }
  });

  // Ẩn menu khi nhấn ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideGroupMessageContextMenu();
    }
  });
}


function showGroupMessageContextMenu(x, y, messageId, isMyMessage) {
  hideGroupMessageContextMenu();
  
  const contextMenu = document.createElement('div');
  contextMenu.id = 'message-context-menu';
  contextMenu.className = 'context-menu';
  contextMenu.style.cssText = `
    position: fixed;
    left: ${x}px;
    top: ${y}px;
    background: white;
    border: 1px solid #ddd;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 10000;
    min-width: 160px;
    padding: 4px 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;
  
  let menuItems = '';
  
  if (isMyMessage) {
    menuItems += `
      <div class="context-menu-item" data-action="edit" data-message-id="${messageId}">
        <i class="fi fi-rr-edit" style="margin-right: 8px;"></i>Sửa tin nhắn
      </div>
      <div class="context-menu-item" data-action="delete" data-message-id="${messageId}">
        <i class="fi fi-rr-trash" style="margin-right: 8px;"></i>Xóa tin nhắn
      </div>
      <div class="context-menu-divider"></div>
    `;
  }
  
  menuItems += `
    <div class="context-menu-item" data-action="pin" data-message-id="${messageId}">
      <i class="fi fi-rr-thumbtack" style="margin-right: 8px;"></i>Ghim tin nhắn
    </div>
  `;
  
  contextMenu.innerHTML = menuItems;
  document.body.appendChild(contextMenu);
  
  // Thêm event listeners cho các menu item
  contextMenu.querySelectorAll('.context-menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = item.dataset.action;
      const msgId = item.dataset.messageId;
      
      console.log('[Group Context Menu] Action clicked:', action, 'for message:', msgId);
      
      switch (action) {
        case 'edit':
          startEditGroupMessage(msgId);
          break;
        case 'delete':
          deleteGroupMessage(msgId);
          break;
        case 'pin':
          pinGroupMessage(msgId);
          break;
      }
      
      hideGroupMessageContextMenu();
    });
  });

  // Đảm bảo menu không vượt ra ngoài màn hình
  const rect = contextMenu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    contextMenu.style.left = (x - rect.width) + 'px';
  }
  if (rect.bottom > window.innerHeight) {
    contextMenu.style.top = (y - rect.height) + 'px';
  }
  
  console.log('[Group Context Menu] Context menu shown');
}

function hideGroupMessageContextMenu() {
  const existingMenu = document.getElementById('message-context-menu');
  if (existingMenu) {
    existingMenu.remove();
    console.log('[Group Context Menu] Context menu hidden');
  }
}

window.startEditGroupMessage = function(messageId) {
  console.log('[Group Context Menu] Starting edit for group message:', messageId);
  
  const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
  if (!messageElement) {
    console.error('[Group Context Menu] Message element not found for editing');
    return;
  }
  
  const messageText = messageElement.querySelector('.message-text');
  if (!messageText) {
    console.error('[Group Context Menu] Message text not found for editing');
    return;
  }
  
  // Lấy nội dung hiện tại (loại bỏ badge đã chỉnh sửa nếu có)
  let currentContent = messageText.textContent;
  if (currentContent.includes('(đã chỉnh sửa)')) {
    currentContent = currentContent.replace('(đã chỉnh sửa)', '').trim();
  }
  
  const newContent = prompt('Sửa tin nhắn:', currentContent);
  if (newContent && newContent !== currentContent) {
    console.log('[Group Context Menu] Editing message with new content:', newContent);
    editGroupMessage(messageId, newContent);
  } else {
    console.log('[Group Context Menu] Edit cancelled or no changes');
  }
  
  hideGroupMessageContextMenu();
};

// ====== SOCKET EVENT LISTENERS FOR GROUP ======
socket.on('message_pinned', (data) => {
  if (data.conversation_type === 'group' && data.conversation_id === currentGroupId) {
    loadGroupPinnedMessage(data.conversation_id);
  }
});

socket.on('message_unpinned', (data) => {
  if (data.conversation_type === 'group' && data.conversation_id === currentGroupId) {
    hideGroupPinnedMessage();
  }
});

socket.on('message_updated', (data) => {
  if (data.conversation_type === 'group' && data.conversation_id === currentGroupId) {
    updateGroupMessageUI(data.message_id, data.new_content);
  }
});

socket.on('message_removed', (data) => {
  if (data.conversation_type === 'group' && data.conversation_id === currentGroupId) {
    removeGroupMessageUI(data.message_id);
  }
});

// ====== SCROLL TO PINNED MESSAGE FOR GROUP ======
window.scrollToGroupPinnedMessage = function(messageId) {
  if (!messageId) return;
  
  console.log(`[Group Pinned Message] Scrolling to message: ${messageId}`);
  
  const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
  
  if (messageElement) {
    messageElement.scrollIntoView({ 
      behavior: 'smooth', 
      block: 'center' 
    });
    
    messageElement.classList.add('highlight-message');
    
    setTimeout(() => {
      messageElement.classList.remove('highlight-message');
    }, 3000);
  } else {
    console.log(`[Group Pinned Message] Message ${messageId} not found in current view`);
    loadGroupMessageAndScroll(messageId);
  }
};

async function loadGroupMessageAndScroll(messageId) {
  try {
    const response = await fetch(`/get_message/${messageId}`);
    const data = await response.json();
    
    if (data.success && data.message) {
      const message = data.message;
      
      if (message.group_id === currentGroupId) {
        alert(`Tin nhắn được ghim không nằm trong phạm vi hiện tại. Cần tải thêm tin nhắn.`);
      } else {
        console.warn(`[Group Pinned Message] Message ${messageId} does not belong to current group`);
        alert('Tin nhắn được ghim không thuộc nhóm hiện tại.');
      }
    } else {
      console.error(`[Group Pinned Message] Failed to load message ${messageId}:`, data.error);
      alert('Không thể tải tin nhắn được ghim.');
    }
  } catch (error) {
    console.error(`[Group Pinned Message] Error loading message ${messageId}:`, error);
    alert('Lỗi khi tải tin nhắn được ghim.');
  }
}
// ====== THÊM HÀM getMessagePreview VÀO group.js ======
function getMessagePreview(message) {
  if (!message || !message.content) return 'Bắt đầu trò chuyện';

  let messageType = message.message_type || 'text';
  let content = message.content;

  if (messageType === 'file') {
    try {
      const fileInfo = typeof content === 'string' ? JSON.parse(content) : content;
      const fileName = fileInfo.name || fileInfo.filename || 'File';
      return `📎 ${fileName}`;
    } catch (e) {
      console.error('Error parsing file preview:', e);
      return '📎 File';
    }
  } else if (messageType === 'image') {
    try {
      const imageInfo = typeof content === 'string' ? JSON.parse(content) : content;
      const imageName = imageInfo.name || imageInfo.filename || 'Hình ảnh';
      return `🖼️ ${imageName}`;
    } catch (e) {
      console.error('Error parsing image preview:', e);
      return '🖼️ Hình ảnh';
    }
  } else if (messageType === 'sticker') {
    return '😊 Sticker';
  } else {
    if (typeof content === 'string') {
      // Thử parse JSON để xem có phải file/image không
      if (content.trim().startsWith('{') && content.trim().endsWith('}')) {
        try {
          const data = JSON.parse(content);
          if (typeof data === 'object') {
            if (data.type === 'file') {
              const fileName = data.name || data.filename || 'File';
              return `📎 ${fileName}`;
            } else if (data.type === 'image') {
              const imageName = data.name || data.filename || 'Hình ảnh';
              return `🖼️ ${imageName}`;
            }
          }
        } catch (e) {
          // Continue as text
        }
      }
      
      // Kiểm tra sticker
      const stickerCodes = ['sticker1', 'sticker2', 'sticker3', 'sticker4', 'sticker5', 'sticker6'];
      if (stickerCodes.includes(content)) {
        return '😊 Sticker';
      }
    }
    
    let text = typeof content === 'string' ? content : String(content);
    text = text.replace('\r', ' ').replace('\n', ' ').trim();
    
    if (!text) return 'Bắt đầu trò chuyện';
    
    const max = 35;
    return text.length > max ? text.substring(0, max) + '...' : text;
  }
}
// ====== GLOBAL EXPORTS FOR GROUP ======
window.pinGroupMessage = pinGroupMessage;
window.unpinGroupMessage = unpinGroupMessage;
window.editGroupMessage = editGroupMessage;
window.deleteGroupMessage = deleteGroupMessage;
window.scrollToGroupPinnedMessage = scrollToGroupPinnedMessage;
// --- CÁC HÀM HỖ TRỢ GỌI VIDEO ---

// Hàm cập nhật giao diện nút gọi
function updateCallButtonState(isActive) {
    const btn = document.getElementById('btn-group-call');
    if (!btn) return;

    if (isActive) {
        // Trạng thái: Đang có cuộc gọi -> Hiển thị "Tham gia" xanh lá
        btn.innerHTML = '<i class="fi fi-rr-enter"></i> Tham gia';
        btn.style.cssText = `
            background-color: #2ecc71; color: white; border: none; 
            padding: 5px 15px; border-radius: 20px; font-size: 14px; cursor: pointer;
            display: flex; align-items: center; gap: 5px;
            animation: pulse-green 2s infinite;
        `;
        btn.title = "Đang có cuộc gọi diễn ra. Bấm để tham gia!";
    } else {
        // Trạng thái: Bình thường -> Hiển thị icon Camera
        btn.innerHTML = '<i class="fas fa-video"></i>';
        btn.style.cssText = "font-size: 1.2rem; border:none; background:none; cursor:pointer; color: #555;";
        btn.title = "Gọi nhóm";
    }
}

// Thêm Animation cho Toast và Nút tham gia (Inject CSS vào trang)
const styleCall = document.createElement('style');
styleCall.innerHTML = `
@keyframes fadeInOut {
    0% { opacity: 0; transform: translate(-50%, 20px); }
    10% { opacity: 1; transform: translate(-50%, 0); }
    90% { opacity: 1; transform: translate(-50%, 0); }
    100% { opacity: 0; transform: translate(-50%, -20px); }
}
@keyframes pulse-green {
    0% { box-shadow: 0 0 0 0 rgba(46, 204, 113, 0.7); }
    70% { box-shadow: 0 0 0 10px rgba(46, 204, 113, 0); }
    100% { box-shadow: 0 0 0 0 rgba(46, 204, 113, 0); }
}
`;
document.head.appendChild(styleCall);

// --- THÊM VÀO CUỐI FILE group.js ---

window.scrollToMessage = function(messageId) {
    console.log("Cuộn tới tin nhắn:", messageId);
    // Tìm tin nhắn theo data-id hoặc data-message-id
    const el = document.querySelector(`.message[data-id="${messageId}"]`) || 
               document.querySelector(`.message[data-message-id="${messageId}"]`);
    
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('highlight-message'); // CSS highlight sẽ làm nó nháy sáng
        setTimeout(() => el.classList.remove('highlight-message'), 2000);
    } else {
        console.warn("Không tìm thấy tin nhắn gốc (có thể chưa load lịch sử).");
    }
};