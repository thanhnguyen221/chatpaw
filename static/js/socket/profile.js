// app/static/js/profile.js
// ==================== CÁC HÀM TOÀN CỤC ====================
import { PostInteractions } from '/static/js/shared/post_interactions.js';
import { ShareModal } from '/static/js/shared/share_modal.js';

let likeProcessing = false;
let commentProcessing = false;
let postProcessing = false;
let socket;
// Thêm hàm này vào phần đầu hoặc file utils của profile.js
function formatTimeFriendly(isoString) {
    if (!isoString) return "";
    
    // Đọc chuỗi thời gian (Đảm bảo chuẩn UTC)
    let date = new Date(isoString.endsWith('Z') ? isoString : isoString + 'Z'); 
    let now = new Date();
    
    // Tính khoảng cách thời gian (bằng giây)
    let diffInSeconds = Math.floor((now - date) / 1000);
    
    // Fix lỗi hiển thị giờ âm nếu có sai lệch timezone ở DB
    if (diffInSeconds < -60) {
        date = new Date(date.getTime() - 7 * 60 * 60 * 1000); // Trừ 7 tiếng
        diffInSeconds = Math.floor((now - date) / 1000);
    }
    if (diffInSeconds < 0) diffInSeconds = 0;

    // Hiển thị dạng tương đối (Khoảng thời gian ngắn)
    if (diffInSeconds < 60) return "Vừa xong";
    if (diffInSeconds < 3600) return Math.floor(diffInSeconds / 60) + " phút trước";
    if (diffInSeconds < 86400) return Math.floor(diffInSeconds / 3600) + " giờ trước";
    if (diffInSeconds < 604800) return Math.floor(diffInSeconds / 86400) + " ngày trước";
    
    // Hiển thị dạng tuyệt đối (Khoảng thời gian dài)
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    
    if (year === now.getFullYear()) {
        return `${hours}:${minutes} - ${day}/${month}`;
    }
    return `${hours}:${minutes} - ${day}/${month}/${year}`;
}
function initializeSocket() {
    try {
        // Sử dụng socket toàn cục đã được khởi tạo từ profile.html
        if (window.socket && window.socket.connected) {
            socket = window.socket;
            console.log('Using global socket instance');
        } else {
            // Fallback: tạo socket mới với CORS configuration
            socket = io({
                transports: ['websocket', 'polling'],
                reconnection: true,
                reconnectionAttempts: 5,
                reconnectionDelay: 1000,
                timeout: 10000
            });
            console.log('Created new socket instance with custom config');
        }
        
        setupSocketEvents();
    } catch (error) {
        console.error('Failed to initialize socket:', error);
        // Không hiển thị lỗi cho người dùng, chỉ log
    }
}
/**
 * Khởi tạo profile editor với debug
 */
function initializeProfileEditorWithDebug() {
    console.log('🔧 [DEBUG] Initializing profile editor...');
    
    try {
        // Kiểm tra xem modal có tồn tại không
        const editProfileModal = document.getElementById('edit-profile-modal');
        const editProfileBtn = document.getElementById('edit-profile-btn');
        
        console.log('🔧 [DEBUG] Edit profile modal exists:', !!editProfileModal);
        console.log('🔧 [DEBUG] Edit profile button exists:', !!editProfileBtn);
        
        if (editProfileModal && editProfileBtn) {
            // Khởi tạo ProfileEditor
            if (typeof ProfileEditor !== 'undefined' && !window.profileEditor) {
                window.profileEditor = new ProfileEditor();
                console.log('✅ [DEBUG] Profile Editor initialized successfully');
            } else {
                console.log('⚠️ [DEBUG] Profile Editor already initialized or not defined');
            }
        } else {
            console.warn('⚠️ [DEBUG] Required elements for profile editor not found');
            
            // Fallback: gắn sự kiện trực tiếp nếu cần
            if (editProfileBtn && !editProfileBtn.hasAttribute('data-listener-attached')) {
                editProfileBtn.setAttribute('data-listener-attached', 'true');
                editProfileBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    console.log('Edit profile clicked, but editor not available');
                    alert('Tính năng chỉnh sửa profile đang được cập nhật. Vui lòng thử lại sau.');
                });
            }
        }
    } catch (error) {
        console.error('❌ [DEBUG] Error initializing profile editor:', error);
    }
}

// Thiết lập socket events
function setupSocketEvents() {
    if (!socket) return;

    socket.on('connect', () => {
        console.log('Connected to server');
        // Load số lượng lời mời khi kết nối
        updateFriendRequestsBadge();
    });

    socket.on('new_friend_request', (data) => {
        updateFriendRequestsBadge(); // Cập nhật badge khi có lời mời mới
    });

    socket.on('friend_request_accepted', (data) => {
        updateFriendRequestsBadge(); // Cập nhật badge sau khi chấp nhận
    });

    socket.on('friend_request_declined', (data) => {
        updateFriendRequestsBadge(); // Cập nhật badge sau khi từ chối
    });
}

// Hàm cập nhật badge (toàn cục)
async function updateFriendRequestsBadge() {
    try {
        const response = await fetch('/friend_requests_count');
        if (response.ok) {
            const data = await response.json();
            const badge = document.getElementById('friend-requests-nav-badge');
            if (badge) {
                if (data.count > 0) {
                    badge.textContent = data.count;
                    badge.style.display = 'flex';
                } else {
                    badge.style.display = 'none';
                }
            }
        }
    } catch (error) {
        console.error('Error updating friend requests badge:', error);
    }
}
/**
 * Hiển thị thông báo
 */
function showNotification(message, type = 'info') {
    // Tạo element thông báo
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
 * Hiển thị/ẩn phần bình luận của bài viết
 */
function toggleComments(postId) {
    const commentsSection = document.getElementById(`comments-${postId}`);
    if (!commentsSection) {
        console.warn(`Comments section not found for post: ${postId}`);
        return;
    }

    if (commentsSection.style.display === 'none' || commentsSection.style.display === '') {
        commentsSection.style.display = 'block';
        commentsSection.classList.add('active');
        
        // Focus vào input comment
        const commentInput = document.getElementById(`comment-input-${postId}`);
        if (commentInput) commentInput.focus();
    } else {
        commentsSection.style.display = 'none';
        commentsSection.classList.remove('active');
    }
}
/**
 * Like/unlike bài viết - PHIÊN BẢN ĐÃ SỬA HOÀN CHỈNH
 */
async function likePost(postId) {
    if (likeProcessing) {
        console.log('Like action already in progress');
        return;
    }
    likeProcessing = true;
    
    try {
        console.log('Like action started for post:', postId);
        
        // Tìm element bài viết - sử dụng selector chính xác hơn
        let postElement = document.querySelector(`article.post-card[data-post-id="${postId}"]`);
        
        if (!postElement) {
            console.error(`❌ Post element not found for ID: ${postId}`);
            showNotification('Không tìm thấy bài viết', 'error');
            likeProcessing = false;
            return;
        }

        // Tìm nút like bên TRONG bài viết này
        const likeBtn = postElement.querySelector('.post-stat.like-btn');
        
        if (!likeBtn) {
            console.error('❌ Like button not found within post element');
            likeProcessing = false;
            return;
        }
        
        const likeCount = likeBtn.querySelector('.like-count');
        const likeIcon = likeBtn.querySelector('i');
        
        // Lưu trạng thái ban đầu để khôi phục nếu lỗi
        const originalLiked = likeBtn.classList.contains('liked');
        const originalCount = likeCount ? likeCount.textContent : '0';
        const originalIconClass = likeIcon.className;
        
        // Hiệu ứng loading
        likeBtn.classList.add('processing');
        if (likeIcon) {
            likeIcon.className = 'fas fa-spinner fa-spin';
        }
        likeBtn.disabled = true;
        
        console.log('Sending like request for post:', postId);
        
        const response = await fetch('/like_post', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ post_id: postId })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        console.log('Like response:', result);
        
        if (result.success) {
            // Cập nhật giao diện dựa trên kết quả từ server
            if (result.liked) {
                // Đã thích
                likeBtn.classList.add('liked');
                likeBtn.classList.remove('processing');
                if (likeIcon) {
                    likeIcon.className = 'fas fa-heart';
                }
                showNotification('Đã thích bài viết', 'success');
            } else {
                // Đã bỏ thích
                likeBtn.classList.remove('liked');
                likeBtn.classList.remove('processing');
                if (likeIcon) {
                    likeIcon.className = 'fas fa-heart';
                }
                showNotification('Đã bỏ thích bài viết', 'info');
            }
            
            // Cập nhật số lượng like
            if (likeCount) {
                likeCount.textContent = result.like_count || '0';
                
                // Hiệu ứng số thay đổi
                likeCount.style.transform = 'scale(1.2)';
                likeCount.style.transition = 'transform 0.3s';
                setTimeout(() => {
                    likeCount.style.transform = 'scale(1)';
                }, 300);
            }
            
            console.log(`✅ Like action successful: ${result.liked ? 'liked' : 'unliked'}`);
            
        } else {
            console.error('❌ Like failed from server:', result.error);
            
            // KHÔI PHỤC TRẠNG THÁI CŨ
            likeBtn.classList.remove('processing');
            likeBtn.disabled = false;
            
            if (originalLiked) {
                likeBtn.classList.add('liked');
            } else {
                likeBtn.classList.remove('liked');
            }
            
            if (likeIcon) {
                likeIcon.className = originalIconClass;
            }
            
            if (likeCount) {
                likeCount.textContent = originalCount;
            }
            
            showNotification(result.error || 'Lỗi khi thích bài viết', 'error');
        }
    } catch (error) {
        console.error('❌ Like error:', error);
        
        // KHÔI PHỤC UI SAU LỖI
        const postElement = document.querySelector(`article.post-card[data-post-id="${postId}"]`);
        if (postElement) {
            const likeBtn = postElement.querySelector('.post-stat.like-btn');
            if (likeBtn) {
                likeBtn.classList.remove('processing');
                likeBtn.disabled = false;
                const likeIcon = likeBtn.querySelector('i');
                if (likeIcon) {
                    likeIcon.className = 'fas fa-heart';
                }
            }
        }
        
        showNotification('Lỗi kết nối, vui lòng thử lại', 'error');
    } finally {
        likeProcessing = false;
        console.log('Like processing complete');
    }
}
/**
 * Gắn sự kiện cho các nút like - PHIÊN BẢN TỐI ƯU với event delegation và debounce
 */
function attachPostInteractionListeners() {
    console.log('🔗 Attaching post interaction listeners...');
    
    // Sử dụng event delegation cho các sự kiện (TRỪ like vì đã có onclick trực tiếp)
    document.addEventListener('click', function(e) {
        // Share button - SỬ DỤNG MODULE CHIA SẺ
        const shareBtn = e.target.closest('.post-stat.share-btn');
        if (shareBtn && shareBtn.dataset.postId) {
            e.preventDefault();
            e.stopPropagation();
            const postId = shareBtn.dataset.postId;
            console.log('📤 Share button clicked for post:', postId);
            
            // Mở luôn modal chia sẻ về trang cá nhân, không hiện menu
            if (window.shareModal && window.shareModal.openShareToProfile) {
                window.shareModal.openShareToProfile(postId);
            } else {
                // Fallback nếu shareModal chưa load
                showShareMenu(postId);
            }
            return false;
        }
        
        // Toggle comments
        const commentToggle = e.target.closest('.post-stat.comment-toggle');
        if (commentToggle && commentToggle.dataset.postId) {
            e.preventDefault();
            e.stopPropagation();
            const postId = commentToggle.dataset.postId;
            console.log('💭 Comment toggle clicked for post:', postId);
            toggleComments(postId);
            return false;
        }
        
        // View media
        const mediaItem = e.target.closest('.post-media-item, .media-item');
        if (mediaItem && mediaItem.dataset.mediaUrl) {
            e.preventDefault();
            const mediaUrl = mediaItem.dataset.mediaUrl;
            const mediaType = mediaItem.dataset.mediaType || 'image';
            
            if (window.openMediaViewer) {
                window.openMediaViewer(mediaUrl, mediaType);
            } else {
                window.open(mediaUrl, '_blank');
            }
            return false;
        }
    }, { passive: false });
}
/**
 * Khởi tạo module chia sẻ - SỬA LẠI
 */
function initializeShareModal() {
    console.log('📤 Initializing share modal module...');
    
    // Kiểm tra nếu share_modal.js đã được tải (type="module")
    if (typeof window.ShareModal !== 'undefined' && window.shareModal) {
        console.log('✅ ShareModal already loaded via module import');
        attachShareEventListeners();
        return;
    }
    
    // Nếu không, thử tải qua script tag cũ
    console.log('⚠️ ShareModal not found, checking for global...');
    
    // Kiểm tra nếu đã có window.shareModal (từ file share_modal.js đã được import)
    if (typeof window.shareModal !== 'undefined') {
        console.log('✅ Found window.shareModal globally');
        attachShareEventListeners();
        return;
    }
    
    // Nếu cả hai đều không có, đợi thêm một chút
    setTimeout(() => {
        if (typeof window.shareModal !== 'undefined') {
            console.log('✅ ShareModal loaded after delay');
            attachShareEventListeners();
        } else {
            console.error('❌ ShareModal failed to load');
            // Fallback: sử dụng hàm cơ bản
            setupFallbackShare();
        }
    }, 1000);
}

/**
 * Thiết lập fallback cho chia sẻ
 */
function setupFallbackShare() {
    console.log('🛠️ Setting up fallback share functionality');
    
    // Gắn sự kiện đơn giản cho nút share
    document.addEventListener('click', function(e) {
        const shareBtn = e.target.closest('.post-stat.share-btn');
        if (shareBtn && shareBtn.dataset.postId) {
            e.preventDefault();
            e.stopPropagation();
            const postId = shareBtn.dataset.postId;
            console.log('📤 Fallback share for post:', postId);
            showShareMenuFallback(postId);
        }
    });
}
/**
 * Menu chia sẻ fallback (cơ bản)
 */
function showShareMenuFallback(postId) {
    // Tạo modal chia sẻ đơn giản
    const modalHTML = `
    <div class="share-modal" id="share-modal-${postId}">
        <div class="modal-content">
            <div class="modal-header">
                <h3><i class="fas fa-share-alt" style="color: #3eb489;"></i> Chia sẻ bài viết</h3>
                <button class="close-btn" onclick="closeShareModal('${postId}')">&times;</button>
            </div>
            <div class="modal-body">
                <button class="share-option-btn" onclick="shareToProfile('${postId}')">
                    <div class="share-option-icon" style="background: linear-gradient(135deg, #3eb489, #2d9a71);">
                        <i class="fas fa-user"></i>
                    </div>
                    <div class="share-option-text">
                        <strong>Chia sẻ về trang cá nhân</strong>
                        <small>Đăng lên trang cá nhân của bạn</small>
                    </div>
                </button>
                
                <button class="share-option-btn" onclick="shareToMessage('${postId}')">
                    <div class="share-option-icon" style="background: linear-gradient(135deg, #3eb489, #2d9a71);">
                        <i class="fas fa-comment"></i>
                    </div>
                    <div class="share-option-text">
                        <strong>Gửi qua tin nhắn</strong>
                        <small>Gửi cho bạn bè hoặc nhóm</small>
                    </div>
                </button>
                
                <button class="share-option-btn" onclick="copyPostLink('${postId}')">
                    <div class="share-option-icon" style="background: linear-gradient(135deg, #3eb489, #2d9a71);">
                        <i class="fas fa-link"></i>
                    </div>
                    <div class="share-option-text">
                        <strong>Sao chép liên kết</strong>
                        <small>Chia sẻ liên kết bài viết</small>
                    </div>
                </button>
            </div>
        </div>
    </div>
`;
    
    // Xóa modal cũ nếu có
    const oldModal = document.getElementById(`share-modal-${postId}`);
    if (oldModal) oldModal.remove();
    
    // Thêm modal mới
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Thêm CSS nếu chưa có
    if (!document.querySelector('#share-fallback-styles')) {
        const styles = `
            <style id="share-fallback-styles">
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
                    background: #007bff;
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
            </style>
        `;
        document.head.insertAdjacentHTML('beforeend', styles);
    }
}
//
window.showShareMenu = function(postId) {
    console.log('1. Opening Share Menu options for:', postId);
    
    // Đóng các menu cũ nếu có
    const existingMenu = document.getElementById(`share-menu-${postId}`);
    if (existingMenu) existingMenu.remove();

    // HTML của Menu lựa chọn
    const menuHTML = `
        <div class="share-menu-modal" id="share-menu-${postId}">
            <div class="share-menu-overlay" onclick="closeShareMenu('${postId}')"></div>
            <div class="share-menu-content">
                <div class="share-menu-header">
                    <h3>Chia sẻ</h3>
                    <button class="close-menu-btn" onclick="closeShareMenu('${postId}')">&times;</button>
                </div>
                <div class="share-menu-body">
                    <button class="share-item" onclick="handleShareOption('${postId}', 'profile')">
                        <div class="share-icon"><i class="fas fa-user-edit"></i></div>
                        <div class="share-text">
                            <strong>Chia sẻ ngay</strong>
                            <span>Đăng lên trang cá nhân của bạn</span>
                        </div>
                    </button>

                    <button class="share-item" onclick="handleShareOption('${postId}', 'message')">
                        <div class="share-icon"><i class="fas fa-comment-dots"></i></div>
                        <div class="share-text">
                            <strong>Gửi qua tin nhắn</strong>
                            <span>Gửi cho bạn bè hoặc nhóm</span>
                        </div>
                    </button>
                    
                    <button class="share-item" onclick="handleShareOption('${postId}', 'copy')">
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

    document.body.insertAdjacentHTML('beforeend', menuHTML);
    
    // Thêm CSS cho menu này nếu chưa có
    addShareMenuCSS();
};

/**
 * BƯỚC 2: Xử lý khi người dùng chọn một tùy chọn trong menu
 */
window.handleShareOption = function(postId, type) {
    // BƯỚC 1: Đóng ngay cái menu lựa chọn
    closeShareMenu(postId); 

    // BƯỚC 2: Mở modal tiếp theo
    setTimeout(() => {
        if (type === 'profile') {
            if (window.shareModal && window.shareModal.openShareToProfile) {
                window.shareModal.openShareToProfile(postId);
            }
        }
        else if (type === 'message') {
            // Gọi dialog chọn bạn bè (nếu có hàm này)
            if (window.openShareToMessageDialog) {
                window.openShareToMessageDialog(postId);
            } else {
                alert('Chức năng gửi tin nhắn đang cập nhật');
            }
        }
        else if (type === 'copy') {
            // Copy link
            const link = `${window.location.origin}/post/${postId}`;
            navigator.clipboard.writeText(link).then(() => {
                showNotification('Đã sao chép liên kết!', 'success');
            });
        }
    }, 100); // Delay nhỏ để hiệu ứng đóng menu mượt hơn
};

/**
 * Hàm tiện ích: Đóng menu
 */
window.closeShareMenu = function(postId) {
    const menu = document.getElementById(`share-menu-${postId}`);
    if (menu) menu.remove();
    // Xóa cả các menu rác nếu còn sót
    document.querySelectorAll('.share-menu-modal').forEach(el => el.remove());
};
function addShareMenuCSS() {
    if (document.getElementById('share-menu-css')) return;
    
    const style = document.createElement('style');
    style.id = 'share-menu-css';
    style.textContent = `
        .share-menu-modal {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            z-index: 9999; display: flex; align-items: flex-end; justify-content: center;
        }
        @media (min-width: 768px) {
            .share-menu-modal { align-items: center; }
        }
        .share-menu-overlay {
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.5);
        }
        .share-menu-content {
            position: relative; background: white; width: 100%; max-width: 400px;
            border-radius: 16px 16px 0 0; padding: 20px; z-index: 10000;
            animation: slideUpMenu 0.3s ease;
            border-top: 3px solid #3eb489; /* THÊM DÒNG NÀY */
        }
        @media (min-width: 768px) {
            .share-menu-content { 
                border-radius: 12px; 
                border: 1px solid #3eb489;
            }
        }
        .share-menu-header {
            display: flex; justify-content: space-between; align-items: center;
            margin-bottom: 20px; border-bottom: 1px solid #eee; padding-bottom: 10px;
        }
        .share-menu-header h3 { 
            margin: 0; 
            font-size: 18px; 
            color: #3eb489; /* THÊM DÒNG NÀY */
        }
        .close-menu-btn { background: none; border: none; font-size: 24px; cursor: pointer; }
        
        .share-item {
            display: flex; align-items: center; width: 100%; padding: 15px;
            border: none; background: none; text-align: left; cursor: pointer;
            border-radius: 8px; transition: all 0.3s ease;
            border: 1px solid #e4e6eb;
            margin-bottom: 8px;
        }
        .share-item:hover { 
            background: rgba(62, 180, 137, 0.1); 
            border-color: #3eb489;
            transform: translateY(-2px);
        }
        .share-icon {
            width: 40px; height: 40px; background: #3eb489; border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            margin-right: 15px; font-size: 18px; color: white;
        }
        .share-text { display: flex; flex-direction: column; }
        .share-text strong { font-size: 15px; color: #050505; }
        .share-text span { font-size: 13px; color: #65676b; }
        
        @keyframes slideUpMenu {
            from { transform: translateY(100%); }
            to { transform: translateY(0); }
        }
    `;
    document.head.appendChild(style);
}
function attachShareEventListeners() {
    console.log('🔗 Attaching share event listeners...');
    
    // Gỡ sự kiện cũ (để tránh lặp nếu hàm này chạy nhiều lần)
    // Cách tốt nhất là dùng cờ hoặc thay thế element, nhưng ở đây ta dùng logic chặn
    
    document.addEventListener('click', function(e) {
        // Tìm nút share
        const shareBtn = e.target.closest('.post-stat.share-btn');
        
        if (shareBtn && shareBtn.dataset.postId) {
            e.preventDefault();
            e.stopPropagation();
            
            const postId = shareBtn.dataset.postId;
            console.log('🔘 Share button clicked -> Open Profile Share Modal for:', postId);
            
            // MỞ LUÔN MODAL CHIA SẺ VỀ TRANG CÁ NHÂN, không hiện menu
            if (window.shareModal && window.shareModal.openShareToProfile) {
                window.shareModal.openShareToProfile(postId);
            } else {
                // Fallback nếu shareModal chưa load
                showShareMenu(postId);
            }
            
            return false;
        }
    });
}
/**
 * Hủy reply
 */
function cancelReply(postId) {
    const commentInput = document.getElementById(`comment-input-${postId}`);
    if (!commentInput) return;
    
    commentInput.placeholder = 'Viết bình luận...';
    delete commentInput.dataset.replyTo;
    delete commentInput.dataset.replyToUsername;
    
    // Ẩn nút hủy
    const cancelBtn = document.getElementById(`cancel-reply-${postId}`);
    if (cancelBtn) {
        cancelBtn.style.display = 'none';
    }
    
    console.log(`[Reply] Cancelled reply for post: ${postId}`);
}
/**
 * Bắt đầu reply comment - ĐÃ SỬA (truyền đúng reply_to)
 */
function startReplyToComment(postId, commentId, username) {
    console.log(`[Reply] Starting reply to ${username} (${commentId}) on post ${postId}`);
    
    // Tìm đúng comment element để xác định đây là comment hay reply
    const commentElement = document.querySelector(`[data-comment-id="${commentId}"][data-post-id="${postId}"]`);
    let isReplyingToReply = false;
    
    if (commentElement) {
        // Kiểm tra xem đang reply comment hay reply
        if (commentElement.classList.contains('comment-reply')) {
            isReplyingToReply = true;
            console.log(`[Reply] Replying to a reply (nested reply)`);
        } else {
            console.log(`[Reply] Replying to a main comment`);
        }
    }
    
    const commentInput = document.getElementById(`comment-input-${postId}`);
    if (!commentInput) {
        console.error(`[Reply] Comment input not found for post: ${postId}`);
        return;
    }
    
    // Đặt placeholder với thông tin reply
    commentInput.placeholder = `Trả lời ${username}...`;
    commentInput.dataset.replyTo = commentId;
    commentInput.dataset.replyToUsername = username;
    
    // Focus vào input
    setTimeout(() => {
        commentInput.focus();
        commentInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
    
    // Hiển thị nút hủy
    const cancelBtn = document.getElementById(`cancel-reply-${postId}`);
    if (cancelBtn) {
        cancelBtn.style.display = 'inline-block';
    } else {
        // Tạo nút hủy nếu chưa có
        const cancelButton = document.createElement('button');
        cancelButton.className = 'btn btn-outline btn-sm';
        cancelButton.id = `cancel-reply-${postId}`;
        cancelButton.innerHTML = '<i class="fas fa-times"></i> Hủy';
        cancelButton.onclick = () => cancelReply(postId);
        
        // Thêm nút hủy vào bên cạnh nút gửi
        const submitBtn = commentInput.nextElementSibling;
        if (submitBtn && submitBtn.classList.contains('comment-submit-btn')) {
            submitBtn.parentNode.insertBefore(cancelButton, submitBtn);
        }
    }
    
    console.log(`[Reply] Reply mode activated for post: ${postId}, isReplyingToReply: ${isReplyingToReply}`);
}
/**
 * Chia sẻ bài viết về trang cá nhân
 */
async function shareToProfile(postId) {
    if (window.shareModal && typeof window.shareModal.openShareToProfile === 'function') {
        await window.shareModal.openShareToProfile(postId);
    } else {
        // Fallback implementation
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
                
                // Reload trang sau 1.5 giây
                setTimeout(() => {
                    location.reload();
                }, 1500);
            } else {
                showNotification(result.error || 'Lỗi khi chia sẻ bài viết', 'error');
            }
        } catch (error) {
            console.error('Share error:', error);
            showNotification('Lỗi kết nối khi chia sẻ', 'error');
        }
    }
}
/**
 * Chia sẻ bài viết qua tin nhắn - VERSION CŨ (giữ lại cho tương thích)
 */
async function shareToMessage(postId) {
    try {
        // Giữ nguyên logic cũ để tương thích
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
 * Hiển thị menu chia sẻ với nhiều tùy chọn hơn
 */
function showShareMenu(postId) {
    // --- SỬA: Không cần kiểm tra module ngoài, gọi thẳng hàm hiển thị menu ---
    // Vì hàm showShareMenuFallback (tạo HTML menu) đang nằm ngay trong file này
    console.log('Opening share menu for:', postId);
    showShareMenuFallback(postId); 
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
        // Sử dụng Web Share API nếu trình duyệt hỗ trợ
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
                // Fallback: sao chép link
                copyPostLink(postId);
            }
        }
    } else {
        // Fallback: sao chép link
        copyPostLink(postId);
    }
    
    closeShareModal(postId);
}

/**
 * Tải modal chọn bạn bè/ nhóm để chia sẻ qua tin nhắn
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
        
        // Tạo dialog chọn người nhận
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
                                    <img src="${friend.avatar}" alt="${friend.full_name || friend.username}" class="recipient-avatar">
                                    <div class="recipient-info">
                                        <strong>${friend.full_name || friend.username}</strong>
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
        
        // Thêm dialog vào body
        document.body.insertAdjacentHTML('beforeend', dialogHTML);
        
        // Thêm sự kiện cho các tab
        document.querySelectorAll(`.tab-btn[data-tab]`).forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tab = e.target.dataset.tab;
                
                // Cập nhật active tab
                document.querySelectorAll(`.tab-btn`).forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                
                // Hiển thị list tương ứng
                document.getElementById(`friends-list-${postId}`).style.display = tab === 'friends' ? 'block' : 'none';
                document.getElementById(`groups-list-${postId}`).style.display = tab === 'groups' ? 'block' : 'none';
            });
        });
        
        // Thêm sự kiện cho checkbox
        document.querySelectorAll(`.recipient-checkbox`).forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                updateSelectedCount(postId);
            });
        });
        
        // Thêm sự kiện tìm kiếm
        const searchInput = document.getElementById(`share-search-${postId}`);
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                filterRecipients(postId, e.target.value);
            });
        }
        
        // Thêm CSS cho modal
        addRecipientModalStyles();
        
    } catch (error) {
        console.error('Error loading recipients:', error);
        showNotification('Lỗi khi tải danh sách bạn bè/nhóm', 'error');
        // Fallback: sử dụng prompt cũ
        shareToMessage(postId);
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
 * Chia sẻ đến người nhận đã chọn
 */
async function shareToSelectedRecipients(postId) {
    try {
        const selectedItems = document.querySelectorAll(`#share-recipient-modal-${postId} .recipient-checkbox:checked`);
        
        if (selectedItems.length === 0) {
            showNotification('Vui lòng chọn ít nhất một người nhận', 'warning');
            return;
        }
        
        const content = prompt("Nhập tin nhắn kèm theo (có thể để trống):", "");
        if (content === null) return; // Người dùng bấm cancel
        
        // Thu thập thông tin người nhận
        const recipients = [];
        selectedItems.forEach(checkbox => {
            const item = checkbox.closest('.recipient-item');
            recipients.push({
                id: item.dataset.id,
                type: item.dataset.type
            });
        });
        
        // Gửi yêu cầu share cho từng người nhận
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
        
        results.forEach((result, index) => {
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
 * Đóng modal chọn người nhận
 */
function closeRecipientModal(postId) {
    const modal = document.getElementById(`share-recipient-modal-${postId}`);
    if (modal) {
        modal.remove();
    }
}

/**
 * Cải thiện hàm shareToMessage để sử dụng dialog mới
 */
async function shareToMessageWithDialog(postId) {
    if (window.shareModal && window.shareModal.shareToMessageWithDialog) {
        window.shareModal.shareToMessageWithDialog(postId);
    } else {
        // Fallback: sử dụng prompt cũ
        shareToMessageOld(postId);
    }
}
/**
 * Thêm CSS cho modal chọn người nhận
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

/**
 * Cải thiện CSS cho share modal
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
            @keyframes slideOut {
                from { transform: translateY(0); opacity: 1; }
                to { transform: translateY(20px); opacity: 0; }
            }
        `;
        document.head.appendChild(styles);
    }
}
function closeShareModal(postId) {
    const modal = document.getElementById(`share-modal-${postId}`);
    if (modal) {
        modal.remove();
    }
}

function copyPostLink(postId) {
    if (window.shareModal && window.shareModal.copyPostLink) {
        window.shareModal.copyPostLink(postId);
    } else {
        // Fallback implementation
        const postUrl = `${window.location.origin}/post/${postId}`;
        navigator.clipboard.writeText(postUrl)
            .then(() => {
                showNotification('Đã sao chép liên kết bài viết!', 'success');
            })
            .catch(err => {
                console.error('Copy failed:', err);
                showNotification('Lỗi khi sao chép liên kết', 'error');
            });
    }
}
/**
 * Thêm bình luận với hỗ trợ reply - PHIÊN BẢN MỚI
 */
async function addComment(postId) {
    if (commentProcessing) {
        console.log('[Comment] Action already in progress (from addComment)');
        return;
    }
    
    try {
        const commentInput = document.getElementById(`comment-input-${postId}`);
        if (!commentInput) {
            console.error(`[Comment] Input not found for post: ${postId}`);
            return;
        }

        const content = commentInput.value.trim();
        const replyTo = commentInput.dataset.replyTo;
        const replyToUsername = commentInput.dataset.replyToUsername;
        
        if (!content) {
            showNotification('Vui lòng nhập nội dung bình luận', 'warning');
            return;
        }

        console.log(`[Comment] Adding comment to post ${postId}:`, { content, replyTo, replyToUsername });
        
        // Sử dụng realtime version
        await addCommentRealtime(postId, content, replyTo, replyToUsername);
        
    } catch (error) {
        console.error('[Comment] Error:', error);
        showNotification('Lỗi khi bình luận', 'error');
        commentProcessing = false; // Đảm bảo reset trạng thái
    }
}
/**
 * Chuyển hướng đến trang chỉnh sửa profile
 */
function editProfile() {
    window.location.href = "/chat";
}

/**
 * Mở dialog chọn ảnh bìa
 */
function changeCoverPhoto() {
    if (window.profileManager && window.profileManager.coverUploadInput) {
        window.profileManager.coverUploadInput.click();
    }
}
// ===== SIDE NAVIGATION =====
class SideNavigation {
    constructor() {
        this.sideNav = document.getElementById('side-nav');
        this.navToggle = document.getElementById('nav-toggle');
        this.navOverlay = document.getElementById('nav-overlay');
        this.isMobile = window.innerWidth <= 768;
        
        if (this.sideNav) {
            this.init();
        }
    }

    init() {
        console.log('Initializing side navigation...');
        this.setupEventListeners();
        this.loadFriendRequestsCount(); // Tải số lượng lời mời khi khởi tạo
    }

    // THÊM HÀM NÀY - Tải số lượng lời mời kết bạn
    async loadFriendRequestsCount() {
        try {
            const response = await fetch('/friend_requests_count');
            if (response.ok) {
                const data = await response.json();
                this.updateFriendRequestsBadge(data.count || 0);
            }
        } catch (error) {
            console.error('Error loading friend requests count:', error);
        }
    }

    // THÊM HÀM NÀY - Cập nhật badge
    updateFriendRequestsBadge(count) {
        const badge = document.getElementById('friend-requests-nav-badge');
        if (badge) {
            if (count > 0) {
                badge.textContent = count;
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
        }
    }

    setupEventListeners() {
        // Toggle menu trên mobile
        if (this.navToggle) {
            this.navToggle.addEventListener('click', () => this.toggleMenu());
        }

        // Đóng menu khi click overlay
        if (this.navOverlay) {
            this.navOverlay.addEventListener('click', () => this.closeMenu());
        }

        // Xử lý resize window
        window.addEventListener('resize', () => this.handleResize());
    }

    toggleMenu() {
        if (this.isMobile) {
            this.sideNav.classList.toggle('active');
            this.navOverlay.classList.toggle('active');
            document.body.classList.toggle('side-nav-open');
        } else {
            this.sideNav.classList.toggle('active');
            document.body.classList.toggle('side-nav-open');
        }
    }

    openMenu() {
        this.sideNav.classList.add('active');
        if (this.isMobile) {
            this.navOverlay.classList.add('active');
        }
        document.body.classList.add('side-nav-open');
    }

    closeMenu() {
        this.sideNav.classList.remove('active');
        if (this.isMobile) {
            this.navOverlay.classList.remove('active');
        }
        document.body.classList.remove('side-nav-open');
    }

    handleResize() {
        this.isMobile = window.innerWidth <= 768;
        
        if (!this.isMobile) {
            this.navOverlay.classList.remove('active');
        } else {
            this.closeMenu();
        }
    }

    updateFriendRequestsBadge(count) {
        const badge = document.getElementById('friend-requests-nav-badge');
        if (badge) {
            if (count > 0) {
                badge.textContent = count;
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
        }
    }
}

// Khởi tạo side navigation
let sideNavigation = null;

// Thêm vào file profile.js hoặc trong thẻ script

// Side Navigation Functions cho profile page
function initializeSideNavigation() {
    const sideNav = document.getElementById('side-nav');
    const navToggle = document.getElementById('nav-toggle');
    const navOverlay = document.getElementById('nav-overlay');
    const isMobile = window.innerWidth <= 768;

    if (!sideNav) return;

    // Toggle menu chỉ dành cho mobile
    if (navToggle) {
        navToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleMenu();
        });
    }

    // Close menu when clicking overlay (mobile only)
    if (navOverlay) {
        navOverlay.addEventListener('click', () => closeMenu());
    }

    // Close menu when clicking outside on mobile
    document.addEventListener('click', (e) => {
        if (isMobile && sideNav.classList.contains('active') && 
            !sideNav.contains(e.target) && e.target !== navToggle) {
            closeMenu();
        }
    });

    // Handle resize
    window.addEventListener('resize', handleResize);

    function toggleMenu() {
        if (isMobile) {
            sideNav.classList.toggle('active');
            navOverlay.classList.toggle('active');
            document.body.classList.toggle('side-nav-open');
        }
        // Trên desktop không cần toggle bằng click
    }

    function closeMenu() {
        if (isMobile) {
            sideNav.classList.remove('active');
            navOverlay.classList.remove('active');
            document.body.classList.remove('side-nav-open');
        }
    }

    function handleResize() {
        const newIsMobile = window.innerWidth <= 768;
        if (newIsMobile && !isMobile) {
            // Switching to mobile - ensure menu is closed
            closeMenu();
        }
    }
    updateFriendRequestsBadge();
}

// Gọi hàm khởi tạo khi trang load
document.addEventListener('DOMContentLoaded', function() {
    initializeSideNavigation();
    
    // Khởi tạo chức năng xem thêm cho bài viết dài
    initializePostContentToggle();
    
    // Các hàm khởi tạo khác của profile page...
});

// ==================== POST CONTENT TOGGLE FUNCTIONALITY ====================
/**
 * Khởi tạo chức năng xem thêm/rút gọn cho bài viết dài
 */
function initializePostContentToggle() {
    // Tìm tất cả nội dung bài viết chính chưa có toggle button
    const postContents = document.querySelectorAll('.post-content:not(.toggle-initialized)');
    
    postContents.forEach(content => {
        const postId = content.id.replace('post-content-', '');
        const textContent = content.textContent.trim();
        
        // Đánh dấu là đã khởi tạo
        content.classList.add('toggle-initialized');
        
        // Chỉ thêm nút xem thêm nếu nội dung dài hơn 3 dòng (khoảng 150 ký tự)
        if (textContent.length > 150) {
            // Thêm class truncated ban đầu
            content.classList.add('truncated');
            
            // Tạo nút xem thêm
            const toggleBtn = document.createElement('button');
            toggleBtn.className = 'post-content-toggle';
            toggleBtn.innerHTML = '<span>Xem thêm</span> <i class="fas fa-chevron-down"></i>';
            toggleBtn.onclick = () => togglePostContent(postId);
            
            // Chèn nút sau nội dung bài viết
            content.parentNode.insertBefore(toggleBtn, content.nextSibling);
        }
    });
    
    // Xử lý cả nội dung bài viết được chia sẻ chưa có toggle button
    const sharedContents = document.querySelectorAll('.shared-content:not(.toggle-initialized)');
    sharedContents.forEach((content, index) => {
        const textContent = content.textContent.trim();
        
        // Đánh dấu là đã khởi tạo
        content.classList.add('toggle-initialized');
        
        if (textContent.length > 150) {
            // Tạo ID unique cho shared content
            const sharedId = `shared-${index}`;
            content.id = `shared-content-${sharedId}`;
            
            // Thêm class truncated
            content.classList.add('truncated');
            
            // Tạo nút xem thêm
            const toggleBtn = document.createElement('button');
            toggleBtn.className = 'post-content-toggle';
            toggleBtn.innerHTML = '<span>Xem thêm</span> <i class="fas fa-chevron-down"></i>';
            toggleBtn.onclick = () => toggleSharedContent(sharedId);
            
            // Chèn nút sau nội dung
            content.parentNode.insertBefore(toggleBtn, content.nextSibling);
        }
    });
}

/**
 * Toggle hiển thị đầy đủ/rút gọn nội dung bài viết
 */
function togglePostContent(postId) {
    const content = document.getElementById(`post-content-${postId}`);
    const toggleBtn = content.nextElementSibling;
    
    if (content.classList.contains('truncated')) {
        // Hiển thị đầy đủ
        content.classList.remove('truncated');
        content.classList.add('expanded');
        toggleBtn.innerHTML = '<span>Rút gọn</span> <i class="fas fa-chevron-up"></i>';
        toggleBtn.classList.add('expanded');
    } else {
        // Rút gọn
        content.classList.remove('expanded');
        content.classList.add('truncated');
        toggleBtn.innerHTML = '<span>Xem thêm</span> <i class="fas fa-chevron-down"></i>';
        toggleBtn.classList.remove('expanded');
    }
}

/**
 * Toggle hiển thị đầy đủ/rút gọn nội dung bài viết được chia sẻ
 */
function toggleSharedContent(sharedId) {
    const content = document.getElementById(`shared-content-${sharedId}`);
    const toggleBtn = content.nextElementSibling;
    
    if (content.classList.contains('truncated')) {
        // Hiển thị đầy đủ
        content.classList.remove('truncated');
        content.classList.add('expanded');
        toggleBtn.innerHTML = '<span>Rút gọn</span> <i class="fas fa-chevron-up"></i>';
        toggleBtn.classList.add('expanded');
    } else {
        // Rút gọn
        content.classList.remove('expanded');
        content.classList.add('truncated');
        toggleBtn.innerHTML = '<span>Xem thêm</span> <i class="fas fa-chevron-down"></i>';
        toggleBtn.classList.remove('expanded');
    }
}
// ==================== CLASS PROFILE MANAGER ====================

class ProfileManager {
    constructor() {
        this.currentMedia = [];
        this.isInitialized = false;
        this.uploadQueue = [];
        this.isUploading = false;
        this.initializeEventListeners();
        this.initializeCoverPhotoUpload();
    }

    /**
     * Khởi tạo tất cả event listeners
     */
    initializeEventListeners() {
        // NGĂN KHÔNG CHO KHỞI TẠO NHIỀU LẦN
        if (this.isInitialized) {
            console.log('ProfileManager already initialized');
            return;
        }
        this.isInitialized = true;

        console.log('Initializing ProfileManager event listeners...');

        // Media upload for posts
        const addImageBtn = document.getElementById('add-image-btn');
        const mediaUpload = document.getElementById('media-upload');
        const submitPost = document.getElementById('submit-post');
        const postContent = document.getElementById('post-content');

        if (addImageBtn) {
            addImageBtn.addEventListener('click', () => this.openMediaUpload());
            console.log('Add image button listener attached');
        } else {
            console.warn('Add image button not found');
        }

        if (mediaUpload) {
            mediaUpload.addEventListener('change', (e) => this.handleMediaUpload(e));
            console.log('Media upload listener attached');
        } else {
            console.warn('Media upload input not found');
        }

        if (submitPost) {
            submitPost.addEventListener('click', () => this.createPost());
            console.log('Submit post button listener attached');
        } else {
            console.warn('Submit post button not found');
        }

        if (postContent) {
            postContent.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && e.ctrlKey) {
                    this.createPost();
                }
            });
            console.log('Post content listener attached');
        } else {
            console.warn('Post content textarea not found');
        }
    }

    /**
     * Khởi tạo upload ảnh bìa
     */
    initializeCoverPhotoUpload() {
        // Tạo input file ẩn cho ảnh bìa
        this.coverUploadInput = document.createElement('input');
        this.coverUploadInput.type = 'file';
        this.coverUploadInput.accept = 'image/*';
        this.coverUploadInput.style.display = 'none';
        this.coverUploadInput.addEventListener('change', (e) => this.handleCoverPhotoUpload(e));
        document.body.appendChild(this.coverUploadInput);
        console.log('Cover photo upload initialized');
    }

    /**
     * Xử lý upload ảnh bìa
     */
    async handleCoverPhotoUpload(event) {
        const file = event.target.files[0];
        if (!file) {
            console.log('No file selected for cover photo');
            return;
        }

        // Kiểm tra kích thước file (tối đa 5MB cho ảnh bìa)
        if (file.size > 5 * 1024 * 1024) {
            showNotification('Ảnh bìa không được vượt quá 5MB', 'error');
            return;
        }

        // Kiểm tra loại file
        if (!file.type.match('image.*')) {
            showNotification('Vui lòng chọn file ảnh', 'error');
            return;
        }

        const formData = new FormData();
        formData.append('cover_photo', file);

        try {
            console.log('Uploading cover photo...');
            const response = await fetch('/update_cover_photo', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            
            if (result.success) {
                // Cập nhật ảnh bìa trong UI
                this.updateCoverPhotoUI(result.cover_photo_url);
                showNotification('Cập nhật ảnh bìa thành công!', 'success');
                console.log('Cover photo updated successfully');
            } else {
                showNotification(result.error || 'Lỗi khi cập nhật ảnh bìa', 'error');
            }
        } catch (error) {
            console.error('Cover photo upload error:', error);
            showNotification('Lỗi khi cập nhật ảnh bìa', 'error');
        }

        // Reset input
        event.target.value = '';
    }

    /**
     * Cập nhật hiển thị ảnh bìa
     */
    updateCoverPhotoUI(coverPhotoUrl) {
        const headerBackground = document.querySelector('.header-background');
        if (!headerBackground) {
            console.error('Header background element not found');
            return;
        }

        const coverImage = headerBackground.querySelector('.cover-image');
        const coverPlaceholder = headerBackground.querySelector('.cover-placeholder');

        if (coverImage) {
            coverImage.src = coverPhotoUrl;
            console.log('Updated existing cover image');
        } else if (coverPlaceholder) {
            // Thay thế placeholder bằng ảnh thực tế
            coverPlaceholder.style.display = 'none';
            const newCoverImage = document.createElement('img');
            newCoverImage.src = coverPhotoUrl;
            newCoverImage.alt = 'Cover photo';
            newCoverImage.className = 'cover-image';
            headerBackground.insertBefore(newCoverImage, headerBackground.firstChild);
            console.log('Created new cover image');
        } else {
            console.warn('No cover image or placeholder found');
        }
    }

    /**
     * Mở dialog chọn media (hỗ trợ multiple)
     */
    openMediaUpload() {
        const mediaUpload = document.getElementById('media-upload');
        if (mediaUpload) {
            // Cho phép chọn nhiều file
            mediaUpload.multiple = true;
            mediaUpload.click();
            console.log('Media upload dialog opened (multiple files allowed)');
        } else {
            console.error('Media upload input not found');
        }
    }

    /**
     * Xử lý upload nhiều media
     */
    async handleMediaUpload(event) {
        const files = Array.from(event.target.files);
        if (!files.length) {
            console.log('No files selected for media upload');
            return;
        }

        console.log(`Processing ${files.length} media files`);

        // Kiểm tra số lượng file
        const maxFiles = 10;
        if (files.length > maxFiles) {
            showNotification(`Bạn chỉ có thể upload tối đa ${maxFiles} file cùng lúc`, 'error');
            event.target.value = '';
            return;
        }

        // Kiểm tra tổng số file không vượt quá giới hạn
        if (files.length + this.currentMedia.length > maxFiles) {
            showNotification(`Bạn chỉ có thể upload tối đa ${maxFiles} file. Hiện tại đã có ${this.currentMedia.length} file.`, 'error');
            event.target.value = '';
            return;
        }

        // Hiển thị loading state
        this.showUploadingState(true);

        // Validate files before upload
        const validFiles = [];
        for (const file of files) {
            // Kiểm tra loại file trước
            const isImage = file.type.match('image.*');
            const isVideo = file.type.match('video.*');
            
            if (!isImage && !isVideo) {
                console.warn(`File ${file.name} không phải là ảnh hoặc video: ${file.type}`);
                showNotification(`File ${file.name} không phải là ảnh hoặc video`, 'error');
                continue;
            }

            // 🔥 [FIX] Chỉ giới hạn ảnh 10MB, video không giới hạn
            if (isImage && file.size > 10 * 1024 * 1024) {
                console.warn(`Ảnh ${file.name} vượt quá 10MB: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
                showNotification(`Ảnh ${file.name} quá lớn (tối đa 10MB)`, 'error');
                continue;
            }
            // Video không giới hạn size

            validFiles.push(file);
        }

        if (validFiles.length === 0) {
            this.showUploadingState(false);
            event.target.value = '';
            return;
        }

        try {
            // Upload tất cả files trong một request
            const formData = new FormData();
            validFiles.forEach(file => {
                formData.append('media', file);
            });

            const response = await fetch('/upload_post_media', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            
            if (result.success && result.media_urls && result.media_urls.length > 0) {
                // Thêm tất cả media URLs đã upload thành công
                this.currentMedia = [...this.currentMedia, ...result.media_urls];
                this.updateMediaPreview();
                console.log(`Successfully uploaded ${result.media_urls.length} files`);
                showNotification(`Đã upload thành công ${result.media_urls.length} file`, 'success');
            } else {
                showNotification(result.error || 'Không có file nào được upload thành công', 'error');
            }
            
        } catch (error) {
            console.error('Upload error:', error);
            showNotification('Lỗi khi tải lên media', 'error');
        } finally {
            this.showUploadingState(false);
        }

        // Reset input
        event.target.value = '';
    }

    /**
     * Hiển thị/ẩn trạng thái đang upload
     */
    showUploadingState(show) {
        const postActions = document.querySelector('.post-actions');
        const submitBtn = document.getElementById('submit-post');
        const addImageBtn = document.getElementById('add-image-btn');
        
        if (show) {
            postActions.classList.add('media-uploading');
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang tải lên...';
            if (addImageBtn) {
                addImageBtn.disabled = true;
            }
        } else {
            postActions.classList.remove('media-uploading');
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fi fi-br-paper-plane"></i> Đăng bài';
            if (addImageBtn) {
                addImageBtn.disabled = false;
            }
        }
    }

    /**
     * Cập nhật preview media với grid layout
     */
    updateMediaPreview() {
        const preview = document.getElementById('media-preview');
        if (!preview) {
            console.error('Media preview element not found');
            return;
        }

        preview.innerHTML = '';

        if (this.currentMedia.length === 0) {
            preview.classList.remove('has-media');
            preview.style.display = 'none';
            return;
        }

        preview.classList.add('has-media');
        preview.style.display = 'grid';

        // Áp dụng layout khác nhau dựa trên số lượng media
        if (this.currentMedia.length === 1) {
            preview.className = 'media-preview-grid has-media single-item';
        } else if (this.currentMedia.length === 2) {
            preview.className = 'media-preview-grid has-media double-items';
        } else if (this.currentMedia.length <= 4) {
            preview.className = 'media-preview-grid has-media multiple-items';
        } else {
            preview.className = 'media-preview-grid has-media grid-items';
        }

        // Tạo preview items
        this.currentMedia.forEach((media, index) => {
            const mediaElement = document.createElement('div');
            mediaElement.className = 'media-preview-item';
            
            if (media.type === 'image') {
                mediaElement.innerHTML = `
                    <img src="${media.url}" alt="Preview" 
                         onerror="this.src='/static/img/default-image.png'">
                    <button type="button" class="remove-media" data-index="${index}" title="Xóa">
                        <i class="fas fa-times"></i>
                    </button>
                `;
            } else {
                mediaElement.innerHTML = `
                    <video src="${media.url}" controls></video>
                    <button type="button" class="remove-media" data-index="${index}" title="Xóa">
                        <i class="fas fa-times"></i>
                    </button>
                `;
            }
            
            preview.appendChild(mediaElement);
        });

        // Thêm event listeners cho nút xóa
        preview.querySelectorAll('.remove-media').forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(e.target.closest('.remove-media').dataset.index);
                this.removeMedia(index);
            });
        });

        console.log(`Media preview updated with ${this.currentMedia.length} items`);
    }

    /**
     * Xóa media khỏi preview
     */
    removeMedia(index) {
        if (index >= 0 && index < this.currentMedia.length) {
            this.currentMedia.splice(index, 1);
            this.updateMediaPreview();
            console.log(`Removed media at index ${index}`);
            
            // Hiển thị thông báo nếu còn media
            if (this.currentMedia.length > 0) {
                showNotification(`Còn ${this.currentMedia.length} file trong bài viết`, 'info');
            }
        } else {
            console.error(`Invalid media index: ${index}`);
        }
    }

    /**
     * Tạo bài viết mới với nhiều media
     */
    async createPost() {
        if (postProcessing) {
            console.log('Post creation already in progress');
            return;
        }
        postProcessing = true;
        
        // Check connection status
        if (!window.connectionManager || !window.connectionManager.isOnline) {
            showNotification('Bạn đang offline. Vui lòng kiểm tra kết nối internet và thử lại.', 'error');
            postProcessing = false;
            return;
        }
        
        const submitBtn = document.getElementById('submit-post');
        if (!submitBtn) {
            console.error('Submit post button not found');
            postProcessing = false;
            return;
        }

        const content = document.getElementById('post-content')?.value.trim() || '';
        const privacy = document.getElementById('profile-post-privacy')?.value || 'public';
        
        if (!content && this.currentMedia.length === 0) {
            showNotification('Vui lòng nhập nội dung hoặc thêm media', 'warning');
            postProcessing = false;
            return;
        }

        const originalHTML = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang đăng...';

        try {
            console.log('Creating post with privacy...', { 
                content, 
                privacy,
                mediaCount: this.currentMedia.length,
                mediaTypes: this.currentMedia.map(m => m.type),
                taggedFriends: window.taggedFriends || [],
                taggedFriendsCount: (window.taggedFriends || []).length
            });
            
            // Warn user if tagging friends in private post
            if (privacy === 'private' && window.taggedFriends && window.taggedFriends.length > 0) {
                const friendNames = window.taggedFriends.map(f => f.display_name || f.username).join(', ');
                const confirmed = confirm(`⚠️ Cảnh báo: Bạn đang gắn thẻ ${friendNames} trong bài viết "Chỉ mình tôi".\n\nBạn bè bị tag sẽ không thể xem bài viết này.\n\nBạn có muốn tiếp tục không?`);
                if (!confirmed) {
                    postProcessing = false;
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = originalHTML;
                    return;
                }
            }
            
            const response = await fetch('/create_post', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    content: content,
                    privacy: privacy,
                    media_urls: this.currentMedia,
                    tagged_friends: window.taggedFriends || []
                })
            });

            if (!response.ok) {
                if (response.status === 0 || response.type === 'opaque') {
                    throw new Error('Network error - Unable to connect to server');
                }
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            
            if (result.success) {
                // Xóa form
                const postContent = document.getElementById('post-content');
                if (postContent) postContent.value = '';
                
                this.currentMedia = [];
                this.updateMediaPreview();
                
                // Reset tagged friends
                window.taggedFriends = [];
                window.taggedFriendsIds = [];
                
                // Hiển thị thông báo thành công
                showNotification('Đăng bài thành công!', 'success');
                
                console.log('Post created successfully, refreshing sidebar before reload...');
                
                // Refresh sidebar trending tags to show new hashtags immediately
                setTimeout(() => {
                    if (window.timelineManager && window.timelineManager.refreshSidebarTrendingTags) {
                        console.log('🔄 [DEBUG] Refreshing sidebar from profile...');
                        window.timelineManager.refreshSidebarTrendingTags();
                        
                        // Then reload page after a short delay
                        setTimeout(() => {
                            console.log('🔄 [DEBUG] Reloading page...');
                            location.reload();
                        }, 500);
                    } else {
                        // Fallback - just reload page
                        console.log('🔄 [DEBUG] Timeline manager not found, reloading page immediately...');
                        location.reload();
                    }
                }, 500);
                
                // Apply formatting after reload (in case reload doesn't work)
                setTimeout(() => {
                    console.log('🔄 [DEBUG] Applying post content formatting after delay...');
                    applyPostContentFormatting();
                }, 2000);
            } else {
                showNotification(result.error || 'Lỗi khi đăng bài', 'error');
            }
        } catch (error) {
            console.error('Create post error:', error);
            
            // Handle different types of errors
            if (error.message.includes('Network error') || error.message.includes('Failed to fetch')) {
                showNotification('Mất kết nối với server. Vui lòng kiểm tra kết nối internet và thử lại.', 'error');
                
                // Trigger connection check
                if (window.connectionManager) {
                    window.connectionManager.checkConnection();
                }
            } else if (error.message.includes('AbortError')) {
                showNotification('Yêu cầu bị hủy. Vui lòng thử lại.', 'warning');
            } else {
                showNotification('Lỗi khi đăng bài: ' + error.message, 'error');
            }
        } finally {
            postProcessing = false;
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalHTML;
        }
    }
}
/**
 * Format nội dung bài viết với tags và hashtags
 */
function formatPostContent(content, taggedFriends = []) {
    if (!content) return '';
    
    let formattedContent = content;
    
    // Convert @mentions to clickable links - only for tagged friends like timeline
    if (taggedFriends && taggedFriends.length > 0) {
        taggedFriends.forEach(friend => {
            // Use display_name (full name) instead of username since that's what gets inserted
            const displayName = friend.display_name || friend.full_name || friend.username;
            const mentionRegex = new RegExp(`@${displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
            formattedContent = formattedContent.replace(mentionRegex, 
                `<a href="/profile/${friend.username}" class="tagged-friend-mention" onclick="event.stopPropagation()">@${displayName}</a>`
            );
        });
    }
    
    // Convert hashtags to clickable links - redirect to hashtag page
    formattedContent = formattedContent.replace(/#([^\s#]+)/g, 
        '<a href="/hashtag/$1" class="hashtag-link">#$1</a>'
    );
    
    // Convert newlines to <br>
    formattedContent = formattedContent.replace(/\n/g, '<br>');
    
    return formattedContent;
}

// Search tag function - Redirect to hashtag page
window.searchTag = function(tag) {
    console.log('🔍 Searching for tag:', tag);
    const cleanTag = tag.startsWith('#') ? tag.substring(1) : tag;
    window.location.href = `/hashtag/${encodeURIComponent(cleanTag)}`;
};

// Show modal with hashtag posts
function showTagPostsModal(tag, loading = false) {
    // Remove existing modal if any
    let modal = document.getElementById('tag-posts-modal');
    if (modal) {
        modal.remove();
    }
    
    // Create modal
    modal = document.createElement('div');
    modal.id = 'tag-posts-modal';
    modal.className = 'tag-posts-modal';
    modal.innerHTML = `
        <div class="tag-modal-backdrop" onclick="closeTagPostsModal()"></div>
        <div class="tag-modal-content">
            <div class="tag-modal-header">
                <div class="tag-modal-info">
                    <div class="tag-modal-icon">
                        <i class="fas fa-hashtag"></i>
                    </div>
                    <div class="tag-modal-title">
                        <span class="tag-label">Hashtag</span>
                        <span class="tag-name">#${tag}</span>
                    </div>
                </div>
                <button class="tag-modal-close" onclick="closeTagPostsModal()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="tag-modal-body">
                <div id="tag-posts-container">
                    ${loading ? `
                        <div class="tag-posts-loading">
                            <i class="fas fa-spinner fa-spin"></i>
                            <span>Đang tải bài viết...</span>
                        </div>
                    ` : ''}
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Trigger animation
    setTimeout(() => {
        modal.classList.add('show');
    }, 10);
    
    // Prevent body scroll
    document.body.style.overflow = 'hidden';
}

// Fetch posts with hashtag
async function fetchTagPosts(tag) {
    try {
        const response = await fetch(`/api/posts/hashtag/${encodeURIComponent(tag)}`);
        const data = await response.json();
        
        if (data.success && data.posts && data.posts.length > 0) {
            renderTagPosts(data.posts, tag);
        } else {
            showEmptyTagPosts(tag);
        }
    } catch (error) {
        console.error('Error fetching tag posts:', error);
        showEmptyTagPosts(tag);
    }
}

// Render posts in modal
function renderTagPosts(posts, tag) {
    const container = document.getElementById('tag-posts-container');
    if (!container) return;
    
    const postsHTML = posts.map(post => `
        <div class="tag-post-item" onclick="viewPost('${post._id}')">
            <div class="tag-post-header">
                <img src="${post.author_avatar || '/static/img/default-avatar.png'}" class="tag-post-avatar">
                <div class="tag-post-info">
                    <div class="tag-post-author">${post.author_name || 'Unknown'}</div>
                    <div class="tag-post-time">${formatTimeAgo(post.created_at)}</div>
                </div>
            </div>
            <div class="tag-post-content">${post.content || ''}</div>
            
            <!-- Post Actions -->
            <div class="tag-post-actions">
                <button class="tag-action-btn ${post.is_liked ? 'liked' : ''}" 
                        onclick="event.stopPropagation(); likePost('${post._id}')"
                        data-post-id="${post._id}">
                    <i class="${post.is_liked ? 'fas' : 'far'} fa-heart"></i>
                    <span>${post.is_liked ? 'Đã thích' : 'Thích'}</span>
                </button>
                <button class="tag-action-btn" 
                        onclick="event.stopPropagation(); toggleComments('${post._id}')"
                        data-post-id="${post._id}">
                    <i class="far fa-comment"></i>
                    <span>Bình luận</span>
                </button>
                <button class="tag-action-btn" 
                        onclick="event.stopPropagation(); showShareMenu('${post._id}')"
                        data-post-id="${post._id}">
                    <i class="fas fa-share"></i>
                    <span>Chia sẻ</span>
                </button>
            </div>
        </div>
    `).join('');
    
    container.innerHTML = postsHTML;
}

// Format time ago function (same as timeline)
function formatTimeAgo(timestamp) {
    if (!timestamp) return '';
    
    // Parse timestamp - xử lý ISO format từ UTC
    let date;
    if (timestamp.includes('T') && timestamp.includes('Z')) {
        // UTC format với Z suffix
        date = new Date(timestamp);
    } else if (timestamp.includes('T')) {
        // ISO format không có Z, thêm Z để chỉ định UTC
        date = new Date(timestamp + 'Z');
    } else {
        // Format khác, coi là local time
        date = new Date(timestamp);
    }
    
    const now = new Date();
    
    // Tính khoảng cách thời gian (milliseconds)
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Vừa xong';
    if (diffMins < 60) return `${diffMins} phút trước`;
    if (diffHours < 24) return `${diffHours} giờ trước`;
    if (diffDays < 7) return `${diffDays} ngày trước`;
    
    // Format ngày tháng cho bài cũ
    return date.toLocaleDateString('vi-VN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    });
}

// Show empty state
function showEmptyTagPosts(tag) {
    const container = document.getElementById('tag-posts-container');
    if (!container) return;
    
    container.innerHTML = `
        <div class="tag-posts-empty">
            <i class="fas fa-inbox"></i>
            <h3>Chưa có bài viết</h3>
            <p>Hashtag #${tag} chưa có bài viết nào.</p>
        </div>
    `;
}

// Close modal
window.closeTagPostsModal = function() {
    const modal = document.getElementById('tag-posts-modal');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => {
            modal.remove();
        }, 300);
    }
    document.body.style.overflow = '';
};

// View post
window.viewPost = function(postId) {
    closeTagPostsModal();
    window.location.href = `/post/${postId}`;
};

// ESC key to close
window.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeTagPostsModal();
    }
});

/**
 * Apply formatting to all existing post contents on page load
 */
function applyPostContentFormatting() {
    console.log('[DEBUG] applyPostContentFormatting called');
    document.querySelectorAll('.post-card').forEach(postCard => {
        const contentElement = postCard.querySelector('.post-content');
        console.log('[DEBUG] Processing post card:', postCard);
        console.log('[DEBUG] Content element:', contentElement);
        console.log('[DEBUG] Content text:', contentElement?.textContent);
        console.log('[DEBUG] Already formatted:', contentElement?.dataset.formatted);
        
        if (contentElement && contentElement.textContent && !contentElement.dataset.formatted) {
            // Get tagged friends data from post card if available
            const taggedFriends = postCard.dataset.taggedFriends ? 
                JSON.parse(postCard.dataset.taggedFriends) : [];
            
            console.log('[DEBUG] Tagged friends data:', taggedFriends);
            console.log('[DEBUG] Content before formatting:', contentElement.textContent);
            
            contentElement.innerHTML = formatPostContent(contentElement.textContent, taggedFriends);
            contentElement.dataset.formatted = 'true';
            
            console.log('[DEBUG] Content after formatting:', contentElement.innerHTML);
        }
    });
}

// Apply formatting when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    applyPostContentFormatting();
});

// Also apply formatting after a delay to catch dynamically loaded content
setTimeout(() => {
    console.log('[DEBUG] Applying post content formatting after delay...');
    applyPostContentFormatting();
}, 1000);

/**
 * Xử lý nút trở về trang của tôi
 */
/**
 * Khởi tạo Profile Likes Manager
 */
function initializeProfileLikes() {
    const profileContainer = document.querySelector('.profile-container');
    if (!profileContainer) return;
    
    const profileUserId = profileContainer.dataset.userId;
    const currentUserId = profileContainer.dataset.currentUserId;
    
    if (profileUserId && currentUserId) {
        // Khởi tạo Profile Likes Manager
        if (window.profileLikesManager) {
            window.profileLikesManager.initialize(profileUserId, currentUserId);
            console.log('Profile Likes Manager initialized successfully');
        }
    }
}

function viewPostShares(postId) {
    window.open(`/post_shares/${postId}`, '_blank');
}
// ==================== KHỞI TẠO ỨNG DỤNG ====================
/**
 * Khởi tạo tất cả event listeners cho trang profile - PHIÊN BẢN ĐÃ SỬA
 */

function initializeProfilePage() {
    console.log('🎯 Initializing profile page...');
    
    try {
        initializeShareModal();
        if (!window.postInteractions) {
            window.postInteractions = new PostInteractions();
            window.postInteractions.initialize();
        }
        // 2. Khởi tạo side navigation đầu tiên
        initializeSideNavigation();
        initializeSharedPosts();
        initializeProfileLikes();
        // 3. Lấy user ID chính xác
        const profileContainer = document.querySelector('.profile-container');
        if (!profileContainer) {
            console.error('❌ Profile container not found');
            return;
        }
        
        const userId = profileContainer.dataset.userId;
        const currentUserId = profileContainer.dataset.currentUserId;
        
        console.log('👤 Profile user ID:', userId);
        console.log('🔐 Current user ID:', currentUserId);
        
        if (!userId || !currentUserId) {
            console.error('❌ Cannot determine user IDs');
            return;
        }
        
        // 4. Nếu đang xem profile của người khác, gắn listeners cho nút bạn bè và kiểm tra trạng thái
        if (userId !== currentUserId) {
            // Kiểm tra trạng thái bạn bè trước
            checkAndUpdateFriendStatus(userId);
            attachFriendActionListeners(userId);
        }
        
        // 5. Khởi tạo carousels
        initializeCarousels();
        
        // 6. CHỈ TẢI BẠN BÈ VÀ ẢNH CHO CHÍNH NGƯỜI DÙNG
        if (userId === currentUserId) {
            console.log('💼 Loading data for own profile');
            loadUserFriends(userId);
            loadRecentPhotos(userId);
        } else {
            console.log('👀 Viewing other user profile, loading limited data');
            loadRecentPhotos(userId);
        }
        
        // 7. Ẩn tất cả sections bình luận
        document.querySelectorAll('.comments-section').forEach(section => {
            if (section.style.display !== 'none') {
                section.style.display = 'none';
            }
        });
        
        // 8. Khởi tạo các listeners khác
        initializePostEditDeleteListeners();
        
        // 9. Gắn sự kiện cho các nút tương tác
        attachPostInteractionListeners();
        
        // 10. Gắn sự kiện cho comment inputs
        attachCommentInputListeners();
        
        // 11. Khởi tạo các chức năng chia sẻ
        attachShareEventListeners();
        attachCommentEventListeners();
        
        // 12. Khởi tạo realtime comment handlers (nếu có socket)
        if (socket) {
            initializeRealtimeCommentHandlers();
        }
        
        console.log('✅ Profile page initialization completed');
        
    } catch (error) {
        console.error('❌ Error initializing profile page:', error);
        showNotification('Lỗi khi tải trang. Vui lòng tải lại trang.', 'error');
    }
}
/**
 * Fallback API cho comment khi socket timeout
 */
async function addCommentAPIFallback(postId, content, replyTo, replyToUsername, tempCommentId) {
    try {
        console.log('[API Fallback] Calling addCommentAPI');
        const result = await addCommentAPI(postId, content, replyTo, replyToUsername);
        
        if (result.success) {
            // Cập nhật comment tạm thành comment thật
            updateTempComment(postId, tempCommentId, result.comment);
            showNotification('Đã thêm bình luận', 'success');
            return true;
        } else {
            // Xóa comment tạm nếu lỗi
            removeTempComment(postId, tempCommentId);
            showNotification(result.error || 'Lỗi khi thêm bình luận', 'error');
            return false;
        }
    } catch (error) {
        console.error('API fallback error:', error);
        removeTempComment(postId, tempCommentId);
        showNotification('Lỗi kết nối khi thêm bình luận', 'error');
        return false;
    }
}

/**
 * API fallback cho thêm comment
 */
async function addCommentAPI(postId, content, replyTo = null, replyToUsername = null) {
    try {
        const requestData = {
            post_id: postId,
            content: content
        };
        
        if (replyTo) {
            requestData.reply_to = replyTo;
            requestData.reply_to_username = replyToUsername;
            requestData.reply_type = 'reply';
        }
        
        console.log('[API] Sending comment request:', requestData);
        
        const response = await fetch('/comment_post', {
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
        console.log('[API] Comment response:', result);
        
        return result;
        
    } catch (error) {
        console.error('API Error:', error);
        return { success: false, error: 'Lỗi kết nối' };
    }
}
function updateTempComment(postId, tempCommentId, realComment) {
    const tempElement = document.querySelector(`[data-comment-id="${tempCommentId}"]`);
    if (!tempElement) {
        console.warn(`Temp comment not found: ${tempCommentId}`);
        return;
    }
    
    // Cập nhật data attribute
    tempElement.dataset.commentId = realComment.id;
    
    // Cập nhật username
    const authorElement = tempElement.querySelector('.comment-author');
    if (authorElement) {
        // Giữ phần reply_to nếu có
        const replyToSpan = authorElement.querySelector('.reply-to');
        const replyToHTML = replyToSpan ? replyToSpan.outerHTML : '';
        authorElement.innerHTML = `${realComment.username || 'Unknown'}${replyToHTML}`;
    }
    
    // Cập nhật avatar
    const avatarElement = tempElement.querySelector('.comment-avatar');
    if (avatarElement && realComment.user_avatar) {
        avatarElement.src = realComment.user_avatar;
    }
    
    // CẬP NHẬT: Thêm các data attributes cần thiết cho reply
    // Giữ reply_to và reply_to_username nếu có
    if (realComment.reply_to) {
        tempElement.dataset.replyTo = realComment.reply_to;
    }
    if (realComment.reply_to_username) {
        tempElement.dataset.replyUsername = realComment.reply_to_username;
    }
    
    // CẬP NHẬT QUAN TRỌNG: Cập nhật TẤT CẢ các phần tử con có data-comment-id
    // để từ ID tạm sang ID thật
    const oldTempId = tempCommentId;
    const newRealId = realComment.id;
    
    // Tìm tất cả phần tử con có data-comment-id = oldTempId và cập nhật
    const allElementsWithOldId = tempElement.querySelectorAll(`[data-comment-id="${oldTempId}"]`);
    allElementsWithOldId.forEach(el => {
        el.dataset.commentId = newRealId;
        console.log(`[updateTempComment] Updated data-comment-id from ${oldTempId} to ${newRealId}`);
    });
    
    // Cũng cập nhật các phần tử có data-reply-id nếu là reply
    if (realComment.reply_to) {
        const allElementsWithOldReplyId = tempElement.querySelectorAll(`[data-reply-id="${oldTempId}"]`);
        allElementsWithOldReplyId.forEach(el => {
            el.dataset.replyId = newRealId;
            console.log(`[updateTempComment] Updated data-reply-id from ${oldTempId} to ${newRealId}`);
        });
    }
    
    console.log(`Updated temp comment ${tempCommentId} to real comment ${realComment.id}`);
}

/**
 * Xóa comment tạm
 */
function removeTempComment(postId, tempCommentId) {
    const tempElement = document.querySelector(`[data-comment-id="${tempCommentId}"]`);
    if (tempElement) {
        tempElement.remove();
        updateCommentCount(postId);
        console.log(`Removed temp comment: ${tempCommentId}`);
    }
}
/**
 * Cập nhật UI khi có sự kiện like comment từ server - ĐÃ SỬA
 */
function updateCommentLikeUI(postId, commentId, replyId, liked, likeCount) {
    console.log(`[UI] Updating like UI: ${commentId}, reply: ${replyId}, liked: ${liked}, count: ${likeCount}`);
    
    let targetElement;
    
    if (replyId) {
        // Tìm reply element
        targetElement = document.querySelector(`[data-comment-id="${replyId}"][data-post-id="${postId}"]`);
    } else {
        // Tìm comment element
        targetElement = document.querySelector(`[data-comment-id="${commentId}"][data-post-id="${postId}"]`);
    }
    
    if (!targetElement) {
        console.warn(`[UI] Element not found for comment ${commentId}, reply ${replyId}, post ${postId}`);
        
        // Thử tìm không có data-post-id (cho backward compatibility)
        if (replyId) {
            targetElement = document.querySelector(`[data-comment-id="${replyId}"]`);
        } else {
            targetElement = document.querySelector(`[data-comment-id="${commentId}"]`);
        }
        
        if (!targetElement) {
            console.error(`[UI] Element still not found after fallback`);
            return;
        }
    }
    
    // Cập nhật nút like
    const likeBtn = targetElement.querySelector('.like-comment-btn');
    const likeCountElement = targetElement.querySelector('.like-count');
    
    if (likeBtn) {
        // Cập nhật trạng thái liked
        if (liked) {
            likeBtn.classList.add('liked');
            likeBtn.innerHTML = '<i class="fas fa-heart"></i> Đã thích';
        } else {
            likeBtn.classList.remove('liked');
            likeBtn.innerHTML = '<i class="fas fa-heart"></i> Thích';
        }
        
        // Cập nhật số lượng
        if (likeCountElement) {
            likeCountElement.textContent = likeCount;
            
            // Hiệu ứng
            likeCountElement.style.transform = 'scale(1.2)';
            likeCountElement.style.transition = 'transform 0.3s';
            setTimeout(() => {
                likeCountElement.style.transform = 'scale(1)';
            }, 300);
        }
        
        console.log(`[UI] Like UI updated successfully`);
    }
}
/**
 * Cập nhật số lượng comment - VERSION MỚI (đếm chính xác)
 */
function updateCommentCount(postId) {
    const postElement = document.querySelector(`[data-post-id="${postId}"]`);
    if (!postElement) {
        console.error(`[UI] Post element not found for counting: ${postId}`);
        return;
    }
    
    // Tìm tất cả comment elements trong bài viết này
    // CHỈ tìm trong phạm vi bài viết hiện tại
    const allComments = postElement.querySelectorAll('.comment-item, .comment-reply');
    const totalCount = allComments.length;
    
    // Cập nhật số trên nút comment
    const countElement = postElement.querySelector('.comment-count');
    if (countElement) {
        countElement.textContent = totalCount;
        
        // Hiệu ứng
        countElement.style.transform = 'scale(1.2)';
        countElement.style.transition = 'transform 0.3s';
        setTimeout(() => {
            countElement.style.transform = 'scale(1)';
        }, 300);
    }
    
    console.log(`[UI] Comment count updated: ${totalCount} for post ${postId} (found ${allComments.length} comments)`);
}
/**
 * Hiển thị trạng thái lỗi bạn bè
 */
function showFriendsError(message = 'Lỗi khi tải danh sách bạn bè') {
    const friendsGrid = document.getElementById('friends-grid');
    if (!friendsGrid) return;

    friendsGrid.innerHTML = `
        <div class="error-state">
            <i class="fas fa-exclamation-triangle" style="font-size: 24px; margin-bottom: 8px; color: #e74c3c;"></i>
            <p>${message}</p>
            <button class="btn btn-outline btn-sm" onclick="retryLoadFriends()">
                <i class="fas fa-redo"></i> Thử lại
            </button>
        </div>
    `;
}

/**
 * Thử lại tải bạn bè
 */
function retryLoadFriends() {
    const profileContainer = document.querySelector('.profile-container');
    if (!profileContainer) return;
    
    const userId = profileContainer.dataset.userId;
    if (userId) {
        loadUserFriends(userId);
    }
}
// ==================== EDIT & DELETE POST FUNCTIONS ====================

/**
 * Mở modal chỉnh sửa bài viết
 */
async function openEditPostModal(postId) {
    try {
        console.log('Opening edit modal for post:', postId);
        
        const response = await fetch(`/get_post/${postId}`);
        const result = await response.json();
        
        if (result.success) {
            const post = result.post;
            const modal = document.getElementById('edit-post-modal');
            const postContent = document.getElementById('edit-post-content');
            const postIdInput = document.getElementById('edit-post-id');
            
            if (modal && postContent && postIdInput) {
                postIdInput.value = postId;
                postContent.value = post.content || '';
                modal.style.display = 'flex';
                document.body.style.overflow = 'hidden';
                
                // Focus vào textarea
                setTimeout(() => {
                    postContent.focus();
                }, 100);
            }
        } else {
            showNotification(result.error || 'Lỗi khi tải bài viết', 'error');
        }
    } catch (error) {
        console.error('Error opening edit modal:', error);
        showNotification('Lỗi khi tải bài viết', 'error');
    }
}

/**
 * Đóng modal chỉnh sửa bài viết
 */
function closeEditPostModal() {
    const modal = document.getElementById('edit-post-modal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = '';
        
        // Reset form
        const form = document.getElementById('edit-post-form');
        if (form) form.reset();
        
        const mediaPreview = document.getElementById('edit-media-preview');
        if (mediaPreview) mediaPreview.innerHTML = '';
    }
}

/**
 * Xử lý sửa bài viết
 */
async function handleEditPost(e) {
    e.preventDefault();
    
    const postId = document.getElementById('edit-post-id').value;
    const content = document.getElementById('edit-post-content').value.trim();
    
    if (!content) {
        showNotification('Vui lòng nhập nội dung bài viết', 'warning');
        return;
    }
    
    const submitBtn = document.getElementById('submit-edit-post');
    if (!submitBtn) return;
    
    const originalHTML = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang lưu...';
    
    try {
        const response = await fetch('/edit_post', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                post_id: postId,
                content: content
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            // Cập nhật UI
            updatePostContent(postId, content);
            closeEditPostModal();
            showNotification('Cập nhật bài viết thành công!', 'success');
        } else {
            showNotification(result.error || 'Lỗi khi cập nhật bài viết', 'error');
        }
    } catch (error) {
        console.error('Error editing post:', error);
        showNotification('Lỗi khi cập nhật bài viết', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalHTML;
    }
}

/**
 * Cập nhật nội dung bài viết trong UI
 */
function updatePostContent(postId, newContent) {
    const postContentElement = document.getElementById(`post-content-${postId}`);
    if (postContentElement) {
        postContentElement.textContent = newContent;
        
        // Thêm badge "đã chỉnh sửa"
        const postTimeElement = postContentElement.closest('.post-card').querySelector('.post-time');
        if (postTimeElement && !postTimeElement.querySelector('.edited-badge')) {
            const editedBadge = document.createElement('span');
            editedBadge.className = 'edited-badge';
            editedBadge.textContent = '(đã chỉnh sửa)';
            postTimeElement.appendChild(editedBadge);
        }
    }
}

/**
 * Xử lý xóa bài viết
 */
async function handleDeletePost(postId) {
    if (!confirm('Bạn có chắc chắn muốn xóa bài viết này?')) {
        return;
    }
    
    try {
        const response = await fetch('/delete_post', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                post_id: postId
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            // Xóa bài viết khỏi UI
            const postElement = document.querySelector(`[data-post-id="${postId}"]`);
            if (postElement) {
                postElement.remove();
            }
            
            showNotification('Xóa bài viết thành công!', 'success');
            
            // Cập nhật số lượng bài viết
            updatePostCount(-1);
            
            // Reload trang sau 1 giây
            setTimeout(() => {
                location.reload();
            }, 1000);
        } else {
            showNotification(result.error || 'Lỗi khi xóa bài viết', 'error');
        }
    } catch (error) {
        console.error('Error deleting post:', error);
        showNotification('Lỗi khi xóa bài viết', 'error');
    }
}

/**
 * Cập nhật số lượng bài viết
 */
function updatePostCount(change) {
    const postCountElement = document.querySelector('.stat-number');
    if (postCountElement) {
        const currentCount = parseInt(postCountElement.textContent) || 0;
        postCountElement.textContent = Math.max(0, currentCount + change);
    }
}

/**
 * Khởi tạo event listeners cho sửa/xóa bài viết
 */
function initializePostEditDeleteListeners() {
    console.log('Initializing post edit/delete listeners...');
    
    // Dropdown menu toggle
    document.querySelectorAll('.post-menu-btn').forEach(btn => {
        if (!btn.hasAttribute('data-listener-attached')) {
            btn.setAttribute('data-listener-attached', 'true');
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const menuContent = btn.nextElementSibling;
                if (menuContent) {
                    // Đóng tất cả menu khác
                    document.querySelectorAll('.post-menu-content').forEach(menu => {
                        if (menu !== menuContent) {
                            menu.classList.remove('show');
                        }
                    });
                    menuContent.classList.toggle('show');
                }
            });
        }
    });
    
    // Edit post buttons
    document.querySelectorAll('.edit-post-btn').forEach(btn => {
        if (btn.dataset.postId && !btn.hasAttribute('data-listener-attached')) {
            btn.setAttribute('data-listener-attached', 'true');
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const postId = btn.dataset.postId;
                openEditPostModal(postId);
                
                // Đóng menu
                const menuContent = btn.closest('.post-menu-content');
                if (menuContent) {
                    menuContent.classList.remove('show');
                }
            });
        }
    });
    
    // Delete post buttons
    document.querySelectorAll('.delete-post-btn').forEach(btn => {
        if (btn.dataset.postId && !btn.hasAttribute('data-listener-attached')) {
            btn.setAttribute('data-listener-attached', 'true');
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const postId = btn.dataset.postId;
                handleDeletePost(postId);
                
                // Đóng menu
                const menuContent = btn.closest('.post-menu-content');
                if (menuContent) {
                    menuContent.classList.remove('show');
                }
            });
        }
    });
    
    // Đóng menu khi click ra ngoài
    document.addEventListener('click', () => {
        document.querySelectorAll('.post-menu-content').forEach(menu => {
            menu.classList.remove('show');
        });
    });
    
    // Edit post modal events
    const closeEditModalBtn = document.getElementById('close-edit-post-modal');
    const cancelEditBtn = document.getElementById('cancel-edit-post');
    const editPostForm = document.getElementById('edit-post-form');
    
    if (closeEditModalBtn) {
        closeEditModalBtn.addEventListener('click', closeEditPostModal);
    }
    
    if (cancelEditBtn) {
        cancelEditBtn.addEventListener('click', closeEditPostModal);
    }
    
    if (editPostForm) {
        editPostForm.addEventListener('submit', handleEditPost);
    }
    
    // Đóng modal khi click ra ngoài
    const editPostModal = document.getElementById('edit-post-modal');
    if (editPostModal) {
        editPostModal.addEventListener('click', (e) => {
            if (e.target === editPostModal) {
                closeEditPostModal();
            }
        });
    }
}

// ==================== FRIENDS & PHOTOS FUNCTIONS ====================
/**
 * Tải danh sách bạn bè - ĐÃ SỬA (SỬA LẠI HOÀN TOÀN)
 */
async function loadUserFriends(userId) {
    try {
        const friendsGrid = document.getElementById('friends-grid');
        const viewAllBtn = document.getElementById('view-all-friends-btn');
        const friendsCount = document.getElementById('friends-count');
        
        if (!friendsGrid) {
            console.warn('Friends grid element not found');
            return;
        }

        // LẤY CURRENT USER ID TỪ DATA ATTRIBUTE
        const profileContainer = document.querySelector('.profile-container');
        const currentUserId = profileContainer ? profileContainer.dataset.currentUserId : null;
        
        console.log('Current user ID:', currentUserId);
        console.log('Profile user ID:', userId);

        // CHỈ TẢI BẠN BÈ NẾU LÀ CHÍNH CHỦ NHÂN
        if (userId !== currentUserId) {
            console.log('Not profile owner, showing restricted message');
            
            // Hiển thị thông báo thay vì bạn bè
            friendsGrid.innerHTML = `
                <div class="friends-restricted">
                    <div class="restricted-message">
                        <i class="fas fa-lock"></i>
                        <p>Chỉ hiển thị với chủ nhân trang cá nhân</p>
                    </div>
                </div>
            `;
            
            // Ẩn nút xem tất cả
            if (viewAllBtn) {
                viewAllBtn.style.display = 'none';
            }
            
            // Cập nhật số lượng bạn bè thành ẩn
            if (friendsCount) {
                friendsCount.textContent = 'Đã ẩn';
            }
            
            return;
        }

        console.log('Loading friends for current user:', userId);
        
        // Hiển thị loading
        friendsGrid.innerHTML = `
            <div class="loading-state">
                <i class="fas fa-spinner fa-spin"></i>
                <span>Đang tải bạn bè...</span>
            </div>
        `;

        const response = await fetch(`/get_user_friends/${userId}`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();

        console.log('Friends API response:', result);

        if (result.success && result.friends && result.friends.length > 0) {
            displayFriends(result.friends);
            
            // Cập nhật số lượng bạn bè
            if (friendsCount) {
                friendsCount.textContent = `${result.friends.length} người bạn`;
            }
            
            // Hiển thị nút xem tất cả nếu có nhiều hơn 6 bạn
            if (viewAllBtn && result.friends.length > 6) {
                viewAllBtn.style.display = 'block';
            }
            
            console.log(`Displayed ${result.friends.length} friends for user ${userId}`);
        } else {
            console.log('No friends found or API error');
            showNoFriends();
            // Cập nhật số lượng bạn bè
            if (friendsCount) {
                friendsCount.textContent = '0 người bạn';
            }
        }
    } catch (error) {
        console.error('Error loading friends:', error);
        showFriendsError('Lỗi khi tải danh sách bạn bè');
    }
}
/**
 * Kiểm tra và cập nhật trạng thái bạn bè
 */
async function checkAndUpdateFriendStatus(targetUserId) {
    try {
        const response = await fetch(`/check_friendship_status/${targetUserId}`);
        if (!response.ok) {
            console.error('Failed to check friendship status');
            return;
        }
        
        const data = await response.json();
        if (data.success) {
            console.log('Friendship status:', data.status);
            updateFriendButtonUI(targetUserId, data.status);
        }
    } catch (error) {
        console.error('Error checking friendship status:', error);
    }
}

/**
 * Xử lý chấp nhận lời mời kết bạn
 */
async function handleAcceptFriendRequest(targetUserId) {
    try {
        console.log('Accepting friend request from:', targetUserId);
        
        // Tìm request ID trước
        const listResponse = await fetch('/friend_requests');
        if (!listResponse.ok) {
            throw new Error('Failed to get friend requests');
        }
        
        const listData = await listResponse.json();
        const request = listData.requests.find(req => 
            req.sender_id === targetUserId && req.status === 'pending'
        );
        
        if (!request) {
            showNotification('Không tìm thấy lời mời kết bạn', 'error');
            return;
        }
        
        const response = await fetch(`/api/friend_requests/${request._id}/accept`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        
        if (result.success) {
            updateFriendButtonUI(targetUserId, 'friend');
            showNotification('Đã chấp nhận lời mời kết bạn', 'success');
        } else {
            showNotification(result.error || 'Lỗi khi chấp nhận lời mời kết bạn', 'error');
        }
    } catch (error) {
        console.error('Error accepting friend request:', error);
        showNotification('Lỗi kết nối khi chấp nhận lời mời kết bạn', 'error');
    }
}

/**
 * Xử lý từ chối lời mời kết bạn
 */
async function handleDeclineFriendRequest(targetUserId) {
    try {
        console.log('Declining friend request from:', targetUserId);
        
        // Tìm request ID trước
        const listResponse = await fetch('/friend_requests');
        if (!listResponse.ok) {
            throw new Error('Failed to get friend requests');
        }
        
        const listData = await listResponse.json();
        const request = listData.requests.find(req => 
            req.sender_id === targetUserId && req.status === 'pending'
        );
        
        if (!request) {
            showNotification('Không tìm thấy lời mời kết bạn', 'error');
            return;
        }
        
        const response = await fetch(`/api/friend_requests/${request._id}/decline`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        
        if (result.success) {
            updateFriendButtonUI(targetUserId, 'not_friend');
            showNotification('Đã từ chối lời mời kết bạn', 'info');
        } else {
            showNotification(result.error || 'Lỗi khi từ chối lời mời kết bạn', 'error');
        }
    } catch (error) {
        console.error('Error declining friend request:', error);
        showNotification('Lỗi kết nối khi từ chối lời mời kết bạn', 'error');
    }
}

/**
 * Xử lý hủy lời mời kết bạn
 */
async function handleCancelFriendRequest(targetUserId) {
    try {
        console.log('Cancelling friend request to:', targetUserId);
        
        const response = await fetch('/cancel_friend_request', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                target_user_id: targetUserId
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        
        if (result.success) {
            // Cập nhật UI về trạng thái "kết bạn"
            updateFriendButtonUI(targetUserId, 'not_friend');
            showNotification('Đã hủy lời mời kết bạn', 'info');
        } else {
            showNotification(result.error || 'Lỗi khi hủy lời mời kết bạn', 'error');
        }
    } catch (error) {
        console.error('Error cancelling friend request:', error);
        showNotification('Lỗi kết nối khi hủy lời mời kết bạn', 'error');
    }
}

/**
 * Thêm hàm xử lý kết bạn
 */
async function handleAddFriend(targetUserId) {
    try {
        console.log('Sending friend request to:', targetUserId);
        
        const response = await fetch('/send_friend_request', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                target_user_id: targetUserId
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        
        if (result.success) {
            // Cập nhật UI tạm thời
            updateFriendButtonUI(targetUserId, 'sent');
            showNotification('Đã gửi lời mời kết bạn', 'success');
        } else {
            showNotification(result.error || 'Lỗi khi gửi lời mời kết bạn', 'error');
        }
    } catch (error) {
        console.error('Error sending friend request:', error);
        showNotification('Lỗi kết nối khi gửi lời mời kết bạn', 'error');
    }
}
/**
 * Xử lý hủy kết bạn
 */
async function handleUnfriend(targetUserId) {
    if (!confirm('Bạn có chắc chắn muốn hủy kết bạn với người này?')) {
        return;
    }
    
    try {
        console.log('Unfriending user:', targetUserId);
        
        const response = await fetch('/unfriend', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                friend_id: targetUserId
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        
        if (result.success) {
            // Cập nhật UI sau khi hủy kết bạn
            updateFriendButtonUI(targetUserId, 'not_friend');
            showNotification('Đã hủy kết bạn thành công', 'success');
            
            // Có thể reload trang để cập nhật danh sách bạn bè
            setTimeout(() => {
                location.reload();
            }, 1500);
        } else {
            showNotification(result.error || 'Lỗi khi hủy kết bạn', 'error');
        }
    } catch (error) {
        console.error('Error unfriending:', error);
        showNotification('Lỗi kết nối khi hủy kết bạn', 'error');
    }
}

/**
 * Cập nhật UI nút bạn bè sau khi hủy kết bạn
 */
function updateFriendButtonUI(targetUserId, status) {
    const friendActions = document.querySelector('.friend-actions');
    if (!friendActions) return;
    
    switch(status) {
        case 'sent':
            friendActions.innerHTML = `
                <button class="btn btn-outline" id="cancel-request-btn">
                    <i class="fas fa-user-times"></i>
                    Hủy lời mời
                </button>
                <button class="btn btn-outline" id="send-message-btn">
                    <i class="fas fa-paper-plane"></i>
                    Nhắn tin
                </button>
                <button class="btn btn-outline" id="more-actions-btn">
                    <i class="fas fa-ellipsis-h"></i>
                </button>
            `;
            break;
        case 'received':
            friendActions.innerHTML = `
                <button class="btn btn-primary" id="accept-request-btn">
                    <i class="fas fa-user-check"></i>
                    Chấp nhận
                </button>
                <button class="btn btn-outline" id="decline-request-btn">
                    <i class="fas fa-user-times"></i>
                    Từ chối
                </button>
                <button class="btn btn-outline" id="send-message-btn">
                    <i class="fas fa-paper-plane"></i>
                    Nhắn tin
                </button>
                <button class="btn btn-outline" id="more-actions-btn">
                    <i class="fas fa-ellipsis-h"></i>
                </button>
            `;
            break;
        case 'friend':
            friendActions.innerHTML = `
                <button class="btn btn-outline" id="send-message-btn">
                    <i class="fas fa-paper-plane"></i>
                    Nhắn tin
                </button>
                <button class="btn btn-outline" id="unfriend-btn">
                    <i class="fas fa-user-times"></i>
                    Hủy kết bạn
                </button>
                <button class="btn btn-outline" id="more-actions-btn">
                    <i class="fas fa-ellipsis-h"></i>
                </button>
            `;
            break;
        case 'not_friend':
            friendActions.innerHTML = `
                <button class="btn btn-primary" id="add-friend-btn">
                <i class="fas fa-user-plus"></i>
                    Kết bạn
                </button>
                <button class="btn btn-outline" id="send-message-btn">
                    <i class="fas fa-paper-plane"></i>
                    Nhắn tin
                </button>
                <button class="btn btn-outline" id="more-actions-btn">
                    <i class="fas fa-ellipsis-h"></i>
                </button>
            `;
            break;
    }
    
    // Gắn lại event listeners
    attachFriendActionListeners(targetUserId);
}

/**
 * Gắn sự kiện cho các nút hành động bạn bè - ĐÃ CẬP NHẬT
 */
/**
 * Gắn sự kiện cho các nút hành động bạn bè - PHIÊN BẢN EVENT DELEGATION
 */
function attachFriendActionListeners(targetUserId) {
    console.log('Attaching friend action listeners for user:', targetUserId);
    
    // SỬ DỤNG EVENT DELEGATION - CHỈ GẮN 1 LẦN
    const friendActions = document.querySelector('.friend-actions');
    if (!friendActions) return;
    
    // XÓA SỰ KIỆN CŨ VÀ GẮN LẠI
    friendActions.replaceWith(friendActions.cloneNode(true));
    const newFriendActions = document.querySelector('.friend-actions');
    
    newFriendActions.addEventListener('click', (e) => {
        const target = e.target;
        
        if (target.id === 'add-friend-btn' || target.closest('#add-friend-btn')) {
            e.preventDefault();
            handleAddFriend(targetUserId);
        }
        else if (target.id === 'cancel-request-btn' || target.closest('#cancel-request-btn')) {
            e.preventDefault();
            e.stopPropagation();
            handleCancelFriendRequest(targetUserId);
        }
        else if (target.id === 'accept-request-btn' || target.closest('#accept-request-btn')) {
            e.preventDefault();
            e.stopPropagation();
            handleAcceptFriendRequest(targetUserId);
        }
        else if (target.id === 'decline-request-btn' || target.closest('#decline-request-btn')) {
            e.preventDefault();
            e.stopPropagation();
            handleDeclineFriendRequest(targetUserId);
        }
        else if (target.id === 'unfriend-btn' || target.closest('#unfriend-btn')) {
            e.preventDefault();
            e.stopPropagation();
            handleUnfriend(targetUserId);
        }
        else if (target.id === 'send-message-btn' || target.closest('#send-message-btn')) {
            e.preventDefault();
            sendMessageToFriend(targetUserId);
        }
    });
}

/**
 * Hiển thị danh sách bạn bè
 */

function displayFriends(friends) {
    const friendsGrid = document.getElementById('friends-grid');
    if (!friendsGrid) return;

    // Chỉ hiển thị 6 bạn đầu tiên
    const displayFriends = friends.slice(0, 6);
    
    if (displayFriends.length === 0) {
        showNoFriends();
        return;
    }

    friendsGrid.innerHTML = displayFriends.map(friend => `
        <div class="friend-item" data-user-id="${friend._id}" data-username="${friend.username}">
            <div class="friend-avatar-container">
                <img src="${friend.avatar}" 
                     alt="${friend.full_name || friend.username}" 
                     class="friend-avatar"
                     onerror="this.src='/static/img/default-avatar.png'">
                ${friend.online ? '<div class="friend-online-status"></div>' : ''}
            </div>
            <span class="friend-name" title="${friend.full_name || friend.username}">
                ${(friend.full_name || friend.username).length > 10 ? (friend.full_name || friend.username).substring(0, 10) + '...' : (friend.full_name || friend.username)}
            </span>
        </div>
    `).join('');

    // Thêm sự kiện click cho bạn bè
    friendsGrid.querySelectorAll('.friend-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const userId = item.dataset.userId;
            const username = item.dataset.username;
            
            console.log('Friend clicked:', { userId, username });
            
            // Mở profile đầy đủ
            viewFriendProfile(userId);
        });
        
        // Thêm sự kiện right-click để xem nhanh
        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const userId = item.dataset.userId;
            openQuickProfileView(userId);
        });
    });
}

/**
 * Hiển thị khi không có bạn bè
 */
function showNoFriends() {
    const friendsGrid = document.getElementById('friends-grid');
    if (!friendsGrid) return;

    friendsGrid.innerHTML = `
        <div class="no-friends">
            <i class="fas fa-user-friends" style="font-size: 24px; margin-bottom: 8px;"></i>
            <p>Chưa có bạn bè</p>
        </div>
    `;
}

/**
 * Tải ảnh gần đây
 */
async function loadRecentPhotos(userId) {
    try {
        const photosGrid = document.getElementById('photos-grid');
        const photosCount = document.getElementById('photos-count');
        const viewAllBtn = document.getElementById('view-all-photos-btn');

        if (!photosGrid) {
            console.warn('Photos grid element not found');
            return;
        }

        console.log('Loading photos for user:', userId);
        
        const response = await fetch(`/get_recent_photos/${userId}`);
        const result = await response.json();

        console.log('Photos API response:', result);

        if (result.success && result.photos && result.photos.length > 0) {
            displayRecentPhotos(result.photos);
            
            // Cập nhật số lượng
            if (photosCount) {
                photosCount.textContent = `${result.photos.length} ảnh`;
            }
            
            // Hiển thị nút xem tất cả nếu có nhiều hơn 6 ảnh
            if (viewAllBtn && result.photos.length > 6) {
                viewAllBtn.style.display = 'block';
            }
        } else {
            console.log('No photos found or API error');
            showNoPhotos();
        }
    } catch (error) {
        console.error('Error loading recent photos:', error);
        showNoPhotos();
    }
}

/**
 * Hiển thị ảnh gần đây
 */
function displayRecentPhotos(photos) {
    const photosGrid = document.getElementById('photos-grid');
    if (!photosGrid) return;

    // Chỉ hiển thị 6 ảnh đầu tiên
    const displayPhotos = photos.slice(0, 6);
    
    if (displayPhotos.length === 0) {
        showNoPhotos();
        return;
    }

    photosGrid.innerHTML = displayPhotos.map(photo => `
        <div class="photo-item" data-post-id="${photo.post_id}">
            <img src="${photo.type === 'video' ? (photo.thumbnail || photo.url) : photo.url}" 
                 alt="${photo.type === 'video' ? 'Recent video' : 'Recent photo'}" 
                 class="photo-thumbnail"
                 onerror="this.src='/static/img/default-image.png'">
            ${photo.type === 'video' ? '<div class="video-play-overlay"><i class="fas fa-play"></i></div>' : ''}
            <div class="photo-overlay">
                <i class="fas fa-expand"></i>
            </div>
        </div>
    `).join('');

    // Thêm sự kiện click cho ảnh
    photosGrid.querySelectorAll('.photo-item').forEach(item => {
        item.addEventListener('click', () => {
            const postId = item.dataset.postId;
            viewPhotoInPost(postId);
        });
    });
}

/**
 * Hiển thị khi không có ảnh
 */
function showNoPhotos() {
    const photosGrid = document.getElementById('photos-grid');
    if (!photosGrid) return;

    photosGrid.innerHTML = `
        <div class="no-photos">
            <i class="fas fa-camera" style="font-size: 24px; margin-bottom: 8px;"></i>
            <p>Chưa có ảnh nào</p>
        </div>
    `;
}

/**
 * Xem trang cá nhân của bạn
 */
function viewFriendProfile(userId) {
    console.log('Viewing friend profile:', userId);
    
    // Hiển thị loading
    showNotification('Đang tải trang cá nhân...', 'info');
    
    // Chuyển hướng đến trang profile của bạn
    // Trước tiên cần lấy username từ user ID
    fetch(`/get_friend_profile/${userId}`)
        .then(response => response.json())
        .then(result => {
            if (result.success && result.friend) {
                // Chuyển hướng đến trang profile bằng username
                window.location.href = `/profile/${result.friend.username}`;
            } else {
                showNotification('Không thể tải trang cá nhân', 'error');
                console.error('Failed to load friend profile:', result.error);
            }
        })
        .catch(error => {
            console.error('Error loading friend profile:', error);
            showNotification('Lỗi khi tải trang cá nhân', 'error');
        });
}

/**
 * Xem trang cá nhân từ username (dự phòng)
 */
function viewFriendProfileByUsername(username) {
    console.log('Viewing friend profile by username:', username);
    window.location.href = `/profile/${username}`;
}

/**
 * Mở modal xem nhanh profile bạn bè
 */
function openQuickProfileView(userId) {
    // Có thể implement modal xem nhanh thông tin bạn bè
    console.log('Opening quick profile view for:', userId);
    
    fetch(`/get_friend_profile/${userId}`)
        .then(response => response.json())
        .then(result => {
            if (result.success && result.friend) {
                showQuickProfileModal(result.friend);
            } else {
                showNotification('Không thể tải thông tin', 'error');
            }
        })
        .catch(error => {
            console.error('Error loading quick profile:', error);
            showNotification('Lỗi khi tải thông tin', 'error');
        });
}

/**
 * Hiển thị modal xem nhanh profile
 */
function showQuickProfileModal(friend) {
    // Tạo modal HTML
    const modalHTML = `
        <div class="quick-profile-modal" id="quick-profile-modal">
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Thông tin cá nhân</h3>
                    <button class="close-btn" onclick="closeQuickProfileModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="profile-summary">
                        <div class="avatar-section">
                            <img src="${friend.avatar}" 
                                 alt="${friend.full_name || friend.username}" 
                                 class="profile-avatar-large"
                                 onerror="this.src='/static/img/default-avatar.png'">
                        </div>
                        <div class="profile-info">
                            <h4 class="profile-name">${friend.full_name || friend.username}</h4>
                            <p class="profile-username">@${friend.username}</p>
                            <div class="profile-stats">
                                <div class="stat">
                                    <span class="stat-number">${friend.friends ? friend.friends.length : 0}</span>
                                    <span class="stat-label">Bạn bè</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="profile-actions">
                        <button class="btn btn-primary" onclick="viewFullProfile('${friend.username}')">
                            <i class="fas fa-user"></i> Xem trang cá nhân
                        </button>
                        <button class="btn btn-outline" onclick="sendMessageToFriend('${friend._id}')">
                            <i class="fas fa-paper-plane"></i> Nhắn tin
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Thêm modal vào body
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Thêm sự kiện click outside để đóng modal
    const modal = document.getElementById('quick-profile-modal');
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeQuickProfileModal();
        }
    });
    
    // Thêm CSS nếu chưa có
    addQuickProfileStyles();
}

/**
 * Đóng modal xem nhanh
 */
function closeQuickProfileModal() {
    const modal = document.getElementById('quick-profile-modal');
    if (modal) {
        modal.remove();
    }
}

/**
 * Xem profile đầy đủ
 */
function viewFullProfile(username) {
    closeQuickProfileModal();
    window.location.href = `/profile/${username}`;
}

/**
 * Gửi tin nhắn cho bạn
 */
function sendMessageToFriend(friendId) {
    closeQuickProfileModal();
    // Chuyển hướng đến trang chat với bạn bè
    window.location.href = `/chat?friend_id=${friendId}`;
}

/**
 * Thêm CSS cho modal xem nhanh
 */
function addQuickProfileStyles() {
    if (!document.querySelector('#quick-profile-styles')) {
        const styles = `
            <style id="quick-profile-styles">
                .quick-profile-modal {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.5);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 10000;
                    animation: fadeIn 0.3s ease;
                }
                
                .quick-profile-modal .modal-content {
                    background: white;
                    border-radius: 12px;
                    width: 90%;
                    max-width: 400px;
                    max-height: 80vh;
                    overflow-y: auto;
                    animation: slideUp 0.3s ease;
                }
                
                .quick-profile-modal .modal-header {
                    padding: 20px;
                    border-bottom: 1px solid #e0e0e0;
                    display: flex;
                    justify-content: between;
                    align-items: center;
                }
                
                .quick-profile-modal .modal-header h3 {
                    margin: 0;
                    font-size: 18px;
                    font-weight: 600;
                }
                
                .quick-profile-modal .close-btn {
                    background: none;
                    border: none;
                    font-size: 24px;
                    cursor: pointer;
                    color: #666;
                }
                
                .quick-profile-modal .modal-body {
                    padding: 20px;
                }
                
                .quick-profile-modal .profile-summary {
                    display: flex;
                    gap: 15px;
                    margin-bottom: 20px;
                }
                
                .quick-profile-modal .profile-avatar-large {
                    width: 80px;
                    height: 80px;
                    border-radius: 50%;
                    object-fit: cover;
                    border: 3px solid #007bff;
                }
                
                .quick-profile-modal .profile-info {
                    flex: 1;
                }
                
                .quick-profile-modal .profile-name {
                    margin: 0 0 5px 0;
                    font-size: 18px;
                    font-weight: 600;
                }
                
                .quick-profile-modal .profile-username {
                    margin: 0 0 10px 0;
                    color: #666;
                    font-size: 14px;
                }
                
                .quick-profile-modal .profile-stats {
                    display: flex;
                    gap: 15px;
                }
                
                .quick-profile-modal .profile-actions {
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                }
                
                .quick-profile-modal .btn {
                    width: 100%;
                    justify-content: center;
                }
                
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                
                @keyframes slideUp {
                    from { transform: translateY(20px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
            </style>
        `;
        document.head.insertAdjacentHTML('beforeend', styles);
    }
}

/**
 * Xem tất cả bạn bè
 */
function viewAllFriends() {
    // Chuyển hướng đến trang friend requests với tab bạn bè
    window.location.href = '/friend_requests_page#friends';
}

/**
 * Xem tất cả ảnh
 */
function viewAllPhotos() {
    // Có thể implement modal hiển thị tất cả ảnh
    alert('Tính năng xem tất cả ảnh đang được phát triển');
}

/**
 * Xem ảnh trong bài viết
 */
function viewPhotoInPost(postId) {
    // Mở media viewer với ảnh từ bài viết
    const postElement = document.querySelector(`[data-post-id="${postId}"]`);
    if (!postElement) return;
    
    // Thu thập media từ bài viết
    const mediaItems = postElement.querySelectorAll('.post-media img, .post-media video');
    if (mediaItems.length === 0) return;
    
    // Chuẩn bị dữ liệu media cho viewer
    window.postMedia = [];
    mediaItems.forEach((item, index) => {
        const isVideo = item.tagName === 'VIDEO';
        window.postMedia.push({
            type: isVideo ? 'video' : 'image',
            url: isVideo ? item.src : item.src,
            thumbnail: isVideo ? item.poster || null : null
        });
    });
    
    // Mở media viewer
    window.currentMediaIndex = 0;
    updateMediaViewer();
    
    const mediaViewer = document.getElementById('media-viewer-modal');
    if (mediaViewer) {
        mediaViewer.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

/**
 * Cập nhật nội dung media viewer
 */
function updateMediaViewer() {
    if (!window.postMedia || window.postMedia.length === 0) return;
    
    const media = window.postMedia[window.currentMediaIndex];
    const viewerMedia = document.getElementById('viewer-media');
    const viewerCounter = document.getElementById('viewer-counter');
    const viewerIndicators = document.getElementById('viewer-indicators');
    
    if (!viewerMedia) return;
    
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
    if (viewerCounter) {
        viewerCounter.innerHTML = `<span class="current-slide">${window.currentMediaIndex + 1}</span> / <span class="total-slides">${window.postMedia.length}</span>`;
    }
    
    // Cập nhật indicators
    if (viewerIndicators) {
        viewerIndicators.innerHTML = '';
        for (let i = 0; i < window.postMedia.length; i++) {
            const indicator = document.createElement('button');
            indicator.className = `viewer-indicator ${i === window.currentMediaIndex ? 'active' : ''}`;
            indicator.addEventListener('click', () => {
                window.currentMediaIndex = i;
                updateMediaViewer();
            });
            viewerIndicators.appendChild(indicator);
        }
    }
    
    // Cập nhật nút navigation
    const prevBtn = document.getElementById('viewer-prev-btn');
    const nextBtn = document.getElementById('viewer-next-btn');
    if (prevBtn) prevBtn.disabled = window.currentMediaIndex === 0;
    if (nextBtn) nextBtn.disabled = window.currentMediaIndex === window.postMedia.length - 1;
}

/**
 * Đóng media viewer
 */
function closeMediaViewer() {
    const modal = document.getElementById('media-viewer-modal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = 'auto';
    }
}

/**
 * Chuyển đến media trước
 */
function viewerPrev() {
    if (window.currentMediaIndex > 0) {
        window.currentMediaIndex--;
        updateMediaViewer();
    }
}

/**
 * Chuyển đến media tiếp theo
 */
function viewerNext() {
    if (window.currentMediaIndex < window.postMedia.length - 1) {
        window.currentMediaIndex++;
        updateMediaViewer();
    }
}

// ==================== PROFILE EDITOR CLASS ====================

class ProfileEditor {
    constructor() {
        this.currentAvatar = null;
        this.initializeEditProfileModal();
    }

    /**
     * Khởi tạo modal chỉnh sửa profile
     */
    initializeEditProfileModal() {
        console.log('Initializing profile editor...');
        
        // Edit Profile Button
        const editProfileBtn = document.getElementById('edit-profile-btn');
        if (editProfileBtn) {
            editProfileBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.openEditProfileModal();
            });
            console.log('Edit profile button listener attached');
        } else {
            console.log('Edit profile button not found - viewing other user profile');
        }

        // Modal Elements
        this.modal = document.getElementById('edit-profile-modal');
        this.form = document.getElementById('edit-profile-form');
        this.avatarPreview = document.getElementById('profile-avatar-preview');
        this.avatarUpload = document.getElementById('profile-avatar-upload');
        this.changeAvatarBtn = document.getElementById('change-profile-avatar-btn');
        this.coverUpload = document.getElementById('cover-upload');
        this.changeCoverBtn = document.getElementById('change-cover-btn');

        // Event Listeners
        if (this.changeAvatarBtn && this.avatarUpload) {
            this.changeAvatarBtn.addEventListener('click', () => this.avatarUpload.click());
        }

        if (this.avatarUpload) {
            this.avatarUpload.addEventListener('change', (e) => this.handleAvatarUpload(e));
        }

        if (this.changeCoverBtn && this.coverUpload) {
            this.changeCoverBtn.addEventListener('click', () => this.coverUpload.click());
        }

        if (this.coverUpload) {
            this.coverUpload.addEventListener('change', (e) => this.handleCoverUpload(e));
        }

        // Close Modal
        const closeBtn = document.getElementById('close-edit-profile-modal');
        const cancelBtn = document.getElementById('cancel-edit-profile');
        
        if (closeBtn) closeBtn.addEventListener('click', () => this.closeModal());
        if (cancelBtn) cancelBtn.addEventListener('click', () => this.closeModal());
        
        if (this.modal) {
            this.modal.addEventListener('click', (e) => {
                if (e.target === this.modal) this.closeModal();
            });
        }

        // Form Submit
        if (this.form) {
            this.form.addEventListener('submit', (e) => this.handleProfileUpdate(e));
        }

        console.log('Profile editor initialized');
    }

    /**
     * Mở modal chỉnh sửa profile
     */
    async openEditProfileModal() {
        console.log('Opening edit profile modal...');
        
        try {
            // Load user data
            await this.loadUserProfile();
            
            // Show modal
            if (this.modal) {
                this.modal.style.display = 'flex';
                document.body.style.overflow = 'hidden';
            }
        } catch (error) {
            console.error('Error opening edit profile modal:', error);
            showNotification('Lỗi khi tải thông tin profile', 'error');
        }
    }

    /**
     * Đóng modal chỉnh sửa profile
     */
    closeModal() {
        console.log('Closing edit profile modal...');
        
        if (this.modal) {
            this.modal.style.display = 'none';
            document.body.style.overflow = 'auto';
        }
    }

    /**
     * Tải thông tin người dùng
     */
    async loadUserProfile() {
        try {
            const response = await fetch('/get_profile');
            if (!response.ok) throw new Error('Failed to load profile');
            
            const user = await response.json();
            console.log('Loaded user profile:', user);
            
            // Fill form fields
            this.fillFormFields(user);
            
        } catch (error) {
            console.error('Error loading user profile:', error);
            throw error;
        }
    }

    /**
     * Điền dữ liệu vào form
     */
    fillFormFields(user) {
        const fields = {
            'edit-full-name': user.full_name || '',
            'edit-username': user.username || '',
            'edit-email': user.email || '',
            'edit-phone': user.phone || '',
            'edit-dob': user.date_of_birth ? user.date_of_birth.split('T')[0] : '',
            'edit-gender': user.gender || 'male',
            // Thêm các trường mở rộng
            'edit-bio': user.bio || '',
            'edit-workplace': user.workplace || '',
            'edit-location': user.location || '',
            'edit-education': user.education || '',
            'edit-interests': user.interests || ''
        };

        Object.keys(fields).forEach(fieldId => {
            const element = document.getElementById(fieldId);
            if (element) {
                element.value = fields[fieldId];
            }
        });

        // Update avatar preview
        if (this.avatarPreview) {
            const avatarUrl = user.avatar || '/static/img/default-avatar.png';
            this.avatarPreview.innerHTML = `<img src="${avatarUrl}" alt="Avatar">`;
        }

        // Store current avatar for comparison
        this.currentAvatar = user.avatar;
    }

    /**
     * Xử lý upload avatar
     */
    handleAvatarUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        // Validate file
        if (file.size > 2 * 1024 * 1024) {
            showNotification('Ảnh không được vượt quá 2MB', 'error');
            return;
        }

        if (!file.type.match('image.*')) {
            showNotification('Vui lòng chọn file ảnh', 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const imgSrc = e.target.result;
            if (this.avatarPreview) {
                this.avatarPreview.innerHTML = `<img src="${imgSrc}" alt="Avatar">`;
            }
            this.currentAvatar = imgSrc; // Store base64 for submission
        };
        reader.readAsDataURL(file);
    }

    /**
     * Xử lý upload cover photo
     */
    async handleCoverUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        // Validate file
        if (file.size > 5 * 1024 * 1024) {
            showNotification('Ảnh bìa không được vượt quá 5MB', 'error');
            return;
        }

        if (!file.type.match('image.*')) {
            showNotification('Vui lòng chọn file ảnh', 'error');
            return;
        }

        const formData = new FormData();
        formData.append('cover_photo', file);

        try {
            const submitBtn = this.changeCoverBtn;
            const originalText = submitBtn.innerHTML;
            
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang tải lên...';

            const response = await fetch('/update_cover_photo', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();
            
            if (result.success) {
                // Update cover photo in UI
                this.updateCoverPhotoUI(result.cover_photo_url);
                showNotification('Cập nhật ảnh bìa thành công!', 'success');
            } else {
                showNotification(result.error || 'Lỗi khi cập nhật ảnh bìa', 'error');
            }
        } catch (error) {
            console.error('Cover upload error:', error);
            showNotification('Lỗi khi cập nhật ảnh bìa', 'error');
        } finally {
            this.changeCoverBtn.disabled = false;
            this.changeCoverBtn.innerHTML = '<i class="fas fa-camera"></i> Đổi ảnh bìa';
            event.target.value = '';
        }
    }

    /**
     * Cập nhật ảnh bìa trong UI
     */
    updateCoverPhotoUI(coverPhotoUrl) {
        const headerBackground = document.querySelector('.header-background');
        if (!headerBackground) return;

        const coverImage = headerBackground.querySelector('.cover-image');
        const coverPlaceholder = headerBackground.querySelector('.cover-placeholder');

        if (coverImage) {
            coverImage.src = coverPhotoUrl;
        } else if (coverPlaceholder) {
            coverPlaceholder.style.display = 'none';
            const newCoverImage = document.createElement('img');
            newCoverImage.src = coverPhotoUrl;
            newCoverImage.alt = 'Cover photo';
            newCoverImage.className = 'cover-image';
            headerBackground.insertBefore(newCoverImage, headerBackground.firstChild);
        }
    }

    /**
     * Xử lý cập nhật profile
     */
    async handleProfileUpdate(event) {
        event.preventDefault();
        
        const submitBtn = document.getElementById('submit-edit-profile');
        if (!submitBtn) return;

        // Get form data (excluding avatar)
        const formData = {
            full_name: document.getElementById('edit-full-name').value,
            username: document.getElementById('edit-username').value,
            email: document.getElementById('edit-email').value,
            phone: document.getElementById('edit-phone').value,
            dob: document.getElementById('edit-dob').value,
            gender: document.getElementById('edit-gender').value,
            // Thêm các trường mở rộng
            bio: document.getElementById('edit-bio')?.value || '',
            workplace: document.getElementById('edit-workplace')?.value || '',
            location: document.getElementById('edit-location')?.value || '',
            education: document.getElementById('edit-education')?.value || '',
            interests: document.getElementById('edit-interests')?.value || ''
        };

        // Validate required fields
        if (!formData.full_name || !formData.username) {
            showNotification('Họ tên và tên đăng nhập là bắt buộc', 'error');
            return;
        }

        const originalHTML = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang lưu...';

        try {
            console.log('Updating profile with data:', formData);
            
            // Upload avatar separately if changed
            let avatarUrl = null;
            if (this.currentAvatar && this.currentAvatar.startsWith('data:image')) {
                // This is a new image file, upload to Cloudinary
                const avatarFormData = new FormData();
                
                // Convert base64 to blob
                const response = await fetch(this.currentAvatar);
                const blob = await response.blob();
                avatarFormData.append('avatar', blob, 'avatar.jpg');
                
                const uploadResponse = await fetch('/upload_avatar', {
                    method: 'POST',
                    body: avatarFormData
                });
                
                const uploadResult = await uploadResponse.json();
                if (uploadResult.success) {
                    avatarUrl = uploadResult.avatar_url;
                } else {
                    throw new Error('Failed to upload avatar');
                }
            }
            
            // Update profile info
            const profileResponse = await fetch('/update_profile', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });

            const result = await profileResponse.json();
            
            if (profileResponse.ok) {
                // Update UI with new avatar URL if uploaded
                if (avatarUrl) {
                    formData.avatar = avatarUrl;
                }
                
                this.updateProfileUI(formData);
                this.closeModal();
                showNotification('Cập nhật hồ sơ thành công!', 'success');
                
                // Reload page to reflect changes in all places
                setTimeout(() => {
                    location.reload();
                }, 1000);
                
            } else {
                showNotification(result.error || 'Cập nhật thất bại!', 'error');
            }
        } catch (error) {
            console.error('Profile update error:', error);
            showNotification('Lỗi kết nối khi cập nhật!', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalHTML;
        }
    }

    /**
     * Cập nhật UI với thông tin mới
     */
    updateProfileUI(userData) {
        // Update profile header
        const profileName = document.querySelector('.profile-name');
        if (profileName) {
            profileName.textContent = userData.full_name;
        }

        // Update avatar in header
        const profileAvatar = document.querySelector('.profile-avatar');
        if (profileAvatar && this.currentAvatar) {
            profileAvatar.src = this.currentAvatar;
        }

        // Update posts author name and avatar
        document.querySelectorAll('.post-author').forEach(author => {
            author.textContent = userData.full_name;
        });

        document.querySelectorAll('.post-avatar').forEach(avatar => {
            if (this.currentAvatar) {
                avatar.src = this.currentAvatar;
            }
        });
    }
}

let profileEditor = null;

function initializeProfileEditor() {
    if (document.getElementById('edit-profile-modal')) {
        profileEditor = new ProfileEditor();
        console.log('Profile Editor initialized');
    }
}

/**
 * Auto-resize textarea height based on content
 */
function autoResizeTextarea(textarea) {
    if (!textarea) return;
    
    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto';
    
    // Set height to scrollHeight
    textarea.style.height = textarea.scrollHeight + 'px';
    
    // Set max height to prevent too tall textareas
    const maxHeight = 200; // pixels
    if (textarea.scrollHeight > maxHeight) {
        textarea.style.height = maxHeight + 'px';
        textarea.style.overflowY = 'auto';
    } else {
        textarea.style.overflowY = 'hidden';
    }
}

// ==================== COMMENT FUNCTIONS ====================

/**
 * Khởi tạo tất cả carousel trên trang
 */
function initializeCarousels() {
    console.log('Initializing carousels...');
    
    document.querySelectorAll('.post-media-carousel').forEach(carousel => {
        const postId = carousel.closest('.post-card').dataset.postId;
        console.log(`Setting up carousel for post: ${postId}`);
        
        // Thêm sự kiện swipe cho mobile
        setupSwipeEvents(carousel, postId);
    });
}

/**
 * Chuyển đến slide trước
 */
function carouselPrev(postId, event) {
    if (event) {
        event.stopPropagation(); // QUAN TRỌNG: ngăn không cho event bubble lên container
        event.preventDefault();
    }
    
    const carousel = document.querySelector(`[data-post-id="${postId}"] .post-media-carousel`);
    if (!carousel) return;
    
    const currentSlide = carousel.querySelector('.carousel-slide.active');
    const slides = carousel.querySelectorAll('.carousel-slide');
    const currentIndex = parseInt(currentSlide.dataset.index);
    
    let prevIndex = currentIndex - 1;
    if (prevIndex < 0) prevIndex = slides.length - 1;
    
    goToSlide(carousel, prevIndex);
}

function carouselNext(postId, event) {
    if (event) {
        event.stopPropagation(); // QUAN TRỌNG: ngăn không cho event bubble lên container
        event.preventDefault();
    }
    
    const carousel = document.querySelector(`[data-post-id="${postId}"] .post-media-carousel`);
    if (!carousel) return;
    
    const currentSlide = carousel.querySelector('.carousel-slide.active');
    const slides = carousel.querySelectorAll('.carousel-slide');
    const currentIndex = parseInt(currentSlide.dataset.index);
    
    let nextIndex = currentIndex + 1;
    if (nextIndex >= slides.length) nextIndex = 0;
    
    goToSlide(carousel, nextIndex);
}

function carouselGoTo(postId, index, event) {
    if (event) {
        event.stopPropagation(); // QUAN TRỌNG: ngăn không cho event bubble lên container
        event.preventDefault();
    }
    
    const carousel = document.querySelector(`[data-post-id="${postId}"] .post-media-carousel`);
    if (!carousel) return;
    
    goToSlide(carousel, index);
}

/**
 * Thực hiện chuyển slide
 */
function goToSlide(carousel, newIndex) {
    const slides = carousel.querySelectorAll('.carousel-slide');
    const indicators = carousel.querySelectorAll('.carousel-indicator');
    const counter = carousel.querySelector('.carousel-counter .current-slide');
    
    if (newIndex < 0 || newIndex >= slides.length) return;
    
    // Ẩn slide hiện tại
    carousel.querySelector('.carousel-slide.active').classList.remove('active');
    carousel.querySelector('.carousel-indicator.active').classList.remove('active');
    
    // Hiển thị slide mới
    slides[newIndex].classList.add('active');
    indicators[newIndex].classList.add('active');
    
    // Cập nhật counter
    if (counter) {
        counter.textContent = newIndex + 1;
    }
    
    console.log(`Carousel navigation: ${newIndex + 1}/${slides.length}`);
}

/**
 * Thiết lập sự kiện swipe cho mobile
 */
function setupSwipeEvents(carousel, postId) {
    let startX = 0;
    let endX = 0;
    const swipeThreshold = 50;
    
    carousel.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
    });
    
    carousel.addEventListener('touchmove', (e) => {
        endX = e.touches[0].clientX;
    });
    
    carousel.addEventListener('touchend', () => {
        const diffX = startX - endX;
        
        if (Math.abs(diffX) > swipeThreshold) {
            if (diffX > 0) {
                // Swipe left - next
                carouselNext(postId);
            } else {
                // Swipe right - previous
                carouselPrev(postId);
            }
        }
    });
    
    // Keyboard navigation
    carousel.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') {
            carouselPrev(postId);
        } else if (e.key === 'ArrowRight') {
            carouselNext(postId);
        }
    });
}

/**
 * Mở modal xem ảnh toàn màn hình
 */
/**
 * Mở modal xem ảnh toàn màn hình - ĐÃ SỬA (không đệ quy)
 */
/**
 * Mở modal xem ảnh toàn màn hình - CHỈ từ media container
 */
function openMediaViewer(postId, startIndex = 0) {
    console.log(`Opening media viewer for post: ${postId}, index: ${startIndex}`);
    
    const postElement = document.querySelector(`[data-post-id="${postId}"]`);
    if (!postElement) {
        console.error(`Post element not found for post: ${postId}`);
        return;
    }
    
    // Lấy media từ DOM như timeline.js
    const mediaElements = postElement.querySelectorAll('img[src*="/uploads/posts/"], video');
    const mediaUrls = [];
    
    mediaElements.forEach((element, index) => {
        if (element.tagName === 'IMG') {
            // Bỏ qua thumbnail của video (có _thumb trong tên)
            if (!element.src.includes('_thumb.')) {
                mediaUrls.push({
                    type: 'image',
                    url: element.src,
                    alt: element.alt || 'Post media',
                    index: index
                });
            }
        } else if (element.tagName === 'VIDEO') {
            const source = element.querySelector('source');
            const videoUrl = source ? source.src : element.src;
            mediaUrls.push({
                type: 'video',
                url: videoUrl,
                alt: 'Post media',
                index: index
            });
        }
    });
    
    if (mediaUrls.length === 0) {
        console.error('No media found in post');
        showNotification('Không thể tìm thấy media. Vui lòng thử lại sau.', 'error');
        return;
    }
    
    console.log('🔍 Found media URLs:', mediaUrls);
    
    // Đảm bảo startIndex hợp lệ
    const validStartIndex = Math.max(0, Math.min(startIndex, mediaUrls.length - 1));
    
    // Sử dụng hàm trực tiếp
    openMediaViewerDirect(postId, mediaUrls, validStartIndex);
}

/**
 * Mở modal viewer trực tiếp
 */
function openMediaViewerDirect(postId, mediaUrls, startIndex) {
    console.log('Opening media viewer directly');
    
    // Đảm bảo modal tồn tại
    let modal = document.getElementById('media-viewer-modal');
    if (!modal) {
        createMediaViewerModal();
        modal = document.getElementById('media-viewer-modal');
    }
    
    // Khởi tạo viewer data
    window.currentMediaViewer = {
        postId: postId,
        mediaUrls: mediaUrls,
        currentIndex: startIndex
    };
    
    // Hiển thị modal
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    // Cập nhật nội dung
    updateViewerContent();
}

/**
 * Cập nhật nội dung viewer
 */
function updateViewerContent() {
    if (!window.currentMediaViewer) return;
    
    const viewerMedia = document.getElementById('viewer-media');
    const viewerCounter = document.getElementById('viewer-counter');
    const viewerIndicators = document.getElementById('viewer-indicators');
    
    if (!viewerMedia) return;
    
    const currentMedia = window.currentMediaViewer.mediaUrls[window.currentMediaViewer.currentIndex];
    
    // Cập nhật media
    viewerMedia.innerHTML = '';
    if (currentMedia.type === 'image') {
        const img = document.createElement('img');
        img.src = currentMedia.url;
        img.alt = currentMedia.alt;
        img.className = 'viewer-media-item';
        viewerMedia.appendChild(img);
    } else if (currentMedia.type === 'video') {
        const video = document.createElement('video');
        video.controls = true;
        video.autoplay = true;
        video.className = 'viewer-media-item';
        const source = document.createElement('source');
        source.src = currentMedia.url;
        source.type = 'video/mp4';
        video.appendChild(source);
        viewerMedia.appendChild(video);
    }
    
    // Cập nhật counter
    if (viewerCounter) {
        viewerCounter.innerHTML = 
            `<span class="current-slide">${window.currentMediaViewer.currentIndex + 1}</span> / 
             <span class="total-slides">${window.currentMediaViewer.mediaUrls.length}</span>`;
    }
    
    // Cập nhật indicators
    if (viewerIndicators) {
        viewerIndicators.innerHTML = '';
        window.currentMediaViewer.mediaUrls.forEach((media, index) => {
            const indicator = document.createElement('button');
            indicator.className = `viewer-indicator ${index === window.currentMediaViewer.currentIndex ? 'active' : ''}`;
            indicator.addEventListener('click', () => {
                goToViewerSlide(index);
            });
            viewerIndicators.appendChild(indicator);
        });
    }
    
    // Cập nhật trạng thái nút navigation
    updateViewerNavigation();
}

/**
 * Điều hướng viewer
 */
function goToViewerSlide(index) {
    if (!window.currentMediaViewer) return;
    
    if (index >= 0 && index < window.currentMediaViewer.mediaUrls.length) {
        window.currentMediaViewer.currentIndex = index;
        updateViewerContent();
    }
}

function updateViewerNavigation() {
    if (!window.currentMediaViewer) return;
    
    const prevBtn = document.getElementById('viewer-prev-btn');
    const nextBtn = document.getElementById('viewer-next-btn');
    
    if (prevBtn) {
        prevBtn.disabled = window.currentMediaViewer.currentIndex === 0;
        prevBtn.style.opacity = window.currentMediaViewer.currentIndex === 0 ? '0.3' : '1';
    }
    if (nextBtn) {
        nextBtn.disabled = window.currentMediaViewer.currentIndex === window.currentMediaViewer.mediaUrls.length - 1;
        nextBtn.style.opacity = window.currentMediaViewer.currentIndex === window.currentMediaViewer.mediaUrls.length - 1 ? '0.3' : '1';
    }
}

/**
 * Tải media hiện tại
 */
function downloadCurrentMedia() {
    if (!window.currentMediaViewer) return;
    
    const currentMedia = window.currentMediaViewer.mediaUrls[window.currentMediaViewer.currentIndex];
    const link = document.createElement('a');
    link.href = currentMedia.url;
    link.download = `media_${window.currentMediaViewer.postId}_${window.currentMediaViewer.currentIndex + 1}`;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

/**
 * Tạo modal viewer nếu chưa tồn tại
 */
function createMediaViewerModal() {
    const modalHTML = `
    <div id="media-viewer-modal" class="media-viewer-modal">
        <div class="media-viewer-content">
            <button class="close-viewer-btn" id="close-media-viewer">
                <i class="fas fa-times"></i>
            </button>
            
            <div class="viewer-container">
                <button class="viewer-nav-btn prev-btn" id="viewer-prev-btn">
                    <i class="fas fa-chevron-left"></i>
                </button>
                
                <div class="viewer-media" id="viewer-media"></div>
                
                <button class="viewer-nav-btn next-btn" id="viewer-next-btn">
                    <i class="fas fa-chevron-right"></i>
                </button>
            </div>
            
            <div class="viewer-counter" id="viewer-counter">
                <span class="current-slide">1</span> / <span class="total-slides">0</span>
            </div>
            
            <div class="viewer-indicators" id="viewer-indicators"></div>
            
            <div class="viewer-actions">
                <button class="viewer-action-btn" id="download-media-btn" title="Tải xuống">
                    <i class="fas fa-download"></i>
                </button>
            </div>
        </div>
    </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    initializeMediaViewerEvents();
}
// ==================== REAL-TIME COMMENT FUNCTIONS ====================
/**
 * Gửi sự kiện like/unlike comment qua socket.io (realtime)
 */
async function likeCommentRealtime(postId, commentId, replyId = null) {
    // Kiểm tra trạng thái processing GLOBAL
    if (window.likeCommentProcessing) {
        console.log('⚠️ Like comment already in progress (from realtime), skipping...');
        return;
    }
    
    // Đánh dấu đang xử lý
    window.likeCommentProcessing = true;
    
    try {
        console.log(`[Realtime] Liking: post=${postId}, comment=${commentId}, reply=${replyId}`);
        
        // Gửi sự kiện qua socket.io nếu kết nối
        if (window.socket && window.socket.connected) {
            console.log('📡 Sending via socket.io...');
            window.socket.emit('comment_liked', {
                post_id: postId,
                comment_id: commentId,
                reply_id: replyId
            });
            
            // UI sẽ được cập nhật qua socket event handler
            console.log('✅ Socket event sent');
            return;
        }
        
        // Fallback: Gọi API nếu socket không hoạt động
        console.log('📡 Socket not connected, using API fallback');
        const result = await likeCommentAPI(postId, commentId, replyId);
        
        if (result.success) {
            // Cập nhật UI
            updateCommentLikeUI(postId, commentId, replyId, result.liked, result.like_count);
            console.log('✅ API fallback successful');
        } else {
            console.error('❌ API fallback failed:', result.error);
        }
        
    } catch (error) {
        console.error('[Realtime] Error liking comment:', error);
        showNotification('Lỗi khi thích bình luận', 'error');
    } finally {
        setTimeout(() => {
            window.likeCommentProcessing = false;
        }, 1000);
    }
}
/**
 * Thêm bình luận vào UI - ĐÃ SỬA (xác định đúng parent cho reply của reply)
 */
function addCommentToUI(postId, commentData, replyTo = null) {
    console.log(`[UI] Adding comment to UI: ${commentData.id}, replyTo: ${replyTo}`);
    
    const postElement = document.querySelector(`[data-post-id="${postId}"]`);
    if (!postElement) {
        console.error(`[UI] Post element not found: ${postId}`);
        return;
    }
    
    const isReply = !!replyTo;
    
    // Tạo HTML cho comment/reply - Đơn giản hóa: nếu có replyTo thì là reply
    const itemClass = isReply ? 'comment-reply' : 'comment-item';
    
    // Đảm bảo commentData có reply_to và reply_to_username để hiển thị "→ @username"
    if (isReply) {
        if (!commentData.reply_to) {
            commentData.reply_to = replyTo;
        }
        // Nếu không có reply_to_username, tìm từ comment gốc
        if (!commentData.reply_to_username) {
            console.log(`[UI] Looking for parent comment with ID: ${replyTo}`);
            let parentComment = postElement.querySelector(`[data-comment-id="${replyTo}"]`);
            
            // Nếu không tìm thấy trong post, thử tìm trong toàn bộ document
            if (!parentComment) {
                parentComment = document.querySelector(`[data-comment-id="${replyTo}"]`);
            }
            
            if (parentComment) {
                const authorEl = parentComment.querySelector('.comment-author');
                if (authorEl) {
                    // Lấy text trực tiếp từ author-name span nếu có
                    const authorNameEl = authorEl.querySelector('.author-name');
                    if (authorNameEl) {
                        commentData.reply_to_username = authorNameEl.textContent.trim();
                    } else {
                        // Fallback: lấy text trước dấu →
                        const authorText = authorEl.textContent.split('→')[0].trim();
                        commentData.reply_to_username = authorText;
                    }
                    console.log(`[UI] Found reply_to_username from DOM: ${commentData.reply_to_username}`);
                }
            } else {
                console.warn(`[UI] Could not find parent comment with ID: ${replyTo}`);
            }
        }
        
        // Nếu vẫn không có, dùng giá trị mặc định
        if (!commentData.reply_to_username) {
            commentData.reply_to_username = 'người dùng';
            console.log(`[UI] Using default reply_to_username`);
        }
    }
    
    const commentHTML = createCommentHTML(postId, commentData, isReply);
    
    if (isReply) {
        // Xử lý reply - TÌM ĐÚNG PARENT COMMENT
        let targetContainer;
        let targetList;
        
        // Tìm comment gốc (không phải reply) chứa thread này
        const topLevelComment = findTopLevelCommentForReply(postElement, replyTo);
        
        if (topLevelComment) {
            const topLevelCommentId = topLevelComment.dataset.commentId;
            
            // Luôn thêm vào container replies của comment gốc
            const { repliesContainer, repliesList } = createRepliesContainerIfNeeded(postId, topLevelCommentId);
            
            if (repliesList) {
                targetContainer = repliesContainer;
                targetList = repliesList;
            } else {
                console.error(`[UI] Failed to get replies container for comment: ${topLevelCommentId}`);
                // Fallback
                const commentsList = postElement.querySelector('.comments-list');
                targetList = commentsList;
            }
        } else {
            console.error(`[UI] Could not find top-level comment for reply: ${replyTo}`);
            // Fallback: thêm vào comments list chính
            const commentsList = postElement.querySelector('.comments-list');
            targetList = commentsList;
        }
        
        if (targetList) {
            targetList.insertAdjacentHTML('beforeend', commentHTML);
            
            // Cập nhật số lượng replies cho comment gốc
            if (topLevelComment) {
                const repliesCount = targetList.querySelectorAll('.comment-reply').length;
                updateReplyCount(postId, topLevelComment.dataset.commentId, repliesCount);
            }
            
            console.log(`[UI] Added reply to thread, total replies: ${targetList.querySelectorAll('.comment-reply').length}`);
        }
    } else {
        // Thêm comment mới vào đầu danh sách comments chính
        const commentsList = postElement.querySelector('.comments-list');
        if (commentsList) {
            commentsList.insertAdjacentHTML('afterbegin', commentHTML);
            console.log(`[UI] Added comment to post ${postId}`);
        }
    }
    
    // Cập nhật tổng số comment
    updateCommentCount(postId);
    
    // Gắn event listeners cho comment mới
    attachCommentEventListeners();
    
    console.log(`[UI] Comment added successfully with class: ${itemClass}`);
}
/**
 * Tìm comment gốc (top-level) cho một reply (hỗ trợ reply của reply)
 */
function findTopLevelCommentForReply(postElement, replyToId) {
    // Tìm tất cả comments cấp 0
    const topLevelComments = postElement.querySelectorAll('.comment-item');
    
    for (const comment of topLevelComments) {
        const commentId = comment.dataset.commentId;
        
        // Nếu replyTo chính là comment này
        if (commentId === replyToId) {
            return comment;
        }
        
        // Tìm trong replies của comment này
        const repliesList = comment.querySelector('.comment-replies');
        if (repliesList) {
            // Kiểm tra tất cả replies (bao gồm reply của reply)
            const allReplies = repliesList.querySelectorAll('.comment-reply');
            for (const reply of allReplies) {
                if (reply.dataset.commentId === replyToId) {
                    // Đây là reply của reply, nhưng vẫn trả về comment gốc
                    return comment;
                }
                
                // Kiểm tra sâu hơn nếu cần (cho nested replies)
                const nestedReplies = reply.querySelectorAll('.comment-reply');
                for (const nestedReply of nestedReplies) {
                    if (nestedReply.dataset.commentId === replyToId) {
                        return comment;
                    }
                }
            }
        }
    }
    
    return null;
}
/**
 * Cập nhật số lượng reply cho một comment
 */
function updateReplyCountForComment(postId, commentId) {
    const commentElement = document.querySelector(`[data-comment-id="${commentId}"][data-post-id="${postId}"]`);
    if (!commentElement) return;
    
    const repliesContainer = commentElement.querySelector('.comment-replies-container');
    const replyCount = repliesContainer ? repliesContainer.querySelectorAll('.comment-reply').length : 0;
    
    // Cập nhật nút xem replies nếu có
    const viewRepliesBtn = commentElement.querySelector('.view-replies-btn');
    if (viewRepliesBtn) {
        const replyCountSpan = viewRepliesBtn.querySelector('.reply-count');
        if (replyCountSpan) {
            replyCountSpan.textContent = replyCount;
        } else {
            viewRepliesBtn.insertAdjacentHTML('beforeend', ` <span class="reply-count">${replyCount}</span>`);
        }
    }
}
/**
 * Hiển thị/ẩn replies của một comment
 */
function toggleReplies(postId, commentId) {
    const repliesContainer = document.getElementById(`replies-${postId}-${commentId}`);
    const toggleBtn = document.querySelector(`.view-replies-btn[data-post-id="${postId}"][data-comment-id="${commentId}"]`);
    
    if (!repliesContainer || !toggleBtn) {
        console.warn(`Replies container or toggle button not found for comment: ${commentId}`);
        return;
    }
    
    const isHidden = repliesContainer.style.display === 'none' || repliesContainer.style.display === '';
    
    if (isHidden) {
        // Hiển thị replies
        repliesContainer.style.display = 'block';
        toggleBtn.classList.add('expanded');
        toggleBtn.querySelector('.toggle-icon').className = 'fas fa-chevron-up toggle-icon';
        
        // Cập nhật text nếu cần
        const replyCount = toggleBtn.querySelector('.reply-count');
        if (replyCount) {
            toggleBtn.innerHTML = `<i class="fas fa-comments"></i> ${replyCount.textContent} trả lời <i class="fas fa-chevron-up toggle-icon"></i>`;
        }
        
        console.log(`[Replies] Showing replies for comment: ${commentId}`);
    } else {
        // Ẩn replies
        repliesContainer.style.display = 'none';
        toggleBtn.classList.remove('expanded');
        toggleBtn.querySelector('.toggle-icon').className = 'fas fa-chevron-down toggle-icon';
        
        // Cập nhật text nếu cần
        const replyCount = toggleBtn.querySelector('.reply-count');
        if (replyCount) {
            toggleBtn.innerHTML = `<i class="fas fa-comments"></i> ${replyCount.textContent} trả lời <i class="fas fa-chevron-down toggle-icon"></i>`;
        }
        
        console.log(`[Replies] Hiding replies for comment: ${commentId}`);
    }
}

/**
 * Tự động mở replies khi thêm reply mới
 */
function showRepliesWhenNewReplyAdded(postId, commentId) {
    const repliesContainer = document.getElementById(`replies-${postId}-${commentId}`);
    const toggleBtn = document.querySelector(`.view-replies-btn[data-post-id="${postId}"][data-comment-id="${commentId}"]`);
    
    if (repliesContainer && toggleBtn) {
        // Nếu đang ẩn, tự động mở
        if (repliesContainer.style.display === 'none' || repliesContainer.style.display === '') {
            repliesContainer.style.display = 'block';
            toggleBtn.classList.add('expanded');
            toggleBtn.querySelector('.toggle-icon').className = 'fas fa-chevron-up toggle-icon';
            
            // Cập nhật text
            const replyCount = toggleBtn.querySelector('.reply-count');
            if (replyCount) {
                const currentCount = parseInt(replyCount.textContent) || 0;
                replyCount.textContent = currentCount + 1;
                toggleBtn.innerHTML = `<i class="fas fa-comments"></i> ${currentCount + 1} trả lời <i class="fas fa-chevron-up toggle-icon"></i>`;
            }
            
            console.log(`[Replies] Auto-showing replies for new reply on comment: ${commentId}`);
        }
    }
}

/**
 * Cập nhật số lượng replies hiển thị trên nút - ĐÃ SỬA
 */
function updateReplyCount(postId, commentId, newCount) {
    console.log(`[updateReplyCount] Updating: post=${postId}, comment=${commentId}, count=${newCount}`);
    
    const toggleBtn = document.querySelector(`.view-replies-btn[data-post-id="${postId}"][data-comment-id="${commentId}"]`);
    if (toggleBtn) {
        console.log(`[updateReplyCount] Found toggle button`);
        
        // Cập nhật toàn bộ nội dung nút với số mới
        const isExpanded = toggleBtn.classList.contains('expanded');
        const toggleIcon = isExpanded ? 'fas fa-chevron-up toggle-icon' : 'fas fa-chevron-down toggle-icon';
        
        toggleBtn.innerHTML = `<i class="fas fa-comments"></i> <span class="reply-count">${newCount}</span> trả lời <i class="${toggleIcon}"></i>`;
        
        console.log(`[updateReplyCount] Updated to ${newCount} replies`);
    } else {
        console.warn(`[updateReplyCount] Toggle button not found for comment ${commentId}`);
    }
}

/**
 * Tạo cấu trúc replies container nếu chưa có
 */
function createRepliesContainerIfNeeded(postId, commentId) {
    let repliesContainer = document.getElementById(`replies-${postId}-${commentId}`);
    let repliesList = document.getElementById(`replies-list-${postId}-${commentId}`);
    
    if (!repliesContainer) {
        // Tìm comment element
        const commentElement = document.querySelector(`[data-comment-id="${commentId}"][data-post-id="${postId}"]`);
        if (!commentElement) {
            console.warn(`Comment element not found: ${commentId}`);
            return null;
        }
        
        // Tạo container mới
        const commentContent = commentElement.querySelector('.comment-content');
        if (!commentContent) {
            console.warn(`Comment content not found for: ${commentId}`);
            return null;
        }
        
        repliesContainer = document.createElement('div');
        repliesContainer.id = `replies-${postId}-${commentId}`;
        repliesContainer.className = 'comment-replies-container';
        repliesContainer.style.display = 'none'; // Ẩn mặc định
        
        repliesList = document.createElement('div');
        repliesList.id = `replies-list-${postId}-${commentId}`;
        repliesList.className = 'comment-replies';
        
        repliesContainer.appendChild(repliesList);
        
        // Thêm sau phần comment actions
        const commentActions = commentContent.querySelector('.comment-actions');
        if (commentActions) {
            commentContent.insertBefore(repliesContainer, commentActions.nextSibling);
        } else {
            commentContent.appendChild(repliesContainer);
        }
        
        // Thêm nút xem replies nếu chưa có
        let toggleBtn = commentElement.querySelector('.view-replies-btn');
        if (!toggleBtn) {
            toggleBtn = document.createElement('button');
            toggleBtn.className = 'btn btn-link btn-sm view-replies-btn';
            toggleBtn.dataset.postId = postId;
            toggleBtn.dataset.commentId = commentId;
            toggleBtn.innerHTML = '<i class="fas fa-comments"></i> 0 trả lời <i class="fas fa-chevron-down toggle-icon"></i>';
            toggleBtn.onclick = () => toggleReplies(postId, commentId);
            
            // Thêm vào comment actions
            const commentActions = commentElement.querySelector('.comment-actions');
            if (commentActions) {
                commentActions.appendChild(toggleBtn);
            }
        }
    }
    
    return { repliesContainer, repliesList };
}

/**
 * Gửi comment/reply mới - SIMPLIFIED VERSION (API only)
 */
async function addCommentRealtime(postId, content, replyTo = null, replyToUsername = null) {
    if (commentProcessing) {
        console.log('[Comment] Action already in progress');
        return;
    }
    
    commentProcessing = true;
    
    try {
        console.log(`[API] Adding comment: post=${postId}, replyTo=${replyTo}`);
        
        // Lấy input element
        const commentInput = document.getElementById(`comment-input-${postId}`);
        if (!commentInput) {
            console.error(`Comment input not found for post: ${postId}`);
            commentProcessing = false;
            return;
        }
        
        // Clear input ngay lập tức
        commentInput.value = '';
        cancelReply(postId);
        
        // Tạo comment tạm thời (optimistic update)
        const tempComment = {
            id: `temp_${Date.now()}`,
            username: 'Bạn', // Sẽ được cập nhật từ server
            content: content,
            user_avatar: document.querySelector('.profile-avatar')?.src || '/static/img/default-avatar.png',
            likes: [],
            created_at: new Date().toISOString(),
            reply_to: replyTo,
            reply_to_username: replyToUsername
        };
        
        // Thêm vào UI ngay lập tức
        addCommentToUI(postId, tempComment, replyTo);
        
        // Gọi API trực tiếp (không dùng socket)
        const result = await addCommentAPI(postId, content, replyTo, replyToUsername);
        
        if (result.success) {
            // Cập nhật comment tạm thành comment thật
            updateTempComment(postId, tempComment.id, result.comment);
            showNotification('Đã thêm bình luận', 'success');
        } else {
            // Xóa comment tạm nếu lỗi
            removeTempComment(postId, tempComment.id);
            showNotification(result.error || 'Lỗi khi thêm bình luận', 'error');
        }
        
    } catch (error) {
        console.error('[API] Error adding comment:', error);
        showNotification('Lỗi khi thêm bình luận', 'error');
    } finally {
        commentProcessing = false;
    }
}
// ==================== COMMENT FUNCTIONS (BỔ SUNG) ====================
/**
 * Like/unlike comment - PHIÊN BẢN ĐÃ SỬA HOÀN CHỈNH
 */
async function likeComment(postId, commentId, replyId = null) {
    // Kiểm tra trạng thái processing
    if (window.likeCommentProcessing) {
        console.log('⚠️ Like comment action already in progress, skipping...');
        return;
    }
    
    window.likeCommentProcessing = true;
    
    try {
        console.log(`🎯 Like comment: post=${postId}, comment=${commentId}, reply=${replyId}`);
        
        // Tìm element để cập nhật UI
        const targetElement = findCommentElement(postId, commentId, replyId);
        if (!targetElement) {
            console.error('❌ Comment element not found for UI update');
            showNotification('Không tìm thấy bình luận', 'error');
            window.likeCommentProcessing = false;
            return;
        }
        
        const likeBtn = targetElement.querySelector('.like-comment-btn');
        const likeCountElement = targetElement.querySelector('.like-count');
        
        if (!likeBtn || !likeCountElement) {
            console.error('❌ Like button or count element not found');
            window.likeCommentProcessing = false;
            return;
        }
        
        // Lưu trạng thái ban đầu để khôi phục nếu lỗi
        const originalLiked = likeBtn.classList.contains('liked');
        const originalCount = parseInt(likeCountElement.textContent) || 0;
        
        // Cập nhật UI tạm thời (optimistic update)
        if (originalLiked) {
            // Đang liked -> bỏ like
            likeBtn.classList.remove('liked');
            likeBtn.innerHTML = '<i class="fas fa-heart"></i> Thích';
            likeCountElement.textContent = Math.max(0, originalCount - 1);
        } else {
            // Chưa liked -> thêm like
            likeBtn.classList.add('liked');
            likeBtn.innerHTML = '<i class="fas fa-heart"></i> Đã thích';
            likeCountElement.textContent = originalCount + 1;
        }
        
        // Hiệu ứng
        likeCountElement.style.transform = 'scale(1.2)';
        likeCountElement.style.transition = 'transform 0.3s';
        setTimeout(() => {
            likeCountElement.style.transform = 'scale(1)';
        }, 300);
        
        // Gọi API
        console.log('📤 Calling likeCommentAPI...');
        const result = await likeCommentAPI(postId, commentId, replyId);
        console.log('📥 API Result:', result);
        
        if (!result.success) {
            // Khôi phục UI nếu lỗi
            console.error('❌ API call failed:', result.error);
            
            if (originalLiked) {
                likeBtn.classList.add('liked');
                likeBtn.innerHTML = '<i class="fas fa-heart"></i> Đã thích';
            } else {
                likeBtn.classList.remove('liked');
                likeBtn.innerHTML = '<i class="fas fa-heart"></i> Thích';
            }
            likeCountElement.textContent = originalCount;
            
            // Hiển thị thông báo lỗi cụ thể
            const errorMsg = result.error || 'Lỗi khi thích bình luận';
            showNotification(errorMsg, 'error');
        } else {
            console.log('✅ Like action successful');
            
            // Hiệu ứng thành công
            likeBtn.style.backgroundColor = 'rgba(0, 123, 255, 0.1)';
            setTimeout(() => {
                likeBtn.style.backgroundColor = '';
            }, 300);
        }
        
    } catch (error) {
        console.error('❌ Error in likeComment:', error);
        showNotification('Lỗi khi thích bình luận', 'error');
    } finally {
        setTimeout(() => {
            window.likeCommentProcessing = false;
            console.log('🔄 Reset likeCommentProcessing to false');
        }, 1000);
    }
}
function findCommentElement(postId, commentId, replyId = null) {
    console.log(`[findCommentElement] Looking for: postId=${postId}, commentId=${commentId}, replyId=${replyId}`);
    
    let selector;
    if (replyId) {
        selector = `[data-comment-id="${replyId}"][data-post-id="${postId}"]`;
    } else {
        selector = `[data-comment-id="${commentId}"][data-post-id="${postId}"]`;
    }
    
    console.log(`[findCommentElement] Trying selector: ${selector}`);
    let element = document.querySelector(selector);
    
    if (element) {
        console.log(`[findCommentElement] Found element with post-id filter`);
        return element;
    }
    
    // Fallback: tìm không có post-id
    if (replyId) {
        selector = `[data-comment-id="${replyId}"]`;
    } else {
        selector = `[data-comment-id="${commentId}"]`;
    }
    
    console.log(`[findCommentElement] Trying fallback selector: ${selector}`);
    element = document.querySelector(selector);
    
    if (element) {
        console.log(`[findCommentElement] Found element without post-id filter`);
        return element;
    }
    
    // Nếu vẫn không tìm thấy, thử tìm trong phạm vi post
    const postElement = document.querySelector(`[data-post-id="${postId}"]`);
    if (postElement) {
        console.log(`[findCommentElement] Searching within post element`);
        if (replyId) {
            element = postElement.querySelector(`[data-comment-id="${replyId}"]`);
        } else {
            element = postElement.querySelector(`[data-comment-id="${commentId}"]`);
        }
        if (element) {
            console.log(`[findCommentElement] Found element within post`);
            return element;
        }
    }
    
    console.error(`[findCommentElement] Element not found for commentId=${commentId}, replyId=${replyId}`);
    return null;
}
/**
 * Tải và hiển thị thông tin chi tiết về bài viết chia sẻ
 */
async function loadSharedPostInfo(postId) {
    try {
        const postElement = document.querySelector(`[data-post-id="${postId}"]`);
        if (!postElement) return;
        
        const isShared = postElement.dataset.isShared === 'true';
        if (!isShared) return;
        
        const response = await fetch(`/get_original_post_info/${postId}`);
        const result = await response.json();
        
        if (result.success && result.original_post) {
            updateSharedPostUI(postId, result.original_post, result.share_content);
        }
    } catch (error) {
        console.error('Error loading shared post info:', error);
    }
}

/**
 * Cập nhật UI cho bài viết chia sẻ
 */
function updateSharedPostUI(postId, originalPost, shareContent) {
    const postElement = document.querySelector(`[data-post-id="${postId}"]`);
    if (!postElement) return;
    
    // Cập nhật thông tin tác giả gốc
    const authorElement = postElement.querySelector('.post-author');
    if (authorElement && !authorElement.querySelector('.shared-from')) {
        const sharedFromHTML = `
            <span class="shared-from">
                <i class="fas fa-retweet"></i>
                từ 
                <a href="/profile/${originalPost.user_name}" class="original-author" target="_blank">
                    ${originalPost.user_name}
                </a>
            </span>
        `;
        authorElement.insertAdjacentHTML('beforeend', sharedFromHTML);
    }
    
    // Cập nhật thời gian bài gốc
    const timeElement = postElement.querySelector('.post-time');
    if (timeElement && originalPost.created_at) {
        const originalTime = new Date(originalPost.created_at);
        const timeString = originalTime.toLocaleString('vi-VN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        if (!timeElement.querySelector('.shared-original-time')) {
            timeElement.insertAdjacentHTML('beforeend', 
                `<span class="shared-original-time">• Bài gốc: ${timeString}</span>`
            );
        }
    }
    
    // Thêm nút xem bài gốc
    const postStats = postElement.querySelector('.post-stats');
    if (postStats && !postStats.querySelector('.view-original-btn')) {
        const viewOriginalBtn = document.createElement('div');
        viewOriginalBtn.className = 'post-stat view-original-btn';
        viewOriginalBtn.innerHTML = `
            <i class="fas fa-external-link-alt"></i>
            <span>Xem bài gốc</span>
        `;
        viewOriginalBtn.onclick = () => viewOriginalPost(originalPost.id);
        
        postStats.appendChild(viewOriginalBtn);
    }
}

/**
 * Xem bài viết gốc
 */
function viewOriginalPost(originalPostId) {
    window.open(`/post/${originalPostId}`, '_blank');
}

/**
 * Thêm menu context cho bài chia sẻ
 */
function addSharedPostContextMenu(postId) {
    const postElement = document.querySelector(`[data-post-id="${postId}"]`);
    if (!postElement) return;
    
    const isShared = postElement.dataset.isShared === 'true';
    if (!isShared) return;
    
    const menuBtn = postElement.querySelector('.post-menu-btn');
    if (menuBtn) {
        const menuContent = menuBtn.nextElementSibling;
        if (menuContent) {
            // Thêm các tùy chọn đặc biệt cho bài chia sẻ
            const sharedMenuItems = `
                <button class="post-menu-item view-original-post-btn" data-post-id="${postId}">
                    <i class="fas fa-external-link-alt"></i> Xem bài gốc
                </button>
                <button class="post-menu-item share-again-btn" data-post-id="${postId}">
                    <i class="fas fa-retweet"></i> Chia sẻ lại
                </button>
                <button class="post-menu-item undo-share-btn" data-post-id="${postId}">
                    <i class="fas fa-trash"></i> Hủy chia sẻ
                </button>
                <div class="menu-divider"></div>
            `;
            
            menuContent.insertAdjacentHTML('afterbegin', sharedMenuItems);
            
            // Gắn sự kiện
            postElement.querySelector('.view-original-post-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                const originalPostId = postElement.dataset.originalPostId;
                if (originalPostId) {
                    viewOriginalPost(originalPostId);
                }
            });
            
            postElement.querySelector('.share-again-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                const originalPostId = postElement.dataset.originalPostId;
                if (originalPostId) {
                    showShareMenu(originalPostId);
                }
            });
            
            postElement.querySelector('.undo-share-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                undoShare(postId);
            });
        }
    }
}

/**
 * Hủy chia sẻ
 */
async function undoShare(postId) {
    if (!confirm('Bạn có chắc chắn muốn hủy chia sẻ bài viết này?')) {
        return;
    }
    
    try {
        const response = await fetch(`/undo_share/${postId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            // Xóa bài viết khỏi UI
            const postElement = document.querySelector(`[data-post-id="${postId}"]`);
            if (postElement) {
                postElement.remove();
            }
            
            showNotification('Đã hủy chia sẻ bài viết', 'success');
        } else {
            showNotification(result.error || 'Lỗi khi hủy chia sẻ', 'error');
        }
    } catch (error) {
        console.error('Error undoing share:', error);
        showNotification('Lỗi kết nối khi hủy chia sẻ', 'error');
    }
}

/**
 * Khởi tạo cho tất cả bài viết chia sẻ
 */
function initializeSharedPosts() {
    console.log('Initializing shared posts...');
    
    // Tìm tất cả bài viết chia sẻ
    document.querySelectorAll('.post-card[data-is-shared="true"]').forEach(postElement => {
        const postId = postElement.dataset.postId;
        
        // Tải thông tin chi tiết
        loadSharedPostInfo(postId);
        
        // Thêm menu context
        addSharedPostContextMenu(postId);
        
        // Thêm sự kiện click để xem chi tiết
        postElement.addEventListener('dblclick', () => {
            const originalPostId = postElement.dataset.originalPostId;
            if (originalPostId) {
                viewOriginalPost(originalPostId);
            }
        });
    });
}
/**
 * API like comment - ĐÃ SỬA HOÀN CHỈNH
 */
async function likeCommentAPI(postId, commentId, replyId = null) {
    try {
        const requestData = {
            post_id: postId,
            comment_id: commentId
        };
        
        if (replyId && replyId !== 'null' && replyId !== 'undefined') {
            requestData.reply_id = replyId;
        }
        
        console.log('[API] Sending like request to /like_comment:', requestData);
        
        // Đảm bảo gọi đúng endpoint với credentials
        const response = await fetch('/like_comment', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            credentials: 'same-origin', // Đảm bảo gửi session cookie
            body: JSON.stringify(requestData)
        });
        
        console.log('[API] Response status:', response.status);
        console.log('[API] Response headers:', response.headers);
        
        const responseText = await response.text();
        console.log('[API] Raw response:', responseText);
        
        if (!response.ok) {
            // Thử parse error message
            let errorMsg = `HTTP error! status: ${response.status}`;
            try {
                const errorData = JSON.parse(responseText);
                errorMsg = errorData.error || errorMsg;
            } catch (e) {
                // Nếu không parse được JSON, dùng text
                errorMsg = responseText || errorMsg;
            }
            
            throw new Error(errorMsg);
        }
        
        // Parse response
        let result;
        try {
            result = JSON.parse(responseText);
        } catch (e) {
            console.error('[API] Failed to parse JSON:', e);
            throw new Error('Invalid JSON response from server');
        }
        
        console.log('[API] Parsed response:', result);
        
        return result;
        
    } catch (error) {
        console.error('[API] Error in likeCommentAPI:', error);
        return { 
            success: false, 
            error: error.message || 'Lỗi kết nối' 
        };
    }
}
function revertCommentLikeUI(postId, commentId, replyId, originalLiked, originalCount) {
    const targetElement = findCommentElement(postId, commentId, replyId);
    if (!targetElement) return;
    
    const likeBtn = targetElement.querySelector('.like-comment-btn');
    const likeCountElement = targetElement.querySelector('.like-count');
    
    if (likeBtn) {
        if (originalLiked) {
            likeBtn.classList.add('liked');
            likeBtn.innerHTML = '<i class="fas fa-heart"></i> Đã thích';
        } else {
            likeBtn.classList.remove('liked');
            likeBtn.innerHTML = '<i class="fas fa-heart"></i> Thích';
        }
    }
    
    if (likeCountElement) {
        likeCountElement.textContent = originalCount;
    }
}
function attachCommentEventListeners() {
    console.log('🔗 Setting up comment event delegation...');
    
    // Xóa các listeners cũ nếu có
    document.removeEventListener('click', handleCommentClick);
    
    // Thêm listener mới
    document.addEventListener('click', handleCommentClick);
}

/**
 * Xử lý click trong comments - ĐÃ TÁCH RA RIÊNG
 */
function handleCommentClick(e) {
    // Xử lý nút like comment
    const likeBtn = e.target.closest('.like-comment-btn');
    if (likeBtn && likeBtn.dataset.postId && likeBtn.dataset.commentId) {
        e.preventDefault();
        e.stopPropagation();
        
        const postId = likeBtn.dataset.postId;
        const commentId = likeBtn.dataset.commentId;
        const replyId = likeBtn.dataset.replyId || null;
        
        console.log('❤️ Like comment clicked:', { postId, commentId, replyId });
        
        // Gọi hàm like
        if (typeof likeComment === 'function') {
            likeComment(postId, commentId, replyId);
        } else {
            console.error('likeComment function not found');
        }
        return false;
    }
    
    // Xử lý nút reply
    const replyBtn = e.target.closest('.reply-action-btn');
    if (replyBtn && replyBtn.dataset.postId && replyBtn.dataset.commentId) {
        e.preventDefault();
        e.stopPropagation();
        
        const postId = replyBtn.dataset.postId;
        const commentId = replyBtn.dataset.commentId;
        
        console.log(`[Reply Click] Post: ${postId}, Comment: ${commentId}`);
        
        // Tìm username từ comment - SỬA: Tìm container comment đúng cách
        // Button cũng có data-comment-id nên closest sẽ tìm thấy chính nó
        // Cần tìm phần tử cha có class comment-item hoặc comment-reply
        let commentElement = replyBtn.closest('.comment-item, .comment-reply');
        
        // Nếu không tìm thấy, thử tìm trong post
        if (!commentElement) {
            const postElement = document.querySelector(`[data-post-id="${postId}"]`);
            if (postElement) {
                commentElement = postElement.querySelector(`[data-comment-id="${commentId}"].comment-item, [data-comment-id="${commentId}"].comment-reply`);
            }
        }
        
        // Nếu vẫn không tìm thấy, thử tìm bất kỳ element nào có data-comment-id (không phải button)
        if (!commentElement) {
            const allElements = document.querySelectorAll(`[data-comment-id="${commentId}"]`);
            for (const el of allElements) {
                if (!el.classList.contains('reply-action-btn') && !el.classList.contains('like-comment-btn')) {
                    commentElement = el;
                    break;
                }
            }
        }
        
        console.log(`[Reply Click] Found comment element:`, commentElement);
        
        let username = 'người dùng';
        if (commentElement) {
            const authorElement = commentElement.querySelector('.comment-author');
            console.log(`[Reply Click] Found author element:`, authorElement);
            if (authorElement) {
                // Ưu tiên lấy từ .author-name span nếu có
                const authorNameSpan = authorElement.querySelector('.author-name');
                if (authorNameSpan) {
                    username = authorNameSpan.textContent.trim();
                    console.log(`[Reply Click] Found username from .author-name: "${username}"`);
                } else {
                    // Fallback: lấy text trước dấu →
                    const authorText = authorElement.textContent || '';
                    username = authorText.split('→')[0].trim();
                    console.log(`[Reply Click] Extracted username from text: "${username}"`);
                }
            }
        }
        
        console.log('💬 Reply button clicked:', { postId, commentId, username });
        
        // Gọi hàm startReplyToComment
        if (typeof startReplyToComment === 'function') {
            startReplyToComment(postId, commentId, username);
        } else {
            console.error('startReplyToComment function not found');
            // Fallback: focus vào input comment
            const commentInput = document.getElementById(`comment-input-${postId}`);
            if (commentInput) {
                commentInput.focus();
                commentInput.placeholder = `Trả lời ${username}...`;
                commentInput.dataset.replyTo = commentId;
                commentInput.dataset.replyToUsername = username;
            }
        }
        return false;
    }
}
/**
 * Sửa đổi hàm addCommentToUI để hỗ trợ ẩn/hiện replies
 */
function addCommentToUIWithRepliesToggle(postId, commentData, replyTo = null) {
    console.log(`[Realtime UI] Adding comment to UI: ${commentData.id}, replyTo: ${replyTo}`);
    
    const postElement = document.querySelector(`[data-post-id="${postId}"]`);
    if (!postElement) {
        console.error(`[Realtime UI] Post element not found: ${postId}`);
        return;
    }
    
    // Tạo HTML cho comment
    const isReply = !!replyTo;
    const commentHTML = createCommentHTMLWithRepliesToggle(postId, commentData, isReply);
    
    if (replyTo) {
        // Tìm parent comment
        const parentComment = findParentComment(postElement, replyTo);
        
        if (parentComment) {
            const parentCommentId = parentComment.dataset.commentId;
            
            // Tạo hoặc lấy replies container
            const { repliesContainer, repliesList } = createRepliesContainerIfNeeded(postId, parentCommentId);
            
            if (repliesList) {
                // Thêm reply vào replies list
                repliesList.insertAdjacentHTML('beforeend', commentHTML);
                
                // Cập nhật số lượng replies
                const repliesCount = repliesList.querySelectorAll('.comment-reply').length;
                updateReplyCount(postId, parentCommentId, repliesCount);
                
                // Tự động mở replies container nếu đang ẩn
                showRepliesWhenNewReplyAdded(postId, parentCommentId);
                
                // Scroll đến reply mới
                const newReply = repliesList.querySelector(`[data-comment-id="${commentData.id}"]`);
                if (newReply) {
                    newReply.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
                
                console.log(`[Realtime UI] Added reply to parent comment: ${parentCommentId}, total replies: ${repliesCount}`);
            } else {
                console.error(`[Realtime UI] Failed to create replies container for comment: ${parentCommentId}`);
                // Fallback: thêm vào comments list chính
                const commentsList = postElement.querySelector('.comments-list');
                if (commentsList) {
                    commentsList.insertAdjacentHTML('afterbegin', commentHTML);
                }
            }
        } else {
            console.error(`[Realtime UI] Parent comment not found for replyTo: ${replyTo}`);
            // Fallback: thêm vào comments list chính
            const commentsList = postElement.querySelector('.comments-list');
            if (commentsList) {
                commentsList.insertAdjacentHTML('afterbegin', commentHTML);
            }
        }
    } else {
        // Thêm comment mới vào đầu danh sách comments chính
        const commentsList = postElement.querySelector('.comments-list');
        if (commentsList) {
            commentsList.insertAdjacentHTML('afterbegin', commentHTML);
            
            // Scroll đến comment mới
            const newComment = commentsList.querySelector(`[data-comment-id="${commentData.id}"]`);
            if (newComment) {
                newComment.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
    }
    
    // Cập nhật số lượng comment
    updateCommentCount(postId);
    
    console.log(`[Realtime UI] Comment added successfully`);
}

/**
 * Tạo HTML cho comment/reply với hỗ trợ toggle replies
 */
function createCommentHTMLWithRepliesToggle(postId, commentData, isReply = false) {
    const isReplyToComment = commentData.reply_to && commentData.reply_to_username;
    
    // Format thời gian
    let commentTime = formatTimeFriendly(commentData.created_at);
    
    // Xác định class dựa trên loại (comment hay reply)
    const itemClass = isReply ? 'comment-reply' : 'comment-item';
    
    // Tạo chuỗi reply chain nếu có
    let replyChainHTML = '';
    if (isReplyToComment) {
        replyChainHTML = `<span class="reply-to">→ @${commentData.reply_to_username}</span>`;
    }
    
    // Số lượng like
    const likeCount = commentData.likes ? commentData.likes.length : 0;
    
    // Số lượng replies (chỉ cho comment chính)
    const repliesCount = isReply ? 0 : (commentData.replies ? commentData.replies.length : 0);
    
    // Tạo HTML cho comment
    let html = `
        <div class="${itemClass}" data-comment-id="${commentData.id}" data-post-id="${postId}">
            <img src="${commentData.user_avatar || '/static/img/default-avatar.png'}" 
                 alt="Avatar" 
                 class="comment-avatar"
                 onerror="this.src='/static/img/default-avatar.png'">
            <div class="comment-content">
                <div class="comment-author">
                    ${commentData.username || 'Unknown'}
                    ${replyChainHTML}
                </div>
                <p class="comment-text">${commentData.content || ''}</p>
                <div class="comment-time">${commentTime}</div>
                <div class="comment-actions">
                    <button class="btn btn-link btn-sm like-comment-btn" 
                            data-post-id="${postId}" 
                            data-comment-id="${commentData.id}"
                            data-reply-id="${isReply ? commentData.id : ''}">
                        <i class="fas fa-heart"></i> 
                        <span class="like-count">${likeCount}</span>
                    </button>
                    <button class="btn btn-link btn-sm reply-action-btn" 
                            data-post-id="${postId}" 
                            data-comment-id="${commentData.id}">
                        <i class="fas fa-reply"></i> Trả lời
                    </button>
    `;
    
    // Thêm nút xem replies nếu là comment chính và có replies
    if (!isReply && repliesCount > 0) {
        html += `
                    <button class="btn btn-link btn-sm view-replies-btn" 
                            data-post-id="${postId}"
                            data-comment-id="${commentData.id}"
                            onclick="toggleReplies('${postId}', '${commentData.id}')">
                        <i class="fas fa-comments"></i>
                        <span class="reply-count">${repliesCount}</span> trả lời
                        <i class="fas fa-chevron-down toggle-icon"></i>
                    </button>
        `;
    }
    
    html += `
                </div>
            </div>
        </div>
    `;
    
    return html;
}

/**
 * Khởi tạo toggle replies cho tất cả comments có replies
 */
function initializeRepliesToggle() {
    console.log('Initializing replies toggle functionality...');
    
    // Tìm tất cả các comment có nút xem replies
    document.querySelectorAll('.view-replies-btn').forEach(btn => {
        const postId = btn.dataset.postId;
        const commentId = btn.dataset.commentId;
        
        // Gắn sự kiện click
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleReplies(postId, commentId);
        });
        
        // Ẩn replies container mặc định
        const repliesContainer = document.getElementById(`replies-${postId}-${commentId}`);
        if (repliesContainer) {
            repliesContainer.style.display = 'none';
        }
    });
    
    console.log('Replies toggle initialized');
}


/**
 * Tìm comment CHÍNH chứa reply (hỗ trợ tìm parent comment cho cả reply của reply)
 */
function findParentComment(postElement, targetCommentId) {
    // Tìm tất cả comments (cấp 0)
    const allComments = postElement.querySelectorAll('.comment-item');
    
    for (const comment of allComments) {
        const commentId = comment.dataset.commentId;
        
        // Nếu targetCommentId chính là comment này
        if (commentId === targetCommentId) {
            return comment;
        }
        
        // Tìm trong replies của comment này
        const repliesContainer = comment.querySelector('.comment-replies');
        if (repliesContainer) {
            const replies = repliesContainer.querySelectorAll('.comment-reply');
            for (const reply of replies) {
                if (reply.dataset.commentId === targetCommentId) {
                    // Dù reply này trả lời reply khác, vẫn trả về comment CHÍNH
                    return comment;
                }
            }
        }
    }
    
    return null;
}
/**
 * Tạo HTML cho comment/reply - ĐÃ SỬA (hiển thị đúng reply chain)
 */
/**
 * Xây dựng cây bình luận từ dữ liệu backend
 */
function buildCommentTree(comments) {
    if (!comments || comments.length === 0) return [];
    
    // Backend trả về comments gốc với mảng replies bên trong
    // Chỉ cần xử lý datetime và trả về comments gốc
    return comments.map(comment => ({
        ...comment,
        replies: comment.replies || []
    }));
}

/**
 * Render comment với replies
 */
function renderComment(comment, postId) {
    const hasReplies = comment.replies && comment.replies.length > 0;
    const repliesHtml = hasReplies ? `
        <div class="comment-replies-container" id="replies-${postId}-${comment.id}" style="display: block;">
            ${comment.replies.map(reply => renderReply(reply, postId, comment.id)).join('')}
        </div>
    ` : '';
    
    // Sử dụng đúng tên trường từ backend: username và user_avatar
    const authorName = comment.author_name || comment.username || 'Unknown';
    const authorAvatar = comment.author_avatar || comment.user_avatar || '/static/img/default-avatar.png';
    
    // Kiểm tra liked - chuyển tất cả về string để so sánh
    const currentUserId = String(window.currentUserId || '');
    const likes = comment.likes || [];
    const isLiked = comment.is_liked || likes.some(like => String(like) === currentUserId);
    const likesCount = comment.likes_count || likes.length;
    
    return `
        <div class="comment-item" data-comment-id="${comment.id}" data-post-id="${postId}">
            <img src="${authorAvatar}" 
                 alt="${authorName}" 
                 class="comment-avatar">
            <div class="comment-content">
                <div class="comment-author">
                    <span class="author-name">${authorName}</span>
                    <span class="comment-time">${formatTimeFriendly(comment.created_at)}</span>
                </div>
                <div class="comment-text">${comment.content}</div>
                <div class="comment-actions">
                    <button class="like-comment-btn ${isLiked ? 'liked' : ''}" 
                            data-post-id="${postId}" 
                            data-comment-id="${comment.id}">
                        <i class="${isLiked ? 'fas' : 'far'} fa-heart"></i>
                        <span class="like-count">${likesCount}</span>
                    </button>
                    <button class="reply-action-btn" 
                            data-post-id="${postId}" 
                            data-comment-id="${comment.id}">
                        <i class="fas fa-reply"></i> Trả lời
                    </button>
                    ${hasReplies ? `
                    <button class="view-replies-btn" onclick="toggleReplies('${postId}', '${comment.id}')">
                        <i class="fas fa-comments"></i>
                        <span class="reply-count">${comment.replies.length}</span> trả lời
                        <i class="fas fa-chevron-down toggle-icon"></i>
                    </button>
                    ` : ''}
                </div>
                ${repliesHtml}
            </div>
        </div>
    `;
}

/**
 * Render reply
 */
function renderReply(reply, postId, parentCommentId) {
    // Sử dụng đúng tên trường từ backend: full_name hoặc username
    const authorName = reply.full_name || reply.author_name || reply.username || 'Unknown';
    const authorAvatar = reply.author_avatar || reply.user_avatar || '/static/img/default-avatar.png';
    
    // Kiểm tra liked - chuyển tất cả về string để so sánh
    const currentUserId = String(window.currentUserId || '');
    const likes = reply.likes || [];
    const isLiked = reply.is_liked || likes.some(like => String(like) === currentUserId);
    const likesCount = reply.likes_count || likes.length;
    
    return `
        <div class="comment-reply" data-comment-id="${reply.id}" data-post-id="${postId}">
            <img src="${authorAvatar}" 
                 alt="${authorName}" 
                 class="comment-avatar small">
            <div class="comment-content">
                <div class="comment-author">
                    <span class="author-name">${authorName}</span>
                    ${reply.reply_to_username ? `<span class="reply-to">→ @${reply.reply_to_username}</span>` : ''}
                    <span class="comment-time">${formatTimeFriendly(reply.created_at)}</span>
                </div>
                <div class="comment-text">${reply.content}</div>
                <div class="comment-actions">
                    <button class="like-comment-btn ${isLiked ? 'liked' : ''}" 
                            data-post-id="${postId}" 
                            data-comment-id="${parentCommentId}"
                            data-reply-id="${reply.id}">
                        <i class="${isLiked ? 'fas' : 'far'} fa-heart"></i>
                        <span class="like-count">${likesCount}</span>
                    </button>
                    <button class="reply-action-btn" 
                            data-post-id="${postId}" 
                            data-comment-id="${reply.id}">
                        <i class="fas fa-reply"></i> Trả lời
                    </button>
                </div>
            </div>
        </div>
    `;
}


/**
 * Tạo HTML cho comment/reply - ĐÃ SỬA (hiển thị đúng reply chain)
 */
function createCommentHTML(postId, commentData, isReply = false) {
    const isReplyToComment = commentData.reply_to && commentData.reply_to_username;
    const itemClass = isReply ? 'comment-reply' : 'comment-item';
    
    // Format thời gian
    let commentTime = formatTimeFriendly(commentData.created_at);
    
    // Tạo chuỗi reply chain nếu có
    let replyChainHTML = '';
    if (isReplyToComment) {
        replyChainHTML = `<span class="reply-to">→ @${commentData.reply_to_username}</span>`;
    }
    
    // Số lượng like
    const likeCount = commentData.likes ? commentData.likes.length : 0;
    
    // Tạo reply target info
    let replyInfo = '';
    if (commentData.reply_to_username) {
        replyInfo = `data-reply-to="${commentData.reply_to}" data-reply-username="${commentData.reply_to_username}"`;
    }
    
    return `
        <div class="${itemClass}" data-comment-id="${commentData.id}" data-post-id="${postId}" ${replyInfo}>
            <img src="${commentData.user_avatar || '/static/img/default-avatar.png'}" 
                 alt="Avatar" 
                 class="comment-avatar"
                 onerror="this.src='/static/img/default-avatar.png'">
            <div class="comment-content">
                <div class="comment-author">
                    ${commentData.username || 'Unknown'}
                    ${replyChainHTML}
                </div>
                <p class="comment-text">${commentData.content || ''}</p>
                <div class="comment-time">${commentTime}</div>
                <div class="comment-actions">
                    <button class="btn btn-link btn-sm like-comment-btn" 
                            data-post-id="${postId}" 
                            data-comment-id="${commentData.id}"
                            data-reply-id="${isReply ? commentData.id : ''}">
                        <i class="fas fa-heart"></i> 
                        <span class="like-count">${likeCount}</span>
                    </button>
                    <button class="btn btn-link btn-sm reply-action-btn" 
                            data-post-id="${postId}" 
                            data-comment-id="${commentData.id}">
                        <i class="fas fa-reply"></i> Trả lời
                    </button>
                </div>
            </div>
        </div>
    `;
}
/**
 * Gắn event listeners cho comment inputs - ĐÃ SỬA
 */
function attachCommentInputListeners() {
    console.log('⌨️ Setting up comment input listeners...');
    
    // Xử lý comment input với event delegation - Enable/disable submit button
    document.addEventListener('input', function(e) {
        if (e.target.classList.contains('comment-input') && e.target.dataset.postId) {
            const postId = e.target.dataset.postId;
            const submitBtn = document.getElementById(`submit-comment-${postId}`);
            
            if (submitBtn) {
                // Luôn enable nút submit
                submitBtn.disabled = false;
                console.log(`[Input] Submit button enabled for post ${postId}`);
            }
        }
    });
    
    // Xử lý comment input với event delegation - Enter key
    document.addEventListener('keypress', function(e) {
        if (e.target.classList.contains('comment-input') && e.target.dataset.postId && e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            const postId = e.target.dataset.postId;
            console.log('[Event] Enter pressed for comment on post:', postId);
            
            if (typeof addComment === 'function') {
                addComment(postId);
            }
            return false;
        }
    });
    
    // Xử lý nút submit comment
    document.addEventListener('click', function(e) {
        const submitBtn = e.target.closest('.comment-submit-btn');
        if (submitBtn && submitBtn.dataset.postId) {
            e.preventDefault();
            e.stopPropagation();
            const postId = submitBtn.dataset.postId;
            console.log('[Event] Submit comment for post:', postId);
            
            if (typeof addComment === 'function') {
                addComment(postId);
            }
            return false;
        }
        
        // Xử lý nút hủy reply
        const cancelBtn = e.target.closest('.btn-outline.btn-sm');
        if (cancelBtn && cancelBtn.id && cancelBtn.id.startsWith('cancel-reply-')) {
            e.preventDefault();
            e.stopPropagation();
            const postId = cancelBtn.id.replace('cancel-reply-', '');
            console.log('[Event] Cancel reply for post:', postId);
            
            if (typeof cancelReply === 'function') {
                cancelReply(postId);
            }
            return false;
        }
    });
}

/**
 * Gửi sự kiện join post room khi tải trang
 */
function joinPostRooms() {
    const postCards = document.querySelectorAll('.post-card');
    postCards.forEach(card => {
        const postId = card.dataset.postId;
        if (postId && socket && socket.connected) {
            socket.emit('join_post_room', { post_id: postId });
            console.log(`[Socket] Joined post room: post_${postId}`);
        }
    });
}

/**
 * Khởi tạo realtime comment handlers
 */
function initializeRealtimeCommentHandlers() {
    if (!socket) {
        console.warn('[Realtime] Socket not initialized');
        return;
    }
    
    console.log('[Realtime] Initializing comment handlers');
    
    // Lắng nghe sự kiện comment mới từ server
    socket.on('new_comment_added', function(data) {
        console.log('[Socket] Received new_comment_added:', data);
        
        // QUAN TRỌNG: Xác định đúng parent comment cho reply
        let parentCommentId = null;
        
        if (data.is_reply && data.reply_to) {
            // Tìm post element
            const postElement = document.querySelector(`[data-post-id="${data.post_id}"]`);
            if (postElement) {
                // Sử dụng hàm findParentComment đã định nghĩa
                const parentComment = findParentComment(postElement, data.reply_to);
                if (parentComment) {
                    parentCommentId = parentComment.dataset.commentId;
                    console.log(`[Socket] Found parent comment for reply: ${parentCommentId}`);
                }
            }
        }
        
        // Thêm comment vào UI với đúng parent
        addCommentToUI(
            data.post_id, 
            data.comment, 
            parentCommentId || data.reply_to  // Dùng parent comment nếu tìm thấy
        );
        
        // Hiển thị thông báo
        if (data.is_reply) {
            showNotification(`${data.comment.username} đã trả lời bình luận`, 'info');
        } else {
            showNotification(`${data.comment.username} đã bình luận`, 'info');
        }
    });
    
    // Lắng nghe sự kiện cập nhật số lượng comment
    socket.on('comment_count_updated', function(data) {
        console.log('[Socket] Received comment_count_updated:', data);
        updateCommentCount(data.post_id);
    });
    
    // Kết nối socket
    socket.on('connect', function() {
        console.log('[Socket] Connected, joining post rooms...');
        joinPostRooms();
    });
    
    // Reconnect
    socket.on('reconnect', function() {
        console.log('[Socket] Reconnected, rejoining post rooms...');
        joinPostRooms();
    });
    
    // Error handling
    socket.on('comment_error', function(data) {
        console.error('[Socket] Comment error:', data);
        showNotification(data.message || 'Lỗi khi xử lý bình luận', 'error');
    });
}

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
// Gọi hàm khởi tạo khi trang load
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(() => {
        initializeRepliesToggle();
    }, 500);
});

// Khởi tạo media viewer khi load
document.addEventListener('DOMContentLoaded', function() {
    console.log('Initializing media viewer events...');
    initializeMediaViewerEvents();
});
// ==================== EVENT LISTENERS & INITIALIZATION ====================

// Khởi tạo khi DOM ready - CHỈ GỌI MỘT LẦN
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        console.log('DOM fully loaded, initializing profile page...');
        initializeProfilePage();
        
        // Khởi tạo Profile Manager
        if (typeof ProfileManager !== 'undefined' && !window.profileManager) {
            window.profileManager = new ProfileManager();
            console.log('ProfileManager initialized');
        }
    });
} else {
    // DOM đã sẵn sàng
    console.log('DOM already ready, initializing profile page...');
    setTimeout(() => {
        initializeProfilePage();
        
        // Khởi tạo Profile Manager
        if (typeof ProfileManager !== 'undefined' && !window.profileManager) {
            window.profileManager = new ProfileManager();
            console.log('ProfileManager initialized');
        }
    }, 100);
}
// Export functions với tên khác để tránh xung đột
window.openFullscreenViewer = openMediaViewer;
window.closeFullscreenViewer = closeMediaViewer;
window.viewerNavigatePrev = viewerPrev;
window.viewerNavigateNext = viewerNext;
window.downloadViewerMedia = downloadCurrentMedia;
window.openMediaViewer = openMediaViewer;
// Export functions
window.addCommentAPI = addCommentAPI;
window.addCommentAPIFallback = addCommentAPIFallback;
window.likeCommentAPI = likeCommentAPI;
// ... rest of exports

// Thêm các hàm mới
window.likeComment = likeComment;
window.likeCommentRealtime = likeCommentRealtime;
window.startReplyToComment = startReplyToComment;
window.addCommentRealtime = addCommentRealtime;
window.cancelReply = cancelReply;
window.shareToProfile = shareToProfile;
window.shareToMessage = shareToMessage;
window.showShareMenu = showShareMenu;
window.closeShareModal = closeShareModal;
window.copyPostLink = copyPostLink;
window.initializeRealtimeCommentHandlers = initializeRealtimeCommentHandlers;
window.attachCommentEventListeners = attachCommentEventListeners;
window.attachCommentInputListeners = attachCommentInputListeners;
window.updateCommentCount = updateCommentCount;
window.handleCommentClick = handleCommentClick;

window.handleUnfriend = handleUnfriend;
window.handleAddFriend = handleAddFriend;
window.handleCancelFriendRequest = handleCancelFriendRequest;
window.handleAcceptFriendRequest = handleAcceptFriendRequest;
window.handleDeclineFriendRequest = handleDeclineFriendRequest;
window.updateFriendButtonUI = updateFriendButtonUI;
window.checkAndUpdateFriendStatus = checkAndUpdateFriendStatus;

window.toggleReplies = toggleReplies;
window.showRepliesWhenNewReplyAdded = showRepliesWhenNewReplyAdded;
window.updateReplyCount = updateReplyCount;
window.initializeRepliesToggle = initializeRepliesToggle;

// Giữ nguyên các exports khác
window.ProfileManager = ProfileManager;
window.likePost = likePost;
window.toggleComments = toggleComments;
window.addComment = addComment;
window.editProfile = editProfile;
window.changeCoverPhoto = changeCoverPhoto;
window.initializeProfilePage = initializeProfilePage;
window.openEditPostModal = openEditPostModal;
window.handleDeletePost = handleDeletePost;
window.showNotification = showNotification;
window.ProfileEditor = ProfileEditor;
window.initializeProfileEditor = initializeProfileEditor;
window.carouselPrev = carouselPrev;
window.carouselNext = carouselNext;
window.carouselGoTo = carouselGoTo;

// Export các hàm share mới
window.shareToProfile = shareToProfile;
window.shareToMessage = shareToMessage;
window.shareToMessageWithDialog = shareToMessageWithDialog;
window.shareToStory = shareToStory;
window.shareToExternal = shareToExternal;
window.copyPostLink = copyPostLink;
window.closeShareModal = closeShareModal;
window.openShareToMessageDialog = openShareToMessageDialog;
window.closeRecipientModal = closeRecipientModal;
window.shareToSelectedRecipients = shareToSelectedRecipients;
window.updateSelectedCount = updateSelectedCount;
window.filterRecipients = filterRecipients;
// Export functions
window.SideNavigation = SideNavigation;
window.initializeSideNavigation = initializeSideNavigation;
window.shareToProfile = shareToProfile;
window.shareToMessageWithDialog = shareToMessageWithDialog;
window.copyPostLink = copyPostLink;
// Export media viewer functions
window.viewPhotoInPost = viewPhotoInPost;
window.updateMediaViewer = updateMediaViewer;
window.closeMediaViewer = closeMediaViewer;
window.viewerPrev = viewerPrev;
window.viewerNext = viewerNext;
window.initializeShareModal = initializeShareModal;
window.viewOriginalPost = viewOriginalPost;

console.log('Profile JS loaded successfully with all functions exported');