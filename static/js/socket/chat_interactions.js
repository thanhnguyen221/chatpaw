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

    // --- B. XỬ LÝ CÁC NÚT TRÊN TIN NHẮN (REPLY & TRANSLATE) ---
    chatContainer.addEventListener('click', function(e) {
        // 1. Nút Trả lời (Reply)
        const replyBtn = e.target.closest('.reply-btn'); // Class nút reply
        if (replyBtn) {
            const messageEl = replyBtn.closest('.message');
            triggerReply(messageEl);
            return;
        }

        // 2. 🔥 [MỚI] Nút Dịch thuật (Translate)
        const transBtn = e.target.closest('.btn-translate');
        if (transBtn) {
            // Hiệu ứng click nhẹ
            transBtn.style.transform = 'scale(0.9)';
            setTimeout(() => transBtn.style.transform = 'scale(1)', 150);

            const messageEl = transBtn.closest('.message');
            const messageId = messageEl.dataset.id || messageEl.dataset.messageId;
            requestTranslateMessage(messageId);
            return;
        }
        
        // 3. Nút Thả tim (nếu có nút kích hoạt riêng)
        const reactTrigger = e.target.closest('.btn-react-trigger');
        if (reactTrigger) {
            window.showReactionPopup(reactTrigger.parentElement);
        }
    });

    

    // --- C. LẮNG NGHE SOCKET ---
    socket.on('message_reaction_updated', (data) => {
        updateReactionUI(data);
        updateSidebarPreview(data);
    });

    // 🔥 Lắng nghe kết quả dịch
    if (!socket.hasListeners('message_translated')) {
        socket.on('message_translated', (data) => {
            handleTranslateResult(data);
        });
    }

    // --- D. XỬ LÝ CẢM ỨNG (SWIPE & LONG PRESS) ---
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

        if (diffY > 30) return; 

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
// LOGIC REACTION (GIỮ NGUYÊN)
// ============================================================

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
        reactContainer.onclick = (e) => {
            window.viewReactionDetails(e, data.message_id, data.conversation_type);
        };
        bubble.appendChild(reactContainer);
    }
    reactContainer.innerHTML = `${data.emoji}`;
    reactContainer.style.animation = 'none';
    reactContainer.offsetHeight; 
    reactContainer.style.animation = 'popInSmooth 0.3s ease';
}

function updateSidebarPreview(data) {
    if (data.action === 'removed') return;
    const convItem = document.querySelector(`.conversation-item[data-id="${data.conversation_id}"]`);
    if (convItem) {
        const previewEl = convItem.querySelector('.conversation-preview');
        const timeEl = convItem.querySelector('.conversation-time');
        
        if (previewEl && data.preview_update) {
            const text = data.preview_update || `Đã thả cảm xúc ${data.emoji}`;
            previewEl.textContent = text;
            previewEl.style.fontWeight = 'bold';
            previewEl.style.color = '#333';
            if (timeEl) timeEl.textContent = 'Vừa xong';
            const list = convItem.parentElement;
            list.prepend(convItem);
        }
    }
}

window.viewReactionDetails = function(event, messageId, conversationType) {
    if(event) event.stopPropagation();
    const modal = document.getElementById('reaction-details-modal');
    const container = document.getElementById('reaction-list-container');
    const modalContent = document.querySelector('.modal-content.reaction-modal-content');

    if (!modal || !container || !modalContent) return;
    
    const headerTitle = modalContent.querySelector('.reaction-modal-header div') || 
                        modalContent.querySelector('.reaction-modal-header h3'); 
    if (headerTitle) headerTitle.textContent = "Cảm xúc tin nhắn";

    const existingTabs = modalContent.querySelector('#reaction-tabs');
    if (existingTabs) existingTabs.remove();
    
    modal.style.display = 'flex';
    container.innerHTML = '<div style="padding:20px; text-align:center; color:#666;">Đang tải...</div>';
    
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
            container.innerHTML = '<div style="padding:20px; text-align:center;">Lỗi kết nối</div>';
        });
};

function renderReactionTabsAndUsers(reactions, userListContainer, modalContent) {
    if (!reactions || reactions.length === 0) {
        userListContainer.innerHTML = '<div style="padding:20px; text-align:center;">Chưa có cảm xúc nào</div>';
        return;
    }
    const groupedReactions = reactions.reduce((acc, user) => {
        if (!acc[user.emoji]) acc[user.emoji] = [];
        acc[user.emoji].push(user);
        return acc;
    }, {});
    
    const tabsContainer = document.createElement('div');
    tabsContainer.id = 'reaction-tabs';
    tabsContainer.className = 'reaction-tabs';

    const allTab = document.createElement('button');
    allTab.className = 'reaction-tab active';
    allTab.innerHTML = `Tất cả <span>${reactions.length}</span>`;
    allTab.onclick = () => {
        tabsContainer.querySelectorAll('.reaction-tab').forEach(t => t.classList.remove('active'));
        allTab.classList.add('active');
        renderUserList(reactions, userListContainer);
    };
    tabsContainer.appendChild(allTab);

    for (const emoji in groupedReactions) {
        const users = groupedReactions[emoji];
        const tab = document.createElement('button');
        tab.className = 'reaction-tab';
        tab.innerHTML = `${emoji} <span>${users.length}</span>`;
        tab.onclick = () => {
            tabsContainer.querySelectorAll('.reaction-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            renderUserList(users, userListContainer);
        };
        tabsContainer.appendChild(tab);
    }
    
    const header = modalContent.querySelector('.reaction-modal-header');
    if (header && header.parentNode) {
        header.parentNode.insertBefore(tabsContainer, userListContainer);
    }
    renderUserList(reactions, userListContainer);
}

function renderUserList(users, container) {
    if (!users || users.length === 0) {
        container.innerHTML = '<div style="padding:20px; text-align:center;">Không có người dùng nào</div>';
        return;
    }
    let html = '';
    users.forEach(user => {
        const avatarSrc = user.avatar || '/static/img/default-avatar.png';
        const displayName = user.full_name || user.username;
        html += `
            <div class="reaction-user-item">
                <img src="${avatarSrc}" class="reaction-user-avatar" alt="${displayName}" onerror="this.src='/static/img/default-avatar.png'">
                <div class="reaction-user-info">
                    <div class="reaction-user-name">${displayName}</div>
                </div>
                <div class="reaction-emoji-icon">${user.emoji}</div>
            </div>
        `;
    });
    container.innerHTML = html;
}

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
    enableReplyMode(id, content, sender);
}

// ============================================================
// 🔥 LOGIC DỊCH THUẬT (TRANSLATE)
// ============================================================

window.requestTranslateMessage = function(messageId) {
    const msgEl = document.querySelector(`.message[data-id="${messageId}"]`);
    if (!msgEl) return;

    const contentEl = msgEl.querySelector('.message-text');
    if (!contentEl) {
        // Có thể thêm hiệu ứng lắc nhẹ báo lỗi nếu không phải text
        return;
    }

    // Toggle: Nếu đang có khung dịch thì xóa đi
    const existingTrans = msgEl.querySelector('.translation-box');
    if (existingTrans) {
        existingTrans.remove();
        return;
    }

    const content = contentEl.innerText;
    const transBox = document.createElement('div');
    transBox.className = 'translation-box loading';
    transBox.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Đang dịch...`;
    
    const container = msgEl.querySelector('.message-bubble') || msgEl.querySelector('.message-content');
    if (container) container.appendChild(transBox);

    socket.emit('translate_message', {
        message_id: messageId,
        content: content
    });
};

function handleTranslateResult(data) {
    const msgEl = document.querySelector(`.message[data-id="${data.message_id}"]`);
    if (!msgEl) return;

    let transBox = msgEl.querySelector('.translation-box');
    if (!transBox) {
        transBox = document.createElement('div');
        const container = msgEl.querySelector('.message-bubble') || msgEl.querySelector('.message-content');
        if(container) container.appendChild(transBox);
        else return;
    }

    transBox.classList.remove('loading');

    if (data.success) {
        transBox.className = 'translation-box success';
        transBox.innerHTML = `
            <div class="trans-header" style="font-size: 0.8em; opacity: 0.8; margin-bottom: 2px; font-style: italic;">
                <i class="fas fa-language"></i> Dịch sang ${data.lang_label}
            </div>
            <div class="trans-content" style="font-weight: 500;">${data.translated}</div>
        `;
    } else {
        transBox.className = 'translation-box error';
        transBox.innerHTML = `<span style="color:red; font-size:0.8em">Lỗi: ${data.error}</span>`;
        setTimeout(() => transBox.remove(), 3000);
    }
}
// --- File: app/static/js/socket/chat_interactions.js ---

// ==========================================
// 1. LOGIC TÍNH TOÁN TIN NHẮN THÔNG MINH (SMART UNREAD)
// ==========================================
export function getSmartMessages(messages, contextPrefix, contextId) {
    // contextPrefix: 'group' hoặc 'private'
    // contextId: ID nhóm hoặc ID người chat
    
    if (!messages || messages.length === 0) return { msgs: [], label: "", isNew: false };

    const storageKey = `last_seen_${contextPrefix}_${contextId}`;
    const lastSeen = localStorage.getItem(storageKey);
    const now = new Date().toISOString();

    let targetMessages = [];
    let label = "";
    let isNew = false; // Biến xác định xem có phải tin mới không

    if (lastSeen) {
        const lastDate = new Date(lastSeen);
        
        // Lọc các tin nhắn có thời gian > lần xem cuối
        targetMessages = messages.filter(m => {
            const t = m.created_at || m.timestamp;
            return t && new Date(t) > lastDate;
        });

        if (targetMessages.length > 0) {
            isNew = true; // Có tin mới thật sự
            label = ` ${targetMessages.length} tin nhắn chưa đọc`;
        }
    }

    // FALLBACK: Nếu không có tin mới (hoặc mới vào lần đầu chưa có mốc)
    // Lấy 20 tin cuối để user vẫn có cái để tóm tắt
    if (targetMessages.length === 0) {
        targetMessages = messages.slice(-20); 
        label = " 20 tin nhắn gần nhất"; 
        isNew = false; // Đây là xem lại lịch sử
    }

    // Cập nhật lại thời gian đã xem là NGAY BÂY GIỜ
    localStorage.setItem(storageKey, now);

    return { msgs: targetMessages, label: label, isNew: isNew };
}

// --- File: app/static/js/socket/chat_interactions.js ---

// 1. Hàm phụ trợ: Tạo Animation mượt mà
function injectKeyframes() {
    if (!document.getElementById('ai-keyframes')) {
        const style = document.createElement('style');
        style.id = 'ai-keyframes';
        style.innerHTML = `
            @keyframes aiFadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes aiSlideUp { from { opacity: 0; transform: translateY(20px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
        `;
        document.head.appendChild(style);
    }
}

// 2. Hàm chính: Tông màu Xanh Lá (#43b581) Dark Gradient
export async function requestAISummary(messages) {
    const modal = document.getElementById('ai-summary-modal');
    const resultBox = document.getElementById('ai-summary-result');
    
    injectKeyframes();
    
    // --- STYLE MODAL ---
    modal.style.cssText = `
        display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0, 0, 0, 0.6); z-index: 9999;
        justify-content: center; align-items: center;
        backdrop-filter: blur(4px); 
        animation: aiFadeIn 0.3s ease-out;
    `;

    // Hộp nội dung
    resultBox.style.cssText = `
        background: #fff; width: 90%; max-width: 500px;
        border-radius: 16px; box-shadow: 0 20px 50px rgba(0,0,0,0.3);
        overflow: hidden; display: flex; flex-direction: column;
        max-height: 80vh; margin: auto; 
        animation: aiSlideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    `;

    // --- HIỂN THỊ LOADING (Header Xanh Lá Dark) ---
    // 🔥 Gradient: Từ màu gốc (#43b581) sang màu xanh đậm (#2f8058)
    const loadingHeader = `
        <div style="background: linear-gradient(135deg, #43b581 0%, #2f8058 100%); padding: 15px 20px; display: flex; justify-content: space-between; align-items: center;">
            <div style="color: white; font-weight: bold; font-size: 16px;"><i class="fas fa-robot"></i> AI Processing...</div>
            <div id="btn-close-temp" style="cursor: pointer; color: white; font-size: 20px;">&times;</div>
        </div>
    `;
    const loadingBody = `
        <div style="padding: 40px 20px; text-align: center; color: #666;">
            <i class="fas fa-circle-notch fa-spin fa-3x" style="color: #43b581;"></i>
            <p style="margin-top: 15px; font-weight: 500;">Đang đọc hiểu tin nhắn...</p>
        </div>
    `;
    resultBox.innerHTML = loadingHeader + loadingBody;
    
    document.getElementById('btn-close-temp').onclick = () => { modal.style.display = 'none'; };

    try {
        const payload = messages.map(m => ({
            sender_name: m.sender_name || m.username || "User", 
            content: m.content || m.message_text || "" 
        }));

        const response = await fetch('/api/summarize_chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: payload })
        });
        
        const data = await response.json();

        if (data.success) {
            // Text in đậm chuyển sang màu xanh đậm cho hợp tone
            let htmlContent = data.summary
                .replace(/\*\*(.*?)\*\*/g, '<strong style="color: #2f8058;">$1</strong>')
                .replace(/\n/g, '<br>');

            // --- HEADER XANH LÁ DARK ---
            const headerHTML = `
                <div style="
                    background: linear-gradient(135deg, #43b581 0%, #2f8058 100%);
                    padding: 15px 20px;
                    display: flex; justify-content: space-between; align-items: center;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                ">
                    <div style="color: white; font-weight: bold; font-size: 16px; display: flex; align-items: center; gap: 8px;">
                        <i class="fas fa-magic"></i> Tóm tắt cuộc trò chuyện
                    </div>
                    <div id="btn-close-summary" style="
                        cursor: pointer; color: white; opacity: 0.8; font-size: 24px; line-height: 1;
                        transition: all 0.2s;
                    " onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.8'">&times;</div>
                </div>
            `;

            // BODY NỘI DUNG
            const bodyHTML = `
                <div style="
                    padding: 20px 25px;
                    overflow-y: auto;
                    color: #4a5568;
                    line-height: 1.6;
                    font-size: 14px;
                    background: #fff;
                ">
                    ${htmlContent}
                </div>
                <div style="padding: 10px 20px; border-top: 1px solid #edf2f7; text-align: right; background: #f7fafc;">
                    <button id="btn-done" style="
                        background: #43b581; color: white; border: none; padding: 6px 15px; 
                        border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500;
                        box-shadow: 0 2px 5px rgba(67, 181, 129, 0.4);
                        transition: background 0.2s;
                    " onmouseover="this.style.background='#3ca374'" onmouseout="this.style.background='#43b581'">Đã hiểu</button>
                </div>
            `;

            resultBox.innerHTML = headerHTML + bodyHTML;

            const closeAction = () => { modal.style.display = 'none'; };
            document.getElementById('btn-close-summary').onclick = closeAction;
            document.getElementById('btn-done').onclick = closeAction;

        } else {
            resultBox.innerHTML = `
                <div style="padding: 30px; text-align: center;">
                    <i class="fas fa-exclamation-triangle" style="color: #e53e3e; font-size: 40px; margin-bottom: 15px;"></i>
                    <h3 style="margin: 0 0 10px 0; color: #2d3748;">Có lỗi xảy ra</h3>
                    <p style="color: #718096;">${data.error}</p>
                    <button onclick="document.getElementById('ai-summary-modal').style.display='none'" style="margin-top: 15px; padding: 8px 20px; background: #cbd5e0; border: none; border-radius: 5px; cursor: pointer;">Đóng</button>
                </div>
            `;
        }

    } catch (err) {
        console.error(err);
        resultBox.innerHTML = `<div style="padding: 30px; color:red; text-align:center">Lỗi kết nối server!</div>`;
    }
    
    modal.onclick = (e) => {
        if (e.target === modal) modal.style.display = 'none';
    };
}

// ==========================================
// 3. HÀM HIỂN THỊ NÚT (MÀU XANH + HIỆU ỨNG NHẢY)
// ==========================================
export function showAISummaryButton(containerId, messages, customLabel = "", isNew = false) {
    if (!messages || messages.length < 2) return;

    const chatContainer = document.getElementById(containerId);
    if (!chatContainer) return;

    // 1. Xóa nút cũ
    const existingBtn = document.getElementById('ai-summary-wrapper');
    if (existingBtn) existingBtn.remove();

    // 2. [MỚI] Tự động bơm CSS Animation "Nhảy Nhảy" vào trang
    if (!document.getElementById('ai-btn-anim')) {
        const style = document.createElement('style');
        style.id = 'ai-btn-anim';
        style.innerHTML = `
            @keyframes gentleJump {
                0%, 100% { transform: translateY(0); }
                50% { transform: translateY(-5px); } /* Nhảy lên 5px */
            }
            @keyframes fadeIn {
                from { opacity: 0; transform: translateY(10px); }
                to { opacity: 1; transform: translateY(0); }
            }
        `;
        document.head.appendChild(style);
    }

    // 3. Tạo Wrapper
    const btnWrapper = document.createElement('div');
    btnWrapper.id = 'ai-summary-wrapper'; 
    btnWrapper.style.cssText = `
        text-align: center; margin: 15px 0 5px 0;
        width: 100%; display: flex; justify-content: center;
        animation: fadeIn 0.5s ease;
    `;
    
    // 4. Tạo nút bấm
    const btn = document.createElement('button');
    btn.className = 'btn-ai-summ'; 
    
    // 5. STYLE & ANIMATION
    if (isNew) {
        // 🔥 Giao diện TIN MỚI: Xanh Lá (#43b581) + Hiệu ứng NHẢY
        btn.style.cssText = `
            background: linear-gradient(to right, #43b581, #2f8058);
            color: white; border: none;
            padding: 8px 20px; border-radius: 20px;
            cursor: pointer; font-size: 13px; font-weight: bold;
            display: inline-flex; align-items: center; gap: 8px;
            box-shadow: 0 4px 10px rgba(67, 181, 129, 0.4);
            transition: all 0.2s;
            animation: gentleJump 2s infinite ease-in-out; /* 🔥 NHẢY NHẢY Ở ĐÂY */
        `;
        btn.innerHTML = `<i class="fas fa-bell fa-shake"></i> Tóm tắt ${customLabel}`;
    } else {
        // 🕒 Giao diện LỊCH SỬ: Xám + Icon Xanh (Không nhảy)
        btn.style.cssText = `
            background: #f8f9fa; color: #6c757d; border: 1px solid #dee2e6;
            padding: 6px 16px; border-radius: 20px;
            cursor: pointer; font-size: 12px; font-weight: 500;
            display: inline-flex; align-items: center; gap: 6px;
            transition: all 0.2s;
        `;
        btn.innerHTML = `<i class="fas fa-history" style="color: #43b581;"></i> Tóm tắt ${customLabel}`;
    }

    // 6. Xử lý Hover (Khi di chuột vào thì dừng nhảy để dễ bấm)
    btn.onmouseenter = () => {
        if (isNew) {
            btn.style.animationPlayState = 'paused'; // Dừng nhảy
            btn.style.transform = "scale(1.05)"; // Phóng to nhẹ
        } else {
            btn.style.borderColor = "#43b581";
            btn.style.color = "#2f8058";
        }
    };
    btn.onmouseleave = () => {
        if (isNew) {
            btn.style.animationPlayState = 'running'; // Nhảy tiếp
            btn.style.transform = "scale(1)";
        } else {
            btn.style.borderColor = "#dee2e6";
            btn.style.color = "#6c757d";
        }
    };

    // 7. SỰ KIỆN CLICK
    btn.onclick = async (e) => {
        e.preventDefault();
        
        // Tắt animation nhảy ngay lập tức
        btn.style.animation = 'none';
        
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Đang xử lý...`;
        btn.disabled = true;
        
        // Nếu là nút lịch sử (màu xám), đổi chữ sang xanh loading
        if(!isNew) btn.style.color = "#43b581";

        await requestAISummary(messages);
        
        // Xóa nút sau khi xong
        btnWrapper.remove();
    };

    btnWrapper.appendChild(btn);
    chatContainer.appendChild(btnWrapper);

    // Cuộn xuống
    setTimeout(() => {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }, 100);
}