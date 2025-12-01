// app/static/js/profile.js
// ==================== CÁC HÀM TOÀN CỤC ====================

let likeProcessing = false;
let commentProcessing = false;
let postProcessing = false;
let socket;

function initializeSocket() {
    try {
        // Sử dụng socket toàn cục đã được khởi tạo từ profile.html
        if (window.socket && window.socket.connected) {
            socket = window.socket;
            console.log('Using global socket instance');
        } else {
            // Fallback: tạo socket mới
            socket = io();
            console.log('Created new socket instance');
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
 * Like/unlike bài viết
 */
async function likePost(postId) {
    if (likeProcessing) {
        console.log('Like action already in progress');
        return;
    }
    likeProcessing = true;
    
    try {
        // Tìm các element một cách an toàn
        const postElement = document.querySelector(`[data-post-id="${postId}"]`);
        if (!postElement) {
            console.error(`Post element not found for ID: ${postId}`);
            return;
        }

        const likeBtn = postElement.querySelector('.like-btn');
        const likeCount = postElement.querySelector('.like-count');
        
        if (!likeBtn || !likeCount) {
            console.error('Like button or count element not found', { likeBtn, likeCount });
            return;
        }

        // Hiệu ứng loading
        const originalHTML = likeBtn.innerHTML;
        likeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        likeBtn.disabled = true;
        
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
        
        if (result.success) {
            // Cập nhật giao diện
            if (result.liked) {
                likeBtn.classList.add('liked');
                likeBtn.innerHTML = '<i class="fas fa-heart"></i> Đã thích';
                showNotification('Đã thích bài viết', 'success');
            } else {
                likeBtn.classList.remove('liked');
                likeBtn.innerHTML = '<i class="fas fa-heart"></i> Thích';
                showNotification('Đã bỏ thích bài viết', 'info');
            }
            
            // Cập nhật số lượng like - AN TOÀN
            if (likeCount) {
                likeCount.textContent = result.like_count || '0';
            }
            
            console.log(`Like action successful: ${result.liked ? 'liked' : 'unliked'}`);
        } else {
            console.error('Like failed:', result.error);
            likeBtn.innerHTML = originalHTML;
            showNotification(result.error || 'Lỗi khi thích bài viết', 'error');
        }
    } catch (error) {
        console.error('Like error:', error);
        // Khôi phục trạng thái nút
        const postElement = document.querySelector(`[data-post-id="${postId}"]`);
        if (postElement) {
            const likeBtn = postElement.querySelector('.like-btn');
            if (likeBtn) {
                likeBtn.innerHTML = '<i class="fas fa-heart"></i> Thích';
                likeBtn.disabled = false;
            }
        }
        showNotification('Lỗi kết nối, vui lòng thử lại', 'error');
    } finally {
        likeProcessing = false;
    }
}

/**
 * Thêm bình luận vào bài viết
 */
async function addComment(postId) {
    if (commentProcessing) {
        console.log('Comment action already in progress');
        return;
    }
    commentProcessing = true;
    
    const commentInput = document.getElementById(`comment-input-${postId}`);
    if (!commentInput) {
        console.error(`Comment input not found for post: ${postId}`);
        commentProcessing = false;
        return;
    }

    const content = commentInput.value.trim();
    
    if (!content) {
        commentProcessing = false;
        return;
    }

    try {
        const submitBtn = commentInput.nextElementSibling;
        if (!submitBtn) {
            console.error('Submit button not found');
            return;
        }
        
        const originalHTML = submitBtn.innerHTML;
        
        // Hiệu ứng loading
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        submitBtn.disabled = true;

        const response = await fetch('/comment_post', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                post_id: postId,
                content: content
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        
        if (result.success) {
            // Thêm bình luận mới vào UI
            const commentsList = document.querySelector(`#comments-${postId} .comments-list`);
            if (commentsList && result.comment) {
                const newComment = document.createElement('div');
                newComment.className = 'comment-item';
                newComment.innerHTML = `
                    <img src="${result.comment.user_avatar || '/static/img/default-avatar.png'}" 
                         alt="Avatar" class="comment-avatar">
                    <div class="comment-content">
                        <strong class="comment-username">${result.comment.username || 'Unknown'}</strong>
                        <p class="comment-text">${result.comment.content}</p>
                        <small class="comment-time">Vừa xong</small>
                    </div>
                `;
                commentsList.appendChild(newComment);
            }
            
            // Xóa nội dung input
            commentInput.value = '';
            
            // Cập nhật số lượng bình luận - AN TOÀN
            const commentCount = document.querySelector(`[data-post-id="${postId}"] .comment-count`);
            if (commentCount) {
                const currentCount = parseInt(commentCount.textContent) || 0;
                commentCount.textContent = currentCount + 1;
            }
            
            showNotification('Đã thêm bình luận', 'success');
            console.log('Comment added successfully');
        } else {
            showNotification(result.error || 'Lỗi khi bình luận', 'error');
        }
    } catch (error) {
        console.error('Comment error:', error);
        showNotification('Lỗi kết nối khi bình luận', 'error');
    } finally {
        commentProcessing = false;
        // Khôi phục nút submit
        const submitBtn = commentInput.nextElementSibling;
        if (submitBtn) {
            submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i>';
            submitBtn.disabled = false;
        }
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
    
    // Các hàm khởi tạo khác của profile page...
});
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

        try {
            // Upload từng file một và theo dõi tiến trình
            const uploadPromises = files.map(file => this.uploadSingleFile(file));
            const results = await Promise.all(uploadPromises);
            
            // Lọc các file upload thành công
            const successfulUploads = results.filter(result => result.success);
            
            if (successfulUploads.length > 0) {
                this.currentMedia = [...this.currentMedia, ...successfulUploads.map(result => result.media)];
                this.updateMediaPreview();
                console.log(`Successfully uploaded ${successfulUploads.length} files`);
                
                if (successfulUploads.length < files.length) {
                    showNotification(`Đã upload thành công ${successfulUploads.length}/${files.length} file`, 'info');
                } else {
                    showNotification(`Đã upload thành công ${successfulUploads.length} file`, 'success');
                }
            } else {
                showNotification('Không có file nào được upload thành công', 'error');
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
     * Upload single file với xử lý lỗi riêng
     */
    async uploadSingleFile(file) {
        // Kiểm tra kích thước file (tối đa 10MB)
        const maxSize = 10 * 1024 * 1024;
        if (file.size > maxSize) {
            console.warn(`File ${file.name} vượt quá kích thước cho phép: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
            return { success: false, error: 'File quá lớn' };
        }

        // Kiểm tra loại file
        if (!file.type.match('image.*') && !file.type.match('video.*')) {
            console.warn(`File ${file.name} không phải là ảnh hoặc video: ${file.type}`);
            return { success: false, error: 'Loại file không hợp lệ' };
        }

        const formData = new FormData();
        formData.append('media', file);

        try {
            const response = await fetch('/upload_post_media', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            
            if (result.success && result.media_urls && result.media_urls.length > 0) {
                return {
                    success: true,
                    media: result.media_urls[0] // Lấy media đầu tiên từ kết quả
                };
            } else {
                return { success: false, error: result.error || 'Upload failed' };
            }
        } catch (error) {
            console.error(`Upload failed for ${file.name}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Hiển thị trạng thái đang upload
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
        
        const submitBtn = document.getElementById('submit-post');
        if (!submitBtn) {
            console.error('Submit post button not found');
            postProcessing = false;
            return;
        }

        const content = document.getElementById('post-content')?.value.trim() || '';
        
        if (!content && this.currentMedia.length === 0) {
            showNotification('Vui lòng nhập nội dung hoặc thêm media', 'warning');
            postProcessing = false;
            return;
        }

        const originalHTML = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang đăng...';

        try {
            console.log('Creating post with multiple media...', { 
                content, 
                mediaCount: this.currentMedia.length,
                mediaTypes: this.currentMedia.map(m => m.type)
            });
            
            const response = await fetch('/create_post', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    content: content,
                    media_urls: this.currentMedia
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            
            if (result.success) {
                // Xóa form
                const postContent = document.getElementById('post-content');
                if (postContent) postContent.value = '';
                
                this.currentMedia = [];
                this.updateMediaPreview();
                
                // Hiển thị thông báo thành công
                showNotification('Đăng bài thành công!', 'success');
                
                console.log('Post created successfully, reloading page...');
                
                // Reload trang sau 1 giây
                setTimeout(() => {
                    location.reload();
                }, 1000);
            } else {
                showNotification(result.error || 'Lỗi khi đăng bài', 'error');
            }
        } catch (error) {
            console.error('Create post error:', error);
            showNotification('Lỗi khi đăng bài', 'error');
        } finally {
            postProcessing = false;
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalHTML;
        }
    }
}
/**
 * Xử lý nút trở về trang của tôi
 */
function handleBackToMyProfile() {
    console.log('Back to my profile button clicked');
    
    // Lấy current user ID từ data attribute
    const profileContainer = document.querySelector('.profile-container');
    const currentUserId = profileContainer ? profileContainer.dataset.currentUserId : null;
    
    if (currentUserId) {
        // Chuyển hướng đến profile của chính mình bằng ID
        window.location.href = `/get_my_profile_url`;
    } else {
        // Fallback: quay lại trang chat
        console.log('No current user ID found, redirecting to chat');
        window.location.href = '/chat';
    }
}
/**
 * Khởi tạo nút trở về - HÀM MỚI
 */
function initializeBackButton() {
    const backToMyProfileBtn = document.getElementById('back-to-my-profile-btn');
    
    if (backToMyProfileBtn) {
        backToMyProfileBtn.addEventListener('click', handleBackToMyProfile);
        console.log('Back button initialized successfully');
    }
}
// ==================== KHỞI TẠO ỨNG DỤNG ====================
/**
 * Khởi tạo tất cả event listeners cho trang profile - PHIÊN BẢN ĐÃ SỬA
 */
/**
 * Khởi tạo tất cả event listeners cho trang profile - PHIÊN BẢN ĐÃ SỬA
 */
function initializeProfilePage() {
    console.log('🎯 Initializing profile page...');
    
    try {
        // 1. Khởi tạo socket (không bắt buộc)
        try {
            initializeSocket();
        } catch (socketError) {
            console.warn('Socket initialization failed, continuing without socket:', socketError);
        }
        
        // 2. Khởi tạo side navigation đầu tiên
        initializeSideNavigation();
        
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
        
        // 4. Nếu đang xem profile của người khác, gắn listeners cho nút bạn bè
        if (userId !== currentUserId) {
            attachFriendActionListeners(userId);
        }
        
        // 5. Khởi tạo carousels
        initializeCarousels();
        
        // 6. CHỈ TẢI BẠN BÈ VÀ ẢNH CHO CHÍNH NGƯỜI DÙNG
        if (userId === currentUserId) {
            console.log('💼 Loading data for own profile');
            loadUserFriends(userId);
            loadRecentPhotos(userId);
            
            // QUAN TRỌNG: Khởi tạo profile editor với debug
            console.log('🔧 Initializing profile editor for current user...');
            setTimeout(() => {
                initializeProfileEditorWithDebug();
            }, 500); // Delay để đảm bảo DOM đã sẵn sàng
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
        
        // 10. Khởi tạo nút back (nếu có)
        initializeBackButton();
        
        console.log('✅ Profile page initialization completed');
        
    } catch (error) {
        console.error('❌ Error initializing profile page:', error);
        showNotification('Lỗi khi tải trang. Vui lòng tải lại trang.', 'error');
    }
}
/**
 * Gắn sự kiện cho like, comment - ĐÃ SỬA
 */
function attachPostInteractionListeners() {
    // Gắn sự kiện cho nút like - AN TOÀN
    document.querySelectorAll('.like-btn').forEach(btn => {
        if (btn.dataset.postId && !btn.hasAttribute('data-listener-attached')) {
            btn.setAttribute('data-listener-attached', 'true');
            btn.addEventListener('click', (e) => {
                const postId = btn.dataset.postId;
                console.log('Like button clicked for post:', postId);
                likePost(postId);
            });
        }
    });

    // Gắn sự kiện cho nút toggle comments - AN TOÀN
    document.querySelectorAll('.comment-toggle').forEach(btn => {
        if (btn.dataset.postId && !btn.hasAttribute('data-listener-attached')) {
            btn.setAttribute('data-listener-attached', 'true');
            btn.addEventListener('click', (e) => {
                const postId = btn.dataset.postId;
                console.log('Toggle comments for post:', postId);
                toggleComments(postId);
            });
        }
    });

    // Gắn sự kiện cho input comment (Enter để gửi) - AN TOÀN
    document.querySelectorAll('.comment-input').forEach(input => {
        if (input.dataset.postId && !input.hasAttribute('data-listener-attached')) {
            input.setAttribute('data-listener-attached', 'true');
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const postId = input.dataset.postId;
                    console.log('Enter pressed for comment on post:', postId);
                    addComment(postId);
                }
            });
        }
    });

    // Gắn sự kiện cho nút submit comment - AN TOÀN
    document.querySelectorAll('.comment-submit-btn').forEach(btn => {
        if (btn.dataset.postId && !btn.hasAttribute('data-listener-attached')) {
            btn.setAttribute('data-listener-attached', 'true');
            btn.addEventListener('click', (e) => {
                const postId = btn.dataset.postId;
                console.log('Submit comment for post:', postId);
                addComment(postId);
            });
        }
    });
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
            updateFriendButtonUI(targetUserId, 'pending');
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
        case 'pending':
            friendActions.innerHTML = `
                <button class="btn btn-outline" disabled>
                    <i class="fas fa-clock"></i>
                    Đã gửi lời mời
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
                <i class="fi fi-rr-users-add"></i>
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
    
    // XỬ LÝ NÚT BACK RIÊNG
    const backToMyProfileBtn = document.getElementById('back-to-my-profile-btn');
    if (backToMyProfileBtn) {
        backToMyProfileBtn.replaceWith(backToMyProfileBtn.cloneNode(true));
        const newBackBtn = document.getElementById('back-to-my-profile-btn');
        newBackBtn.addEventListener('click', handleBackToMyProfile);
    }
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
                     alt="${friend.username}" 
                     class="friend-avatar"
                     onerror="this.src='/static/img/default-avatar.png'">
                ${friend.online ? '<div class="friend-online-status"></div>' : ''}
            </div>
            <span class="friend-name" title="${friend.username}">
                ${friend.username.length > 10 ? friend.username.substring(0, 10) + '...' : friend.username}
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
            <img src="${photo.url}" 
                 alt="Recent photo" 
                 class="photo-thumbnail"
                 onerror="this.src='/static/img/default-image.png'">
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
                                 alt="${friend.username}" 
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
    // Có thể implement modal hiển thị tất cả bạn bè
    alert('Tính năng xem tất cả bạn bè đang được phát triển');
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
    // Có thể implement modal xem ảnh lớn
    alert(`Xem ảnh trong bài viết ${postId}`);
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
            console.error('Edit profile button not found!');
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
     * Đóng modal
     */
    closeModal() {
        if (this.modal) {
            this.modal.style.display = 'none';
            document.body.style.overflow = '';
        }
        this.currentAvatar = null;
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
            'edit-gender': user.gender || 'male'
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

        // Get form data
        const formData = {
            full_name: document.getElementById('edit-full-name').value,
            username: document.getElementById('edit-username').value,
            email: document.getElementById('edit-email').value,
            phone: document.getElementById('edit-phone').value,
            dob: document.getElementById('edit-dob').value,
            gender: document.getElementById('edit-gender').value,
            avatar: this.currentAvatar // Use the stored avatar (could be base64 or URL)
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
            console.log('Updating profile with data:', { ...formData, avatar: '...' });
            
            const response = await fetch('/update_profile', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });

            const result = await response.json();
            
            if (response.ok) {
                // Update UI
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
// ==================== CAROUSEL FUNCTIONS ====================

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
    
    // Chỉ mở viewer nếu không phải từ nút điều hướng
    if (event) {
        const target = event.target;
        // Kiểm tra nếu click từ nút điều hướng hoặc indicators thì không mở viewer
        if (target.closest('.carousel-nav') || 
            target.closest('.carousel-indicators') ||
            target.closest('.carousel-btn') ||
            target.closest('.carousel-indicator')) {
            console.log('Click from navigation, skipping viewer');
            return;
        }
    }
    
    const carousel = document.querySelector(`[data-post-id="${postId}"] .post-media-carousel`);
    if (!carousel) {
        console.error(`Carousel not found for post: ${postId}`);
        return;
    }
    
    const slides = carousel.querySelectorAll('.carousel-slide');
    const mediaUrls = [];
    
    // Thu thập thông tin media
    slides.forEach((slide, index) => {
        const img = slide.querySelector('img');
        const video = slide.querySelector('video');
        
        if (img) {
            mediaUrls.push({
                type: 'image',
                url: img.src,
                alt: img.alt || 'Post image',
                index: index
            });
        } else if (video) {
            const source = video.querySelector('source');
            if (source) {
                mediaUrls.push({
                    type: 'video',
                    url: source.src,
                    alt: 'Post video',
                    index: index
                });
            }
        }
    });
    
    if (mediaUrls.length === 0) {
        console.warn('No media found for viewer');
        return;
    }
    
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

function viewerPrev() {
    if (!window.currentMediaViewer) return;
    
    if (window.currentMediaViewer.currentIndex > 0) {
        window.currentMediaViewer.currentIndex--;
        updateViewerContent();
    }
}

function viewerNext() {
    if (!window.currentMediaViewer) return;
    
    if (window.currentMediaViewer.currentIndex < window.currentMediaViewer.mediaUrls.length - 1) {
        window.currentMediaViewer.currentIndex++;
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
 * Đóng media viewer
 */
function closeMediaViewer() {
    const modal = document.getElementById('media-viewer-modal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
    window.currentMediaViewer = null;
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
// Thêm các hàm mới
window.handleUnfriend = handleUnfriend;
window.handleAddFriend = handleAddFriend;
window.updateFriendButtonUI = updateFriendButtonUI;
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
console.log('Profile JS loaded successfully');
// Export functions
window.SideNavigation = SideNavigation;
window.initializeSideNavigation = initializeSideNavigation;

// Khởi tạo khi DOM ready
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM fully loaded, initializing side navigation...');
    initializeSideNavigation();
});