import { socket } from "./index.js";

function getAvatarSrc(avatar) {
  if (!avatar) return '/static/img/default-avatar.png';
  
  if (avatar.startsWith('http')) {
    return avatar;
  }
  
  // Bỏ kiểm tra độ dài base64
  if (avatar.startsWith('data:image')) {
    return avatar;
  }
  
  return avatar; // Trả về nguyên giá trị vì server đã xử lý
}

export function setupFriendEvents() {
  socket.on('friend_request_sent', () => {
    alert('✅ Đã gửi lời mời kết bạn thành công!');
  });

  socket.on('new_friend_request', (data) => {
    showFriendRequestNotification(data);
    fetchFriendRequests();
  });

  socket.on('friend_added', () => {
    console.log('Bạn bè mới được thêm!');
    fetchFriends();
    fetchFriendRequests();
  });
}

export function setupContactClickEvents() {
  document.querySelectorAll('.contact-item').forEach(item => {
    item.addEventListener('click', async () => {
      const friendId = item.dataset.userId;
      await openOrCreateConversation(friendId);
    });
  });
}

export function setupSearchInput() {
  const searchInput = document.getElementById('search-friends');
  const resultsContainer = document.getElementById('search-results');

  searchInput.addEventListener('input', function() {
    const searchTerm = this.value.trim();
    if (searchTerm.length < 2) {
      resultsContainer.style.display = 'none';
      return;
    }

    fetch(`/search_friends?q=${encodeURIComponent(searchTerm)}`)
      .then(res => res.json())
      .then(data => {
        resultsContainer.innerHTML = '';

        if (data.results.length === 0) {
          resultsContainer.innerHTML = '<div class="no-results">Không tìm thấy kết quả</div>';
        } else {
          data.results.forEach(user => {
            resultsContainer.appendChild(renderUserResult(user));
          });
        }

        resultsContainer.style.display = 'block';
      });
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#search-results') && !e.target.closest('#search-friends')) {
      resultsContainer.style.display = 'none';
    }
  });
}
function renderUserResult(user) {
  const div = document.createElement('div');
  div.className = 'search-result';
  div.dataset.id = user._id;

  // ✅ Dùng lại hàm getAvatarSrc
  const avatarSrc = getAvatarSrc(user.avatar);

  div.innerHTML = `
    <div class="user-info">
      <img src="${avatarSrc}" alt="${user.username}" class="avatar">
      <div>
        <div>
          <span class="username">${user.username}</span>
          ${user.online ? '<span class="online-dot"></span>' : ''}
        </div>
        <div class="email">${user.email}</div>
      </div>
    </div>
    <div class="relationship">
      ${user.is_friend ? '<span class="friend-badge">Bạn bè</span>' : '<button class="add-friend">Kết bạn</button>'}
    </div>
  `;

  if (!user.is_friend) {
    div.querySelector('.add-friend').addEventListener('click', () => {
      socket.emit('send_friend_request', { recipient_id: user._id });
      div.querySelector('.relationship').innerHTML = '<span class="request-sent">Đã gửi lời mời</span>';
    });
  }

  return div;
}

export function fetchFriends() {
  fetch('/get_friends')
    .then(res => res.json())
    .then(data => {
      const contactsContainer = document.getElementById('contacts');
      if (!contactsContainer) return;
      contactsContainer.innerHTML = '';

      data.friends.forEach(friend => {
        const contactEl = document.createElement('div');
        contactEl.className = 'contact';
        contactEl.dataset.id = friend._id;

        const avatarSrc = getAvatarSrc(friend.avatar); // ✅ dùng hàm getAvatarSrc

        contactEl.innerHTML = `
          <img 
            src="${avatarSrc}" 
            alt="${friend.username}" 
            class="contact-avatar">
          <div class="contact-info">
            <div class="contact-name">${friend.username}</div>
          </div>
          <div class="contact-status">
            ${friend.online ? '<span class="online-dot"></span>' : ''}
          </div>
        `;

        contactEl.addEventListener('click', () => {
          socket.emit('start_conversation', { recipient_id: friend._id });
        });

        contactsContainer.appendChild(contactEl);
      });
    });
}
export function fetchFriendRequests() {
  fetch('/friend_requests')
    .then(res => res.json())
    .then(data => {
      const container = document.getElementById('friend-requests');
      container.innerHTML = '';

      data.requests.forEach(req => {
        const reqEl = document.createElement('div');
        reqEl.className = 'friend-request';

        // ✅ Lấy avatar thật của người gửi (req.avatar hoặc req.sender.avatar)
        const avatarSrc = getAvatarSrc(req.avatar || (req.sender && req.sender.avatar));

        reqEl.innerHTML = `
          <div class="friend-request-info">
            <img src="${avatarSrc}" alt="${req.username}" class="avatar">
            <div>
              <strong>${req.username}</strong> (${req.email})
            </div>
          </div>
          <div class="friend-request-actions">
            <button class="accept-friend" data-request="${req.request_id}" data-sender="${req.sender_id}">
              <i class="fi fi-ss-check-circle"></i>
            </button>
            <button class="decline-friend" data-request="${req.request_id}">
              <i class="fi fi-ss-cross-circle"></i>
            </button>
          </div>
        `;

        reqEl.querySelector('.accept-friend').addEventListener('click', function() {
          const requestId = this.dataset.request;
          const senderId = this.dataset.sender;
          socket.emit('accept_friend_request', { request_id: requestId, sender_id: senderId });
          reqEl.remove();
        });

        reqEl.querySelector('.decline-friend').addEventListener('click', function() {
          const requestId = this.dataset.request;
          socket.emit('decline_friend_request', { request_id: requestId });
          reqEl.remove();
        });

        container.appendChild(reqEl);
      });
    });
}

function showFriendRequestNotification(data) {
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.innerHTML = `
    <strong>${data.sender_name}</strong> muốn kết bạn với bạn
    <button class="accept-friend" data-sender="${data.sender_id}" data-request="${data.request_id}">Chấp nhận</button>
    <button class="close-notification">Đóng</button>
  `;

  notification.querySelector('.accept-friend').addEventListener('click', function() {
    const senderId = this.dataset.sender;
    const requestId = this.dataset.request;
    socket.emit('accept_friend_request', { sender_id: senderId, request_id: requestId });
    notification.remove();
  });

  notification.querySelector('.close-notification').addEventListener('click', () => {
    notification.remove();
  });

  document.body.appendChild(notification);
}

socket.on('connect', () => {
  const userId = document.querySelector('.user-avatar').dataset.userId;
  socket.emit('user_online', { userId });
});

socket.on('user_status', ({ userId, online }) => {
  // Cập nhật trong danh sách bạn bè
  const contact = document.querySelector(`.contact[data-id="${userId}"]`);
  if (contact) {
    const statusDiv = contact.querySelector('.contact-status');
    if (online) {
      if (!statusDiv.querySelector('.online-dot')) {
        statusDiv.innerHTML = '<span class="online-dot"></span>';
      }
    } else {
      statusDiv.innerHTML = '';
    }
  }

  // Cập nhật trong danh sách hội thoại
  const conversationItem = document.querySelector(`.conversation-item[data-friend-id="${userId}"]`);
  if (conversationItem) {
    const statusDiv = conversationItem.querySelector('.conversation-status');
    if (online) {
      if (!statusDiv.querySelector('.online-dot')) {
        statusDiv.innerHTML = '<div class="online-dot"></div>';
      }
    } else {
      statusDiv.innerHTML = '';
    }
  }
});
export async function openOrCreateConversation(friendId) {
  try {
    const response = await fetch(`/get_or_create_conversation/${friendId}`);
    const data = await response.json();
    
    if (data.conversation_id) {
      // Lấy tên bạn
      const friendItem = document.querySelector(`.contact-item[data-user-id="${friendId}"]`);
      const friendName = friendItem?.querySelector('.contact-name')?.textContent || 'Bạn bè';
      
      // Thêm vào danh sách hội thoại
      addNewConversation(data.conversation_id, friendName);
      
      // Mở hội thoại
      document.getElementById('animation-screen')?.classList.add('hidden');
      joinConversation(data.conversation_id);
    }
  } catch (err) {
    console.error('Lỗi khi tạo hội thoại:', err);
  }
}

export function addNewConversation(conversationId, friendName) {
  const conversationsEl = document.getElementById('conversations');
  
  // Kiểm tra xem đã tồn tại chưa
  if (document.querySelector(`.conversation-item[data-id="${conversationId}"]`)) {
    return;
  }

  const convEl = document.createElement('div');
  convEl.className = 'conversation-item';
  convEl.dataset.id = conversationId;
  convEl.innerHTML = `
    <div class="conversation-avatar">
      <img src="" alt="${friendName}" class="friend-avatar">
    </div>
    <div class="conversation-info">
      <div class="conversation-name">${friendName}</div>
      <div class="conversation-time">Vừa xong</div>
    </div>
  `;
  
  convEl.addEventListener('click', () => joinConversation(conversationId));
  conversationsEl.prepend(convEl);
}