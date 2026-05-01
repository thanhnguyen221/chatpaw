// app/static/js/shared/share_modal.js
// ==================== MODAL CHIA SẺ BÀI VIẾT ====================

class ShareModal {
    constructor() {
        this.currentPost = null;
        this.init();
    }

    init() {
        // Thêm CSS cho modal
        this.addStyles();
        console.log('ShareModal initialized');
    }

    /**
     * Mở modal chia sẻ bài viết
     */
    //

    async openShareToProfile(postId) {
        try {
            console.log('Opening share to profile modal for post:', postId);
            
            if (!postId) {
                throw new Error('Post ID is required');
            }
            
            const response = await fetch(`/api/post/${postId}`);
            
            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error('Bài viết không tồn tại');
                } else if (response.status === 403) {
                    throw new Error('Bạn không có quyền xem bài viết này');
                } else if (response.status === 401) {
                    throw new Error('Vui lòng đăng nhập lại');
                } else {
                    throw new Error(`Lỗi server: ${response.status}`);
                }
            }
            
            const result = await response.json();
            console.log('API Response:', result);

            if (!result.success) {
                throw new Error(result.error || 'Không thể tải bài viết');
            }

            if (!result.post) {
                throw new Error('Dữ liệu bài viết trống');
            }
            
            this.currentPost = result.post;
            this.showModal();
            
        } catch (error) {
            console.error('Error opening share modal:', error);
            
            // Hiển thị thông báo lỗi thân thiện hơn
            let errorMessage = error.message;
            if (error.message.includes('fetch')) {
                errorMessage = 'Lỗi kết nối mạng. Vui lòng kiểm tra lại kết nối.';
            }
            
            showNotification(errorMessage, 'error');
        }
    }

    /**
     * Hiển thị modal
     */
    showModal() {
        // --- SỬA LỖI: Chỉ xóa HTML modal cũ, KHÔNG gọi this.closeModal() ---
        // Vì this.closeModal() sẽ set this.currentPost = null làm mất dữ liệu
        const oldModal = document.getElementById('share-to-profile-modal');
        if (oldModal) {
            oldModal.remove();
        }
        // ------------------------------------------------------------------

        // --- DEBUG: Kiểm tra dữ liệu ---
        console.log('Dữ liệu post để share (Fixed):', this.currentPost);

        if (!this.currentPost) {
            showNotification('Lỗi dữ liệu bài viết', 'error');
            return;
        }

        // Xử lý dữ liệu an toàn
        const owner = this.currentPost.owner_info || {};
        const ownerName = owner.full_name || owner.username || 'Người dùng';
        const ownerAvatar = owner.avatar || '/static/img/default-avatar.png';
        
        const likes = this.currentPost.like_count || (this.currentPost.likes ? this.currentPost.likes.length : 0);
        const comments = this.currentPost.comment_count || 0;
        const shares = this.currentPost.shares || 0;

        // Tạo modal HTML (Phần này giữ nguyên như code cũ)
        const modalHTML = `
            <div class="share-to-profile-modal active" id="share-to-profile-modal">
                <div class="modal-overlay" onclick="window.shareModal?.closeModal()"></div>
                <div class="modal-container">
                    <div class="modal-header">
                        <h3 class="modal-title">
                            <i class="fas fa-share-alt"></i>
                            Chia sẻ bài viết
                        </h3>
                        <button class="modal-close" onclick="window.shareModal?.closeModal()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>

                    <div class="modal-body">
                        <div class="post-preview">
                            <div class="post-preview-header">
                                <img src="${ownerAvatar}" 
                                     alt="${ownerName}"
                                     class="preview-avatar">
                                <div class="preview-author">
                                    <div class="preview-name">${ownerName}</div>
                                    <div class="preview-time">Bài viết gốc</div>
                                </div>
                            </div>
                            
                            <div class="preview-content">
                                ${this.formatPostContent(this.currentPost.content)}
                            </div>
                            
                            ${this.currentPost.media_urls && this.currentPost.media_urls.length > 0 ? 
                                this.createMediaPreview(this.currentPost.media_urls) : ''}
                            
                            <div class="preview-stats">
                                <span class="stat-item">
                                    <i class="fas fa-heart"></i> ${likes}
                                </span>
                                <span class="stat-item">
                                    <i class="fas fa-comment"></i> ${comments}
                                </span>
                                <span class="stat-item">
                                    <i class="fas fa-share"></i> ${shares}
                                </span>
                            </div>
                        </div>

                        <div class="share-form">
                            <div class="share-header">
                                <img src="${window.currentUser?.avatar || '/static/img/default-avatar.png'}" 
                                     alt="Avatar" 
                                     class="share-avatar">
                                <div class="share-user">
                                    <div class="share-username">${window.currentUser?.full_name || window.currentUser?.username || 'Bạn'}</div>
                                    <div class="share-label">đang chia sẻ bài viết này</div>
                                </div>
                            </div>
                            
                            <div class="share-input-container">
                                <textarea class="share-input" 
                                          id="share-content"
                                          placeholder="Bạn muốn nói gì về bài viết này?"
                                          rows="4"></textarea>
                                <div class="share-input-counter">
                                    <span id="char-count">0</span>/500
                                </div>
                            </div>

                            <div class="privacy-options">
                                <div class="privacy-label">
                                    <i class="fas fa-globe-asia"></i>
                                    Ai có thể xem bài viết này?
                                </div>
                                <div class="privacy-buttons">
                                    <button class="privacy-btn active" data-privacy="public">
                                        <i class="fas fa-globe"></i>
                                        Công khai
                                    </button>
                                    <button class="privacy-btn" data-privacy="friends">
                                        <i class="fas fa-user-friends"></i>
                                        Bạn bè
                                    </button>
                                    <button class="privacy-btn" data-privacy="only_me">
                                        <i class="fas fa-lock"></i>
                                        Chỉ mình tôi
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="modal-footer">
                        <button class="btn btn-outline" onclick="window.shareModal?.closeModal()">
                            <i class="fas fa-times"></i>
                            Hủy
                        </button>
                        <button class="btn btn-primary" onclick="window.shareModal?.submitShare()">
                            <i class="fas fa-paper-plane"></i>
                            Chia sẻ ngay
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
        this.initEvents();
        setTimeout(() => {
            const textarea = document.getElementById('share-content');
            if(textarea) textarea.focus();
        }, 100);
    }
    /**
     * Format nội dung bài viết
     */
    formatPostContent(content) {
        if (!content) return '';
        
        // Xử lý xuống dòng
        const formatted = content
            .replace(/\n/g, '<br>')
            .replace(/https?:\/\/[^\s]+/g, '<a href="$&" target="_blank">$&</a>')
            .replace(/#([^\s#]+)/g, '<span class="hashtag">#$1</span>');
            
        return `<div class="post-content-text">${formatted}</div>`;
    }

    /**
     * Tạo preview cho media
     */
    createMediaPreview(mediaUrls) {
        if (!mediaUrls || mediaUrls.length === 0) return '';
        
        let previewHTML = '<div class="preview-media">';
        
        if (mediaUrls.length === 1) {
            const media = mediaUrls[0];
            const mediaUrl = typeof media === 'string' ? media : media.url;
            const mediaType = typeof media === 'string' 
                ? (mediaUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? 'image' : 'video')
                : (media.type || 'image');
                
            if (mediaType === 'image') {
                previewHTML += `
                    <img src="${mediaUrl}" 
                         alt="Post media" 
                         class="preview-media-single"
                         onload="this.style.opacity='1'"
                         onerror="this.style.display='none'">
                `;
            } else {
                previewHTML += `
                    <div class="preview-video">
                        <video src="${mediaUrl}" controls preload="metadata"></video>
                        <div class="video-overlay">
                            <i class="fas fa-play-circle"></i>
                        </div>
                    </div>
                `;
            }
        } else {
            previewHTML += '<div class="preview-media-grid">';
            mediaUrls.slice(0, 4).forEach((media, index) => {
                const mediaUrl = typeof media === 'string' ? media : media.url;
                const mediaType = typeof media === 'string' 
                    ? (mediaUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? 'image' : 'video')
                    : (media.type || 'image');
                    
                const extraCount = mediaUrls.length > 4 && index === 3 
                    ? `<div class="media-extra-count">+${mediaUrls.length - 4}</div>` 
                    : '';
                
                previewHTML += `
                    <div class="media-grid-item">
                        ${mediaType === 'image' 
                            ? `<img src="${mediaUrl}" alt="Media ${index + 1}" onerror="this.style.display='none'">`
                            : `<div class="media-video"><i class="fas fa-play"></i></div>`
                        }
                        ${extraCount}
                    </div>
                `;
            });
            previewHTML += '</div>';
        }
        
        previewHTML += '</div>';
        return previewHTML;
    }

    /**
     * Khởi tạo events
     */
    initEvents() {
        const textarea = document.getElementById('share-content');
        const charCount = document.getElementById('char-count');
        
        // Đếm ký tự
        if (textarea && charCount) {
            textarea.addEventListener('input', () => {
                const length = textarea.value.length;
                charCount.textContent = length;
                
                if (length > 500) {
                    charCount.style.color = '#e74c3c';
                    textarea.style.borderColor = '#e74c3c';
                } else {
                    charCount.style.color = '#666';
                    textarea.style.borderColor = '#e0e0e0';
                }
            });
        }
        
        // Quyền riêng tư
        const privacyBtns = document.querySelectorAll('.privacy-btn');
        privacyBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                privacyBtns.forEach(b => b.classList.remove('active'));
                // Dùng currentTarget để đảm bảo luôn là button, không phải icon bên trong
                e.currentTarget.classList.add('active');
            });
        });
        
        // Đóng modal bằng ESC
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeModal();
            }
        });
    }

    /**
     * Submit chia sẻ
     */
    async submitShare() {
        const content = document.getElementById('share-content')?.value.trim() || '';
        const privacyBtn = document.querySelector('.privacy-btn.active');
        const privacy = privacyBtn ? privacyBtn.dataset.privacy : 'public';
        
        if (content.length > 500) {
            showNotification('Nội dung không được vượt quá 500 ký tự', 'error');
            return;
        }
        
        const submitBtn = document.querySelector('.modal-footer .btn-primary');
        if (!submitBtn) return;
        
        // Lưu icon và text ban đầu
        const icon = submitBtn.querySelector('i');
        const text = submitBtn.lastChild;
        const originalIcon = icon ? icon.className : '';
        const originalText = text ? text.textContent : '';
        
        submitBtn.disabled = true;
        
        // Chỉ thay đổi icon và text, không thay đổi toàn bộ HTML
        if (icon) icon.className = 'fas fa-spinner fa-spin';
        if (text) text.textContent = ' Đang chia sẻ...';
        
        try {
            const response = await fetch('/share_post', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    post_id: this.currentPost._id,
                    content: content,
                    share_type: 'profile',
                    privacy: privacy
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                showNotification('Đã chia sẻ bài viết về trang cá nhân!', 'success');
                this.closeModal();
                
                // Reload trang sau 1.5 giây
                setTimeout(() => {
                    if (window.location.pathname.includes('/profile')) {
                        window.location.reload();
                    }
                }, 1500);
            } else {
                throw new Error(result.error || 'Lỗi khi chia sẻ');
            }
            
        } catch (error) {
            console.error('Share error:', error);
            showNotification(error.message || 'Lỗi khi chia sẻ bài viết', 'error');
        } finally {
            submitBtn.disabled = false;
            // Restore icon và text
            if (icon) icon.className = originalIcon;
            if (text) text.textContent = originalText;
        }
    }

    ///

    /**
     * Đóng modal
     */
    closeModal() {
        // 1. Đóng modal chi tiết (Modal to)
        const modal = document.getElementById('share-to-profile-modal');
        if (modal) {
            modal.remove();
        }

        // 2. [THÊM MỚI] Đóng luôn các menu lựa chọn (Modal nhỏ) nếu còn sót
        const shareMenus = document.querySelectorAll('.share-menu-modal');
        shareMenus.forEach(menu => menu.remove());
        
        // Hoặc gọi hàm helper từ profile.js nếu có (để chắc chắn)
        if (typeof window.closeShareMenu === 'function') {
            window.closeShareMenu(); 
        }

        // Reset dữ liệu
        this.currentPost = null;
    }
    /**
     * Thêm CSS cho modal
     */
    addStyles() {
        if (document.getElementById('share-modal-styles')) return;
        
        const styles = document.createElement('style');
        styles.id = 'share-modal-styles';
        styles.textContent = `
            /* Modal Container */
            .share-to-profile-modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                z-index: 10000;
                display: none;
            }
            
            .share-to-profile-modal.active {
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .modal-overlay {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.5);
                backdrop-filter: blur(3px);
            }
            
            .modal-container {
                position: relative;
                background: white;
                border-radius: 16px;
                width: 95%;
                max-width: 500px;
                max-height: 90vh;
                display: flex;
                flex-direction: column;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                animation: modalSlideUp 0.3s ease;
                z-index: 10001;
            }
            
            @keyframes modalSlideUp {
                from {
                    opacity: 0;
                    transform: translateY(30px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
            
            /* Modal Header */
            .modal-header {
                padding: 20px 24px;
                border-bottom: 1px solid #e0e0e0;
                display: flex;
                align-items: center;
                justify-content: space-between;
                flex-shrink: 0;
            }
            
            .modal-title {
                margin: 0;
                font-size: 18px;
                font-weight: 600;
                color: #333;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            
            .modal-title i {
                color: #27ae60; 
            }
            
            .modal-close {
                background: none;
                border: none;
                width: 36px;
                height: 36px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                color: #666;
                transition: all 0.2s;
            }
            
            .modal-close:hover {
                background: #f5f5f5;
                color: #27ae60;
            }
            
            /* Modal Body */
            .modal-body {
                padding: 24px;
                overflow-y: auto;
                flex: 1;
            }
            
            /* Post Preview */
            .post-preview {
                background: #f8f9fa;
                border-radius: 12px;
                padding: 16px;
                margin-bottom: 24px;
                border: 1px solid #e9ecef;
            }
            
            .post-preview-header {
                display: flex;
                align-items: center;
                gap: 12px;
                margin-bottom: 12px;
            }
            
            .preview-avatar {
                width: 40px;
                height: 40px;
                border-radius: 50%;
                object-fit: cover;
                border: 2px solid white;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            
            .preview-author {
                flex: 1;
            }
            
            .preview-name {
                font-weight: 600;
                color: #333;
                font-size: 14px;
            }
            
            .preview-time {
                font-size: 12px;
                color: #666;
                margin-top: 2px;
            }
            
            .preview-content {
                margin-bottom: 12px;
            }
            
            .post-content-text {
                font-size: 14px;
                line-height: 1.5;
                color: #333;
            }
            
            .post-content-text a {
                color: #3eb489;
                text-decoration: none;
            }
            
            .post-content-text .hashtag {
                color: #3eb489;
                font-weight: 500;
            }
            
            /* Media Preview */
            .preview-media {
                margin-bottom: 12px;
            }
            
            .preview-media-single {
                width: 100%;
                max-height: 200px;
                object-fit: cover;
                border-radius: 8px;
                opacity: 0;
                transition: opacity 0.3s;
            }
            
            .preview-video {
                position: relative;
                border-radius: 8px;
                overflow: hidden;
            }
            
            .preview-video video {
                width: 100%;
                max-height: 200px;
                object-fit: cover;
                border-radius: 8px;
            }
            
            .video-overlay {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                background: rgba(0, 0, 0, 0.2);
            }
            
            .video-overlay i {
                font-size: 48px;
                color: white;
                opacity: 0.8;
            }
            
            .preview-media-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 4px;
                border-radius: 8px;
                overflow: hidden;
            }
            
            .media-grid-item {
                position: relative;
                aspect-ratio: 1;
                overflow: hidden;
            }
            
            .media-grid-item img {
                width: 100%;
                height: 100%;
                object-fit: cover;
            }
            
            .media-video {
                width: 100%;
                height: 100%;
                background: #333;
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
            }
            
            .media-extra-count {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.6);
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-size: 20px;
                font-weight: bold;
            }
            
            /* Post Stats */
            .preview-stats {
                display: flex;
                gap: 16px;
                padding-top: 12px;
                border-top: 1px solid #e0e0e0;
            }
            
            .stat-item {
                display: flex;
                align-items: center;
                gap: 6px;
                font-size: 13px;
                color: #666;
            }
            
            .stat-item i {
                color: #666;
            }
            
            /* Share Form */
            .share-form {
                margin-top: 24px;
            }
            
            .share-header {
                display: flex;
                align-items: center;
                gap: 12px;
                margin-bottom: 16px;
            }
            
            .share-avatar {
                width: 40px;
                height: 40px;
                border-radius: 50%;
                object-fit: cover;
                border: 2px solid #27ae60;
            }
            
            .share-user {
                flex: 1;
            }
            
            .share-username {
                font-weight: 600;
                color: #333;
                font-size: 14px;
            }
            
            .share-label {
                font-size: 12px;
                color: #666;
                margin-top: 2px;
            }
            
            /* Share Input */
            .share-input-container {
                position: relative;
                margin-bottom: 20px;
            }
            
            .share-input {
                width: 100%;
                padding: 14px;
                border: 1px solid #e0e0e0;
                border-radius: 12px;
                font-size: 14px;
                line-height: 1.5;
                resize: none;
                transition: border-color 0.2s;
                font-family: inherit;
            }
            
            .share-input:focus {
                outline: none;
                border-color: #27ae60;
                box-shadow: 0 0 0 3px rgba(39, 174, 96, 0.1);
            }
            
            .share-input-counter {
                position: absolute;
                bottom: 8px;
                right: 8px;
                font-size: 12px;
                color: #666;
                background: white;
                padding: 2px 6px;
                border-radius: 10px;
            }
            
            /* Privacy Options */
            .privacy-options {
                margin-top: 20px;
                padding-top: 20px;
                border-top: 1px solid #f0f0f0;
            }
            
            .privacy-label {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 13px;
                color: #666;
                margin-bottom: 12px;
            }
            
            .privacy-label i {
                color: #27ae60;
            }
            
            .privacy-buttons {
                display: flex;
                gap: 8px;
            }
            
            .privacy-btn {
                flex: 1;
                padding: 10px;
                border: 1px solid #e0e0e0;
                border-radius: 8px;
                background: white;
                font-size: 13px;
                color: #666;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                transition: all 0.2s;
            }
            
            .privacy-btn:hover {
                border-color: #27ae60;
                color: #27ae60;
            }
            
            .privacy-btn.active {
                background: #27ae60;
                border-color: #27ae60;
                color: white;
            }
            
            .privacy-btn.active i {
                color: white !important;
            }
            
            .privacy-btn i {
                font-size: 14px;
            }
            
            /* Modal Footer */
            .modal-footer {
                padding: 20px 24px;
                border-top: 1px solid #e0e0e0;
                display: flex;
                justify-content: flex-end;
                gap: 12px;
                flex-shrink: 0;
            }
            
            .btn {
                padding: 10px 20px;
                border-radius: 8px;
                font-weight: 500;
                font-size: 14px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
                transition: all 0.2s;
            }
            
            .btn-outline {
                background: white;
                border: 1px solid #e0e0e0;
                color: #666;
            }
            
            .btn-outline:hover {
                background: #f8f9fa;
                border-color: #ccc;
            }
            
            .btn-primary {
                background: linear-gradient(135deg, #27ae60, #229954);
                border: none;
                color: white;
                box-shadow: 0 2px 4px rgba(39, 174, 96, 0.3); 
            }
            
            .btn-primary:hover {
                background: linear-gradient(135deg, #229954, #1e8449);
                transform: translateY(-1px);
                box-shadow: 0 4px 8px rgba(39, 174, 96, 0.3);
            }
            
            .btn-primary:disabled {
                opacity: 0.6;
                cursor: not-allowed;
                transform: none;
            }
            
            /* Responsive */
            @media (max-width: 576px) {
                .modal-container {
                    width: 100%;
                    height: 100%;
                    max-height: 100%;
                    border-radius: 0;
                }
                
                .modal-body {
                    padding: 16px;
                }
                
                .preview-media-grid {
                    grid-template-columns: 1fr;
                }
                
                .privacy-buttons {
                    flex-direction: column;
                }
                
                .modal-footer {
                    padding: 16px;
                }
            }
            
            /* Scrollbar styling */
            .modal-body::-webkit-scrollbar {
                width: 6px;
            }
            
            .modal-body::-webkit-scrollbar-track {
                background: #f1f1f1;
                border-radius: 3px;
            }
            
            .modal-body::-webkit-scrollbar-thumb {
                background: #ccc;
                border-radius: 3px;
            }
            
            .modal-body::-webkit-scrollbar-thumb:hover {
                background: #999;
            }
        `;
        
        document.head.appendChild(styles);
    }
}

// ==================== KHỞI TẠO VÀ TÍCH HỢP ====================

// Khởi tạo modal toàn cục
window.shareModal = new ShareModal();

// Hàm gọi từ các nút chia sẻ
window.shareToProfile = async function(postId) {
    // Đóng modal cũ nếu có
    const oldModal = document.getElementById('share-to-profile-modal');
    if (oldModal) {
        oldModal.remove();
    }
    
    // Mở modal mới
    await window.shareModal.openShareToProfile(postId);
};

// Cập nhật hàm gắn sự kiện trong profile.js và post_detail.js
function attachShareEventListeners() {
    // Event delegation cho nút chia sẻ về profile
    document.addEventListener('click', async function(e) {
        // Nút chia sẻ trong menu
        const shareProfileBtn = e.target.closest('[onclick*="shareToProfile"]');
        if (shareProfileBtn) {
            e.preventDefault();
            e.stopPropagation();
            
            const postId = shareProfileBtn.dataset.postId || 
                          shareProfileBtn.dataset.id ||
                          shareProfileBtn.getAttribute('onclick').match(/'([^']+)'|"([^"]+)"|\(([^)]+)\)/)?.[1];
            
            if (postId) {
                await window.shareModal.openShareToProfile(postId);
            }
            return false;
        }
        
        // Nút chia sẻ trong share modal cũ
        if (e.target.classList.contains('share-option-btn') && 
            e.target.textContent.includes('Chia sẻ về trang cá nhân')) {
            const postId = e.target.closest('.share-modal')?.id?.replace('share-modal-', '');
            if (postId) {
                e.preventDefault();
                e.stopPropagation();
                await window.shareModal.openShareToProfile(postId);
                
                // Đóng modal cũ
                const oldModal = document.getElementById(`share-modal-${postId}`);
                if (oldModal) oldModal.remove();
                return false;
            }
        }
    });
}

// Gắn sự kiện khi DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachShareEventListeners);
} else {
    attachShareEventListeners();
}

// Export cho các file khác sử dụng
export { ShareModal };

// Gán hàm global để các file khác có thể gọi
window.shareToProfile = async function(postId) {
    // Đóng modal cũ nếu có
    const oldModal = document.getElementById('share-to-profile-modal');
    if (oldModal) {
        oldModal.remove();
    }
    
    // Mở modal mới
    await window.shareModal.openShareToProfile(postId);
};