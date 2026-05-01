// 🔥 Universal Floating Chat & Notification System
// Sử dụng cho tất cả các trang: timeline, profile, friend_requests, settings, etc.

(function() {
    let currentFloatingChat = null;
    let socket = null;

    // Khởi tạo khi DOM ready
    document.addEventListener('DOMContentLoaded', init);

    function init() {
        // Tìm socket instance hiện có hoặc đợi nó sẵn sàng
        if (window.socket) {
            socket = window.socket;
            setupSocketListeners();
        } else {
            // Đợi socket sẵn sàng
            const checkSocket = setInterval(() => {
                if (window.socket) {
                    socket = window.socket;
                    setupSocketListeners();
                    clearInterval(checkSocket);
                }
            }, 100);
            // Timeout sau 5 giây
            setTimeout(() => clearInterval(checkSocket), 5000);
        }

        // Tạo UI elements
        createNotificationContainer();
        createFloatingChatWidget();
    }

    // ====== CREATE UI ELEMENTS ======
    function createNotificationContainer() {
        if (document.getElementById('in-app-notifications-container')) return;

        const container = document.createElement('div');
        container.id = 'in-app-notifications-container';
        container.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            z-index: 9998;
            display: flex;
            flex-direction: column;
            gap: 10px;
            max-width: 350px;
        `;
        document.body.appendChild(container);

        // Add animation styles
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideInRight {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }

    function createFloatingChatWidget() {
        if (document.getElementById('floating-chat-widget')) return;

        const widget = document.createElement('div');
        widget.id = 'floating-chat-widget';
        widget.style.cssText = `
            display: none;
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 380px;
            height: 500px;
            background: white;
            border-radius: 16px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
            z-index: 9999;
            flex-direction: column;
            overflow: hidden;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;

        widget.innerHTML = `
            <div style="
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 15px 20px;
                display: flex;
                align-items: center;
                justify-content: space-between;
            ">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <img id="floating-chat-avatar" src="/static/img/default-avatar.png" style="
                        width: 40px; height: 40px; border-radius: 50%; object-fit: cover;
                        border: 2px solid rgba(255,255,255,0.3);
                    ">
                    <div>
                        <div id="floating-chat-name" style="font-weight: 600; font-size: 15px;"></div>
                        <div style="font-size: 12px; opacity: 0.8;">Đang hoạt động</div>
                    </div>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button id="floating-call-btn" style="
                        background: rgba(255,255,255,0.2); border: none; width: 32px; height: 32px;
                        border-radius: 50%; color: white; cursor: pointer;
                        display: flex; align-items: center; justify-content: center;
                    " title="Gọi thoại"><i class="fas fa-phone"></i></button>
                    <button id="floating-video-btn" style="
                        background: rgba(255,255,255,0.2); border: none; width: 32px; height: 32px;
                        border-radius: 50%; color: white; cursor: pointer;
                        display: flex; align-items: center; justify-content: center;
                    " title="Gọi video"><i class="fas fa-video"></i></button>
                    <button id="floating-close-btn" style="
                        background: rgba(255,255,255,0.2); border: none; width: 32px; height: 32px;
                        border-radius: 50%; color: white; cursor: pointer;
                        display: flex; align-items: center; justify-content: center;
                    " title="Đóng"><i class="fas fa-times"></i></button>
                </div>
            </div>
            <div id="floating-chat-messages" style="
                flex: 1; overflow-y: auto; padding: 15px; background: #f8f9fa;
                display: flex; flex-direction: column; gap: 10px;
            ">
                <div style="text-align: center; color: #999; font-size: 13px; padding: 20px;">
                    Chọn thông báo để mở chat
                </div>
            </div>
            <div style="
                padding: 15px; background: white;
                border-top: 1px solid #e0e0e0;
                display: flex; gap: 10px;
            ">
                <input type="text" id="floating-chat-input" placeholder="Nhập tin nhắn..." style="
                    flex: 1; padding: 12px 15px; border: 1px solid #e0e0e0;
                    border-radius: 20px; outline: none; font-size: 14px;
                ">
                <button id="floating-send-btn" style="
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    border: none; width: 40px; height: 40px; border-radius: 50%;
                    color: white; cursor: pointer;
                    display: flex; align-items: center; justify-content: center;
                "><i class="fas fa-paper-plane"></i></button>
            </div>
        `;

        document.body.appendChild(widget);

        // Bind events
        document.getElementById('floating-close-btn')?.addEventListener('click', closeFloatingChat);
        document.getElementById('floating-send-btn')?.addEventListener('click', sendFloatingMessage);
        document.getElementById('floating-chat-input')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendFloatingMessage();
        });
        document.getElementById('floating-call-btn')?.addEventListener('click', () => startCallFromPage('audio'));
        document.getElementById('floating-video-btn')?.addEventListener('click', () => startCallFromPage('video'));
    }

    // 🔥 Tự động join tất cả nhóm để nhận thông báo realtime
    function joinAllUserGroups() {
        if (!socket) return;
        
        // Lấy danh sách nhóm từ API
        fetch('/user_groups')
            .then(r => r.json())
            .then(data => {
                const groups = data.groups || [];
                groups.forEach(group => {
                    const groupId = group._id || group.group_id;
                    if (groupId) {
                        socket.emit('join_group', { group_id: groupId });
                        console.log('[UniversalChat] Joined group:', groupId);
                    }
                });
            })
            .catch(err => console.error('[UniversalChat] Error joining groups:', err));
    }

    // ====== SOCKET LISTENERS ======
    function setupSocketListeners() {
        if (!socket) return;

        // 🔥 Tự động join tất cả nhóm để nhận thông báo
        joinAllUserGroups();

        // Tin nhắn nhóm
        socket.on('group_message', (data) => {
            const myId = window.session?.user_id;
            if (String(data.sender_id) === String(myId)) return;

            showNotification({
                title: data.group_name || 'Nhóm',
                message: `${data.sender_name || 'Ai đó'}: ${data.content?.substring(0, 50) || 'Tin nhắn mới'}`,
                avatar: data.sender_avatar,
                conversationId: data.group_id,
                conversationType: 'group',
                data: data
            });
        });

        // Tin nhắn 1v1
        socket.on('receive_message', (data) => {
            const myId = window.session?.user_id;
            if (String(data.sender_id) === String(myId)) return;
            if (data.conversation_type === 'group') return;

            showNotification({
                title: data.sender_name || 'Tin nhắn mới',
                message: data.content?.substring(0, 50) || 'Tin nhắn mới',
                avatar: data.sender_avatar,
                conversationId: data.conversation_id,
                conversationType: 'private',
                data: data
            });
        });

        // Lời mời gọi
        socket.on('call:incoming_notification', (data) => {
            showCallNotification(data);
        });
    }

    // ====== NOTIFICATION FUNCTIONS ======
    function showNotification({ title, message, avatar, conversationId, conversationType }) {
        const container = document.getElementById('in-app-notifications-container');
        if (!container) return;

        const notif = document.createElement('div');
        notif.style.cssText = `
            background: white;
            border-radius: 12px;
            padding: 15px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            display: flex;
            align-items: center;
            gap: 12px;
            cursor: pointer;
            animation: slideInRight 0.3s ease;
            border-left: 4px solid ${conversationType === 'group' ? '#667eea' : '#3eb489'};
        `;

        notif.innerHTML = `
            <img src="${avatar || '/static/img/default-avatar.png'}" style="
                width: 45px; height: 45px; border-radius: 50%; object-fit: cover;
            ">
            <div style="flex: 1; min-width: 0;">
                <div style="font-weight: 600; color: #333; font-size: 14px; margin-bottom: 3px;">
                    ${title}
                    <span style="
                        font-size: 10px; padding: 2px 6px; border-radius: 10px;
                        background: ${conversationType === 'group' ? '#667eea' : '#3eb489'};
                        color: white; margin-left: 6px;
                    ">${conversationType === 'group' ? 'NHÓM' : 'CHAT'}</span>
                </div>
                <div style="color: #666; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    ${message}
                </div>
            </div>
            <button onclick="event.stopPropagation(); this.parentElement.remove()" style="
                background: none; border: none; color: #999; cursor: pointer; padding: 5px;
            "><i class="fas fa-times"></i></button>
        `;

        notif.addEventListener('click', () => {
            openFloatingChat(conversationId, conversationType, title, avatar);
            notif.remove();
        });

        container.appendChild(notif);

        // Auto remove sau 5s
        setTimeout(() => notif.remove(), 5000);

        // Giới hạn 3 thông báo
        while (container.children.length > 3) {
            container.firstChild?.remove();
        }
    }

    function showCallNotification(data) {
        const container = document.getElementById('in-app-notifications-container');
        if (!container) return;

        const isGroup = data.conversation_type === 'group';
        const title = isGroup
            ? (data.room_name || 'Cuộc gọi đến')
            : (data.caller?.username || 'Cuộc gọi đến');
        const message = isGroup
            ? `${data.caller?.username || 'Ai đó'} đang gọi...`
            : 'đang gọi cho bạn...';

        const notif = document.createElement('div');
        notif.style.cssText = `
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 12px;
            padding: 15px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.2);
            display: flex;
            align-items: center;
            gap: 12px;
            color: white;
            animation: slideInRight 0.3s ease;
        `;

        notif.innerHTML = `
            <div style="position: relative;">
                <img src="${data.caller?.avatar || '/static/img/default-avatar.png'}" style="
                    width: 50px; height: 50px; border-radius: 50%; object-fit: cover;
                    border: 2px solid white;
                ">
                <div style="
                    position: absolute; bottom: -2px; right: -2px;
                    background: #ff3b30; width: 16px; height: 16px;
                    border-radius: 50%; display: flex; align-items: center; justify-content: center;
                "><i class="fas fa-phone" style="font-size: 8px;"></i></div>
            </div>
            <div style="flex: 1;">
                <div style="font-weight: 600; font-size: 15px; margin-bottom: 3px;">${title}</div>
                <div style="font-size: 13px; opacity: 0.9;">${message}</div>
            </div>
            <div style="display: flex; gap: 8px;">
                <button class="call-decline-btn" style="
                    background: rgba(255,255,255,0.2); border: none; width: 36px; height: 36px;
                    border-radius: 50%; color: white; cursor: pointer;
                "><i class="fas fa-phone-slash"></i></button>
                <button class="call-accept-btn" style="
                    background: #3eb489; border: none; width: 36px; height: 36px;
                    border-radius: 50%; color: white; cursor: pointer;
                "><i class="fas fa-phone"></i></button>
            </div>
        `;

        // Bind events
        notif.querySelector('.call-decline-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            declineCall(data.conversation_id);
            notif.remove();
        });

        notif.querySelector('.call-accept-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            acceptCall(data.conversation_id, data.conversation_type, data.call_id, data.call_mode);
        });

        container.appendChild(notif);

        // Play ringtone
        const ringtone = new Audio('/static/sounds/ringtone.mp3');
        ringtone.loop = true;
        ringtone.play().catch(() => {});
        notif.ringtone = ringtone;

        // Auto remove sau 30s
        setTimeout(() => {
            if (notif.ringtone) notif.ringtone.pause();
            notif.remove();
        }, 30000);
    }

    // ====== FLOATING CHAT FUNCTIONS ======
    function openFloatingChat(conversationId, type, name, avatar) {
        currentFloatingChat = { conversationId, type, name, avatar };

        const widget = document.getElementById('floating-chat-widget');
        document.getElementById('floating-chat-name').textContent = name;
        document.getElementById('floating-chat-avatar').src = avatar || '/static/img/default-avatar.png';
        document.getElementById('floating-chat-messages').innerHTML = '<div style="text-align:center; color:#999; padding:20px;">Đang tải...</div>';

        widget.style.display = 'flex';

        // Load messages
        loadMessages(conversationId, type);

        // Join room
        if (socket) {
            socket.emit(type === 'group' ? 'join_group' : 'join_conversation',
                type === 'group' ? { group_id: conversationId } : { conversation_id: conversationId }
            );
        }
    }

    function closeFloatingChat() {
        const widget = document.getElementById('floating-chat-widget');
        widget.style.display = 'none';

        if (currentFloatingChat && socket) {
            socket.emit(currentFloatingChat.type === 'group' ? 'leave_group' : 'leave_conversation', {
                [currentFloatingChat.type === 'group' ? 'group_id' : 'conversation_id']: currentFloatingChat.conversationId
            });
        }
        currentFloatingChat = null;
    }

    function loadMessages(conversationId, type) {
        const endpoint = type === 'group'
            ? `/group_message?group_id=${conversationId}`
            : `/conversation/${conversationId}`;

        fetch(endpoint)
            .then(r => r.json())
            .then(data => {
                const messages = data.messages || [];
                const container = document.getElementById('floating-chat-messages');
                container.innerHTML = '';

                if (messages.length === 0) {
                    container.innerHTML = '<div style="text-align:center; color:#999; padding:20px;">Chưa có tin nhắn</div>';
                    return;
                }

                messages.slice(-20).forEach(msg => {
                    appendMessageToFloating(msg);
                });

                container.scrollTop = container.scrollHeight;
            })
            .catch(err => {
                console.error('Load messages error:', err);
                document.getElementById('floating-chat-messages').innerHTML =
                    '<div style="text-align:center; color:#999; padding:20px;">Không thể tải tin nhắn</div>';
            });
    }

    function appendMessageToFloating(msg) {
        const container = document.getElementById('floating-chat-messages');
        const myId = window.session?.user_id;
        const isMe = String(msg.sender_id) === String(myId);

        const div = document.createElement('div');
        div.style.cssText = `
            align-self: ${isMe ? 'flex-end' : 'flex-start'};
            max-width: 80%;
            background: ${isMe ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'white'};
            color: ${isMe ? 'white' : '#333'};
            padding: 10px 14px;
            border-radius: 18px;
            font-size: 13px;
            word-wrap: break-word;
            box-shadow: 0 1px 2px rgba(0,0,0,0.1);
        `;
        div.textContent = msg.content || msg.message;

        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }

    function sendFloatingMessage() {
        const input = document.getElementById('floating-chat-input');
        const content = input.value.trim();
        if (!content || !currentFloatingChat || !socket) return;

        const { conversationId, type } = currentFloatingChat;

        socket.emit(type === 'group' ? 'send_group_message' : 'send_message',
            type === 'group'
                ? { group_id: conversationId, content, message_type: 'text' }
                : { conversation_id: conversationId, content, message_type: 'text' }
        );

        // Optimistic append
        appendMessageToFloating({
            sender_id: window.session?.user_id,
            content: content
        });

        input.value = '';
    }

    // ====== CALL FUNCTIONS ======
    function startCallFromPage(mode) {
        if (!currentFloatingChat) {
            alert('Vui lòng mở một cuộc trò chuyện trước');
            return;
        }

        const { conversationId, type, name } = currentFloatingChat;

        if (type === 'group') {
            socket.emit('call:invite_group', {
                conversation_id: conversationId,
                conversation_type: 'group',
                call_mode: mode
            });
            showOutgoingCallUI(name, mode);
        } else {
            // Gọi 1v1 - cần tìm recipient_id
            fetch(`/api/conversation/${conversationId}`)
                .then(r => r.json())
                .then(data => {
                    const myId = window.session?.user_id;
                    const recipient = data.participants?.find(p => String(p) !== String(myId));

                    if (recipient) {
                        socket.emit('call:invite_private', {
                            conversation_id: conversationId,
                            recipient_id: recipient,
                            conversation_type: 'private',
                            call_mode: mode
                        });
                        showOutgoingCallUI(name, mode);
                    }
                });
        }
    }

    function showOutgoingCallUI(name, mode) {
        const div = document.createElement('div');
        div.id = 'universal-outgoing-call';
        div.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0,0,0,0.9); z-index: 10000;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            color: white;
        `;

        div.innerHTML = `
            <img src="/static/img/default-avatar.png" style="
                width: 120px; height: 120px; border-radius: 50%; margin-bottom: 20px;
            ">
            <h2>${name}</h2>
            <p>Đang ${mode === 'video' ? 'gọi video' : 'gọi thoại'}...</p>
            <button id="cancel-outgoing-call" style="
                background: #ff3b30; border: none; width: 60px; height: 60px;
                border-radius: 50%; margin-top: 30px; color: white; font-size: 24px;
            "><i class="fas fa-phone-slash"></i></button>
        `;

        document.body.appendChild(div);

        document.getElementById('cancel-outgoing-call').addEventListener('click', () => {
            cancelOutgoingCall();
        });
    }

    function cancelOutgoingCall() {
        const div = document.getElementById('universal-outgoing-call');
        if (div) div.remove();

        if (socket && currentFloatingChat) {
            socket.emit('call:cancel', {
                conversation_id: currentFloatingChat.conversationId,
                conversation_type: currentFloatingChat.type
            });
        }
    }

    function acceptCall(id, type, callId, mode) {
        window.location.href = `/chat?call=${id}&type=${type}&call_id=${callId}&mode=${mode}`;
    }

    function declineCall(id) {
        if (socket) {
            socket.emit('call:decline', { conversation_id: id });
        }
    }

    // ====== EXPOSE GLOBALS ======
    window.UniversalChat = {
        openFloatingChat,
        closeFloatingChat,
        showNotification,
        showCallNotification
    };
})();
