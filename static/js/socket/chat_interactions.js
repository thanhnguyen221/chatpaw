import { socket } from './index.js';
import { enableReplyMode } from '../chat_input.js';

// --- CÁC BIẾN TOÀN CỤC ---
let touchstartX = 0;
let touchstartY = 0;
let currentSwipingEl = null;
const SWIPE_THRESHOLD = 80; 

let longPressTimer;
const LONG_PRESS_DURATION = 500; 

export function setupChatInteractions() {
    const chatContainer = document.querySelector('.chat-messages') || document.getElementById('messages');
    if (!chatContainer) return;

    // --- A. ĐÓNG POPUP KHI CLICK RA NGOÀI ---
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.reaction-popup') && !e.target.closest('.btn-react-trigger')) {
            closeAllReactionPopups();
        }
    });

    // --- B. XỬ LÝ CLICK NÚT REPLY ---
    chatContainer.addEventListener('click', function(e) {
        const btn = e.target.closest('.message-action-btn.reply-btn');
        if (btn) {
            const messageEl = btn.closest('.message');
            triggerReply(messageEl);
        }
    });

    // --- C. LẮNG NGHE SOCKET (CẬP NHẬT UI & SIDEBAR) ---
    socket.on('message_reaction_updated', (data) => {
        // 1. Cập nhật icon trên tin nhắn
        updateReactionUI(data);
        // 2. Cập nhật dòng chữ ở danh sách hội thoại
        updateSidebarPreview(data);
    });

    // --- D. XỬ LÝ CẢM ỨNG (MOBILE): SWIPE & LONG PRESS ---
    chatContainer.addEventListener('touchstart', function(e) {
        const wrapper = e.target.closest('.message-content-wrapper');
        const bubble = e.target.closest('.message-bubble'); 
        const swipeTarget = e.target.closest('.message-content, .message-content-wrapper, .message-bubble');
        
        if (!swipeTarget) return;

        touchstartX = e.changedTouches[0].screenX;
        touchstartY = e.changedTouches[0].screenY;
        currentSwipingEl = swipeTarget;
        currentSwipingEl.classList.add('swiping');

        // Long Press (Thả tim)
        if (wrapper || bubble) {
            longPressTimer = setTimeout(() => {
                if (navigator.vibrate) navigator.vibrate(50);
                window.showReactionPopup(wrapper || bubble.parentElement);
                currentSwipingEl = null; 
            }, LONG_PRESS_DURATION);
        }
    }, { passive: true });

    chatContainer.addEventListener('touchmove', function(e) {
        clearTimeout(longPressTimer);
        if (!currentSwipingEl) return;

        const currentX = e.changedTouches[0].screenX;
        const diffX = currentX - touchstartX;
        const diffY = Math.abs(e.changedTouches[0].screenY - touchstartY);

        if (diffY > 30) return; // Đang cuộn dọc

        // Kéo sang phải
        if (diffX > 0 && diffX < 120) {
            currentSwipingEl.style.transform = `translateX(${diffX}px)`;
        }
    }, { passive: true });

    chatContainer.addEventListener('touchend', function(e) {
        clearTimeout(longPressTimer);
        if (!currentSwipingEl) return;

        const endX = e.changedTouches[0].screenX;
        const diffX = endX - touchstartX;

        currentSwipingEl.classList.remove('swiping');
        currentSwipingEl.style.transform = 'translateX(0px)';

        if (diffX > SWIPE_THRESHOLD) {
            if (navigator.vibrate) navigator.vibrate(50);
            const messageEl = currentSwipingEl.closest('.message');
            triggerReply(messageEl);
        }
        currentSwipingEl = null;
    });
}

// ============================================================
// E. CÁC HÀM XỬ LÝ REACTION (GẮN VÀO WINDOW)
// ============================================================

// 1. Hiển thị Popup
window.showReactionPopup = function(wrapperElement) {
    closeAllReactionPopups(); 

    const messageEl = wrapperElement.closest('.message');
    if (!messageEl) return;

    const messageId = messageEl.dataset.id || messageEl.dataset.messageId;
    const convType = messageEl.dataset.conversationType || 'private';

    const popup = document.createElement('div');
    popup.className = 'reaction-popup';
    
    const emojis = ['❤️', '😆', '😮', '😢', '😡', '👍'];
    
    emojis.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'reaction-btn';
        btn.textContent = emoji;
        btn.onclick = (e) => {
            e.stopPropagation();
            sendReaction(messageId, emoji, convType);
            closeAllReactionPopups();
        };
        popup.appendChild(btn);
    });

    wrapperElement.appendChild(popup);
    requestAnimationFrame(() => popup.classList.add('show'));
};

function closeAllReactionPopups() {
    document.querySelectorAll('.reaction-popup').forEach(el => el.remove());
}

// 2. Gửi Socket
function sendReaction(messageId, emoji, type) {
    let convId = null;
    if (type === 'group') {
        convId = window.currentGroupId || (window.currentConversation && window.currentConversationType === 'group' ? window.currentConversation : null);
    } else {
        convId = window.currentConversation;
    }

    if (!messageId) return;

    socket.emit('react_message', {
        message_id: messageId,
        conversation_id: convId,
        conversation_type: type,
        emoji: emoji
    });
}

// 3. Cập nhật UI Tin nhắn (Vẽ icon tim)
function updateReactionUI(data) {
    const msgEl = document.querySelector(`.message[data-id="${data.message_id}"]`) || 
                  document.querySelector(`.message[data-message-id="${data.message_id}"]`);
    if (!msgEl) return;

    const bubble = msgEl.querySelector('.message-bubble');
    let reactContainer = bubble.querySelector('.message-reactions-display');

    if (data.action === 'removed') {
        if (reactContainer) reactContainer.remove();
        return;
    }

    if (!reactContainer) {
        reactContainer = document.createElement('div');
        reactContainer.className = 'message-reactions-display';
        
        // Gắn sự kiện click để xem chi tiết
        reactContainer.onclick = (e) => {
            window.viewReactionDetails(e, data.message_id, data.conversation_type);
        };
        
        bubble.appendChild(reactContainer);
    }

    // Hiển thị icon mới nhất (Đơn giản hóa)
    // Nếu muốn hiển thị số lượng: `${data.emoji} <span>1</span>`
    reactContainer.innerHTML = `${data.emoji}`;
    
    // Hiệu ứng nảy
    reactContainer.style.animation = 'none';
    reactContainer.offsetHeight; 
    reactContainer.style.animation = 'popInSmooth 0.3s ease';
}

// 4. Cập nhật Sidebar (Hiển thị "Đã thả cảm xúc...")
function updateSidebarPreview(data) {
    if (data.action === 'removed') return;

    const convItem = document.querySelector(`.conversation-item[data-id="${data.conversation_id}"]`);
    if (convItem) {
        const previewEl = convItem.querySelector('.conversation-preview');
        const timeEl = convItem.querySelector('.conversation-time');
        
        if (previewEl && data.preview_update) {
            // data.preview_update được server gửi về (VD: "Bạn: Đã thả ❤️")
            // Hoặc tự build text ở client nếu server chưa gửi
            const text = data.preview_update || `Đã thả cảm xúc ${data.emoji}`;
            
            previewEl.textContent = text;
            previewEl.style.fontWeight = 'bold';
            previewEl.style.color = '#333';
            
            if (timeEl) timeEl.textContent = 'Vừa xong';
            
            // Đẩy lên đầu
            const list = convItem.parentElement;
            list.prepend(convItem);
        }
    }
}

// ============================================================
// F. XEM CHI TIẾT NGƯỜI THẢ CẢM XÚC (MODAL)
// ============================================================

window.viewReactionDetails = function(event, messageId, conversationType) {
    if(event) event.stopPropagation();
    
    const modal = document.getElementById('reaction-details-modal');
    const container = document.getElementById('reaction-list-container');
    
    if (!modal || !container) return;
    
    modal.style.display = 'block';
    container.innerHTML = '<div style="padding:20px; text-align:center; color:#666;">Đang tải...</div>';
    
    // Gọi API lấy danh sách
    fetch(`/get_message_reactions/${messageId}?type=${conversationType}`)
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                renderReactionList(data.reactions, container);
            } else {
                container.innerHTML = '<div style="padding:20px; text-align:center;">Lỗi tải dữ liệu</div>';
            }
        })
        .catch(err => {
            console.error(err);
            container.innerHTML = '<div style="padding:20px; text-align:center;">Lỗi kết nối</div>';
        });
};

function renderReactionList(reactions, container) {
    if (!reactions || reactions.length === 0) {
        container.innerHTML = '<div style="padding:20px; text-align:center;">Chưa có cảm xúc nào</div>';
        return;
    }
    
    let html = '';
    reactions.forEach(user => {
        html += `
            <div class="reaction-user-item">
                <img src="${user.avatar}" class="reaction-user-avatar" alt="${user.username}">
                <div class="reaction-user-info">
                    <div class="reaction-user-name">${user.username}</div>
                </div>
                <div class="reaction-emoji-icon">${user.emoji}</div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// Logic đóng modal chi tiết
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('reaction-details-modal');
    const closeBtn = document.querySelector('.close-reaction-modal');
    
    if (closeBtn && modal) {
        closeBtn.onclick = () => modal.style.display = "none";
        window.addEventListener('click', (e) => {
            if (e.target == modal) modal.style.display = "none";
        });
    }
});

// ============================================================
// G. KÍCH HOẠT TRẢ LỜI (REPLY)
// ============================================================
function triggerReply(messageEl) {
    if (!messageEl) return;
    
    const id = messageEl.dataset.id || messageEl.dataset.messageId;
    let sender = "Người dùng";

    if (messageEl.classList.contains('me') || messageEl.classList.contains('sent')) {
        sender = "Chính bạn";
    } else {
        const nameEl = messageEl.querySelector('.sender-info') || messageEl.querySelector('.message-sender');
        if (nameEl) sender = nameEl.innerText;
        else if (messageEl.dataset.senderName) sender = messageEl.dataset.senderName;
    }

    let content = "Tin nhắn";
    if (messageEl.querySelector('.gift-wrap')) content = "🎁 Hộp quà";
    else if (messageEl.querySelector('.file-name')) content = `📎 ${messageEl.querySelector('.file-name').innerText}`;
    else if (messageEl.querySelector('.uploaded-image')) content = "📷 [Hình ảnh]";
    else if (messageEl.querySelector('.sticker')) content = "😊 [Sticker]";
    else if (messageEl.querySelector('.audio-message')) content = "🎤 [Tin nhắn thoại]";
    else {
        const textEl = messageEl.querySelector('.message-text');
        if (textEl) content = textEl.innerText;
    }

    const preview = document.querySelector('.reply-preview');
    if (preview) {
        preview.dataset.messageId = id;
        preview.dataset.senderName = sender;
        preview.dataset.messageText = content;
        if (messageEl.dataset.senderId) preview.dataset.senderId = messageEl.dataset.senderId;
    }

    enableReplyMode(id, content, sender);
}

// ============================================================
// F. XEM CHI TIẾT NGƯỜI THẢ CẢM XÚC (CÓ TAB VÀ SỐ LƯỢNG)
// ============================================================

window.viewReactionDetails = function(event, messageId, conversationType) {
    if(event) event.stopPropagation();
    
    const modal = document.getElementById('reaction-details-modal');
    const container = document.getElementById('reaction-list-container');
    const modalContent = document.querySelector('.modal-content.reaction-modal-content');

    if (!modal || !container || !modalContent) return;
    
    // 1. Xóa tab cũ nếu có trước khi mở modal mới
    const existingTabs = modalContent.querySelector('#reaction-tabs');
    if (existingTabs) existingTabs.remove();
    
    modal.style.display = 'block';
    container.innerHTML = '<div style="padding:20px; text-align:center; color:#666;">Đang tải...</div>';
    
    // 2. Gọi API lấy danh sách
    fetch(`/get_message_reactions/${messageId}?type=${conversationType}`)
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                renderReactionTabsAndUsers(data.reactions, container, modalContent);
            } else {
                container.innerHTML = '<div style="padding:20px; text-align:center;">Lỗi tải dữ liệu</div>';
            }
        })
        .catch(err => {
            console.error(err);
            container.innerHTML = '<div style="padding:20px; text-align:center;">Lỗi kết nối</div>';
        });
};

/**
 * Nhóm dữ liệu, tạo tab và render danh sách người dùng mặc định.
 */
function renderReactionTabsAndUsers(reactions, userListContainer, modalContent) {
    if (!reactions || reactions.length === 0) {
        userListContainer.innerHTML = '<div style="padding:20px; text-align:center;">Chưa có cảm xúc nào</div>';
        return;
    }

    // 1. Nhóm dữ liệu theo Emoji: {'❤️': [user1, user2], '😆': [user3]}
    const groupedReactions = reactions.reduce((acc, user) => {
        if (!acc[user.emoji]) {
            acc[user.emoji] = [];
        }
        acc[user.emoji].push(user);
        return acc;
    }, {});
    
    // 2. Tạo khung chứa Tabs
    const tabsContainer = document.createElement('div');
    tabsContainer.id = 'reaction-tabs';
    tabsContainer.className = 'reaction-tabs';

    let isFirst = true;
    for (const emoji in groupedReactions) {
        const users = groupedReactions[emoji];
        const tab = document.createElement('button');
        tab.className = 'reaction-tab' + (isFirst ? ' active' : '');
        tab.innerHTML = `${emoji} <span>${users.length}</span>`;
        tab.dataset.emoji = emoji;

        // Xử lý sự kiện click tab
        tab.onclick = () => {
            document.querySelectorAll('#reaction-tabs .reaction-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            renderUserList(users, userListContainer);
        };
        tabsContainer.appendChild(tab);
        
        // Mặc định hiện danh sách của tab đầu tiên
        if (isFirst) {
            renderUserList(users, userListContainer);
            isFirst = false;
        }
    }
    
    // 3. Chèn thanh tab vào Modal (sau header)
    const header = modalContent.querySelector('.reaction-modal-header');
    header.parentNode.insertBefore(tabsContainer, userListContainer);
}

/**
 * Render danh sách người dùng vào vùng chứa.
 */
function renderUserList(users, container) {
    if (!users || users.length === 0) {
        container.innerHTML = '<div style="padding:20px; text-align:center;">Không có người dùng nào</div>';
        return;
    }
    
    let html = '';
    users.forEach(user => {
        html += `
            <div class="reaction-user-item">
                <img src="${user.avatar}" class="reaction-user-avatar" alt="${user.username}">
                <div class="reaction-user-info">
                    <div class="reaction-user-name">${user.username}</div>
                </div>
                <div class="reaction-emoji-icon">${user.emoji}</div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// Logic đóng modal chi tiết
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('reaction-details-modal');
    const closeBtn = document.querySelector('.close-reaction-modal');
    
    if (closeBtn && modal) {
        closeBtn.onclick = () => modal.style.display = "none";
        window.addEventListener('click', (e) => {
            if (e.target == modal) modal.style.display = "none";
        });
    }
});