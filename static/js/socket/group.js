import { socket } from "./index.js";

// --- DEFAULT AVATARS (fallback) ---
const defaultGroupAvatar = window.defaultGroupAvatar || '/static/img/default-group.png';
// ------------------------------------

let currentGroupId = null;

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
        currentGroupId = null;
        document.querySelector('.chat-header h2').textContent = 'Messages';
        document.getElementById('animation-screen').style.display = 'flex';
        document.getElementById('messages').style.display = 'none';
        closeManageSidebar(); // <-- thêm
      }
    }
  });

  // Tin nhắn nhóm mới
  socket.on('group_message', (data) => {
    console.log('[Socket] Nhận tin nhắn nhóm:', data);
    if (currentGroupId === data.group_id) {
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
          if (confirm('Bạn có chắc muốn rời nhóm này?')) {
            socket.emit('leave_group', { group_id: groupId });
            closeManageSidebar();
          }
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
  // Kiểm tra xem nhóm đã tồn tại chưa
  const existingGroup = document.querySelector(`.group-item[data-id="${groupId}"]`);
  
  if (existingGroup) {
    // Cập nhật avatar và tên nếu nhóm đã tồn tại
    const avatarImg = existingGroup.querySelector('.group-avatar img');
    if (avatarImg) {
      avatarImg.src = avatarUrl || defaultGroupAvatar;
      avatarImg.alt = groupName;
    }
    
    const nameElement = existingGroup.querySelector('.group-name');
    if (nameElement) {
      nameElement.textContent = groupName;
    }
    return;
  }

  // Nếu chưa tồn tại, tạo nhóm mới
  const groupsList = document.getElementById('groups-list');
  const groupElement = document.createElement('div');
  groupElement.className = 'group-item';
  groupElement.dataset.id = groupId;
  groupElement.innerHTML = `
    <div class="group-avatar">
      <img src="${avatarUrl || defaultGroupAvatar}" 
           alt="${groupName}">
    </div>
    <div class="group-info">
      <div class="group-name">${groupName}</div>
    </div>
  `;
  
  groupElement.addEventListener('click', () => {
    openGroupChat(groupId, groupName);
  });
  
  groupsList.appendChild(groupElement);
}

export function setupGroupMessageSending() {
  const messageInput = document.getElementById('message');
  const sendButton = document.getElementById('send');

  function sendGroupMessage() {
    const content = messageInput.value.trim();
    if (!content || !currentGroupId) return;

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
  const messagesContainer = document.getElementById('messages');
  messagesContainer.innerHTML = '<div class="loading">Đang tải tin nhắn...</div>';
  
  fetch(`/group_message?group_id=${groupId}`)
    .then(response => {
      if (!response.ok) {
        throw new Error('Không thể tải tin nhắn nhóm');
      }
      return response.json();
    })
    .then(data => {
      messagesContainer.innerHTML = '';
      
      if (data.messages && data.messages.length > 0) {
        // SỬA: Gọi appendGroupMessage cho từng tin nhắn
        data.messages.forEach(msg => {
          appendGroupMessage(msg);
        });
      } else {
        messagesContainer.innerHTML = '<div class="no-messages">Chưa có tin nhắn nào trong nhóm</div>';
      }
      
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    })
    .catch(error => {
      console.error("Lỗi tải tin nhắn nhóm: ", error);
      messagesContainer.innerHTML = `<div class="error">${error.message}</div>`;
    });
}
function appendGroupMessage(msg) {
  const messagesContainer = document.getElementById('messages');
  const isMe = msg.sender_id === window.session.user_id;
  
  const messageElement = document.createElement('div');
  messageElement.className = `message ${isMe ? 'sent' : 'received'}`;
  
  // Sửa: Xử lý cả tin nhắn nhóm và cá nhân
  const senderName = isMe ? 'Bạn' : msg.sender_name;
  
  messageElement.innerHTML = `
    ${!isMe ? `<div class="sender-info">
        <img src="${getUserAvatar(msg.sender_id)}" class="avatar-small">
        <span class="sender-name">${senderName}</span>
      </div>` : ''}
    <div class="message-content">${msg.content}</div>
    <div class="message-time">
      ${formatTime(msg.timestamp)}
    </div>
  `;
  
  messagesContainer.appendChild(messageElement);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}
function getUserAvatar(userId, avatarUrl) {
  return url_for('static', filename='img/default-avatar.png');
}

export function openGroupChat(groupId, groupName) {
  currentGroupId = groupId;
  
  // Ẩn animation, hiển thị tin nhắn
  document.getElementById('animation-screen').style.display = 'none';
  document.getElementById('messages').style.display = 'block';
  
  // Cập nhật header
  const header = document.querySelector('.chat-header');
  header.innerHTML = `
  <h2>${groupName}</h2>
  <button id="manage-group-btn" class="btn-manage" title="Quản lý nhóm">
  <i class="fi fi-br-bars-staggered"></i>
  </button>
`;

  // Thêm sự kiện quản lý nhóm
  document.getElementById('manage-group-btn').addEventListener('click', () => {
    openManageGroupModal(groupId);
  });
  socket.emit('join_group', { group_id: groupId });

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

// Sửa hàm formatTime thành
function formatTime(dateString) {
  if (!dateString) return '';
  
  // Sử dụng moment từ đối tượng toàn cục
  const m = window.moment(dateString);
  
  if (!m.isValid()) return '';
  
  // Kiểm tra xem moment có hỗ trợ timezone không
  if (typeof m.tz === 'function') {
    return m.tz('Asia/Ho_Chi_Minh').format('HH:mm');
  } else {
    // Fallback nếu không có timezone
    return m.format('HH:mm');
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
  addGroupToList(data.group_id, null, data.new_avatar);
  if (data.group_id === currentGroupId) {
      // Cập nhật avatar trong header
      const headerImg = document.querySelector('.chat-header .group-avatar');
      if (headerImg) {
          headerImg.src = data.new_avatar;
      }
      
      // Cập nhật avatar trong sidebar
      const sidebarImg = document.querySelector(`.group-item[data-id="${data.group_id}"] .group-avatar img`);
      if (sidebarImg) {
          sidebarImg.src = data.new_avatar;
      }
      
      // Cập nhật trong modal nếu đang mở
      const modalImg = document.getElementById('group-avatar-img');
      if (modalImg) {
          modalImg.src = data.new_avatar;
      }
  }
});