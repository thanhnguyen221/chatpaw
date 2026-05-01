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

      // Chuột phải để xem mini profile
      contactsContainer.addEventListener('contextmenu', (e) => {
          const item = e.target.closest('.contact-item');
          if (!item) return;
          e.preventDefault();
          const friendId = item.dataset.userId;
          if (window.openMiniProfile) {
              window.openMiniProfile(friendId);
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
      <img src="${avatarSrc}" alt="${user.full_name || user.username}" class="avatar">
      <div>
        <div class="username">${user.full_name || user.username}</div>
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
          <img src="${avatarSrc}" alt="${friend.full_name || friend.username}" class="contact-avatar">
          <div class="contact-info">
            <div class="contact-name">${friend.full_name || friend.username}</div>
          </div>
          <div class="contact-status">${onlineHtml}</div>
        `;
        contactsContainer.appendChild(contactEl);
      });
      
      // Không cần gọi setupContactClickEvents lại vì đã dùng Event Delegation
    });
}



/**
 * Xem trang cá nhân của người gửi lời mời (cho trang chat)
 */
function viewSenderProfile(senderId) {
  console.log('Viewing sender profile from chat:', senderId);
  
  // Mở tab mới để xem profile
  window.open(`/profile/${senderId}`, '_blank');
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
      return data.conversation_id;
    }
  } catch (err) {
    console.error('Lỗi mở hội thoại:', err);
  }
}
// Cho phép gọi từ các script khác (vd: mini profile popup)
window.openOrCreateConversation = openOrCreateConversation;

export function sendFriendRequest(recipientId) {
    if (recipientId) {
        socket.emit('send_friend_request', { recipient_id: recipientId });
    }
}
window.sendFriendRequest = sendFriendRequest;

// Thêm vào cuối friends.js
export function setupFriendRequestsPage() {
  console.log('[Friends] Setting up friend requests page...');
  
  // Override hàm fetchFriendRequests để cập nhật UI trang requests
  const originalFetchFriendRequests = fetchFriendRequests;
  
  window.fetchFriendRequests = async function() {
      try {
          const response = await fetch('/friend_requests');
          
          if (!response.ok) {
              throw new Error('Không thể tải danh sách lời mời');
          }
          
          const data = await response.json();
          
          // Nếu đang ở trang friend requests, cập nhật UI
          if (window.friendRequestsManager && typeof window.friendRequestsManager.displayRequests === 'function') {
              window.friendRequestsManager.displayRequests(data.requests);
          }
          
          // Vẫn giữ chức năng gốc cho chat page
          const container = document.getElementById('friend-requests');
          if (container) {
              if (data.requests.length === 0) {
                  container.innerHTML = '<div class="no-requests" style="padding:10px;color:#888;text-align:center">Không có lời mời nào</div>';
                  return;
              }

              container.innerHTML = '';
              data.requests.forEach(req => {
                  const reqEl = document.createElement('div');
                  reqEl.className = 'friend-request-item';
                  
                  reqEl.innerHTML = `
                      <div class="req-info">
                          <strong>${req.full_name || req.username}</strong>
                      </div>
                      <div class="req-actions">
                          <button class="btn-accept" data-id="${req.request_id}" data-sender="${req.sender_id}">
                              <i class="fas fa-check"></i>
                          </button>
                          <button class="btn-decline" data-id="${req.request_id}">
                              <i class="fas fa-times"></i>
                          </button>
                      </div>
                  `;

                  reqEl.querySelector('.btn-accept').addEventListener('click', function() {
                      socket.emit('accept_friend_request', { 
                          request_id: this.dataset.id, 
                          sender_id: this.dataset.sender 
                      });
                      reqEl.remove();
                  });
                  
                  reqEl.querySelector('.btn-decline').addEventListener('click', function() {
                      socket.emit('decline_friend_request', { request_id: this.dataset.id });
                      reqEl.remove();
                  });

                  container.appendChild(reqEl);
              });
          }
          
      } catch (error) {
          console.error('Error fetching friend requests:', error);
          
          // Thông báo lỗi cho cả hai trang
          if (window.friendRequestsManager) {
              window.friendRequestsManager.showError('Không thể tải danh sách lời mời');
          }
          
          const container = document.getElementById('friend-requests');
          if (container) {
              container.innerHTML = '<div class="error-state">Lỗi khi tải lời mời</div>';
          }
      }
  };
  
  return window.fetchFriendRequests;
}
function createRequestElement(request) {
  const div = document.createElement('div');
  div.className = 'request-item';
  
  const avatarSrc = request.avatar || '/static/img/default-avatar.png';
  const mutualFriends = request.mutual_friends || 0;
  const isOnline = request.is_online || false;
  
  div.innerHTML = `
      ${isOnline ? '<div class="online-indicator"></div>' : ''}
      <img src="${avatarSrc}" alt="${request.full_name || request.username}" class="request-avatar"
           onerror="this.src='/static/img/default-avatar.png'">
      <div class="request-info">
          <div class="request-name">${escapeHtml(request.full_name || request.username)}</div>
          <div class="request-meta">${request.email || 'Người dùng PAW TALK'}</div>
          ${mutualFriends > 0 ? `<div class="mutual-friends">${mutualFriends} bạn chung</div>` : ''}
      </div>
      <div class="request-actions">
          <button class="btn btn-primary" onclick="acceptRequest('${request.request_id}', '${request.sender_id}')">
              <i class="fas fa-check"></i> Đồng ý
          </button>
          <button class="btn btn-outline" onclick="declineRequest('${request.request_id}')">
              <i class="fas fa-times"></i> Từ chối
          </button>
      </div>
  `;

  return div;
}
// --- 6. CẬP NHẬT BADGE LỜI MỜI KẾT BẠN ---
export function updateFriendRequestsBadge(count) {
  // Cập nhật badge trong side navigation
  const navBadge = document.getElementById('friend-requests-nav-badge');
  if (navBadge) {
    if (count > 0) {
      navBadge.textContent = count;
      navBadge.style.display = 'flex';
    } else {
      navBadge.style.display = 'none';
    }
  }
  
  // Cập nhật badge trong chat page (nếu có)
  const chatBadge = document.getElementById('friend-requests-badge');
  if (chatBadge) {
    if (count > 0) {
      chatBadge.textContent = count;
      chatBadge.style.display = 'inline';
    } else {
      chatBadge.style.display = 'none';
    }
  }
}

// ✅ Chỉ còn 1 phiên bản fetchFriendRequests
export function fetchFriendRequests() {
  fetch('/friend_requests')
    .then(res => res.json())
    .then(data => {
      const container = document.getElementById('friend-requests');
      const requests = data.requests || [];

      // Cập nhật badge với số lượng thực tế
      updateFriendRequestsBadge(requests.length);

      if (!container) return;

      container.innerHTML = '';

      if (requests.length === 0) {
        container.innerHTML = `
          <div class="no-requests" style="padding:10px;color:#888;text-align:center">
            Không có lời mời nào
          </div>`;
        return;
      }

      requests.forEach(req => {
        const reqEl = document.createElement('div');
        reqEl.className = 'friend-request-item';
        
        const avatarSrc = req.avatar || '/static/img/default-avatar.png';
        
        reqEl.innerHTML = `
          <div class="req-avatar-container" onclick="viewSenderProfile('${req.sender_id}')" style="cursor: pointer;">
            <img src="${avatarSrc}" alt="${req.full_name || req.username}" class="req-avatar"
                 onerror="this.src='/static/img/default-avatar.png'">
          </div>
          <div class="req-info" onclick="viewSenderProfile('${req.sender_id}')" style="cursor: pointer; flex: 1;">
            <strong>${req.full_name || req.username}</strong>
            <div class="req-email">${req.email || ''}</div>
          </div>
          <div class="req-actions">
            <button class="btn-accept" data-id="${req.request_id}" data-sender="${req.sender_id}">
              <i class="fas fa-check"></i>
            </button>
            <button class="btn-decline" data-id="${req.request_id}">
              <i class="fas fa-times"></i>
            </button>
          </div>
        `;

        const acceptBtn = reqEl.querySelector('.btn-accept');
        const declineBtn = reqEl.querySelector('.btn-decline');

        acceptBtn.addEventListener('click', function () {
          socket.emit('accept_friend_request', { 
            request_id: this.dataset.id, 
            sender_id: this.dataset.sender 
          });
          // Xóa khỏi UI rồi reload lại list + badge cho chắc
          reqEl.remove();
          fetchFriendRequests();
        });

        declineBtn.addEventListener('click', function () {
          socket.emit('decline_friend_request', { request_id: this.dataset.id });
          reqEl.remove();
          fetchFriendRequests();
        });

        container.appendChild(reqEl);
      });

      // Nếu có trang quản lý riêng (friend_requests_page) thì cập nhật luôn
      if (window.friendRequestsManager && 
          typeof window.friendRequestsManager.displayRequests === 'function') {
        window.friendRequestsManager.displayRequests(requests);
      }
    })
    .catch(err => {
      console.error('Error fetching friend requests:', err);

      const container = document.getElementById('friend-requests');
      if (container) {
        container.innerHTML = `
          <div class="error-state" style="padding:10px;color:#e74c3c;text-align:center">
            Lỗi khi tải lời mời
          </div>`;
      }

      if (window.friendRequestsManager && 
          typeof window.friendRequestsManager.showError === 'function') {
        window.friendRequestsManager.showError('Không thể tải danh sách lời mời');
      }
    });
}

// Giữ dòng này ở cuối file để dùng được onclick trong HTML
window.viewSenderProfile = viewSenderProfile;
