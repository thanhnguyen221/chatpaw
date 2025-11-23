import { socket } from "./index.js";
import { joinConversation } from './chat.js';
import { setCurrentConversation } from '../chat_input.js';

// --- HELPER: Xử lý Avatar an toàn ---
function getAvatarSrc(avatar) {
  if (!avatar) return '/static/img/default-avatar.png';
  if (avatar.startsWith('http') || avatar.startsWith('data:image')) {
    return avatar;
  }
  return avatar; 
}

// --- 1. SỰ KIỆN SOCKET ---
export function setupFriendEvents() {
  
  // Lời mời kết bạn
  socket.on('friend_request_sent', () => {
    // Có thể dùng Toast thay vì alert để đẹp hơn
    alert('✅ Đã gửi lời mời kết bạn thành công!');
  });

  socket.on('new_friend_request', (data) => {
    showFriendRequestNotification(data);
    fetchFriendRequests(); // Load lại danh sách
  });

  socket.on('friend_added', () => {
    console.log('[Friends] Bạn bè mới được thêm!');
    fetchFriends();        // Load lại danh bạ
    fetchFriendRequests(); // Load lại lời mời
  });

  // [QUAN TRỌNG] Cập nhật trạng thái Online/Offline
  // Backend gửi: emit('friend_online_status', {'user_id': ..., 'is_online': ...})
  socket.on('friend_online_status', (data) => {
    console.log('[Friends] Status update:', data);
    updateFriendStatusUI(data.user_id, data.is_online);
  });
  
  // Nhận danh sách online ban đầu (nếu có)
  socket.on('online_status_update', (onlineStatusMap) => {
    console.log('[Friends] Initial online status:', onlineStatusMap);
    for (const [userId, info] of Object.entries(onlineStatusMap)) {
        updateFriendStatusUI(userId, info.online);
    }
  });
}

// --- 2. HÀM CẬP NHẬT UI ONLINE/OFFLINE ---
export function updateFriendStatusUI(userId, isOnline) {
    // 1. Cập nhật trong Danh bạ (Tab Contacts)
    // Selector tìm theo data-user-id
    const contactEl = document.querySelector(`.contact-item[data-user-id="${userId}"]`);
    if (contactEl) {
        const statusEl = contactEl.querySelector('.contact-status');
        if (statusEl) {
            statusEl.innerHTML = isOnline ? '<span class="online-dot"></span>' : '';
        }
    }

    // 2. Cập nhật trong Danh sách hội thoại (Sidebar)
    // Lưu ý: Chúng ta cần tìm conversation item chứa ảnh/tên của user đó
    // Cách tốt nhất là tìm theo class conversation-item, sau đó check src ảnh hoặc thêm data-friend-id vào HTML
    // Ở đây ta sẽ tìm các conversation có data-last-message-sender hoặc logic tương tự nếu có
    
    // Tạm thời: Quét qua các conversation-item, nếu avatar trùng hoặc logic khác
    // Cách chính xác hơn: Cần Backend trả về friend_id trong data attribute của conversation-item.
    // Nếu bạn đã update template HTML để có data-friend-id thì dùng:
    // const convEl = document.querySelector(`.conversation-item[data-friend-id="${userId}"]`);
}

// --- 3. XỬ LÝ CLICK & TÌM KIẾM ---
export function setupContactClickEvents() {
  // Sử dụng Event Delegation cho cha để không phải gán lại sự kiện khi reload list
  const contactsContainer = document.getElementById('contacts');
  if (contactsContainer) {
      contactsContainer.addEventListener('click', async (e) => {
          const item = e.target.closest('.contact-item');
          if (item) {
              const friendId = item.dataset.userId;
              
              // Highlight active
              document.querySelectorAll('.contact-item').forEach(el => el.classList.remove('active'));
              item.classList.add('active');
              
              await openOrCreateConversation(friendId);
          }
      });
  }
}

export function setupSearchInput() {
  const searchInput = document.getElementById('search-friends');
  const resultsContainer = document.getElementById('search-results');

  if (!searchInput || !resultsContainer) return;

  searchInput.addEventListener('input', debounce(function() {
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
  }, 300));

  // Đóng search khi click ra ngoài
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#search-results') && !e.target.closest('#search-friends')) {
      resultsContainer.style.display = 'none';
    }
  });
}

function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

function renderUserResult(user) {
  const div = document.createElement('div');
  div.className = 'search-result';
  
  const avatarSrc = getAvatarSrc(user.avatar);
  const isFriend = user.is_friend;

  div.innerHTML = `
    <div class="user-info">
      <img src="${avatarSrc}" alt="${user.username}" class="avatar">
      <div>
        <div class="username">${user.username}</div>
        <div class="email">${user.email}</div>
      </div>
    </div>
    <div class="relationship">
      ${isFriend ? 
        `<button class="btn-action open-chat-btn">Nhắn tin</button>` : 
        `<button class="btn-action add-friend-btn">Kết bạn</button>`
      }
    </div>
  `;

  if (isFriend) {
      div.querySelector('.open-chat-btn').addEventListener('click', () => {
          openOrCreateConversation(user._id);
          document.getElementById('search-results').style.display = 'none';
          document.getElementById('search-friends').value = '';
      });
  } else {
      div.querySelector('.add-friend-btn').addEventListener('click', function() {
          socket.emit('send_friend_request', { recipient_id: user._id });
          this.parentElement.innerHTML = '<span class="request-sent">Đã gửi</span>';
      });
  }

  return div;
}

// --- 4. FETCH DATA ---
export function fetchFriends() {
  fetch('/get_friends')
    .then(res => res.json())
    .then(data => {
      const contactsContainer = document.getElementById('contacts');
      if (!contactsContainer) return;
      contactsContainer.innerHTML = '';

      data.friends.forEach(friend => {
        const contactEl = document.createElement('div');
        contactEl.className = 'contact-item';
        contactEl.dataset.userId = friend._id;

        const avatarSrc = getAvatarSrc(friend.avatar);
        // Nếu có online thì hiện dot
        const onlineHtml = friend.online ? '<span class="online-dot"></span>' : '';

        contactEl.innerHTML = `
          <img src="${avatarSrc}" alt="${friend.username}" class="contact-avatar">
          <div class="contact-info">
            <div class="contact-name">${friend.username}</div>
          </div>
          <div class="contact-status">${onlineHtml}</div>
        `;
        contactsContainer.appendChild(contactEl);
      });
      
      // Không cần gọi setupContactClickEvents lại vì đã dùng Event Delegation
    });
}

export function fetchFriendRequests() {
  fetch('/friend_requests')
    .then(res => res.json())
    .then(data => {
      const container = document.getElementById('friend-requests');
      if (!container) return;
      container.innerHTML = '';

      if (data.requests.length === 0) {
          container.innerHTML = '<div class="no-requests" style="padding:10px;color:#888;text-align:center">Không có lời mời nào</div>';
          return;
      }

      data.requests.forEach(req => {
        const reqEl = document.createElement('div');
        reqEl.className = 'friend-request-item'; // CSS class style.css
        
        // Tìm avatar (backend trả về req.sender_id nhưng cần avatar)
        // Tạm thời dùng default nếu API chưa trả avatar sender
        const avatarSrc = '/static/img/default-avatar.png'; 

        reqEl.innerHTML = `
          <div class="req-info">
             <strong>${req.username}</strong>
          </div>
          <div class="req-actions">
            <button class="btn-accept" data-id="${req.request_id}" data-sender="${req.sender_id}"><i class="fas fa-check"></i></button>
            <button class="btn-decline" data-id="${req.request_id}"><i class="fas fa-times"></i></button>
          </div>
        `;

        reqEl.querySelector('.btn-accept').addEventListener('click', function() {
            socket.emit('accept_friend_request', { request_id: this.dataset.id, sender_id: this.dataset.sender });
            reqEl.remove();
        });
        reqEl.querySelector('.btn-decline').addEventListener('click', function() {
            socket.emit('decline_friend_request', { request_id: this.dataset.id });
            reqEl.remove();
        });

        container.appendChild(reqEl);
      });
    });
}

function showFriendRequestNotification(data) {
    // Tạo toast notification đơn giản
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.style.cssText = `
        position: fixed; top: 20px; right: 20px; background: #fff;
        padding: 15px; border-radius: 8px; box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        z-index: 9999; display: flex; flex-direction: column; gap: 10px;
        border-left: 4px solid #3eb489; animation: slideIn 0.3s;
    `;
    
    toast.innerHTML = `
        <div><strong>${data.sender_name}</strong> muốn kết bạn!</div>
        <div style="display:flex; gap:10px; justify-content:flex-end;">
            <button id="toast-accept" style="background:#3eb489; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;">Đồng ý</button>
            <button id="toast-close" style="background:#eee; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;">Để sau</button>
        </div>
    `;
    
    document.body.appendChild(toast);
    
    toast.querySelector('#toast-accept').onclick = () => {
        socket.emit('accept_friend_request', { sender_id: data.sender_id, request_id: data.request_id });
        toast.remove();
    };
    toast.querySelector('#toast-close').onclick = () => toast.remove();
    
    // Tự tắt sau 10s
    setTimeout(() => { if(toast.parentNode) toast.remove(); }, 10000);
}

// --- 5. LOGIC CHUYỂN TRANG CHAT ---
export async function openOrCreateConversation(friendId) {
  try {
    const response = await fetch(`/get_or_create_conversation/${friendId}`);
    const data = await response.json();
    
    if (data.conversation_id) {
      // Set context cho chat_input
      if (typeof setCurrentConversation === 'function') {
        setCurrentConversation(data.conversation_id, 'private');
      }
      
      // Mở tab hội thoại và active nó
      // Giả lập click vào nút tab conversations
      const tabBtn = document.querySelector('button[data-tab="conversations"]');
      if(tabBtn) tabBtn.click();

      // Gọi hàm joinConversation từ chat.js (đã import)
      joinConversation(data.conversation_id);
    }
  } catch (err) {
    console.error('Lỗi mở hội thoại:', err);
  }
}