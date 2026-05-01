// app/static/js/post_detail.js
// ==================== KHỞI TẠO ====================

// DOM Elements
const likeBtn = document.getElementById('like-btn');
const likeCount = document.getElementById('like-count');
const commentBtn = document.getElementById('comment-btn');
const commentInput = document.getElementById('comment-input');
const submitComment = document.getElementById('submit-comment');
const commentsList = document.getElementById('comments-list');
const commentCount = document.getElementById('comment-count');
const shareBtn = document.getElementById('share-btn');

// Media Viewer Elements
const mediaViewer = document.getElementById('media-viewer');
const viewerMedia = document.getElementById('viewer-media');
const viewerCounter = document.getElementById('viewer-counter');
const viewerIndicators = document.getElementById('viewer-indicators');
const prevMediaBtn = document.getElementById('prev-media');
const nextMediaBtn = document.getElementById('next-media');
const closeViewerBtn = document.getElementById('close-viewer');

// State variables
let currentMediaIndex = 0;
let postMedia = [];
let replyToCommentId = null;
let isProcessing = false;

/**
 * Hiển thị menu chia sẻ với nhiều tùy chọn
 */
function showShareMenu(postId) {
    // 1. Đóng các menu cũ nếu có
    document.querySelectorAll('.share-menu-modal').forEach(el => el.remove());

    // 2. Thêm CSS (QUAN TRỌNG: Nếu thiếu cái này modal sẽ không hiện hoặc vỡ)
    addShareMenuStyles();

    // 3. Tạo HTML cho Menu
    const menuHTML = `
        <div class="share-menu-modal" id="share-menu-${postId}">
            <div class="share-menu-overlay"></div>
            <div class="share-menu-content">
                <div class="share-menu-header">
                    <h3>Chia sẻ</h3>
                    <button class="close-menu-btn">&times;</button>
                </div>
                <div class="share-menu-body">
                    <button class="share-item" onclick="handleShareToProfile('${postId}')">
                        <div class="share-icon"><i class="fas fa-user-edit"></i></div>
                        <div class="share-text">
                            <strong>Viết bài công khai</strong>
                            <span>Chia sẻ lên trang cá nhân của bạn</span>
                        </div>
                    </button>

                    <button class="share-item" onclick="window.shareToMessageWithDialog ? window.shareToMessageWithDialog('${postId}') : alert('Chức năng đang cập nhật')">
                        <div class="share-icon"><i class="fas fa-comment-dots"></i></div>
                        <div class="share-text">
                            <strong>Gửi qua tin nhắn</strong>
                            <span>Gửi cho bạn bè hoặc nhóm</span>
                        </div>
                    </button>
                    
                    <button class="share-item" onclick="handleCopyLink('${postId}')">
                        <div class="share-icon"><i class="fas fa-link"></i></div>
                        <div class="share-text">
                            <strong>Sao chép liên kết</strong>
                            <span>Lưu đường dẫn bài viết này</span>
                        </div>
                    </button>
                </div>
            </div>
        </div>
    `;

    // 4. Chèn vào body
    document.body.insertAdjacentHTML('beforeend', menuHTML);

    // 5. Gắn sự kiện đóng menu
    const modal = document.getElementById(`share-menu-${postId}`);
    const closeBtn = modal.querySelector('.close-menu-btn');
    const overlay = modal.querySelector('.share-menu-overlay');

    const closeMenu = () => modal.remove();
    
    closeBtn.addEventListener('click', closeMenu);
    overlay.addEventListener('click', closeMenu);
}
window.handleShareToProfile = function(id) {
    // Đóng menu nhỏ trước
    const menu = document.getElementById(`share-menu-${id}`);
    if(menu) menu.remove();

    // Gọi hàm global từ file share_modal.js
    if (window.shareToProfile) {
        window.shareToProfile(id);
    } else if (window.shareModal && window.shareModal.openShareToProfile) {
        window.shareModal.openShareToProfile(id);
    } else {
        console.error('Không tìm thấy hàm shareToProfile. Kiểm tra lại file share_modal.js');
        alert('Lỗi: Chưa tải được thư viện chia sẻ.');
    }
};

// Hàm copy link
window.handleCopyLink = function(id) {
    const link = `${window.location.origin}/post/${id}`;
    navigator.clipboard.writeText(link).then(() => {
        alert('Đã sao chép liên kết!');
        const menu = document.getElementById(`share-menu-${id}`);
        if(menu) menu.remove();
    }).catch(err => {
        console.error('Failed to copy: ', err);
    });
};

function addShareMenuStyles() {
    if (document.getElementById('share-menu-style')) return;

    const css = `
        .share-menu-modal {
            position: fixed;
            top: 0; left: 0; width: 100%; height: 100%;
            z-index: 9999;
            display: flex;
            align-items: flex-end; /* Mobile: hiện ở dưới đáy */
            justify-content: center;
        }
        .share-menu-overlay {
            position: absolute;
            top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.5);
            backdrop-filter: blur(2px);
        }
        .share-menu-content {
            position: relative;
            background: white;
            width: 100%;
            max-width: 500px;
            border-radius: 20px 20px 0 0;
            padding: 20px;
            animation: slideUp 0.3s ease-out;
            z-index: 10000;
        }
        @media (min-width: 768px) {
            .share-menu-modal { align-items: center; }
            .share-menu-content { border-radius: 12px; }
        }
        .share-menu-header {
            display: flex; justify-content: space-between; align-items: center;
            margin-bottom: 20px; border-bottom: 1px solid #eee; padding-bottom: 10px;
        }
        .share-menu-header h3 { margin: 0; font-size: 18px; }
        .close-menu-btn {
            background: none; border: none; font-size: 24px; cursor: pointer;
        }
        .share-item {
            display: flex; align-items: center; width: 100%;
            padding: 15px; border: none; background: none;
            text-align: left; cursor: pointer; border-radius: 10px;
            transition: background 0.2s;
        }
        .share-item:hover { background-color: #f5f5f5; }
        .share-icon {
            width: 40px; height: 40px; background: #e4e6eb;
            border-radius: 50%; display: flex; align-items: center;
            justify-content: center; margin-right: 15px; font-size: 20px;
        }
        .share-text { display: flex; flex-direction: column; }
        .share-text strong { font-size: 15px; color: #050505; }
        .share-text span { font-size: 13px; color: #65676b; }
        
        @keyframes slideUp {
            from { transform: translateY(100%); }
            to { transform: translateY(0); }
        }
    `;
    const style = document.createElement('style');
    style.id = 'share-menu-style';
    style.textContent = css;
    document.head.appendChild(style);
}

/**
 * Chia sẻ bài viết về trang cá nhân
 */
async function shareToProfile(postId) {
    try {
        const content = prompt("Nhập nội dung chia sẻ (có thể để trống):", "");
        if (content === null) return;
        
        const response = await fetch('/share_post', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                post_id: postId,
                content: content || '',
                share_type: 'profile'
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        
        if (result.success) {
            showNotification('Đã chia sẻ bài viết về trang cá nhân!', 'success');
            closeShareModal(postId);
        } else {
            showNotification(result.error || 'Lỗi khi chia sẻ bài viết', 'error');
        }
    } catch (error) {
        console.error('Share error:', error);
        showNotification('Lỗi kết nối khi chia sẻ', 'error');
    }
}

/**
 * Chia sẻ bài viết qua tin nhắn với dialog chọn người nhận
 */
async function shareToMessageWithDialog(postId) {
    openShareToMessageDialog(postId);
}

/**
 * Mở dialog chọn bạn bè/nhóm để chia sẻ
 */
async function openShareToMessageDialog(postId) {
    try {
        // Tải danh sách bạn bè và nhóm
        const [friendsResponse, groupsResponse] = await Promise.all([
            fetch('/get_friends'),
            fetch('/get_user_groups')
        ]);
        
        const friendsData = await friendsResponse.json();
        const groupsData = await groupsResponse.json();
        
        // Tạo dialog
        const dialogHTML = `
            <div class="share-recipient-modal" id="share-recipient-modal-${postId}">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3><i class="fas fa-users"></i> Chọn người nhận</h3>
                        <button class="close-btn" onclick="closeRecipientModal('${postId}')">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="search-container">
                            <input type="text" id="share-search-${postId}" class="form-input" 
                                   placeholder="Tìm bạn bè hoặc nhóm...">
                        </div>
                        
                        <div class="recipient-tabs">
                            <button class="tab-btn active" data-tab="friends">Bạn bè (${friendsData.friends?.length || 0})</button>
                            <button class="tab-btn" data-tab="groups">Nhóm (${groupsData.groups?.length || 0})</button>
                        </div>
                        
                        <div class="recipient-list" id="friends-list-${postId}">
                            ${friendsData.friends?.map(friend => `
                                <div class="recipient-item" data-id="${friend._id}" data-type="friend">
                                    <img src="${friend.avatar}" alt="${friend.username}" class="recipient-avatar">
                                    <div class="recipient-info">
                                        <strong>${friend.username}</strong>
                                        <small>${friend.online ? '🟢 Đang online' : '⚫ Offline'}</small>
                                    </div>
                                    <input type="checkbox" class="recipient-checkbox">
                                </div>
                            `).join('') || '<p class="no-items">Chưa có bạn bè</p>'}
                        </div>
                        
                        <div class="recipient-list" id="groups-list-${postId}" style="display: none;">
                            ${groupsData.groups?.map(group => `
                                <div class="recipient-item" data-id="${group._id}" data-type="group">
                                    <img src="${group.avatar || '/static/img/group-default.png'}" alt="${group.name}" class="recipient-avatar">
                                    <div class="recipient-info">
                                        <strong>${group.name}</strong>
                                        <small>${group.member_count || 0} thành viên</small>
                                    </div>
                                    <input type="checkbox" class="recipient-checkbox">
                                </div>
                            `).join('') || '<p class="no-items">Chưa tham gia nhóm nào</p>'}
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-outline" onclick="closeRecipientModal('${postId}')">Hủy</button>
                        <button class="btn btn-primary" onclick="shareToSelectedRecipients('${postId}')" id="share-selected-btn-${postId}" disabled>
                            <i class="fas fa-paper-plane"></i> Gửi (0)
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', dialogHTML);
        
        // Gắn sự kiện
        document.querySelectorAll(`#share-recipient-modal-${postId} .tab-btn[data-tab]`).forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tab = e.target.dataset.tab;
                document.querySelectorAll(`#share-recipient-modal-${postId} .tab-btn`).forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                document.getElementById(`friends-list-${postId}`).style.display = tab === 'friends' ? 'block' : 'none';
                document.getElementById(`groups-list-${postId}`).style.display = tab === 'groups' ? 'block' : 'none';
            });
        });
        
        document.querySelectorAll(`#share-recipient-modal-${postId} .recipient-checkbox`).forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                updateSelectedCount(postId);
            });
        });
        
        const searchInput = document.getElementById(`share-search-${postId}`);
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                filterRecipients(postId, e.target.value);
            });
        }
        
        addRecipientModalStyles();
        
    } catch (error) {
        console.error('Error loading recipients:', error);
        showNotification('Lỗi khi tải danh sách bạn bè/nhóm', 'error');
        // Fallback: sử dụng prompt cũ
        shareToMessageOld(postId);
    }
}

/**
 * Chia sẻ bài viết đến người nhận đã chọn
 */
async function shareToSelectedRecipients(postId) {
    try {
        const selectedItems = document.querySelectorAll(`#share-recipient-modal-${postId} .recipient-checkbox:checked`);
        
        if (selectedItems.length === 0) {
            showNotification('Vui lòng chọn ít nhất một người nhận', 'warning');
            return;
        }
        
        const content = prompt("Nhập tin nhắn kèm theo (có thể để trống):", "");
        if (content === null) return;
        
        const recipients = [];
        selectedItems.forEach(checkbox => {
            const item = checkbox.closest('.recipient-item');
            recipients.push({
                id: item.dataset.id,
                type: item.dataset.type
            });
        });
        
        const promises = recipients.map(async (recipient) => {
            const requestData = {
                post_id: postId,
                content: content || '',
                share_type: 'message',
                target_id: recipient.id,
                target_type: recipient.type
            };
            
            const response = await fetch('/share_post', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestData)
            });
            
            return response.json();
        });
        
        const results = await Promise.allSettled(promises);
        
        let successCount = 0;
        let errorCount = 0;
        
        results.forEach((result) => {
            if (result.status === 'fulfilled' && result.value.success) {
                successCount++;
            } else {
                errorCount++;
            }
        });
        
        closeRecipientModal(postId);
        closeShareModal(postId);
        
        if (successCount > 0) {
            showNotification(`Đã gửi bài viết đến ${successCount} người nhận!`, 'success');
        }
        
        if (errorCount > 0) {
            showNotification(`${errorCount} tin nhắn gửi thất bại`, 'warning');
        }
        
    } catch (error) {
        console.error('Share error:', error);
        showNotification('Lỗi khi chia sẻ bài viết', 'error');
    }
}

/**
 * Chia sẻ bài viết về tin nổi bật (story)
 */
async function shareToStory(postId) {
    try {
        const response = await fetch('/share_post', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                post_id: postId,
                content: '',
                share_type: 'story'
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        
        if (result.success) {
            showNotification('Đã đăng bài viết vào tin nổi bật!', 'success');
            closeShareModal(postId);
        } else {
            showNotification(result.error || 'Lỗi khi đăng vào tin nổi bật', 'error');
        }
    } catch (error) {
        console.error('Share to story error:', error);
        showNotification('Lỗi kết nối khi chia sẻ', 'error');
    }
}

/**
 * Chia sẻ bài viết ra bên ngoài
 */
async function shareToExternal(postId) {
    const postUrl = `${window.location.origin}/post/${postId}`;
    
    if (navigator.share) {
        try {
            await navigator.share({
                title: 'PAW TALK - Bài viết hay',
                text: 'Xem bài viết này trên PAW TALK',
                url: postUrl
            });
            showNotification('Đã chia sẻ bài viết!', 'success');
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('Share error:', error);
                copyPostLink(postId);
            }
        }
    } else {
        copyPostLink(postId);
    }
    
    closeShareModal(postId);
}

/**
 * Sao chép link bài viết
 */
function copyPostLink(postId) {
    const postUrl = `${window.location.origin}/post/${postId}`;
    navigator.clipboard.writeText(postUrl)
        .then(() => {
            showNotification('Đã sao chép liên kết bài viết!', 'success');
        })
        .catch(err => {
            console.error('Copy failed:', err);
            showNotification('Lỗi khi sao chép liên kết', 'error');
        });
    closeShareModal(postId);
}

/**
 * Đóng share modal
 */
function closeShareModal(postId) {
    const modal = document.getElementById(`share-modal-${postId}`);
    if (modal) {
        modal.remove();
    }
}

/**
 * Đóng recipient modal
 */
function closeRecipientModal(postId) {
    const modal = document.getElementById(`share-recipient-modal-${postId}`);
    if (modal) {
        modal.remove();
    }
}

/**
 * Cập nhật số lượng người được chọn
 */
function updateSelectedCount(postId) {
    const checkboxes = document.querySelectorAll(`#share-recipient-modal-${postId} .recipient-checkbox:checked`);
    const shareBtn = document.getElementById(`share-selected-btn-${postId}`);
    
    if (shareBtn) {
        const count = checkboxes.length;
        shareBtn.textContent = count > 0 ? `Gửi (${count})` : 'Gửi';
        shareBtn.disabled = count === 0;
    }
}

/**
 * Lọc danh sách người nhận
 */
function filterRecipients(postId, searchTerm) {
    const items = document.querySelectorAll(`#share-recipient-modal-${postId} .recipient-item`);
    const term = searchTerm.toLowerCase();
    
    items.forEach(item => {
        const name = item.querySelector('.recipient-info strong').textContent.toLowerCase();
        const isVisible = name.includes(term);
        item.style.display = isVisible ? 'flex' : 'none';
    });
}

/**
 * Chia sẻ bài viết qua tin nhắn - VERSION CŨ (dự phòng)
 */
async function shareToMessageOld(postId) {
    try {
        const friendId = prompt("Nhập ID người bạn muốn chia sẻ (hoặc để trống để chia sẻ vào group):", "");
        if (friendId === null) return;
        
        const content = prompt("Nhập tin nhắn kèm theo (có thể để trống):", "");
        
        const requestData = {
            post_id: postId,
            content: content || '',
            share_type: 'message'
        };
        
        if (friendId) {
            requestData.target_id = friendId;
        }
        
        const response = await fetch('/share_post', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        
        if (result.success) {
            showNotification('Đã chia sẻ bài viết qua tin nhắn!', 'success');
        } else {
            showNotification(result.error || 'Lỗi khi chia sẻ bài viết', 'error');
        }
    } catch (error) {
        console.error('Share error:', error);
        showNotification('Lỗi kết nối khi chia sẻ', 'error');
    }
}

/**
 * Thêm CSS cho share modal
 */
function addShareModalStyles() {
    if (!document.querySelector('#share-modal-styles')) {
        const styles = document.createElement('style');
        styles.id = 'share-modal-styles';
        styles.textContent = `
            .share-modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 1000;
            }
            .share-modal .modal-content {
                background: white;
                border-radius: 12px;
                width: 90%;
                max-width: 400px;
                animation: slideUp 0.3s ease;
            }
            .share-modal .modal-header {
                padding: 20px;
                border-bottom: 1px solid #e0e0e0;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .share-modal .modal-header h3 {
                margin: 0;
                font-size: 18px;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .share-modal .close-btn {
                background: none;
                border: none;
                font-size: 24px;
                cursor: pointer;
                color: #666;
                padding: 0;
                width: 30px;
                height: 30px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 50%;
                transition: background 0.2s;
            }
            .share-modal .close-btn:hover {
                background: #f5f5f5;
            }
            .share-modal .modal-body {
                padding: 20px;
            }
            .share-option-btn {
                width: 100%;
                padding: 15px;
                background: none;
                border: none;
                border-radius: 8px;
                margin-bottom: 10px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 15px;
                transition: background 0.2s;
                text-align: left;
            }
            .share-option-btn:hover {
                background: #f5f5f5;
            }
            .share-option-icon {
                width: 40px;
                height: 40px;
                border-radius: 50%;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-size: 18px;
            }
            .share-option-text {
                flex: 1;
            }
            .share-option-text strong {
                display: block;
                font-size: 14px;
                font-weight: 600;
                margin-bottom: 3px;
            }
            .share-option-text small {
                font-size: 12px;
                color: #666;
            }
            @keyframes slideUp {
                from { transform: translateY(20px); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }
        `;
        document.head.appendChild(styles);
    }
}

/**
 * Thêm CSS cho recipient modal
 */
function addRecipientModalStyles() {
    if (!document.querySelector('#recipient-modal-styles')) {
        const styles = document.createElement('style');
        styles.id = 'recipient-modal-styles';
        styles.textContent = `
            .share-recipient-modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 1001;
            }
            .share-recipient-modal .modal-content {
                background: white;
                border-radius: 12px;
                width: 90%;
                max-width: 500px;
                max-height: 80vh;
                display: flex;
                flex-direction: column;
                animation: slideUp 0.3s ease;
            }
            .share-recipient-modal .modal-header {
                padding: 20px;
                border-bottom: 1px solid #e0e0e0;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .share-recipient-modal .modal-header h3 {
                margin: 0;
                font-size: 18px;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .share-recipient-modal .modal-body {
                padding: 20px;
                flex: 1;
                overflow-y: auto;
            }
            .share-recipient-modal .search-container {
                margin-bottom: 15px;
            }
            .recipient-tabs {
                display: flex;
                gap: 5px;
                margin-bottom: 15px;
                border-bottom: 1px solid #e0e0e0;
                padding-bottom: 10px;
            }
            .tab-btn {
                padding: 8px 16px;
                background: none;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-weight: 500;
                transition: background 0.2s;
            }
            .tab-btn.active {
                background: #007bff;
                color: white;
            }
            .recipient-list {
                max-height: 300px;
                overflow-y: auto;
            }
            .recipient-item {
                display: flex;
                align-items: center;
                padding: 10px;
                border-radius: 8px;
                margin-bottom: 5px;
                cursor: pointer;
                transition: background 0.2s;
            }
            .recipient-item:hover {
                background: #f5f5f5;
            }
            .recipient-avatar {
                width: 40px;
                height: 40px;
                border-radius: 50%;
                object-fit: cover;
                margin-right: 12px;
            }
            .recipient-info {
                flex: 1;
            }
            .recipient-info strong {
                display: block;
                font-size: 14px;
            }
            .recipient-info small {
                font-size: 12px;
                color: #666;
            }
            .recipient-checkbox {
                width: 18px;
                height: 18px;
                cursor: pointer;
            }
            .no-items {
                text-align: center;
                padding: 20px;
                color: #999;
                font-style: italic;
            }
            .share-recipient-modal .modal-footer {
                padding: 15px 20px;
                border-top: 1px solid #e0e0e0;
                display: flex;
                justify-content: flex-end;
                gap: 10px;
            }
        `;
        document.head.appendChild(styles);
    }
}
// ==================== CẬP NHẬT EVENT LISTENERS ====================

function attachPostDetailListeners() {
    console.log('Attaching post detail listeners...');
    
    // Share button event - SỬA LẠI HOÀN TOÀN
    const shareBtn = document.getElementById('share-btn');
    if (shareBtn) {
        // Xóa tất cả event listeners cũ
        shareBtn.replaceWith(shareBtn.cloneNode(true));
        const newShareBtn = document.getElementById('share-btn');
        
        // Gắn event listener mới
        newShareBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            const postId = window.postId;
            console.log('Share button clicked, postId:', postId);
            
            if (postId) {
                // Hiển thị menu chia sẻ của chúng ta
                showShareMenu(postId);
            } else {
                // Thử lấy từ URL
                const path = window.location.pathname.split('/');
                const idFromUrl = path[path.length - 1];
                if (idFromUrl && idFromUrl !== 'post') {
                    showShareMenu(idFromUrl);
                } else {
                    showNotification('Không tìm thấy bài viết để chia sẻ', 'error');
                }
            }
        });
    }
    
    // Gắn sự kiện cho nút share trong post stats (nếu có)
    const shareStatBtn = document.querySelector('.share-btn');
    if (shareStatBtn && shareStatBtn.dataset.postId) {
        shareStatBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            showShareMenu(this.dataset.postId);
        });
    }
}

// ==================== CÁC HÀM HỖ TRỢ ====================
let currentReplyTarget = null;

/**
 * Thiết lập trạng thái reply
 */
function setupReply(commentId, username) {
    currentReplyTarget = {
        commentId: commentId,
        username: username
    };
    
    // Hiển thị reply indicator
    const replyIndicator = document.getElementById('reply-indicator');
    const replyTargetName = document.getElementById('reply-target-name');
    
    if (replyIndicator && replyTargetName) {
        replyTargetName.textContent = `@${username}`;
        replyIndicator.style.display = 'block';
    }
    
    // Thay đổi placeholder của input
    const commentInput = document.getElementById('comment-input');
    if (commentInput) {
        commentInput.placeholder = `Trả lời ${username}...`;
        commentInput.focus();
    }
}

/**
 * Hủy trạng thái reply
 */
function cancelReply() {
    currentReplyTarget = null;
    
    // Ẩn reply indicator
    const replyIndicator = document.getElementById('reply-indicator');
    if (replyIndicator) {
        replyIndicator.style.display = 'none';
    }
    
    // Khôi phục placeholder
    const commentInput = document.getElementById('comment-input');
    if (commentInput) {
        commentInput.placeholder = 'Viết bình luận...';
    }
}

/**
 * Xử lý gửi comment/reply
 */
async function submitCommentHandler() {
    if (isProcessing) return;
    
    const content = commentInput.value.trim();
    
    if (!content) {
        showNotification('Vui lòng nhập nội dung bình luận', 'warning');
        return;
    }
    
    isProcessing = true;
    
    try {
        // Disable button và hiển thị loading
        submitComment.disabled = true;
        submitComment.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        
        const commentData = {
            post_id: postId,
            content: content
        };
        
        // Thêm thông tin reply nếu đang reply
        if (currentReplyTarget) {
            commentData.reply_to = currentReplyTarget.commentId;
            commentData.reply_to_username = currentReplyTarget.username;
        }
        
        const response = await fetch('/comment_post', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(commentData)
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Thêm comment mới vào UI
            addCommentToUI(data.comment, currentReplyTarget);
            
            // Reset form
            commentInput.value = '';
            cancelReply();
            
            // Cập nhật số lượng comment
            updateTotalCommentCount();
            
            showNotification('Đã thêm bình luận', 'success');
        } else {
            showNotification(data.error || 'Lỗi khi đăng bình luận', 'error');
        }
    } catch (error) {
        console.error('Error posting comment:', error);
        showNotification('Lỗi kết nối khi đăng bình luận', 'error');
    } finally {
        isProcessing = false;
        submitComment.disabled = false;
        submitComment.innerHTML = '<i class="fas fa-paper-plane"></i>';
    }
}

/**
 * Thêm comment/reply mới vào UI
 */
function addCommentToUI(commentData, replyTarget = null) {
    const commentsList = document.getElementById('comments-list');
    const noComments = document.querySelector('.no-comments');
    
    // Xóa thông báo "chưa có comment" nếu có
    if (noComments) {
        noComments.remove();
    }
    
    if (replyTarget) {
        // Đây là reply - thêm vào replies container
        const replyContainerId = `replies-${postId}-${replyTarget.commentId}`;
        let repliesContainer = document.getElementById(replyContainerId);
        
        if (!repliesContainer) {
            // Tạo replies container nếu chưa có
            const parentComment = document.querySelector(`.comment-item[data-comment-id="${replyTarget.commentId}"]`);
            if (parentComment) {
                const commentContent = parentComment.querySelector('.comment-content');
                
                // Tạo container
                repliesContainer = document.createElement('div');
                repliesContainer.className = 'comment-replies-container';
                repliesContainer.id = replyContainerId;
                repliesContainer.style.display = 'block'; // Hiển thị khi có reply mới
                
                // Tạo list
                const repliesList = document.createElement('div');
                repliesList.className = 'comment-replies';
                repliesList.id = `replies-list-${postId}-${replyTarget.commentId}`;
                
                repliesContainer.appendChild(repliesList);
                commentContent.appendChild(repliesContainer);
                
                // Cập nhật nút view replies
                updateViewRepliesButton(replyTarget.commentId, 1);
            }
        }
        
        if (repliesContainer) {
            const repliesList = repliesContainer.querySelector('.comment-replies');
            const replyHTML = createReplyHTML(commentData, replyTarget.username);
            repliesList.insertAdjacentHTML('beforeend', replyHTML);
            
            // Process hashtags in the new reply
            const newReply = repliesList.lastElementChild;
            processNewComment(newReply);
            
            // Cập nhật số lượng replies
            const repliesCount = repliesList.querySelectorAll('.comment-reply').length;
            updateViewRepliesButton(replyTarget.commentId, repliesCount);
        }
    } else {
        // Đây là comment mới - thêm vào đầu danh sách
        const commentHTML = createCommentHTML(commentData);
        commentsList.insertAdjacentHTML('afterbegin', commentHTML);
        
        // Process hashtags in the new comment
        const newComment = commentsList.firstElementChild;
        processNewComment(newComment);
    }
    
    // Cập nhật tổng số comment
    const totalCountElement = document.getElementById('total-comment-count');
    if (totalCountElement) {
        const currentCount = parseInt(totalCountElement.textContent) || 0;
        totalCountElement.textContent = currentCount + 1;
    }
}

/**
 * Tạo HTML cho comment chính
 */
function createCommentHTML(commentData) {
    return `
        <div class="comment-item" data-comment-id="${commentData.id}" data-post-id="${postId}">
            <img src="${commentData.user_avatar}" alt="${commentData.full_name || commentData.username}" class="comment-avatar">
            <div class="comment-content">
                <div class="comment-header">
                    <strong>${commentData.full_name || commentData.username}</strong>
                    <span class="comment-time">${getTimeAgo(new Date(commentData.created_at))}</span>
                </div>
                <p class="comment-text">${formatPostContent(escapeHtml(commentData.content))}</p>
                <div class="comment-actions">
                    <button class="comment-action-btn like-comment-btn" 
                            data-post-id="${postId}" 
                            data-comment-id="${commentData.id}">
                        <i class="fas fa-heart"></i>
                        <span class="comment-like-count">${commentData.likes ? commentData.likes.length : 0}</span>
                    </button>
                    <button class="comment-action-btn reply-comment-btn" 
                            data-post-id="${postId}" 
                            data-comment-id="${commentData.id}"
                            data-username="${commentData.username}">
                        <i class="fas fa-reply"></i> Trả lời
                    </button>
                </div>
            </div>
        </div>
    `;
}

/**
 * Tạo HTML cho reply
 */
function createReplyHTML(replyData, replyToUsername) {
    return `
        <div class="comment-reply" data-comment-id="${replyData.id}" data-post-id="${postId}"
             data-reply-to="${replyData.reply_to}" data-reply-username="${replyToUsername}">
            <img src="${replyData.user_avatar}" alt="${replyData.full_name || replyData.username}" class="comment-avatar-small">
            <div class="comment-content">
                <div class="comment-header">
                    <strong>${replyData.full_name || replyData.username}</strong>
                    <span class="reply-to-text">→ Trả lời @${replyToUsername}</span>
                    <span class="comment-time">${getTimeAgo(new Date(replyData.created_at))}</span>
                </div>
                <p class="comment-text">${formatPostContent(escapeHtml(replyData.content))}</p>
                <div class="comment-actions">
                    <button class="comment-action-btn like-comment-btn" 
                            data-post-id="${postId}" 
                            data-comment-id="${replyData.id}"
                            data-reply-id="${replyData.id}">
                        <i class="fas fa-heart"></i>
                        <span class="comment-like-count">${replyData.likes ? replyData.likes.length : 0}</span>
                    </button>
                    <button class="comment-action-btn reply-comment-btn" 
                            data-post-id="${postId}" 
                            data-comment-id="${replyData.id}"
                            data-username="${replyData.username}"
                            data-reply-to="${replyData.reply_to}">
                        <i class="fas fa-reply"></i> Trả lời
                    </button>
                </div>
            </div>
        </div>
    `;
}

/**
 * Cập nhật nút view replies
 */
function updateViewRepliesButton(commentId, count) {
    const viewRepliesBtn = document.querySelector(`.view-replies-btn[data-comment-id="${commentId}"]`);
    
    if (!viewRepliesBtn) {
        // Tạo nút nếu chưa có
        const commentItem = document.querySelector(`.comment-item[data-comment-id="${commentId}"]`);
        if (commentItem) {
            const commentActions = commentItem.querySelector('.comment-actions');
            if (commentActions) {
                const newButton = document.createElement('button');
                newButton.className = 'comment-action-btn view-replies-btn';
                newButton.dataset.postId = postId;
                newButton.dataset.commentId = commentId;
                newButton.innerHTML = `
                    <i class="fas fa-comments"></i>
                    <span class="reply-count">${count}</span> trả lời
                    <i class="fas fa-chevron-down toggle-icon"></i>
                `;
                newButton.addEventListener('click', () => toggleReplies(commentId));
                commentActions.appendChild(newButton);
            }
        }
    } else {
        // Cập nhật số lượng
        const countSpan = viewRepliesBtn.querySelector('.reply-count');
        if (countSpan) {
            countSpan.textContent = count;
        }
    }
}

/**
 * Hiển thị/ẩn replies
 */
function toggleReplies(commentId) {
    console.log(`Toggling replies for comment: ${commentId}`);
    
    const repliesContainer = document.getElementById(`replies-${postId}-${commentId}`);
    const toggleBtn = document.querySelector(`.view-replies-btn[data-comment-id="${commentId}"]`);
    
    if (!repliesContainer || !toggleBtn) {
        console.log(`Không tìm thấy replies container (${repliesContainer ? 'có' : 'không'}) hoặc toggle button (${toggleBtn ? 'có' : 'không'})`);
        return;
    }
    
    const isHidden = repliesContainer.style.display === 'none' || repliesContainer.style.display === '';
    const toggleIcon = toggleBtn.querySelector('.toggle-icon');
    
    console.log(`Trạng thái hiện tại: ${isHidden ? 'ẩn' : 'hiển thị'}`);
    
    if (isHidden) {
        repliesContainer.style.display = 'block';
        if (toggleIcon) {
            toggleIcon.className = 'fas fa-chevron-up toggle-icon';
        }
        console.log('Đã hiển thị replies');
    } else {
        repliesContainer.style.display = 'none';
        if (toggleIcon) {
            toggleIcon.className = 'fas fa-chevron-down toggle-icon';
        }
        console.log('Đã ẩn replies');
    }
}
// ==================== ATTACH EVENT LISTENERS ====================

/**
 * Gắn sự kiện cho các nút reply
 */
function attachReplyEventListeners() {
    // Event delegation cho reply buttons
    document.addEventListener('click', function(e) {
        const replyBtn = e.target.closest('.reply-comment-btn');
        if (replyBtn && replyBtn.dataset.commentId) {
            e.preventDefault();
            e.stopPropagation();
            
            const commentId = replyBtn.dataset.commentId;
            const username = replyBtn.dataset.username;
            
            setupReply(commentId, username);
            return false;
        }
        
        // Nút hủy reply
        const cancelReplyBtn = e.target.closest('#cancel-reply');
        if (cancelReplyBtn) {
            e.preventDefault();
            cancelReply();
            return false;
        }
        
        // Nút view replies
        const viewRepliesBtn = e.target.closest('.view-replies-btn');
        if (viewRepliesBtn && viewRepliesBtn.dataset.commentId) {
            e.preventDefault();
            e.stopPropagation();
            
            const commentId = viewRepliesBtn.dataset.commentId;
            toggleReplies(commentId);
            return false;
        }
    });
}

/**
 * Hiển thị thông báo
 */
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <i class="fas fa-${type === 'success' ? 'check' : type === 'error' ? 'exclamation-triangle' : 'info'}-circle"></i>
            <span>${message}</span>
        </div>
    `;
    
    // Thêm styles nếu chưa có
    if (!document.querySelector('#notification-styles')) {
        const styles = document.createElement('style');
        styles.id = 'notification-styles';
        styles.textContent = `
            .notification {
                position: fixed;
                top: 20px;
                right: 20px;
                background: white;
                padding: 15px 20px;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                z-index: 10000;
                border-left: 4px solid #007bff;
                animation: slideIn 0.3s ease;
                max-width: 400px;
            }
            .notification-success {
                border-left-color: #28a745;
            }
            .notification-error {
                border-left-color: #dc3545;
            }
            .notification-warning {
                border-left-color: #ffc107;
            }
            .notification-content {
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .notification-content i {
                font-size: 18px;
            }
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            @keyframes slideOut {
                from { transform: translateX(0); opacity: 1; }
                to { transform: translateX(100%); opacity: 0; }
            }
        `;
        document.head.appendChild(styles);
    }
    
    document.body.appendChild(notification);
    
    // Tự động xóa sau 4 giây
    setTimeout(() => {
        if (notification.parentNode) {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }
    }, 4000);
}

/**
 * Cập nhật số lượng like trong UI
 */
function updateLikeUI(liked, newCount) {
    // Cập nhật nút like
    likeBtn.classList.toggle('liked', liked);
    likeBtn.innerHTML = liked 
        ? '<i class="fas fa-heart"></i><span>Bỏ thích</span>'
        : '<i class="fas fa-heart"></i><span>Thích</span>';
    
    // Cập nhật số lượng like
    likeCount.textContent = newCount;
    
    // CHỈ CẬP NHẬT NẾU ELEMENT TỒN TẠI
    const likeStat = document.getElementById('like-stat');
    if (likeStat) {
        likeStat.classList.toggle('liked', liked);
        const likeCountInStat = likeStat.querySelector('.like-count');
        if (likeCountInStat) {
            likeCountInStat.textContent = newCount;
        }
    }
}

/**
 * Cập nhật số lượng bình luận
 */
function updateCommentCount(change) {
    const currentCount = parseInt(commentCount.textContent) || 0;
    const newCount = Math.max(0, currentCount + change);
    commentCount.textContent = newCount;
    
    // Cập nhật tiêu đề phần bình luận
    const commentTitle = document.querySelector('.comments-section h3');
    if (commentTitle) {
        commentTitle.textContent = `Bình luận (${newCount})`;
    }
}

// ==================== LIKE FUNCTIONALITY ====================

/**
 * Xử lý like/unlike bài viết
 */
async function likePost() {
    if (isProcessing) return;
    isProcessing = true;
    
    try {
        const response = await fetch('/like_post', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ post_id: postId })
        });
        
        const data = await response.json();
        
        if (data.success) {
            updateLikeUI(data.liked, data.like_count);
            showNotification(data.liked ? 'Đã thích bài viết' : 'Đã bỏ thích bài viết', 'success');
        } else {
            showNotification(data.error || 'Lỗi khi thích bài viết', 'error');
        }
    } catch (error) {
        console.error('Error liking post:', error);
        showNotification('Lỗi kết nối khi thích bài viết', 'error');
    } finally {
        isProcessing = false;
    }
}

// ==================== COMMENT FUNCTIONALITY ====================

/**
 * Xử lý gửi bình luận
 */
async function submitCommentHandler() {
    if (isProcessing) return;
    
    const content = commentInput.value.trim();
    
    if (!content) {
        showNotification('Vui lòng nhập nội dung bình luận', 'warning');
        return;
    }
    
    isProcessing = true;
    
    try {
        // Disable button and show loading
        submitComment.disabled = true;
        submitComment.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        
        const commentData = {
            post_id: postId,
            content: content
        };
        
        // Thêm reply_to nếu đang trả lời bình luận
        if (replyToCommentId) {
            commentData.reply_to = replyToCommentId;
        }
        
        const response = await fetch('/comment_post', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(commentData)
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Thêm bình luận mới vào UI
            addCommentToUI(data.comment);
            
            // Cập nhật số lượng bình luận
            updateCommentCount(1);
            
            // Xóa input
            commentInput.value = '';
            
            // Xóa trạng thái reply
            clearReplyState();
            
            showNotification('Đã thêm bình luận', 'success');
        } else {
            showNotification(data.error || 'Lỗi khi đăng bình luận', 'error');
        }
    } catch (error) {
        console.error('Error posting comment:', error);
        showNotification('Lỗi kết nối khi đăng bình luận', 'error');
    } finally {
        isProcessing = false;
        submitComment.disabled = false;
        submitComment.innerHTML = '<i class="fas fa-paper-plane"></i>';
    }
}

/**
 * Thêm bình luận mới vào UI
 */
function addCommentToUI(comment) {
    // Tạo element bình luận
    const commentItem = document.createElement('div');
    commentItem.className = 'comment-item';
    commentItem.dataset.commentId = comment.id;
    
    // Xử lý thời gian
    const commentTime = comment.created_at ? new Date(comment.created_at) : new Date();
    const timeAgo = getTimeAgo(commentTime);
    
    // Xử lý avatar
    let avatarUrl = comment.user_avatar;
    if (avatarUrl && !avatarUrl.startsWith('http') && !avatarUrl.startsWith('data:image') && !avatarUrl.startsWith('/static')) {
        avatarUrl = `/static/${avatarUrl}`;
    } else if (!avatarUrl) {
        avatarUrl = '/static/img/default-avatar.png';
    }
    
    // Tạo HTML cho bình luận (có hỗ trợ trả lời)
    commentItem.innerHTML = `
        <img src="${avatarUrl}" alt="${comment.full_name || comment.username}" class="comment-avatar">
        <div class="comment-content">
            <div class="comment-header">
                <strong>${comment.full_name || comment.username}</strong>
                <span class="comment-time">${timeAgo}</span>
            </div>
            ${comment.reply_to ? '<div class="comment-reply-to">Trả lời <span class="reply-target">@' + (comment.reply_to_username || 'người dùng') + '</span></div>' : ''}
            <p class="comment-text">${formatPostContent(escapeHtml(comment.content))}</p>
            <div class="comment-actions">
                <button class="comment-action-btn like-comment-btn" data-comment-id="${comment.id}">
                    <i class="far fa-heart"></i>
                    <span class="comment-like-count">0</span>
                </button>
                <button class="comment-action-btn reply-comment-btn" data-comment-id="${comment.id}">
                    <i class="far fa-comment"></i>
                    Trả lời
                </button>
            </div>
            ${comment.replies && comment.replies.length > 0 ? 
                `<div class="comment-replies">
                    ${comment.replies.map(reply => `
                        <div class="comment-reply-item" data-comment-id="${reply.id}">
                            <img src="${reply.user_avatar || '/static/img/default-avatar.png'}" alt="${reply.full_name || reply.username}" class="comment-avatar">
                            <div class="comment-content">
                                <div class="comment-header">
                                    <strong>${reply.full_name || reply.username}</strong>
                                    <span class="comment-time">${getTimeAgo(new Date(reply.created_at))}</span>
                                </div>
                                <p class="comment-text">${formatPostContent(escapeHtml(reply.content))}</p>
                            </div>
                        </div>
                    `).join('')}
                </div>` : ''
            }
        </div>
    `;
    
    // Xóa thông báo "chưa có bình luận" nếu tồn tại
    const noComments = document.querySelector('.no-comments');
    if (noComments) {
        noComments.remove();
    }
    
    // Thêm vào đầu danh sách bình luận
    commentsList.prepend(commentItem);
    
    // Gắn sự kiện cho các nút trong bình luận mới
    attachCommentEventListeners(commentItem);
    
    // Scroll đến bình luận mới
    commentItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Escape HTML để tránh XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Tính thời gian "cách đây"
 */
function getTimeAgo(date) {
    // Kiểm tra nếu date không hợp lệ
    if (!(date instanceof Date) || isNaN(date.getTime())) {
        return 'Vừa xong';
    }
    
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);
    
    if (diffSec < 60) {
        return 'Vừa xong';
    } else if (diffMin < 60) {
        return `${diffMin} phút trước`;
    } else if (diffHour < 24) {
        return `${diffHour} giờ trước`;
    } else if (diffDay < 7) {
        return `${diffDay} ngày trước`;
    } else {
        return date.toLocaleDateString('vi-VN');
    }
}

/**
 * Gắn sự kiện cho các nút trong bình luận
 */
function attachCommentEventListeners(commentElement) {
    // Nút like bình luận
    const likeBtn = commentElement.querySelector('.like-comment-btn');
    if (likeBtn) {
        likeBtn.addEventListener('click', function() {
            const commentId = this.dataset.commentId;
            likeComment(commentId, this);
        });
    }
    
    // Nút trả lời bình luận
    const replyBtn = commentElement.querySelector('.reply-comment-btn');
    if (replyBtn) {
        replyBtn.addEventListener('click', function() {
            const commentId = this.dataset.commentId;
            const commentElement = this.closest('.comment-item');
            const username = commentElement.querySelector('.comment-header strong').textContent;
            setReplyState(commentId, username);
        });
    }
}

/**
 * Thiết lập trạng thái trả lời bình luận
 */
function setReplyState(commentId, username) {
    replyToCommentId = commentId;
    
    // Tạo hoặc cập nhật UI cho trạng thái reply
    let replyIndicator = document.querySelector('.reply-indicator');
    if (!replyIndicator) {
        replyIndicator = document.createElement('div');
        replyIndicator.className = 'reply-indicator';
        replyIndicator.innerHTML = `
            <div class="reply-indicator-content">
                <span>Đang trả lời <strong>@${username}</strong></span>
                <button class="cancel-reply-btn">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
        
        const commentForm = document.querySelector('.comment-form');
        commentForm.parentNode.insertBefore(replyIndicator, commentForm);
        
        // Gắn sự kiện cho nút hủy reply
        replyIndicator.querySelector('.cancel-reply-btn').addEventListener('click', clearReplyState);
    } else {
        replyIndicator.querySelector('strong').textContent = `@${username}`;
    }
    
    // Focus vào input
    commentInput.focus();
    commentInput.placeholder = `Trả lời ${username}...`;
    
    // Thêm class để style
    commentInput.classList.add('replying');
}

/**
 * Xóa trạng thái trả lời bình luận
 */
function clearReplyState() {
    replyToCommentId = null;
    
    // Xóa UI indicator
    const replyIndicator = document.querySelector('.reply-indicator');
    if (replyIndicator) {
        replyIndicator.remove();
    }
    
    // Reset input
    commentInput.placeholder = 'Viết bình luận...';
    commentInput.classList.remove('replying');
}

// ==================== COMMENT LIKE FUNCTIONALITY ====================

/**
 * Xử lý like/unlike bình luận
 */
async function likeComment(commentId, buttonElement) {
    if (isProcessing) return;
    isProcessing = true;
    
    try {
        // TODO: Tạo API endpoint cho like bình luận
        // Tạm thời xử lý ở client-side
        const likeCountElement = buttonElement.querySelector('.comment-like-count');
        const currentLikes = parseInt(likeCountElement.textContent) || 0;
        const isLiked = buttonElement.classList.contains('liked');
        
        // Toggle trạng thái like
        if (isLiked) {
            buttonElement.classList.remove('liked');
            buttonElement.querySelector('i').className = 'far fa-heart';
            likeCountElement.textContent = Math.max(0, currentLikes - 1);
        } else {
            buttonElement.classList.add('liked');
            buttonElement.querySelector('i').className = 'fas fa-heart';
            likeCountElement.textContent = currentLikes + 1;
        }
        
        // Gửi request đến server (khi có API)
        // const response = await fetch('/like_comment', {
        //     method: 'POST',
        //     headers: { 'Content-Type': 'application/json' },
        //     body: JSON.stringify({ comment_id: commentId })
        // });
        
    } catch (error) {
        console.error('Error liking comment:', error);
    } finally {
        isProcessing = false;
    }
}

// ==================== MEDIA VIEWER FUNCTIONALITY ====================
/**
 * Khởi tạo sự kiện cho media viewer
 */
function initializeMediaViewerEvents() {
    const closeBtn = document.getElementById('close-media-viewer');
    const prevBtn = document.getElementById('viewer-prev-btn');
    const nextBtn = document.getElementById('viewer-next-btn');
    const downloadBtn = document.getElementById('download-media-btn');
    const modal = document.getElementById('media-viewer-modal');
    
    if (closeBtn) closeBtn.addEventListener('click', closeMediaViewer);
    if (prevBtn) prevBtn.addEventListener('click', viewerPrev);
    if (nextBtn) nextBtn.addEventListener('click', viewerNext);
    if (downloadBtn) downloadBtn.addEventListener('click', downloadCurrentMedia);
    
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeMediaViewer();
        });
    }
    
    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        if (!window.currentMediaViewer) return;
        
        switch(e.key) {
            case 'Escape':
                closeMediaViewer();
                break;
            case 'ArrowLeft':
                viewerPrev();
                break;
            case 'ArrowRight':
                viewerNext();
                break;
        }
    });
}
/**
 * Khởi tạo media viewer
 */
function initializeMediaViewer() {
    // Thu thập tất cả media từ bài viết
    const mediaElements = document.querySelectorAll('.post-media-detail img, .post-media-detail video, .media-item img, .media-item video');
    
    postMedia = [];
    mediaElements.forEach((element, index) => {
        let url, type;
        
        if (element.tagName === 'IMG') {
            url = element.src;
            type = 'image';
        } else if (element.tagName === 'VIDEO') {
            const source = element.querySelector('source');
            url = source ? source.src : element.src;
            type = 'video';
        }
        
        if (url) {
            postMedia.push({
                url: url,
                type: type,
                element: element
            });
            
            // Thêm sự kiện click để mở viewer
            element.style.cursor = 'pointer';
            element.addEventListener('click', () => openMediaViewer(index));
        }
    });
}

/**
 * Mở media viewer
 */
function openMediaViewer(index) {
    if (index < 0 || index >= postMedia.length) return;
    
    currentMediaIndex = index;
    updateMediaViewer();
    mediaViewer.classList.add('active');
    document.body.style.overflow = 'hidden';
}

/**
 * Cập nhật nội dung media viewer
 */
function updateMediaViewer() {
    if (!postMedia || postMedia.length === 0) return;
    
    const media = postMedia[currentMediaIndex];
    viewerMedia.innerHTML = '';
    
    if (media.type === 'image') {
        const img = document.createElement('img');
        img.src = media.url;
        img.alt = 'Post image';
        img.className = 'viewer-media-item';
        viewerMedia.appendChild(img);
    } else if (media.type === 'video') {
        const video = document.createElement('video');
        video.controls = true;
        video.autoplay = true;
        video.className = 'viewer-media-item';
        const source = document.createElement('source');
        source.src = media.url;
        source.type = 'video/mp4';
        video.appendChild(source);
        viewerMedia.appendChild(video);
    }
    
    // Cập nhật counter
    viewerCounter.textContent = `${currentMediaIndex + 1} / ${postMedia.length}`;
    
    // Cập nhật indicators
    viewerIndicators.innerHTML = '';
    for (let i = 0; i < postMedia.length; i++) {
        const indicator = document.createElement('button');
        indicator.className = `viewer-indicator ${i === currentMediaIndex ? 'active' : ''}`;
        indicator.addEventListener('click', () => {
            currentMediaIndex = i;
            updateMediaViewer();
        });
        viewerIndicators.appendChild(indicator);
    }
    
    // Cập nhật nút navigation
    prevMediaBtn.disabled = currentMediaIndex === 0;
    nextMediaBtn.disabled = currentMediaIndex === postMedia.length - 1;
}

/**
 * Đóng media viewer
 */
function closeMediaViewer() {
    mediaViewer.classList.remove('active');
    document.body.style.overflow = 'auto';
}

/**
 * Xử lý điều hướng media viewer
 */
function prevMedia() {
    if (currentMediaIndex > 0) {
        currentMediaIndex--;
        updateMediaViewer();
    }
}

function nextMedia() {
    if (currentMediaIndex < postMedia.length - 1) {
        currentMediaIndex++;
        updateMediaViewer();
    }
}

// ==================== SHARE FUNCTIONALITY ====================

/**
 * Xử lý chia sẻ bài viết
 */
function sharePost() {
    // Lấy postId từ global hoặc URL
    let postId = window.postId;
    
    if (!postId) {
        // Thử lấy từ URL
        const path = window.location.pathname.split('/');
        const idFromUrl = path[path.length - 1];
        if (idFromUrl && idFromUrl !== 'post') {
            postId = idFromUrl;
        }
    }
    
    if (postId) {
        // Hiển thị menu chia sẻ tùy chỉnh của chúng ta
        showShareMenu(postId);
    } else {
        // Fallback: hiển thị thông báo lỗi
        showNotification('Không tìm thấy ID bài viết', 'error');
    }
}


// ==================== COMMENT REPLY UI ENHANCEMENT ====================

/**
 * Thêm CSS cho giao diện trả lời bình luận
 */
function addReplyStyles() {
    if (!document.querySelector('#reply-styles')) {
        const styles = document.createElement('style');
        styles.id = 'reply-styles';
        styles.textContent = `
            .reply-indicator {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 10px 15px;
                border-radius: 8px;
                margin-bottom: 10px;
                animation: slideDown 0.3s ease;
            }
            
            .reply-indicator-content {
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            
            .cancel-reply-btn {
                background: rgba(255, 255, 255, 0.2);
                border: none;
                color: white;
                width: 24px;
                height: 24px;
                border-radius: 50%;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background 0.2s;
            }
            
            .cancel-reply-btn:hover {
                background: rgba(255, 255, 255, 0.3);
            }
            
            .comment-input.replying {
                border-color: #667eea;
                background: #f8f9ff;
            }
            
            .comment-reply-to {
                background: #f1f3ff;
                padding: 4px 8px;
                border-radius: 4px;
                margin: 5px 0;
                font-size: 12px;
                color: #667eea;
            }
            
            .comment-reply-to .reply-target {
                font-weight: bold;
            }
            
            .comment-replies {
                margin-top: 10px;
                padding-left: 20px;
                border-left: 2px solid #e0e0e0;
            }
            
            .comment-reply-item {
                display: flex;
                gap: 10px;
                margin-bottom: 10px;
            }
            
            .comment-reply-item:last-child {
                margin-bottom: 0;
            }
            
            .comment-reply-item .comment-avatar {
                width: 28px;
                height: 28px;
            }
            
            .comment-reply-item .comment-content {
                flex: 1;
            }
            
            .comment-reply-item .comment-header {
                font-size: 13px;
            }
            
            .comment-reply-item .comment-text {
                font-size: 14px;
                margin: 5px 0 0 0;
            }
            
            .comment-actions {
                display: flex;
                gap: 15px;
                margin-top: 8px;
            }
            
            .comment-action-btn {
                background: none;
                border: none;
                color: #666;
                font-size: 12px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 4px;
                padding: 4px 8px;
                border-radius: 4px;
                transition: all 0.2s;
            }
            
            .comment-action-btn:hover {
                background: #f5f5f5;
                color: #333;
            }
            
            .comment-action-btn.liked {
                color: #e74c3c;
            }
            
            .comment-action-btn.liked:hover {
                color: #c0392b;
            }
            
            @keyframes slideDown {
                from {
                    transform: translateY(-10px);
                    opacity: 0;
                }
                to {
                    transform: translateY(0);
                    opacity: 1;
                }
            }
        `;
        document.head.appendChild(styles);
    }
}

// ==================== LOAD COMMENTS FUNCTIONALITY ====================

/**
 * Tải thêm bình luận (phân trang)
 */
async function loadMoreComments() {
    // TODO: Implement pagination for comments
    // Hiện tại tất cả bình luận đã được tải trong HTML template
}

// ==================== EVENT LISTENERS ====================

/**
 * Gắn tất cả event listeners
 */
function attachEventListeners() {
    console.log('Attaching event listeners...');
    
    // Like post
    if (likeBtn) {
        likeBtn.addEventListener('click', likePost);
    }
    
    // Like stats click - show who liked the post
    const likeStat = document.getElementById('like-stat');
    if (likeStat) {
        likeStat.addEventListener('click', viewPostLikes);
        likeStat.style.cursor = 'pointer';
    }
    
    // Comment submit button
    if (submitComment) {
        submitComment.addEventListener('click', submitCommentHandler);
    }
    
    // Comment input (Enter to submit, Shift+Enter for new line)
    if (commentInput) {
        commentInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitCommentHandler();
            }
        });
        
        // Auto-resize textarea
        commentInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
        });
    }
    
    // Share button
    if (shareBtn) {
        shareBtn.addEventListener('click', sharePost);
    }
    
    // Media viewer navigation
    if (prevMediaBtn) {
        prevMediaBtn.addEventListener('click', prevMedia);
    }
    
    if (nextMediaBtn) {
        nextMediaBtn.addEventListener('click', nextMedia);
    }
    
    if (closeViewerBtn) {
        closeViewerBtn.addEventListener('click', closeMediaViewer);
    }
    
    // Close media viewer với ESC key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && mediaViewer.classList.contains('active')) {
            closeMediaViewer();
        }
    });
    
    // Click outside media viewer to close
    if (mediaViewer) {
        mediaViewer.addEventListener('click', (e) => {
            if (e.target === mediaViewer) {
                closeMediaViewer();
            }
        });
    }
    
    // Gắn sự kiện cho nút hủy reply
    const cancelReplyBtn = document.getElementById('cancel-reply');
    if (cancelReplyBtn) {
        cancelReplyBtn.addEventListener('click', cancelReply);
    }
    const viewRepliesButtons = document.querySelectorAll('.view-replies-btn');
    console.log(`Found ${viewRepliesButtons.length} view replies buttons in template`);
    
    viewRepliesButtons.forEach(button => {
        const commentId = button.dataset.commentId;
        console.log(`Found view replies button for comment ${commentId}`);
        
        // Gắn sự kiện trực tiếp cho các nút đã có
        button.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log(`Direct click on view replies for comment ${commentId}`);
            toggleReplies(commentId);
        });
    });
    
    // Gắn sự kiện cho các nút reply và like comment
    attachCommentInteractionListeners();
}
/**
 * Gắn sự kiện cho các nút tương tác với comment
 */
function attachCommentInteractionListeners() {
    console.log('Attaching comment interaction listeners...');
    
    // Sử dụng event delegation
    document.addEventListener('click', function(e) {
        // Nút reply
        const replyBtn = e.target.closest('.reply-comment-btn');
        if (replyBtn) {
            e.preventDefault();
            e.stopPropagation();
            
            const commentId = replyBtn.dataset.commentId;
            const username = replyBtn.dataset.username;
            
            console.log(`Setting up reply to comment ${commentId}, user: ${username}`);
            setupReply(commentId, username);
            return false;
        }
        
        // Nút like comment
        const likeBtn = e.target.closest('.like-comment-btn');
        if (likeBtn) {
            e.preventDefault();
            e.stopPropagation();
            
            const commentId = likeBtn.dataset.commentId;
            const postId = likeBtn.dataset.postId;
            const replyId = likeBtn.dataset.replyId;
            
            console.log(`Liking comment ${commentId}, reply: ${replyId}`);
            likeCommentHandler(postId, commentId, replyId);
            return false;
        }
        
        // Nút view replies - SỬA LẠI PHẦN NÀY
        const viewRepliesBtn = e.target.closest('.view-replies-btn');
        if (viewRepliesBtn) {
            e.preventDefault();
            e.stopPropagation();
            
            const commentId = viewRepliesBtn.dataset.commentId;
            console.log(`Toggling replies for comment ${commentId}`);
            toggleReplies(commentId);
            return false;
        }
    });
}

/**
 * Xử lý like/unlike comment
 */
async function likeCommentHandler(postId, commentId, replyId = null) {
    if (isProcessing) {
        console.log('Like action already in progress');
        return;
    }
    
    isProcessing = true;
    
    try {
        // Tìm element của comment
        const selector = replyId ? 
            `.comment-reply[data-comment-id="${commentId}"]` :
            `.comment-item[data-comment-id="${commentId}"]`;
        
        const commentElement = document.querySelector(selector);
        if (!commentElement) {
            console.error('Comment element not found');
            return;
        }
        
        const likeBtn = commentElement.querySelector('.like-comment-btn');
        const likeCountElement = commentElement.querySelector('.comment-like-count');
        
        if (!likeBtn || !likeCountElement) {
            console.error('Like button or count element not found');
            return;
        }
        
        // Lưu trạng thái ban đầu
        const originalLiked = likeBtn.classList.contains('liked');
        const originalCount = parseInt(likeCountElement.textContent) || 0;
        
        // Optimistic update
        if (originalLiked) {
            likeBtn.classList.remove('liked');
            likeBtn.querySelector('i').className = 'fas fa-heart';
            likeCountElement.textContent = Math.max(0, originalCount - 1);
        } else {
            likeBtn.classList.add('liked');
            likeBtn.querySelector('i').className = 'fas fa-heart';
            likeCountElement.textContent = originalCount + 1;
        }
        
        // Gọi API
        const requestData = {
            post_id: postId,
            comment_id: commentId
        };
        
        if (replyId) {
            requestData.reply_id = replyId;
        }
        
        console.log('Sending like request:', requestData);
        
        const response = await fetch('/like_comment', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        });
        
        const result = await response.json();
        console.log('Like response:', result);
        
        if (!result.success) {
            // Khôi phục lại trạng thái cũ nếu lỗi
            if (originalLiked) {
                likeBtn.classList.add('liked');
                likeBtn.querySelector('i').className = 'fas fa-heart';
            } else {
                likeBtn.classList.remove('liked');
                likeBtn.querySelector('i').className = 'fas fa-heart';
            }
            likeCountElement.textContent = originalCount;
            
            showNotification(result.error || 'Lỗi khi thích bình luận', 'error');
        } else {
            showNotification(originalLiked ? 'Đã bỏ thích bình luận' : 'Đã thích bình luận', 'success');
        }
        
    } catch (error) {
        console.error('Error liking comment:', error);
        showNotification('Lỗi kết nối khi thích bình luận', 'error');
    } finally {
        isProcessing = false;
    }
}
// ==================== KHỞI TẠO KHI DOM READY ====================

document.addEventListener('DOMContentLoaded', function() {
    const shareBtn = document.getElementById('share-btn');
    const postId = typeof window.postId !== 'undefined' ? window.postId : document.querySelector('.post-item, .post-card-detail')?.dataset.postId;

    if (shareBtn) {
        shareBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation(); // Ngăn chặn sự kiện nổi bọt
            
            if (postId) {
                console.log('Click share button for post:', postId);
                showShareMenu(postId);
            } else {
                console.error('Không tìm thấy Post ID');
            }
        });
    }
    console.log('Post detail page loaded');
    if (!window.postId) {
        // Thử lấy từ URL
        const path = window.location.pathname.split('/');
        const idFromUrl = path[path.length - 1];
        if (idFromUrl && idFromUrl !== 'post') {
            window.postId = idFromUrl;
            console.log('Set postId from URL:', window.postId);
        }
    }
    
    // Khởi tạo các biến toàn cục
    window.postId = postId;
    
    // Khởi tạo các listeners
    attachEventListeners();
    attachPostDetailListeners();
    
    // Tính và hiển thị số comment ban đầu
    updateTotalCommentCount();  // Đảm bảo gọi hàm này
    
    // Media viewer initialization
    initializeMediaViewer();
    
    // Auto-resize comment input
    const commentInput = document.getElementById('comment-input');
    if (commentInput) {
        commentInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
        });
    }
    
    // Khởi tạo event listeners cho comment interactions
    attachCommentInteractionListeners();
    
    console.log('Post detail initialization completed');
});

/**
 * Cập nhật tổng số comment (bao gồm cả replies)
 */
function updateTotalCommentCount() {
    try {
        // Tính tổng số comment
        let totalComments = 0;
        
        // Đếm comment chính
        const mainComments = document.querySelectorAll('.comment-item');
        totalComments += mainComments.length;
        
        // Đếm replies
        const replies = document.querySelectorAll('.comment-reply');
        totalComments += replies.length;
        
        console.log(`[Comment Count] Total: ${totalComments} (${mainComments.length} main + ${replies.length} replies)`);
        
        // Cập nhật số trong title
        const commentTitle = document.querySelector('.comments-section h3');
        if (commentTitle) {
            commentTitle.innerHTML = `Bình luận (<span id="total-comment-count">${totalComments}</span>)`;
        }
        
        // Cập nhật số trong post stats (nếu có)
        const postStatsCount = document.getElementById('comment-count');
        if (postStatsCount) {
            postStatsCount.textContent = totalComments;
        }
        
        return totalComments;
    } catch (error) {
        console.error('Error updating comment count:', error);
        return 0;
    }
}
/**
 * Cập nhật số lượng like của một comment
 */
function updateCommentLikeCount(commentId, newCount, isReply = false) {
    try {
        const selector = isReply ? 
            `.comment-reply[data-comment-id="${commentId}"] .comment-like-count` :
            `.comment-item[data-comment-id="${commentId}"] .comment-like-count`;
        
        const likeCountElement = document.querySelector(selector);
        if (likeCountElement) {
            likeCountElement.textContent = newCount;
            
            // Hiệu ứng
            likeCountElement.style.transform = 'scale(1.2)';
            likeCountElement.style.color = '#e74c3c';
            setTimeout(() => {
                likeCountElement.style.transform = 'scale(1)';
                likeCountElement.style.color = '';
            }, 300);
        }
    } catch (error) {
        console.error('Error updating comment like count:', error);
    }
}

function attachDetailPageListeners() {
    // Share button
    const shareBtn = document.getElementById('share-btn');
    if (shareBtn) {
        shareBtn.addEventListener('click', () => {
            sharePostDetail();
        });
    }
    
    // Comment input (Enter to submit)
    const commentInput = document.getElementById('comment-input');
    if (commentInput) {
        commentInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const postId = window.postId;
                const content = this.value.trim();
                if (content) {
                    window.postInteractions.addComment(postId, content);
                    this.value = '';
                }
            }
        });
    }
    function sharePostDetail() {
        const postUrl = window.location.href;
        
        if (navigator.share) {
            navigator.share({
                title: 'Bài viết từ Paw Talk',
                text: 'Xem bài viết này trên Paw Talk',
                url: postUrl,
            }).then(() => {
                window.postInteractions.showNotification('Đã chia sẻ bài viết', 'success');
            }).catch((error) => {
                if (error.name !== 'AbortError') {
                    // Fallback: copy to clipboard
                    copyPostLink(postUrl);
                }
            });
        } else {
            copyPostLink(postUrl);
        }
    }
    
    function copyPostLink(url) {
        navigator.clipboard.writeText(url)
            .then(() => {
                window.postInteractions.showNotification('Đã sao chép link bài viết!', 'success');
            })
            .catch(() => {
                prompt('Copy link bài viết:', url);
            });
    }
    
    function updateCommentCountOnDetailPage(count = null) {
        const commentCountElement = document.getElementById('comment-count');
        if (commentCountElement) {
            if (count !== null) {
                commentCountElement.textContent = count;
            } else {
                const currentCount = parseInt(commentCountElement.textContent) || 0;
                commentCountElement.textContent = currentCount + 1;
            }
            
            // Cập nhật tiêu đề
            const commentTitle = document.querySelector('.comments-section h3');
            if (commentTitle) {
                commentTitle.textContent = `Bình luận (${commentCountElement.textContent})`;
            }
        }
    }
}
/**
 * Thiết lập trạng thái reply
 */
function setupReply(commentId, username) {
    currentReplyTarget = {
        commentId: commentId,
        username: username
    };
    
    // Hiển thị reply indicator
    const replyIndicator = document.getElementById('reply-indicator');
    const replyTargetName = document.getElementById('reply-target-name');
    
    if (replyIndicator && replyTargetName) {
        replyTargetName.textContent = `@${username}`;
        replyIndicator.style.display = 'block';
    }
    
    // Thay đổi placeholder của input
    const commentInput = document.getElementById('comment-input');
    if (commentInput) {
        commentInput.placeholder = `Trả lời ${username}...`;
        commentInput.focus();
    }
}

/**
 * Hủy trạng thái reply
 */
function cancelReply() {
    currentReplyTarget = null;
    
    // Ẩn reply indicator
    const replyIndicator = document.getElementById('reply-indicator');
    if (replyIndicator) {
        replyIndicator.style.display = 'none';
    }
    
    // Khôi phục placeholder
    const commentInput = document.getElementById('comment-input');
    if (commentInput) {
        commentInput.placeholder = 'Viết bình luận...';
    }
}

/**
 * Xử lý gửi comment/reply
 */
async function submitCommentHandler() {
    if (isProcessing) return;
    
    const content = commentInput.value.trim();
    
    if (!content) {
        showNotification('Vui lòng nhập nội dung bình luận', 'warning');
        return;
    }
    
    isProcessing = true;
    
    try {
        // Disable button và hiển thị loading
        submitComment.disabled = true;
        submitComment.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        
        const commentData = {
            post_id: postId,
            content: content
        };
        
        // Thêm thông tin reply nếu đang reply
        if (currentReplyTarget) {
            commentData.reply_to = currentReplyTarget.commentId;
            commentData.reply_to_username = currentReplyTarget.username;
        }
        
        const response = await fetch('/comment_post', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(commentData)
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Thêm comment mới vào UI
            addCommentToUI(data.comment, currentReplyTarget);
            
            // Reset form
            commentInput.value = '';
            cancelReply();
            
            // Cập nhật số lượng comment
            updateTotalCommentCount();
            
            showNotification('Đã thêm bình luận', 'success');
        } else {
            showNotification(data.error || 'Lỗi khi đăng bình luận', 'error');
        }
    } catch (error) {
        console.error('Error posting comment:', error);
        showNotification('Lỗi kết nối khi đăng bình luận', 'error');
    } finally {
        isProcessing = false;
        submitComment.disabled = false;
        submitComment.innerHTML = '<i class="fas fa-paper-plane"></i>';
    }
}

/**
 * Thêm comment/reply mới vào UI
 */
function addCommentToUI(commentData, replyTarget = null) {
    const commentsList = document.getElementById('comments-list');
    const noComments = document.querySelector('.no-comments');
    
    // Xóa thông báo "chưa có comment" nếu có
    if (noComments) {
        noComments.remove();
    }
    
    if (replyTarget) {
        // Đây là reply - thêm vào replies container
        const replyContainerId = `replies-${postId}-${replyTarget.commentId}`;
        let repliesContainer = document.getElementById(replyContainerId);
        
        if (!repliesContainer) {
            // Tạo replies container nếu chưa có
            const parentComment = document.querySelector(`.comment-item[data-comment-id="${replyTarget.commentId}"]`);
            if (parentComment) {
                const commentContent = parentComment.querySelector('.comment-content');
                
                // Tạo container
                repliesContainer = document.createElement('div');
                repliesContainer.className = 'comment-replies-container';
                repliesContainer.id = replyContainerId;
                repliesContainer.style.display = 'block'; // Hiển thị khi có reply mới
                
                // Tạo list
                const repliesList = document.createElement('div');
                repliesList.className = 'comment-replies';
                repliesList.id = `replies-list-${postId}-${replyTarget.commentId}`;
                
                repliesContainer.appendChild(repliesList);
                commentContent.appendChild(repliesContainer);
                
                // Cập nhật nút view replies
                updateViewRepliesButton(replyTarget.commentId, 1);
            }
        }
        
        if (repliesContainer) {
            const repliesList = repliesContainer.querySelector('.comment-replies');
            const replyHTML = createReplyHTML(commentData, replyTarget.username);
            repliesList.insertAdjacentHTML('beforeend', replyHTML);
            
            // Process hashtags in the new reply
            const newReply = repliesList.lastElementChild;
            processNewComment(newReply);
            
            // Cập nhật số lượng replies
            const repliesCount = repliesList.querySelectorAll('.comment-reply').length;
            updateViewRepliesButton(replyTarget.commentId, repliesCount);
        }
    } else {
        // Đây là comment mới - thêm vào đầu danh sách
        const commentHTML = createCommentHTML(commentData);
        commentsList.insertAdjacentHTML('afterbegin', commentHTML);
        
        // Process hashtags in the new comment
        const newComment = commentsList.firstElementChild;
        processNewComment(newComment);
    }
    
    // Cập nhật tổng số comment
    const totalCountElement = document.getElementById('total-comment-count');
    if (totalCountElement) {
        const currentCount = parseInt(totalCountElement.textContent) || 0;
        totalCountElement.textContent = currentCount + 1;
    }
}

/**
 * Tạo HTML cho comment chính
 */
function createCommentHTML(commentData) {
    return `
        <div class="comment-item" data-comment-id="${commentData.id}" data-post-id="${postId}">
            <img src="${commentData.user_avatar}" alt="${commentData.full_name || commentData.username}" class="comment-avatar">
            <div class="comment-content">
                <div class="comment-header">
                    <strong>${commentData.full_name || commentData.username}</strong>
                    <span class="comment-time">${getTimeAgo(new Date(commentData.created_at))}</span>
                </div>
                <p class="comment-text">${formatPostContent(escapeHtml(commentData.content))}</p>
                <div class="comment-actions">
                    <button class="comment-action-btn like-comment-btn" 
                            data-post-id="${postId}" 
                            data-comment-id="${commentData.id}">
                        <i class="fas fa-heart"></i>
                        <span class="comment-like-count">${commentData.likes ? commentData.likes.length : 0}</span>
                    </button>
                    <button class="comment-action-btn reply-comment-btn" 
                            data-post-id="${postId}" 
                            data-comment-id="${commentData.id}"
                            data-username="${commentData.username}">
                        <i class="fas fa-reply"></i> Trả lời
                    </button>
                </div>
            </div>
        </div>
    `;
}

/**
 * Tạo HTML cho reply
 */
function createReplyHTML(replyData, replyToUsername) {
    return `
        <div class="comment-reply" data-comment-id="${replyData.id}" data-post-id="${postId}"
             data-reply-to="${replyData.reply_to}" data-reply-username="${replyToUsername}">
            <img src="${replyData.user_avatar}" alt="${replyData.full_name || replyData.username}" class="comment-avatar-small">
            <div class="comment-content">
                <div class="comment-header">
                    <strong>${replyData.full_name || replyData.username}</strong>
                    <span class="reply-to-text">→ Trả lời @${replyToUsername}</span>
                    <span class="comment-time">${getTimeAgo(new Date(replyData.created_at))}</span>
                </div>
                <p class="comment-text">${formatPostContent(escapeHtml(replyData.content))}</p>
                <div class="comment-actions">
                    <button class="comment-action-btn like-comment-btn" 
                            data-post-id="${postId}" 
                            data-comment-id="${replyData.id}"
                            data-reply-id="${replyData.id}">
                        <i class="fas fa-heart"></i>
                        <span class="comment-like-count">${replyData.likes ? replyData.likes.length : 0}</span>
                    </button>
                    <button class="comment-action-btn reply-comment-btn" 
                            data-post-id="${postId}" 
                            data-comment-id="${replyData.id}"
                            data-username="${replyData.username}"
                            data-reply-to="${replyData.reply_to}">
                        <i class="fas fa-reply"></i> Trả lời
                    </button>
                </div>
            </div>
        </div>
    `;
}

/**
 * Cập nhật nút view replies
 */
function updateViewRepliesButton(commentId, count) {
    const viewRepliesBtn = document.querySelector(`.view-replies-btn[data-comment-id="${commentId}"]`);
    
    if (!viewRepliesBtn) {
        // Tạo nút nếu chưa có
        const commentItem = document.querySelector(`.comment-item[data-comment-id="${commentId}"]`);
        if (commentItem) {
            const commentActions = commentItem.querySelector('.comment-actions');
            if (commentActions) {
                const newButton = document.createElement('button');
                newButton.className = 'comment-action-btn view-replies-btn';
                newButton.dataset.postId = postId;
                newButton.dataset.commentId = commentId;
                newButton.innerHTML = `
                    <i class="fas fa-comments"></i>
                    <span class="reply-count">${count}</span> trả lời
                    <i class="fas fa-chevron-down toggle-icon"></i>
                `;
                commentActions.appendChild(newButton);
                console.log(`Đã tạo nút view replies cho comment ${commentId}`);
            }
        }
    } else {
        // Cập nhật số lượng
        const countSpan = viewRepliesBtn.querySelector('.reply-count');
        if (countSpan) {
            countSpan.textContent = count;
        }
        console.log(`Đã cập nhật số lượng replies cho comment ${commentId}: ${count}`);
    }
}

/**
 * Hiển thị/ẩn replies
 */
function toggleReplies(commentId) {
    const repliesContainer = document.getElementById(`replies-${postId}-${commentId}`);
    const toggleBtn = document.querySelector(`.view-replies-btn[data-comment-id="${commentId}"]`);
    
    if (!repliesContainer || !toggleBtn) return;
    
    const isHidden = repliesContainer.style.display === 'none' || repliesContainer.style.display === '';
    const toggleIcon = toggleBtn.querySelector('.toggle-icon');
    
    if (isHidden) {
        repliesContainer.style.display = 'block';
        toggleIcon.className = 'fas fa-chevron-up toggle-icon';
    } else {
        repliesContainer.style.display = 'none';
        toggleIcon.className = 'fas fa-chevron-down toggle-icon';
    }
}

// ==================== ATTACH EVENT LISTENERS ====================

/**
 * Gắn sự kiện cho các nút reply
 */
function attachReplyEventListeners() {
    // Event delegation cho reply buttons
    document.addEventListener('click', function(e) {
        const replyBtn = e.target.closest('.reply-comment-btn');
        if (replyBtn && replyBtn.dataset.commentId) {
            e.preventDefault();
            e.stopPropagation();
            
            const commentId = replyBtn.dataset.commentId;
            const username = replyBtn.dataset.username;
            
            setupReply(commentId, username);
            return false;
        }
        
        // Nút hủy reply
        const cancelReplyBtn = e.target.closest('#cancel-reply');
        if (cancelReplyBtn) {
            e.preventDefault();
            cancelReply();
            return false;
        }
        
        // Nút view replies
        const viewRepliesBtn = e.target.closest('.view-replies-btn');
        if (viewRepliesBtn && viewRepliesBtn.dataset.commentId) {
            e.preventDefault();
            e.stopPropagation();
            
            const commentId = viewRepliesBtn.dataset.commentId;
            toggleReplies(commentId);
            return false;
        }
    });
}
window.shareToProfile = async function(postId) {
    await window.shareModal.openShareToProfile(postId);
};
// ==================== XỬ LÝ SỰ KIỆN (THÊM MỚI) ====================

// Gán sự kiện click cho nút Share
if (shareBtn) {
    shareBtn.addEventListener('click', (e) => {
        e.preventDefault();
        // Kiểm tra xem postId có tồn tại không (biến này được define trong file HTML)
        if (typeof postId !== 'undefined') {
            showShareMenu(postId);
        } else {
            console.error('Không tìm thấy Post ID');
        }
    });
}

// ==================== EXPORT FUNCTIONS ====================

// Export functions to global scope for use in inline event handlers
window.openMediaViewer = openMediaViewer;
window.closeMediaViewer = closeMediaViewer;
window.prevMedia = prevMedia;
window.nextMedia = nextMedia;
window.likePost = likePost;
window.sharePost = sharePost;
window.toggleReplies = toggleReplies; 
window.submitCommentHandler = submitCommentHandler;

window.updateTotalCommentCount = updateTotalCommentCount;
window.setupReply = setupReply;
window.cancelReply = cancelReply;
window.submitCommentHandler = submitCommentHandler;
window.toggleReplies = toggleReplies;
window.likeCommentHandler = likeCommentHandler;
window.attachCommentInteractionListeners = attachCommentInteractionListeners;

// ==================== SHARE MODAL FUNCTIONS ====================

/**
 * Hiển thị modal chia sẻ
 */
function showShareModal() {
    const modal = document.getElementById('share-modal');
    if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
}

/**
 * Đóng modal chia sẻ
 */
function closeShareModal() {
    const modal = document.getElementById('share-modal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = '';
    }
}

/**
 * Chia sẻ lên trang cá nhân
 */
async function shareToProfileDetail() {
    const postId = window.postId;
    if (!postId) {
        showNotification('Không tìm thấy ID bài viết', 'error');
        return;
    }
    
    try {
        const response = await fetch('/share_post', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken
            },
            body: JSON.stringify({
                post_id: postId,
                share_type: 'profile'
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Đã chia sẻ bài viết lên trang cá nhân!', 'success');
            closeShareModal();
            
            // Cập nhật số lượng chia sẻ
            const shareCountElement = document.getElementById('share-count');
            if (shareCountElement) {
                const currentCount = parseInt(shareCountElement.textContent) || 0;
                shareCountElement.textContent = currentCount + 1;
            }
        } else {
            showNotification(data.error || 'Lỗi khi chia sẻ bài viết', 'error');
        }
    } catch (error) {
        console.error('Error sharing post:', error);
        showNotification('Lỗi kết nối khi chia sẻ bài viết', 'error');
    }
}

/**
 * Gửi qua tin nhắn
 */
function shareToMessageDetail() {
    const postId = window.postId;
    if (!postId) {
        showNotification('Không tìm thấy ID bài viết', 'error');
        return;
    }
    
    // Chuyển hướng đến trang chat với post_id
    window.location.href = `/chat?share_post=${postId}`;
}

/**
 * Sao chép liên kết bài viết
 */
function copyPostLinkDetail() {
    const postUrl = window.location.href;
    
    navigator.clipboard.writeText(postUrl)
        .then(() => {
            showNotification('Đã sao chép liên kết bài viết!', 'success');
            closeShareModal();
        })
        .catch(() => {
            // Fallback
            prompt('Sao chép liên kết:', postUrl);
        });
}

// Gắn sự kiện cho share modal khi DOM ready
document.addEventListener('DOMContentLoaded', function() {
    // Nút mở modal chia sẻ - hiện thẳng form chia sẻ profile
    const shareBtn = document.getElementById('share-btn');
    if (shareBtn) {
        shareBtn.addEventListener('click', function(e) {
            e.preventDefault();
            openShareToProfileModal(); // Hiện thẳng form chia sẻ
        });
    }
    
    // Nút đóng modal
    const closeShareToProfileBtn = document.getElementById('close-share-to-profile-modal');
    if (closeShareToProfileBtn) {
        closeShareToProfileBtn.addEventListener('click', function(e) {
            e.preventDefault();
            closeShareToProfileModal();
        });
    }
    
    // Đóng modal khi click ra ngoài
    const shareToProfileModal = document.getElementById('share-to-profile-modal');
    if (shareToProfileModal) {
        shareToProfileModal.addEventListener('click', function(e) {
            if (e.target === shareToProfileModal) {
                closeShareToProfileModal();
            }
        });
    }
    
    // Cập nhật số ký tự khi nhập
    const shareContent = document.getElementById('share-content');
    if (shareContent) {
        shareContent.addEventListener('input', updateCharCount);
    }
});

window.showShareMenu = showShareModal;
window.closeShareModal = closeShareModal;
window.shareToProfile = shareToProfileDetail;
window.shareToMessage = shareToMessageDetail;
window.copyPostLink = copyPostLinkDetail;

// ==================== SHARE TO PROFILE MODAL FUNCTIONS ====================

let currentPrivacy = 'public';

/**
 * Mở modal chia sẻ lên trang cá nhân
 */
function openShareToProfileModal() {
    // Đóng modal chính
    closeShareModal();
    
    // Mở modal chia sẻ profile
    const modal = document.getElementById('share-to-profile-modal');
    if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        
        // Reset form
        const shareContent = document.getElementById('share-content');
        if (shareContent) {
            shareContent.value = '';
        }
        updateCharCount();
        
        // Reset privacy
        selectPrivacy('public');
    }
}

/**
 * Đóng modal chia sẻ profile
 */
function closeShareToProfileModal() {
    const modal = document.getElementById('share-to-profile-modal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = '';
    }
}

/**
 * Chọn quyền riêng tư
 */
function selectPrivacy(privacy) {
    currentPrivacy = privacy;
    
    // Cập nhật UI
    const buttons = document.querySelectorAll('.privacy-btn');
    buttons.forEach(btn => {
        if (btn.dataset.privacy === privacy) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

/**
 * Cập nhật số ký tự
 */
function updateCharCount() {
    const shareContent = document.getElementById('share-content');
    const charCount = document.getElementById('char-count');
    
    if (shareContent && charCount) {
        const count = shareContent.value.length;
        charCount.textContent = count;
        
        // Đổi màu nếu quá 500 ký tự
        if (count > 500) {
            charCount.style.color = '#e74c3c';
        } else {
            charCount.style.color = '#999';
        }
    }
}

/**
 * Submit chia sẻ lên trang cá nhân
 */
async function submitShareToProfile() {
    const postId = window.postId;
    if (!postId) {
        showNotification('Không tìm thấy ID bài viết', 'error');
        return;
    }
    
    const shareContent = document.getElementById('share-content');
    const content = shareContent ? shareContent.value.trim() : '';
    
    // Kiểm tra số ký tự
    if (content.length > 500) {
        showNotification('Nội dung không được quá 500 ký tự', 'error');
        return;
    }
    
    try {
        const response = await fetch('/share_post', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken
            },
            body: JSON.stringify({
                post_id: postId,
                share_type: 'profile',
                content: content,
                privacy: currentPrivacy
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Đã chia sẻ bài viết lên trang cá nhân!', 'success');
            closeShareToProfileModal();
            
            // Cập nhật số lượng chia sẻ
            const shareCountElement = document.getElementById('share-count');
            if (shareCountElement) {
                const currentCount = parseInt(shareCountElement.textContent) || 0;
                shareCountElement.textContent = currentCount + 1;
            }
        } else {
            showNotification(data.error || 'Lỗi khi chia sẻ bài viết', 'error');
        }
    } catch (error) {
        console.error('Error sharing post:', error);
        showNotification('Lỗi kết nối khi chia sẻ bài viết', 'error');
    }
}

// Gắn sự kiện cho share to profile modal khi DOM ready
document.addEventListener('DOMContentLoaded', function() {
    // Nút đóng modal chia sẻ profile
    const closeShareToProfileBtn = document.getElementById('close-share-to-profile-modal');
    if (closeShareToProfileBtn) {
        closeShareToProfileBtn.addEventListener('click', function(e) {
            e.preventDefault();
            closeShareToProfileModal();
        });
    }
    
    // Đóng modal khi click ra ngoài
    const shareToProfileModal = document.getElementById('share-to-profile-modal');
    if (shareToProfileModal) {
        shareToProfileModal.addEventListener('click', function(e) {
            if (e.target === shareToProfileModal) {
                closeShareToProfileModal();
            }
        });
    }
    
    // Cập nhật số ký tự khi nhập
    const shareContent = document.getElementById('share-content');
    if (shareContent) {
        shareContent.addEventListener('input', updateCharCount);
    }
});

// ==================== HASHTAG PROCESSING ====================

/**
 * Format post content to convert hashtags and mentions to clickable links
 * Similar to timeline.js formatPostContent function
 */
function formatPostContent(content, taggedFriends = []) {
    console.log('[DEBUG] formatPostContent called with:', { content, taggedFriends });
    let formattedContent = content;
    
    // Convert @mentions to blue clickable links
    if (taggedFriends && taggedFriends.length > 0) {
        taggedFriends.forEach(friend => {
            // Use display_name (full name) instead of username since that's what gets inserted
            const displayName = friend.display_name || friend.full_name || friend.username;
            const mentionRegex = new RegExp(`@${displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
            formattedContent = formattedContent.replace(mentionRegex, 
                `<a href="/profile/${friend.username || friend._id}" class="mention-link">@${displayName}</a>`
            );
        });
    }
    
    // Convert hashtags to clickable links - add hashtag-link class
    // Use [^\s#] to match any non-whitespace, non-hash character including Vietnamese
    const hashtagRegex = /#([^\s#]+)/g;
    formattedContent = formattedContent.replace(hashtagRegex, 
        '<a href="/hashtag/$1" class="hashtag-link">#$1</a>'
    );
    
    console.log('[DEBUG] Formatted content:', formattedContent);
    return formattedContent;
}

/**
 * Hiển thị modal danh sách người đã thích bài viết
 * Tương tự như timeline.js
 */
async function viewPostLikes() {
    try {
        const postId = window.postId;
        if (!postId) return;
        
        // Create modal if not exists
        let modal = document.getElementById('post-likes-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'post-likes-modal';
            modal.className = 'post-likes-modal';
            modal.innerHTML = `
                <div class="post-likes-modal-content">
                    <div class="post-likes-modal-header">
                        <h3><i class="fas fa-heart" style="color: var(--primary);"></i> Người đã thích</h3>
                        <button class="close-post-likes-modal" onclick="document.getElementById('post-likes-modal').style.display='none'">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="post-likes-list" id="post-likes-list">
                        <div class="post-likes-loading">
                            <i class="fas fa-spinner fa-spin"></i>
                            <span>Đang tải...</span>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            
            // Close when clicking outside
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.style.display = 'none';
                }
            });
        }
        
        // Show modal with loading state
        modal.style.display = 'flex';
        const listContainer = document.getElementById('post-likes-list');
        listContainer.innerHTML = `
            <div class="post-likes-loading">
                <i class="fas fa-spinner fa-spin"></i>
                <span>Đang tải...</span>
            </div>
        `;
        
        // Fetch likes data
        const response = await fetch(`/api/timeline/posts/${postId}/likes`);
        const data = await response.json();
        
        if (data.success) {
            if (data.likes && data.likes.length > 0) {
                listContainer.innerHTML = data.likes.map(user => `
                    <div class="post-likes-user-item" onclick="window.location.href='/profile/${user.username}'">
                        <img src="${user.avatar}" 
                             alt="${user.full_name || user.username}" 
                             class="post-likes-user-avatar"
                             onerror="this.src='/static/img/default-avatar.png'">
                        <div class="post-likes-user-info">
                            <div class="post-likes-user-name">${user.full_name || user.username}</div>
                            <div class="post-likes-user-username">@${user.username}</div>
                        </div>
                        <i class="fas fa-heart post-likes-user-icon" style="color: var(--primary);"></i>
                    </div>
                `).join('');
            } else {
                listContainer.innerHTML = `
                    <div class="post-likes-empty">
                        <i class="fas fa-heart" style="color: #ccc;"></i>
                        <p>Chưa có ai thích bài viết này</p>
                    </div>
                `;
            }
        } else {
            listContainer.innerHTML = `
                <div class="post-likes-error">
                    <i class="fas fa-exclamation-triangle" style="color: #e74c3c;"></i>
                    <p>Không thể tải danh sách người thích</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error loading post likes:', error);
        const listContainer = document.getElementById('post-likes-list');
        if (listContainer) {
            listContainer.innerHTML = `
                <div class="post-likes-error">
                    <i class="fas fa-exclamation-triangle" style="color: #e74c3c;"></i>
                    <p>Lỗi kết nối</p>
                </div>
            `;
        }
    }
}

/**
 * Process new comment elements to add hashtag links
 */
function processNewComment(commentElement) {
    const commentTextElement = commentElement.querySelector('.comment-text');
    if (commentTextElement && !commentTextElement.dataset.processed) {
        const originalContent = commentTextElement.textContent;
        const formattedContent = formatPostContent(originalContent);
        commentTextElement.innerHTML = formattedContent;
        commentTextElement.dataset.processed = 'true';
    }
}

/**
 * Process existing post content to add hashtag links
 */
function processPostContent() {
    const postTextElement = document.querySelector('.post-text');
    if (postTextElement && !postTextElement.dataset.processed) {
        const originalContent = postTextElement.textContent;
        const formattedContent = formatPostContent(originalContent);
        postTextElement.innerHTML = formattedContent;
        postTextElement.dataset.processed = 'true';
    }
}

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', function() {
    console.log('Post detail page loaded');
    
    // Process post content to add hashtag links
    processPostContent();
    
    // Process comment content to add hashtag links
    const commentTexts = document.querySelectorAll('.comment-text');
    commentTexts.forEach(commentElement => {
        if (!commentElement.dataset.processed) {
            const originalContent = commentElement.textContent;
            const formattedContent = formatPostContent(originalContent);
            commentElement.innerHTML = formattedContent;
            commentElement.dataset.processed = 'true';
        }
    });
    
    attachPostDetailListeners();
    attachEventListeners();
    attachCommentInteractionListeners();
    
    // Đóng modal khi click ra ngoài
    const shareToProfileModal = document.getElementById('share-to-profile-modal');
    if (shareToProfileModal) {
        shareToProfileModal.addEventListener('click', function(e) {
            if (e.target === shareToProfileModal) {
                closeShareToProfileModal();
            }
        });
    }
    
    // Cập nhật số ký tự khi nhập
    const shareContent = document.getElementById('share-content');
    if (shareContent) {
        shareContent.addEventListener('input', updateCharCount);
    }
});

window.openShareToProfileModal = openShareToProfileModal;
window.closeShareToProfileModal = closeShareToProfileModal;
window.selectPrivacy = selectPrivacy;
window.submitShareToProfile = submitShareToProfile;
window.formatPostContent = formatPostContent;