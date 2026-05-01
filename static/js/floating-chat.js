// ============================================
// 🔥 MULTI-FLOATING CHAT SYSTEM (4 Windows)
// ============================================

const MAX_FLOATING_CHATS = 4;
const floatingChats = []; // Array of active chat objects

// Theme colors - đồng bộ với app
const THEME = {
    primary: '#3eb489',      // Project green
    primaryDark: '#2d9cdb', // Project blue
    primaryLight: '#5fd4a3', // Light green
    secondary: '#2d9cdb',    // Project blue
    background: '#F3F4F6',
    text: '#1F2937',
    textLight: '#6B7280',
    white: '#FFFFFF',
    border: '#E5E7EB'
};

// ====== GET CHAT POSITION ======
function getChatPosition(index) {
    // Stack from right: 20px, 390px, 760px, 1130px
    const positions = [
        { right: 20, bottom: 20 },
        { right: 390, bottom: 20 },
        { right: 760, bottom: 20 },
        { right: 1130, bottom: 20 }
    ];
    return positions[index] || positions[0];
}

// ====== CREATE CHAT WINDOW ======
function createChatWindow(conversationId, type, name, avatar) {
    const index = floatingChats.length;
    const chatId = `floating-chat-${Date.now()}-${index}`;
    const pos = getChatPosition(index);
    
    const chatData = {
        id: chatId,
        index: index,
        conversationId: conversationId,
        type: type,
        name: name,
        avatar: avatar,
        minimized: false,
        messages: [],
        replyingTo: null
    };
    
    floatingChats.push(chatData);
    
    // Create HTML
    const widget = document.createElement('div');
    widget.id = chatId;
    widget.className = 'floating-chat-widget';
    widget.style.cssText = `
        position: fixed;
        right: ${pos.right}px;
        bottom: ${pos.bottom}px;
        width: 360px;
        height: 480px;
        background: ${THEME.white};
        border-radius: 16px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.15), 0 2px 8px rgba(0,0,0,0.1);
        z-index: ${10000 + index};
        display: flex;
        flex-direction: column;
        overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
        border: 1px solid ${THEME.border};
    `;
    
    widget.innerHTML = `
        <!-- Drag Handle / Minimize Bar -->
        <div class="chat-drag-handle" onclick="toggleMinimizeChat(${index})" style="
            background: linear-gradient(135deg, #3eb489 0%, #2d9cdb 100%);
            padding: 8px 0;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            border-bottom: 1px solid rgba(255,255,255,0.1);
            position: relative;
        " title="Nhấp để thu nhỏ/mở rộng">
            <div style="
                width: 40px;
                height: 4px;
                background: rgba(255,255,255,0.4);
                border-radius: 2px;
            "></div>
            <div style="
                position: absolute;
                right: 12px;
                top: 50%;
                transform: translateY(-50%);
                color: rgba(255,255,255,0.7);
                font-size: 10px;
            ">
                <i class="fas fa-chevron-down"></i>
            </div>
        </div>
        
        <!-- Header -->
        <div id="${chatId}-header" style="
            background: linear-gradient(135deg, #3eb489 0%, #2d9cdb 100%);
            color: white;
            padding: 12px 16px;
            display: flex;
            align-items: center;
            gap: 12px;
            flex-shrink: 0;
        ">
            <div style="position: relative;">
                <img src="${avatar || '/static/img/default-avatar.png'}" style="
                    width: 40px; height: 40px;
                    border-radius: 50%;
                    object-fit: cover;
                    border: 2px solid rgba(255,255,255,0.3);
                    cursor: pointer;
                " onclick="toggleMinimizeChat(${index})">
                <div style="
                    position: absolute;
                    bottom: 0;
                    right: 0;
                    width: 12px;
                    height: 12px;
                    background: #10B981;
                    border-radius: 50%;
                    border: 2px solid ${THEME.primary};
                "></div>
            </div>
            <div style="flex: 1; min-width: 0;">
                <div style="font-weight: 600; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    ${escapeHtml(name)}
                </div>
                <div style="font-size: 11px; opacity: 0.9; display: flex; align-items: center; gap: 4px;">
                    <span style="width: 6px; height: 6px; background: #10B981; border-radius: 50%;"></span>
                    ${type === 'group' ? 'Nhóm chat' : 'Active now'}
                </div>
            </div>
            <button onclick="event.stopPropagation(); startCallFromChat(${index}, 'audio')" style="
                background: rgba(255,255,255,0.15);
                border: none;
                color: white;
                width: 34px; height: 34px;
                border-radius: 50%;
                cursor: pointer;
                display: flex; align-items: center; justify-content: center;
            " title="Gọi thoại" onmouseover="this.style.background='rgba(255,255,255,0.25)'" onmouseout="this.style.background='rgba(255,255,255,0.15)'">
                <i class="fas fa-phone" style="font-size: 13px;"></i>
            </button>
            <button onclick="event.stopPropagation(); closeChatWindow(${index})" style="
                background: rgba(255,255,255,0.15);
                border: none;
                color: white;
                width: 34px; height: 34px;
                border-radius: 50%;
                cursor: pointer;
                display: flex; align-items: center; justify-content: center;
            " title="Đóng" onmouseover="this.style.background='rgba(255,255,255,0.25)'" onmouseout="this.style.background='rgba(255,255,255,0.15)'">
                <i class="fas fa-times" style="font-size: 14px;"></i>
            </button>
        </div>
        
        <!-- Messages Area -->
        <div id="${chatId}-messages" style="
            flex: 1;
            overflow-y: auto;
            padding: 16px;
            background: ${THEME.background};
            display: flex;
            flex-direction: column;
            gap: 10px;
        ">
            <div style="text-align: center; color: ${THEME.textLight}; font-size: 13px; padding: 30px;">
                <i class="fas fa-spinner fa-spin" style="margin-right: 8px;"></i>Đang tải tin nhắn...
            </div>
        </div>
        
        <!-- Input Area -->
        <div id="${chatId}-input-area" style="
            padding: 14px 16px;
            background: ${THEME.white};
            border-top: 1px solid ${THEME.border};
            display: flex;
            gap: 10px;
            align-items: center;
            flex-shrink: 0;
        ">
            <input type="text" id="${chatId}-input" placeholder="Nhập tin nhắn..." style="
                flex: 1;
                padding: 12px 16px;
                border: 1px solid ${THEME.border};
                border-radius: 24px;
                outline: none;
                font-size: 14px;
                background: ${THEME.background};
                transition: border-color 0.2s;
            " onkeypress="if(event.key==='Enter')sendMessageFromChat(${index})" onfocus="this.style.borderColor='${THEME.primary}'" onblur="this.style.borderColor='${THEME.border}'">
            <button onclick="sendMessageFromChat(${index})" style="
                background: linear-gradient(135deg, #3eb489 0%, #2d9cdb 100%);
                border: none;
                color: white;
                width: 42px; height: 42px;
                border-radius: 50%;
                cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                transition: all 0.2s;
                box-shadow: 0 2px 8px rgba(62, 180, 137, 0.3);
            " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                <i class="fas fa-paper-plane" style="font-size: 15px;"></i>
            </button>
        </div>
    `;
    
    document.body.appendChild(widget);
    
    // Load messages
    loadChatMessages(index);
    
    // Focus the new chat
    focusChat(index);
}

// ====== MINIMIZE/MAXIMIZE CHAT ======
function toggleMinimizeChat(index) {
    const chat = floatingChats[index];
    if (!chat) return;
    
    const widget = document.getElementById(chat.id);
    if (!widget) return;
    
    chat.minimized = !chat.minimized;
    
    if (chat.minimized) {
        // Store current children and hide them
        chat.originalChildren = Array.from(widget.children);
        
        // Create minimized view
        const miniView = document.createElement('div');
        miniView.id = `${chat.id}-miniview`;
        miniView.style.cssText = `
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            border-radius: 50%;
            background: linear-gradient(135deg, #3eb489 0%, #2d9cdb 100%);
            overflow: hidden;
        `;
        miniView.innerHTML = `
            <img src="${chat.avatar || '/static/img/default-avatar.png'}" style="
                width: 58px; height: 58px;
                border-radius: 50%;
                object-fit: cover;
                border: 2px solid white;
            ">
            <!-- Online indicator -->
            <div style="
                position: absolute;
                bottom: 2px;
                right: 2px;
                width: 14px;
                height: 14px;
                background: #10B981;
                border-radius: 50%;
                border: 3px solid white;
                box-shadow: 0 1px 3px rgba(0,0,0,0.2);
            "></div>
            <!-- Close button -->
            <div id="${chat.id}-closebtn" style="
                position: absolute;
                top: -4px;
                right: -4px;
                width: 20px;
                height: 20px;
                background: #EF4444;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-size: 10px;
                cursor: pointer;
                opacity: 0;
                transition: opacity 0.2s;
                box-shadow: 0 1px 3px rgba(0,0,0,0.2);
            ">
                <i class="fas fa-times"></i>
            </div>
        `;
        
        // Hide original children
        chat.originalChildren.forEach(child => {
            child.style.display = 'none';
        });
        
        widget.appendChild(miniView);
        
        // Click to restore
        miniView.addEventListener('click', function(e) {
            if (e.target.closest(`#${chat.id}-closebtn`)) {
                e.stopPropagation();
                closeChatWindow(index);
            } else {
                toggleMinimizeChat(index);
            }
        });
        
        // Show close button on hover
        miniView.addEventListener('mouseenter', () => {
            const closeBtn = document.getElementById(`${chat.id}-closebtn`);
            if (closeBtn) closeBtn.style.opacity = '1';
        });
        miniView.addEventListener('mouseleave', () => {
            const closeBtn = document.getElementById(`${chat.id}-closebtn`);
            if (closeBtn) closeBtn.style.opacity = '0';
        });
        
        // Update style
        widget.style.width = '64px';
        widget.style.height = '64px';
        widget.style.borderRadius = '50%';
        widget.style.overflow = 'visible';
        widget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.2)';
        widget.style.border = `3px solid ${THEME.white}`;
        
        // Update position
        const pos = getChatPosition(index);
        widget.style.right = `${pos.right}px`;
        widget.style.bottom = `${pos.bottom}px`;
    } else {
        // Restore - remove minimized view and show original children
        const miniView = document.getElementById(`${chat.id}-miniview`);
        if (miniView) miniView.remove();
        
        if (chat.originalChildren) {
            chat.originalChildren.forEach(child => {
                child.style.display = '';
            });
        }
        
        // Restore style
        widget.style.width = '360px';
        widget.style.height = '480px';
        widget.style.borderRadius = '16px';
        widget.style.overflow = 'hidden';
        widget.style.boxShadow = '0 8px 32px rgba(0,0,0,0.15), 0 2px 8px rgba(0,0,0,0.1)';
        widget.style.border = `1px solid ${THEME.border}`;
        
        // Scroll to bottom
        scrollToBottom(index);
    }
}

// ====== CLOSE CHAT ======
function closeChatWindow(index) {
    const chat = floatingChats[index];
    if (!chat) return;
    
    const widget = document.getElementById(chat.id);
    if (widget) {
        widget.style.transform = 'scale(0.9)';
        widget.style.opacity = '0';
        setTimeout(() => widget.remove(), 200);
    }
    
    // Remove from array
    floatingChats.splice(index, 1);
    
    // Reindex and reposition remaining chats
    floatingChats.forEach((c, i) => {
        c.index = i;
        const w = document.getElementById(c.id);
        if (w) {
            const pos = getChatPosition(i);
            w.style.right = `${pos.right}px`;
            w.style.bottom = `${pos.bottom}px`;
            w.style.zIndex = 10000 + i;
        }
    });
}

// ====== FOCUS CHAT ======
function focusChat(index) {
    floatingChats.forEach((c, i) => {
        const widget = document.getElementById(c.id);
        if (widget) {
            widget.style.zIndex = 10000 + (i === index ? 10 : i);
        }
    });
}

// ====== LOAD MESSAGES ======
function loadChatMessages(index) {
    const chat = floatingChats[index];
    if (!chat) return;
    
    const messagesContainer = document.getElementById(`${chat.id}-messages`);
    if (!messagesContainer) return;
    
    // Load from API
    const url = chat.type === 'group'
        ? `/api/group_messages/${chat.conversationId}?limit=50`
        : `/api/conversation_messages/${chat.conversationId}?limit=50`;
    
    fetch(url)
        .then(r => r.json())
        .then(data => {
            messagesContainer.innerHTML = '';
            const messages = data.messages || [];
            messages.forEach(msg => appendMessageToChat(index, msg));
            scrollToBottom(index);
        })
        .catch(err => {
            messagesContainer.innerHTML = `
                <div style="text-align: center; color: #999; padding: 20px;">
                    Không thể tải tin nhắn
                </div>
            `;
        });
}

// ====== APPEND MESSAGE ======
function appendMessageToChat(index, message) {
    const chat = floatingChats[index];
    if (!chat) return;
    
    const messagesContainer = document.getElementById(`${chat.id}-messages`);
    if (!messagesContainer) return;
    
    const myId = window.session?.user_id;
    const isMe = String(message.sender_id) === String(myId);
    
    const msgDiv = document.createElement('div');
    msgDiv.style.cssText = `
        display: flex;
        ${isMe ? 'justify-content: flex-end' : 'justify-content: flex-start'};
        margin-bottom: 8px;
    `;
    
    // Parse content
    let messageContent = '';
    let messageType = message.message_type || 'text';
    let parsedContent = null;
    
    try {
        if (message.content && message.content.startsWith('{')) {
            parsedContent = JSON.parse(message.content);
            if (parsedContent.type) messageType = parsedContent.type;
        }
    } catch (e) {}
    
    // Render based on type
    if (messageType === 'image') {
        const imgUrl = parsedContent?.thumbnail || parsedContent?.url || message.content;
        const fullUrl = parsedContent?.url || imgUrl;
        messageContent = `<img src="${imgUrl}" style="max-width: 200px; max-height: 200px; border-radius: 8px; cursor: pointer;" onclick="window.open('${fullUrl}', '_blank')">`;
    } else if (messageType === 'file') {
        const fileInfo = parsedContent || {};
        messageContent = `
            <div style="background: white; padding: 10px; border-radius: 8px; display: flex; align-items: center; gap: 8px;">
                <i class="fas fa-file" style="font-size: 24px; color: #3eb489;"></i>
                <div style="flex: 1; min-width: 0;">
                    <div style="font-size: 12px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(fileInfo.name || 'File')}</div>
                </div>
                <a href="${fileInfo.url}" download style="color: #3eb489;"><i class="fas fa-download"></i></a>
            </div>
        `;
    } else if (messageType === 'video') {
        const fileInfo = parsedContent || {};
        messageContent = `
            <video controls style="max-width: 220px; border-radius: 8px;" preload="metadata">
                <source src="${fileInfo.url}" type="video/mp4">
            </video>
        `;
    } else {
        messageContent = escapeHtml(message.content || '');
    }
    
    msgDiv.innerHTML = `
        <div style="
            max-width: 70%;
            padding: 10px 14px;
            border-radius: 18px;
            font-size: 13px;
            line-height: 1.4;
            ${isMe 
                ? 'background: linear-gradient(135deg, #3eb489 0%, #2d9cdb 100%); color: white; border-bottom-right-radius: 4px;' 
                : 'background: white; color: #333; border-bottom-left-radius: 4px; box-shadow: 0 1px 2px rgba(0,0,0,0.1);'}
        ">
            ${messageContent}
            <div style="font-size: 10px; opacity: 0.7; margin-top: 4px; text-align: right;">
                ${new Date(message.created_at).toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'})}
            </div>
        </div>
    `;
    
    messagesContainer.appendChild(msgDiv);
    scrollToBottom(index);
}

// ====== SCROLL TO BOTTOM ======
function scrollToBottom(index) {
    const chat = floatingChats[index];
    if (!chat) return;
    const messagesContainer = document.getElementById(`${chat.id}-messages`);
    if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

// ====== SEND MESSAGE ======
function sendMessageFromChat(index) {
    const chat = floatingChats[index];
    if (!chat) return;
    
    const input = document.getElementById(`${chat.id}-input`);
    if (!input || !input.value.trim()) return;
    
    const content = input.value.trim();
    input.value = '';
    
    // Emit via socket
    if (socket) {
        if (chat.type === 'group') {
            socket.emit('send_group_message', {
                group_id: chat.conversationId,
                content: content,
                message_type: 'text'
            });
        } else {
            socket.emit('send_message', {
                conversation_id: chat.conversationId,
                content: content,
                message_type: 'text'
            });
        }
    }
    
    // Optimistic add
    appendMessageToChat(index, {
        sender_id: window.session?.user_id,
        content: content,
        message_type: 'text',
        created_at: new Date().toISOString()
    });
}

// ====== ATTACHMENT MENU ======
function toggleAttachmentMenu(index) {
    const chat = floatingChats[index];
    if (!chat) return;
    
    // Remove existing menu
    const existing = document.getElementById(`attachment-menu-${index}`);
    if (existing) {
        existing.remove();
        return;
    }
    
    const widget = document.getElementById(chat.id);
    const rect = widget.getBoundingClientRect();
    
    const menu = document.createElement('div');
    menu.id = `attachment-menu-${index}`;
    menu.style.cssText = `
        position: fixed;
        bottom: ${rect.bottom - rect.height + 60}px;
        right: ${rect.left + 20}px;
        background: ${THEME.white};
        border-radius: 16px;
        padding: 8px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.2);
        z-index: 100001;
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 180px;
        border: 1px solid ${THEME.border};
        animation: fadeIn 0.2s ease;
    `;
    
    const items = [
        { icon: 'fa-pencil-alt', text: 'Vẽ ảnh', color: '#E91E63', action: () => openDrawingCanvas(index) },
        { icon: 'fa-image', text: 'Gửi ảnh', color: '#10B981', action: () => sendImageFromChat(index) },
        { icon: 'fa-file', text: 'Gửi file', color: '#3B82F6', action: () => sendFileFromChat(index) },
        { icon: 'fa-map-marker-alt', text: 'Vị trí', color: '#F59E0B', action: () => sendLocationFromChat(index) },
        { icon: 'fa-poll', text: 'Bình chọn', color: '#8B5CF6', action: () => createPollFromChat(index) }
    ];
    
    items.forEach(item => {
        const btn = document.createElement('button');
        btn.style.cssText = `
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 14px;
            border: none;
            background: none;
            cursor: pointer;
            border-radius: 10px;
            font-size: 14px;
            color: ${THEME.text};
            transition: all 0.15s;
            text-align: left;
        `;
        btn.innerHTML = `
            <div style="width: 32px; height: 32px; border-radius: 50%; background: ${item.color}15; display: flex; align-items: center; justify-content: center; color: ${item.color};">
                <i class="fas ${item.icon}" style="font-size: 13px;"></i>
            </div>
            <span style="font-weight: 500;">${item.text}</span>
        `;
        btn.onmouseover = () => {
            btn.style.background = THEME.background;
        };
        btn.onmouseout = () => {
            btn.style.background = 'none';
        };
        btn.onclick = (e) => {
            e.stopPropagation();
            item.action();
            menu.remove();
        };
        menu.appendChild(btn);
    });
    
    document.body.appendChild(menu);
    
    // Close on click outside
    setTimeout(() => {
        const closeHandler = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeHandler);
            }
        };
        document.addEventListener('click', closeHandler);
    }, 100);
}

// ====== SEND IMAGE ======
function sendImageFromChat(index) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => handleFileSelect(e, index, 'image');
    input.click();
}

// ====== OPEN DRAWING CANVAS (Instagram Style) ======
function openDrawingCanvas(index) {
    const chat = floatingChats[index];
    if (!chat) return;
    
    // Remove existing canvas
    const existing = document.getElementById(`drawing-canvas-${index}`);
    if (existing) existing.remove();
    
    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = `drawing-canvas-${index}`;
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.95);
        z-index: 100010;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
    `;
    
    // Canvas container
    const canvasContainer = document.createElement('div');
    canvasContainer.style.cssText = `
        position: relative;
        width: 360px;
        height: 480px;
        background: linear-gradient(135deg, #3eb489 0%, #2d9cdb 100%);
        border-radius: 16px;
        overflow: hidden;
        box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    `;
    
    // Canvas
    const canvas = document.createElement('canvas');
    canvas.width = 360;
    canvas.height = 480;
    canvas.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        cursor: crosshair;
    `;
    
    const ctx = canvas.getContext('2d');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ffffff';
    
    // Gradient presets
    const gradients = [
        'linear-gradient(135deg, #3eb489 0%, #2d9cdb 100%)',
        'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
        'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
        'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
        'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
        'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
        'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
        'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
    ];
    let currentGradient = 0;
    
    // Text overlay for vibe
    const textOverlay = document.createElement('div');
    textOverlay.contentEditable = true;
    textOverlay.innerText = 'Nhập tin nhắn...';
    textOverlay.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 28px;
        font-weight: 700;
        color: white;
        text-align: center;
        width: 80%;
        outline: none;
        text-shadow: 0 2px 10px rgba(0,0,0,0.3);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        letter-spacing: -0.5px;
        cursor: text;
    `;
    
    // Drawing state
    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;
    
    // Drawing events
    function startDrawing(e) {
        isDrawing = true;
        const rect = canvas.getBoundingClientRect();
        lastX = (e.clientX || e.touches[0].clientX) - rect.left;
        lastY = (e.clientY || e.touches[0].clientY) - rect.top;
    }
    
    function draw(e) {
        if (!isDrawing) return;
        e.preventDefault();
        
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX || e.touches[0].clientX) - rect.left;
        const y = (e.clientY || e.touches[0].clientY) - rect.top;
        
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(x, y);
        ctx.stroke();
        
        lastX = x;
        lastY = y;
    }
    
    function stopDrawing() {
        isDrawing = false;
    }
    
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);
    canvas.addEventListener('touchstart', startDrawing);
    canvas.addEventListener('touchmove', draw);
    canvas.addEventListener('touchend', stopDrawing);
    
    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.style.cssText = `
        position: absolute;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        gap: 12px;
        background: rgba(0,0,0,0.6);
        padding: 12px 20px;
        border-radius: 30px;
        backdrop-filter: blur(10px);
    `;
    
    // Color picker
    const colors = ['#ffffff', '#ff6b6b', '#4ecdc4', '#ffe66d', '#1a535c', '#f7fff7', '#ff006e', '#8338ec'];
    colors.forEach(color => {
        const colorBtn = document.createElement('button');
        colorBtn.style.cssText = `
            width: 28px;
            height: 28px;
            border-radius: 50%;
            border: 3px solid ${ctx.strokeStyle === color ? 'white' : 'transparent'};
            background: ${color};
            cursor: pointer;
            transition: all 0.2s;
        `;
        colorBtn.onclick = () => {
            ctx.strokeStyle = color;
            // Update all color buttons border
            toolbar.querySelectorAll('button').forEach(btn => {
                if (colors.includes(btn.style.background)) {
                    btn.style.border = '3px solid transparent';
                }
            });
            colorBtn.style.border = '3px solid white';
        };
        toolbar.appendChild(colorBtn);
    });
    
    // Brush size
    const sizeBtn = document.createElement('button');
    sizeBtn.innerHTML = '<i class="fas fa-circle"></i>';
    sizeBtn.style.cssText = `
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: none;
        background: white;
        color: black;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 8px;
    `;
    const sizes = [2, 4, 8, 12, 20];
    let sizeIndex = 1;
    sizeBtn.onclick = () => {
        sizeIndex = (sizeIndex + 1) % sizes.length;
        ctx.lineWidth = sizes[sizeIndex];
        sizeBtn.style.fontSize = sizes[sizeIndex] + 'px';
    };
    toolbar.appendChild(sizeBtn);
    
    // Change background
    const bgBtn = document.createElement('button');
    bgBtn.innerHTML = '<i class="fas fa-palette"></i>';
    bgBtn.style.cssText = `
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: none;
        background: white;
        color: black;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
    `;
    bgBtn.onclick = () => {
        currentGradient = (currentGradient + 1) % gradients.length;
        canvasContainer.style.background = gradients[currentGradient];
    };
    toolbar.appendChild(bgBtn);
    
    // Clear button
    const clearBtn = document.createElement('button');
    clearBtn.innerHTML = '<i class="fas fa-trash"></i>';
    clearBtn.style.cssText = `
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: none;
        background: #ff4757;
        color: white;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
    `;
    clearBtn.onclick = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
    toolbar.appendChild(clearBtn);
    
    // Top bar
    const topBar = document.createElement('div');
    topBar.style.cssText = `
        position: absolute;
        top: 20px;
        left: 20px;
        right: 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
    `;
    
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '<i class="fas fa-times"></i>';
    closeBtn.style.cssText = `
        width: 40px;
        height: 40px;
        border-radius: 50%;
        border: none;
        background: rgba(0,0,0,0.5);
        color: white;
        cursor: pointer;
        font-size: 18px;
        backdrop-filter: blur(10px);
    `;
    closeBtn.onclick = () => overlay.remove();
    
    const sendBtn = document.createElement('button');
    sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Gửi';
    sendBtn.style.cssText = `
        padding: 12px 24px;
        border-radius: 24px;
        border: none;
        background: white;
        color: #333;
        cursor: pointer;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
    `;
    sendBtn.onclick = () => {
        // Combine canvas and text
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = 360;
        finalCanvas.height = 480;
        const finalCtx = finalCanvas.getContext('2d');
        
        // Draw background
        finalCtx.fillStyle = canvasContainer.style.background;
        finalCtx.fillRect(0, 0, 360, 480);
        
        // Draw canvas content
        finalCtx.drawImage(canvas, 0, 0);
        
        // Get data URL
        const dataUrl = finalCanvas.toDataURL('image/png');
        
        // Send as image
        if (socket && chat) {
            const imageData = {
                type: 'image',
                url: dataUrl,
                name: 'drawing.png',
                mime_type: 'image/png'
            };
            
            if (chat.type === 'group') {
                socket.emit('send_group_message', {
                    group_id: chat.conversationId,
                    content: JSON.stringify(imageData),
                    message_type: 'image'
                });
            } else {
                socket.emit('send_message', {
                    conversation_id: chat.conversationId,
                    content: JSON.stringify(imageData),
                    message_type: 'image'
                });
            }
        }
        
        // Add locally
        appendMessageToChat(index, {
            sender_id: window.session?.user_id,
            content: JSON.stringify({
                type: 'image',
                url: dataUrl,
                thumbnail: dataUrl
            }),
            message_type: 'image',
            created_at: new Date().toISOString()
        });
        
        overlay.remove();
        showToast('Đã gửi tin nhắn vẽ!', 'success');
    };
    
    topBar.appendChild(closeBtn);
    topBar.appendChild(sendBtn);
    
    // Assemble
    canvasContainer.appendChild(canvas);
    canvasContainer.appendChild(textOverlay);
    canvasContainer.appendChild(toolbar);
    canvasContainer.appendChild(topBar);
    overlay.appendChild(canvasContainer);
    document.body.appendChild(overlay);
}

// ====== SEND FILE ======
function sendFileFromChat(index) {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = (e) => handleFileSelect(e, index, 'file');
    input.click();
}

// ====== HANDLE FILE SELECT ======
async function handleFileSelect(e, index, type) {
    const file = e.target.files[0];
    if (!file) return;
    
    const chat = floatingChats[index];
    if (!chat) return;
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('conversation_id', chat.conversationId);
    formData.append('conversation_type', chat.type);
    
    try {
        showToast(`Đang tải ${type === 'image' ? 'ảnh' : 'file'}...`, 'info');
        
        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        if (data.success) {
            const fileData = {
                type: type,
                url: data.url,
                name: file.name,
                size: file.size,
                mime_type: file.type
            };
            
            if (type === 'image' && data.thumbnail) {
                fileData.thumbnail = data.thumbnail;
            }
            
            // Send message
            if (socket) {
                if (chat.type === 'group') {
                    socket.emit('send_group_message', {
                        group_id: chat.conversationId,
                        content: JSON.stringify(fileData),
                        message_type: type
                    });
                } else {
                    socket.emit('send_message', {
                        conversation_id: chat.conversationId,
                        content: JSON.stringify(fileData),
                        message_type: type
                    });
                }
            }
            
            showToast('Đã gửi!', 'success');
        }
    } catch (err) {
        showToast('Lỗi tải file!', 'error');
    }
}

// ====== SEND LOCATION ======
function sendLocationFromChat(index) {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => {
            const { latitude, longitude } = pos.coords;
            const locationData = {
                type: 'location',
                lat: latitude,
                lng: longitude,
                address: 'Vị trí của tôi'
            };
            
            const chat = floatingChats[index];
            if (socket && chat) {
                if (chat.type === 'group') {
                    socket.emit('send_group_message', {
                        group_id: chat.conversationId,
                        content: JSON.stringify(locationData),
                        message_type: 'location'
                    });
                } else {
                    socket.emit('send_message', {
                        conversation_id: chat.conversationId,
                        content: JSON.stringify(locationData),
                        message_type: 'location'
                    });
                }
            }
        });
    }
}

// ====== CREATE POLL ======
function createPollFromChat(index) {
    const question = prompt('Nhập câu hỏi bình chọn:');
    if (!question) return;
    
    const optionsText = prompt('Nhập các lựa chọn (cách nhau bằng dấu phẩy):');
    if (!optionsText) return;
    
    const options = optionsText.split(',').map((opt, idx) => ({
        id: idx,
        text: opt.trim(),
        voters: []
    }));
    
    const pollData = {
        type: 'poll',
        question: question,
        options: options
    };
    
    const chat = floatingChats[index];
    if (socket && chat) {
        if (chat.type === 'group') {
            socket.emit('send_group_message', {
                group_id: chat.conversationId,
                content: JSON.stringify(pollData),
                message_type: 'poll'
            });
        } else {
            socket.emit('send_message', {
                conversation_id: chat.conversationId,
                content: JSON.stringify(pollData),
                message_type: 'poll'
            });
        }
    }
}

// ====== START CALL ======
function startCallFromChat(index, mode) {
    const chat = floatingChats[index];
    if (!chat || !socket) {
        alert('Không thể thực hiện cuộc gọi');
        return;
    }
    
    if (chat.type === 'group') {
        socket.emit('call:invite_group', {
            conversation_id: chat.conversationId,
            conversation_type: 'group',
            call_mode: mode
        });
    } else {
        fetch(`/api/conversation/${chat.conversationId}`)
            .then(r => r.json())
            .then(data => {
                const myId = window.session?.user_id;
                const recipient = data.participants?.find(p => String(p) !== String(myId));
                if (recipient) {
                    socket.emit('call:invite_private', {
                        conversation_id: chat.conversationId,
                        recipient_id: recipient,
                        conversation_type: 'private',
                        call_mode: mode
                    });
                }
            });
    }
}

// ====== TOAST NOTIFICATION ======
function showToast(message, type = 'info') {
    const colors = { 
        info: THEME.primary, 
        success: '#10B981', 
        error: '#EF4444' 
    };
    
    // Remove existing toasts
    const existing = document.querySelectorAll('.floating-chat-toast');
    existing.forEach(t => t.remove());
    
    const toast = document.createElement('div');
    toast.className = 'floating-chat-toast';
    toast.style.cssText = `
        position: fixed;
        bottom: 100px;
        left: 50%;
        transform: translateX(-50%);
        background: ${colors[type]};
        color: white;
        padding: 12px 24px;
        border-radius: 24px;
        font-size: 14px;
        z-index: 100002;
        box-shadow: 0 4px 16px rgba(0,0,0,0.2);
        animation: slideUp 0.3s ease;
        font-weight: 500;
    `;
    toast.innerHTML = `
        <i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}" style="margin-right: 8px;"></i>
        ${message}
    `;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideDown 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

// ====== ESCAPE HTML ======
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ====== PLUS BUTTON - OPEN NEW CHAT DIALOG ======
function openNewChatDialog() {
    // Remove existing
    const existing = document.getElementById('new-chat-dialog');
    if (existing) {
        existing.remove();
        return;
    }
    
    const dialog = document.createElement('div');
    dialog.id = 'new-chat-dialog';
    dialog.style.cssText = `
        position: fixed;
        bottom: 90px;
        right: 20px;
        width: 320px;
        max-height: 400px;
        background: white;
        border-radius: 16px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.2);
        z-index: 10000;
        overflow: hidden;
        display: flex;
        flex-direction: column;
    `;
    
    dialog.innerHTML = `
        <div style="padding: 16px; border-bottom: 1px solid #e0e0e0;">
            <div style="font-weight: 600; font-size: 16px; margin-bottom: 12px;">Tin nhắn mới</div>
            <input type="text" id="new-chat-search" placeholder="Tìm kiếm người dùng..." style="
                width: 100%;
                padding: 10px 14px;
                border: 1px solid #e0e0e0;
                border-radius: 20px;
                font-size: 14px;
                outline: none;
            " oninput="searchUsers(this.value)">
        </div>
        <div id="new-chat-results" style="flex: 1; overflow-y: auto; padding: 8px;">
            <div style="text-align: center; color: #999; padding: 20px;">
                Nhập tên để tìm kiếm
            </div>
        </div>
    `;
    
    document.body.appendChild(dialog);
    
    // Focus input
    setTimeout(() => document.getElementById('new-chat-search')?.focus(), 100);
    
    // Close on click outside
    setTimeout(() => {
        const closeHandler = (e) => {
            if (!dialog.contains(e.target) && !e.target.closest('.floating-plus-btn')) {
                dialog.remove();
                document.removeEventListener('click', closeHandler);
            }
        };
        document.addEventListener('click', closeHandler);
    }, 100);
}

// ====== SEARCH USERS ======
function searchUsers(query) {
    const resultsDiv = document.getElementById('new-chat-results');
    if (!query.trim()) {
        resultsDiv.innerHTML = '<div style="text-align: center; color: #999; padding: 20px;">Nhập tên để tìm kiếm</div>';
        return;
    }
    
    resultsDiv.innerHTML = '<div style="text-align: center; padding: 20px;"><i class="fas fa-spinner fa-spin"></i></div>';
    
    fetch(`/api/search_users?q=${encodeURIComponent(query)}`)
        .then(r => r.json())
        .then(data => {
            const users = data.users || [];
            if (users.length === 0) {
                resultsDiv.innerHTML = '<div style="text-align: center; color: #999; padding: 20px;">Không tìm thấy</div>';
                return;
            }
            
            resultsDiv.innerHTML = users.map(u => `
                <div onclick="startNewChat('${u.id}', '${escapeHtml(u.name)}', '${u.avatar_url || ''}')" style="
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 10px 12px;
                    cursor: pointer;
                    border-radius: 8px;
                    transition: background 0.2s;
                " onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background='none'">
                    <img src="${u.avatar_url || '/static/img/default-avatar.png'}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover;">
                    <div style="flex: 1;">
                        <div style="font-weight: 500; font-size: 14px;">${escapeHtml(u.name)}</div>
                        <div style="font-size: 12px; color: #888;">@${escapeHtml(u.username || '')}</div>
                    </div>
                </div>
            `).join('');
        })
        .catch(() => {
            resultsDiv.innerHTML = '<div style="text-align: center; color: #999; padding: 20px;">Lỗi tìm kiếm</div>';
        });
}

// ====== START NEW CHAT ======
function startNewChat(userId, name, avatar) {
    // Create conversation
    fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participant_id: userId })
    })
    .then(r => r.json())
    .then(data => {
        openFloatingChat(data.conversation_id, 'private', name, avatar);
        document.getElementById('new-chat-dialog')?.remove();
    })
    .catch(() => {
        showToast('Không thể tạo cuộc trò chuyện', 'error');
    });
}

// ====== SOCKET EVENTS FOR MULTI-CHAT ======
function setupMultiChatSocketEvents() {
    if (!socket) return;
    
    socket.on('receive_message', (data) => {
        const chatIndex = floatingChats.findIndex(
            c => c.conversationId === data.conversation_id && c.type === 'private'
        );
        
        if (chatIndex >= 0) {
            appendMessageToChat(chatIndex, data);
        } else if (String(data.sender_id) !== String(window.session?.user_id)) {
            // Auto open if not me
            openFloatingChat(data.conversation_id, 'private', data.sender_name, data.sender_avatar);
        }
    });
    
    socket.on('group_message', (data) => {
        const chatIndex = floatingChats.findIndex(
            c => c.conversationId === data.group_id && c.type === 'group'
        );
        
        if (chatIndex >= 0) {
            appendMessageToChat(chatIndex, data);
        } else if (String(data.sender_id) !== String(window.session?.user_id)) {
            openFloatingChat(data.group_id, 'group', data.group_name, data.sender_avatar);
        }
    });
}

// ====== CREATE PLUS BUTTON ======
function createFloatingPlusButton() {
    const btn = document.createElement('button');
    btn.className = 'floating-plus-btn';
    btn.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: linear-gradient(135deg, ${THEME.primary} 0%, ${THEME.secondary} 100%);
        border: none;
        color: white;
        font-size: 26px;
        cursor: pointer;
        box-shadow: 0 4px 16px rgba(79, 70, 229, 0.4);
        z-index: 9998;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    `;
    btn.innerHTML = '<i class="fas fa-plus"></i>';
    
    // Better click handler
    btn.addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        openNewChatDialog();
    });
    
    // Hover effects
    btn.addEventListener('mouseenter', () => {
        btn.style.transform = 'scale(1.1)';
        btn.style.boxShadow = '0 6px 24px rgba(79, 70, 229, 0.5)';
    });
    btn.addEventListener('mouseleave', () => {
        btn.style.transform = 'scale(1)';
        btn.style.boxShadow = '0 4px 16px rgba(79, 70, 229, 0.4)';
    });
    
    document.body.appendChild(btn);
}

// ====== INITIALIZE ======
document.addEventListener('DOMContentLoaded', () => {
    setupMultiChatSocketEvents();
    createFloatingPlusButton();
});

// Add animations
const style = document.createElement('style');
style.textContent = `
    @keyframes fadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
    }
    
    .floating-chat-widget {
        animation: fadeIn 0.3s ease;
    }
    
    .floating-chat-widget::-webkit-scrollbar {
        width: 6px;
    }
    
    .floating-chat-widget::-webkit-scrollbar-track {
        background: transparent;
    }
    
    .floating-chat-widget::-webkit-scrollbar-thumb {
        background: #ddd;
        border-radius: 3px;
    }
`;
document.head.appendChild(style);
