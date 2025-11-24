import { enableReplyMode } from '../chat_input.js';

// Các biến cho logic Swipe (Vuốt)
let touchstartX = 0;
let touchstartY = 0;
let currentSwipingEl = null;
const SWIPE_THRESHOLD = 80; // Kéo 80px là kích hoạt

export function setupChatInteractions() {
    const chatContainer = document.querySelector('.chat-messages') || document.getElementById('messages');
    if (!chatContainer) return;

    // --- 1. XỬ LÝ CLICK NÚT REPLY (DESKTOP) ---
    // Dùng Event Delegation (gán sự kiện vào cha để bắt click của con)
    chatContainer.addEventListener('click', function(e) {
        // Tìm xem có click vào nút .message-action-btn (nút reply tròn) không
        const btn = e.target.closest('.message-action-btn');
        if (btn) {
            const messageEl = btn.closest('.message');
            triggerReply(messageEl);
        }
    });

    // --- 2. XỬ LÝ CLICK MENU MOBILE ---
    const mobileReplyBtn = document.getElementById('mob-reply');
    if (mobileReplyBtn) {
        mobileReplyBtn.addEventListener('click', () => {
            if (window.currentLongPressMessage) {
                triggerReply(window.currentLongPressMessage);
            }
            hideMobileMenu();
        });
    }

    // Đóng menu khi click overlay
    const overlay = document.getElementById('menu-overlay');
    if (overlay) overlay.addEventListener('click', hideMobileMenu);


    // --- 3. XỬ LÝ SWIPE TO REPLY (MOBILE) ---
   chatContainer.addEventListener('touchstart', function(e) {
    // hỗ trợ cả layout 1v1 (.message-content) và group (.message-content-wrapper / .message-bubble)
    const msgContent = e.target.closest('.message-content, .message-content-wrapper, .message-bubble');
    if (!msgContent) return;

    touchstartX = e.changedTouches[0].screenX;
    touchstartY = e.changedTouches[0].screenY;
    currentSwipingEl = msgContent;
    
    msgContent.classList.add('swiping');
}, { passive: true });



    chatContainer.addEventListener('touchmove', function(e) {
        if (!currentSwipingEl) return;

        const currentX = e.changedTouches[0].screenX;
        const diffX = currentX - touchstartX;
        const diffY = Math.abs(e.changedTouches[0].screenY - touchstartY);

        // Nếu người dùng đang cuộn dọc trang web -> Hủy logic vuốt ngang
        if (diffY > 30) return;

        // Chỉ cho phép kéo sang phải (hoặc trái tùy ý, ở đây giả lập Messenger kéo content sang phải)
        // Giới hạn max 100px
        if (diffX > 0 && diffX < 120) {
            // Chia 2 để tạo cảm giác "nặng" (kháng lực)
            currentSwipingEl.style.transform = `translateX(${diffX}px)`;
        }
    }, { passive: true });

    chatContainer.addEventListener('touchend', function(e) {
        if (!currentSwipingEl) return;

        const endX = e.changedTouches[0].screenX;
        const diffX = endX - touchstartX;

        // Bật lại transition để nó trượt về vị trí cũ mượt mà
        currentSwipingEl.classList.remove('swiping');
        currentSwipingEl.style.transform = 'translateX(0px)';

        // Nếu kéo đủ dài -> Kích hoạt Reply
        if (diffX > SWIPE_THRESHOLD) {
            // Rung phản hồi (nếu thiết bị hỗ trợ)
            if (navigator.vibrate) navigator.vibrate(50);
            
            const messageEl = currentSwipingEl.closest('.message');
            triggerReply(messageEl);
        }

        currentSwipingEl = null;
    });

    // --- 4. XỬ LÝ LONG PRESS (MOBILE) ---
    // (Tùy chọn: Nếu bạn muốn đè tin nhắn hiện menu như Zalo)
    let longPressTimer;
    chatContainer.addEventListener('touchstart', function(e) {
    if (e.target.closest('.message-content-wrapper') || e.target.closest('.message-bubble')) {
        window.currentLongPressMessage = e.target.closest('.message');
        longPressTimer = setTimeout(() => showMobileMenu(), 500);
    }
}, { passive: true });


    chatContainer.addEventListener('touchend', () => clearTimeout(longPressTimer));
    chatContainer.addEventListener('touchmove', () => clearTimeout(longPressTimer));
}

// --- HÀM HỖ TRỢ ---
function showMobileMenu() {
    document.getElementById('mobile-context-menu').classList.add('active');
    document.getElementById('menu-overlay').classList.add('active');
}

function hideMobileMenu() {
    document.getElementById('mobile-context-menu').classList.remove('active');
    document.getElementById('menu-overlay').classList.remove('active');
}

function triggerReply(messageEl) {
    if (!messageEl) return;
    
    // Ưu tiên data-id, fallback data-message-id
    const id = messageEl.dataset.id || messageEl.dataset.messageId;
    
    // Tìm tên người gửi
    let sender = "Người dùng";

    // Tin nhắn của mình
    if (messageEl.classList.contains('me') || messageEl.classList.contains('sent')) {
        sender = "Chính bạn";
    } else {
        const nameEl = messageEl.querySelector('.message-sender, .sender-name');
        if (nameEl) {
            sender = nameEl.innerText;
        } else if (messageEl.dataset.senderName) {
            sender = messageEl.dataset.senderName;
        }
    }

    // Nội dung text (support cả 1v1 & group)
    let content = "Đính kèm/Hình ảnh";
    const textEl = messageEl.querySelector('.message-text, .text, .file-name');
    if (textEl) {
        content = textEl.innerText;
    } else if (messageEl.querySelector('.uploaded-image')) {
        content = "[Hình ảnh]";
    } else if (messageEl.querySelector('.sticker')) {
        content = "[Sticker]";
    }

    // LƯU THÊM INFO VÀO .reply-preview để group.js đọc lại
    const preview = document.querySelector('.reply-preview');
    if (preview) {
        preview.dataset.messageId = id;
        preview.dataset.senderName = sender;
        preview.dataset.messageText = content;

        // nếu trong DOM có data-sender-id thì lưu luôn
        if (messageEl.dataset.senderId) {
            preview.dataset.senderId = messageEl.dataset.senderId;
        }
    }

    // Gọi logic hiện UI reply + state trong chat_input.js
    enableReplyMode(id, content, sender);
}
