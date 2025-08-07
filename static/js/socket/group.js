import { socket } from "./index.js";

// Biến toàn cục lưu trữ nhóm hiện tại đang mở
let currentGroupId = null;

export function setupGroupSocketEvents() {
  // Trong setupGroupSocketEvents
socket.on('user_left_group', (data) => {
  if (data.user_id === window.session.user_id) {
      // Nếu là chính mình rời nhóm
      if (currentGroupId === data.group_id) {
          currentGroupId = null;
          // Hiển thị màn hình chính
          document.querySelector('.chat-header h2').textContent = 'Messages';
          document.getElementById('animation-screen').style.display = 'flex';
      }
      // Xóa nhóm khỏi danh sách
      document.querySelector(`.group-item[data-id="${data.group_id}"]`)?.remove();
  } else {
      // Cập nhật giao diện nếu đang xem nhóm này
      if (currentGroupId === data.group_id) {
          openManageGroupModal(data.group_id); // Refresh modal
      }
  }
});
  // Cập nhật tên nhóm
  socket.on('group_name_updated', (data) => {
    if (data.group_id === currentGroupId) {
      document.querySelector('.chat-header h2').textContent = data.new_name;
      document.getElementById('manage-group-sidebar').style.display = 'none';
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
      
      // Nếu người dùng hiện tại bị xóa
      if (data.user_id === window.session.user_id) {
        currentGroupId = null;
        document.querySelector('.chat-header h2').textContent = 'Messages';
        document.getElementById('animation-screen').style.display = 'flex';
        document.getElementById('messages').style.display = 'none';
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

  // Bị xóa khỏi nhóm
  socket.on('group_removed', (groupId) => {
    console.log(`[Socket] Bạn đã bị xóa khỏi nhóm ${groupId}`);
    if (currentGroupId === groupId) {
      document.querySelector('.chat-header h2').textContent = 'Messages';
      currentGroupId = null;
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

export function addGroupToList(groupId, groupName) {
  // Kiểm tra xem nhóm đã tồn tại chưa
  if (document.querySelector(`.group-item[data-id="${groupId}"]`)) {
    return;
  }

  const groupsList = document.getElementById('groups-list');
  const groupElement = document.createElement('div');
  groupElement.className = 'group-item';
  groupElement.dataset.id = groupId;
  groupElement.innerHTML = `
    <div class="group-avatar">
      <i class="fi fi-rr-users-alt"></i>
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
  return avatarUrl || "{{ url_for('static', filename='img/default-avatar.png') }}";
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
    <i class="fi fi-rr-settings"></i>
  </button>
`;

  // Thêm sự kiện quản lý nhóm
  document.getElementById('manage-group-btn').addEventListener('click', () => {
    openManageGroupModal(groupId);
  });
  socket.emit('join_group', { group_id: groupId });

}
function openManageGroupModal(groupId) {
  const modal = document.getElementById('manage-group-sidebar');
  if (!modal) return;

  modal.dataset.groupId = groupId;

  fetch(`/group_info/${groupId}`)
    .then(response => response.json())
    .then(groupInfo => {
      // Sửa: Lấy role của người dùng hiện tại từ groupInfo
      const isAdmin = groupInfo.current_user_role === 'admin';
      const groupName = groupInfo.name;

      // Sửa: Hiển thị tên nhóm trong input
      document.getElementById('edit-group-name').value = groupName;

      // Hiển thị các phần chỉ dành cho admin
      document.getElementById('group-name-edit-section').style.display = isAdmin ? 'block' : 'none';
      document.getElementById('add-member-section').style.display = isAdmin ? 'block' : 'none';

      // Hiển thị danh sách thành viên
      const membersContainer = document.getElementById('group-members-list');
      membersContainer.innerHTML = '';

      groupInfo.members.forEach(member => {
        const memberEl = document.createElement('div');
        memberEl.className = 'group-member-item';

        const isMe = member._id === window.session.user_id;
        const isCreator = member.is_creator;

        let actionsHTML = '';

        // Hiển thị nút xóa nếu là admin
        if (isAdmin && !isMe && !isCreator) {
          actionsHTML += `
            <button class="remove-member-btn" data-user-id="${member._id}" title="Xoá thành viên">
            ❌
            </button>
          `;
        }

        // Hiển thị nút rời nhóm cho chính mình
        if (isMe) {
          actionsHTML += `
            <button class="leave-group-btn" data-group-id="${groupId}" title="Rời nhóm">
              🚪 Rời nhóm
            </button>
          `;
        }

        memberEl.innerHTML = `
          <img src="${member.avatar}" alt="${member.username}" class="member-avatar">
          <span>${member.username}</span>
          ${isCreator ? '<span class="creator-badge">(Chủ nhóm)</span>' : ''}
          ${actionsHTML}
        `;

        membersContainer.appendChild(memberEl);
      });

      // Gắn sự kiện xóa thành viên
      if (isAdmin) {
        membersContainer.querySelectorAll('.remove-member-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const userId = btn.dataset.userId;
            if (confirm('Bạn có chắc muốn xóa thành viên này khỏi nhóm?')) {
              removeGroupMember(groupId, userId);
            }
          });
        });
      }

      // Gắn sự kiện rời nhóm
      membersContainer.querySelectorAll('.leave-group-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          if (confirm('Bạn có chắc muốn rời nhóm này?')) {
            socket.emit('leave_group', {
              group_id: groupId
            });
            modal.style.display = 'none';
          }
        });
      });

      modal.style.display = 'block';
    })
    .catch(error => {
      console.error('Lỗi tải thông tin nhóm:', error);
      alert('Không thể tải thông tin nhóm');
    });
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
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('manage-group-btn')?.addEventListener('click', () => {
    openManageGroupModal(currentGroupId);
  });
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
// Gọi hàm setup trong DOMContentLoaded
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
  if (manageBtn) {
    manageBtn.addEventListener("click", () => {
      const sidebar = document.getElementById("manage-group-sidebar");
      if (sidebar) {
        sidebar.style.display = "block";
      }
    });
  }

  const closeBtn = document.getElementById("close-manage-sidebar");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      const sidebar = document.getElementById("manage-group-sidebar");
      if (sidebar) {
        sidebar.style.display = "none";
      }
    });
  }
});
