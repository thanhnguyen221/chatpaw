// app/static/js/profile.js

// ==================== CÁC HÀM TOÀN CỤC ====================

let likeProcessing = false;
let commentProcessing = false;
let postProcessing = false;


function showNotification(message, type = 'info') {
    // Tạo element thông báo
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <i class="fas fa-${type === 'success' ? 'check' : 'info'}-circle"></i>
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
            }
            .notification-success {
                border-left-color: #28a745;
            }
            .notification-error {
                border-left-color: #dc3545;
            }
            .notification-content {
                display: flex;
                align-items: center;
                gap: 10px;
            }
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(styles);
    }
    
    document.body.appendChild(notification);
    
    // Tự động xóa sau 3 giây
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 3000);
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
            } else {
                likeBtn.classList.remove('liked');
                likeBtn.innerHTML = '<i class="fas fa-heart"></i> Thích';
            }
            
            // Cập nhật số lượng like - AN TOÀN
            if (likeCount) {
                likeCount.textContent = result.like_count || '0';
            }
            
            console.log(`Like action successful: ${result.liked ? 'liked' : 'unliked'}`);
        } else {
            console.error('Like failed:', result.error);
            likeBtn.innerHTML = originalHTML;
            alert(result.error || 'Lỗi khi thích bài viết');
        }
    } catch (error) {
        console.error('Like error:', error);
        // Khôi phục trạng thái nút
        const postElement = document.querySelector(`[data-post-id="${postId}"]`);
        if (postElement) {
            const likeBtn = postElement.querySelector('.like-btn');
            if (likeBtn) {
                likeBtn.innerHTML = '<i class="fas fa-heart"></i> Thích';
            }
        }
        alert('Lỗi kết nối, vui lòng thử lại');
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
            
            console.log('Comment added successfully');
        } else {
            alert(result.error || 'Lỗi khi bình luận');
        }
    } catch (error) {
        console.error('Comment error:', error);
        alert('Lỗi kết nối khi bình luận');
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

// ==================== CLASS PROFILE MANAGER ====================

class ProfileManager {
    constructor() {
        this.currentMedia = [];
        this.isInitialized = false;
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
        const addVideoBtn = document.getElementById('add-video-btn');
        const mediaUpload = document.getElementById('media-upload');
        const submitPost = document.getElementById('submit-post');
        const postContent = document.getElementById('post-content');

        if (addImageBtn) {
            addImageBtn.addEventListener('click', () => this.openMediaUpload());
            console.log('Add image button listener attached');
        } else {
            console.warn('Add image button not found');
        }
        
        if (addVideoBtn) {
            addVideoBtn.addEventListener('click', () => this.openMediaUpload());
            console.log('Add video button listener attached');
        } else {
            console.warn('Add video button not found');
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
            alert('Ảnh bìa không được vượt quá 5MB');
            return;
        }

        // Kiểm tra loại file
        if (!file.type.match('image.*')) {
            alert('Vui lòng chọn file ảnh');
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
                this.showNotification('Cập nhật ảnh bìa thành công!', 'success');
                console.log('Cover photo updated successfully');
            } else {
                alert(result.error || 'Lỗi khi cập nhật ảnh bìa');
            }
        } catch (error) {
            console.error('Cover photo upload error:', error);
            alert('Lỗi khi cập nhật ảnh bìa');
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
     * Mở dialog chọn media
     */
    openMediaUpload() {
        const mediaUpload = document.getElementById('media-upload');
        if (mediaUpload) {
            mediaUpload.click();
            console.log('Media upload dialog opened');
        } else {
            console.error('Media upload input not found');
        }
    }

    /**
     * Xử lý upload media
     */
    async handleMediaUpload(event) {
        const files = Array.from(event.target.files);
        if (!files.length) {
            console.log('No files selected for media upload');
            return;
        }

        console.log(`Processing ${files.length} media files`);

        // Kiểm tra số lượng file
        if (files.length + this.currentMedia.length > 10) {
            alert('Bạn chỉ có thể upload tối đa 10 file');
            return;
        }

        const formData = new FormData();
        files.forEach(file => {
            formData.append('media', file);
        });

        try {
            const response = await fetch('/upload_post_media', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            if (result.success) {
                this.currentMedia = [...this.currentMedia, ...result.media_urls];
                this.updateMediaPreview();
                console.log('Media uploaded successfully:', result.media_urls.length);
            } else {
                alert(result.error || 'Lỗi khi tải lên media');
            }
        } catch (error) {
            console.error('Upload error:', error);
            alert('Lỗi khi tải lên media');
        }

        // Reset input
        event.target.value = '';
    }

    /**
     * Cập nhật preview media
     */
    updateMediaPreview() {
        const preview = document.getElementById('media-preview');
        if (!preview) {
            console.error('Media preview element not found');
            return;
        }

        preview.innerHTML = '';

        this.currentMedia.forEach((media, index) => {
            const mediaElement = document.createElement('div');
            mediaElement.className = 'media-preview-item';
            
            if (media.type === 'image') {
                mediaElement.innerHTML = `
                    <img src="${media.url}" alt="Preview" onerror="this.src='/static/img/default-image.png'">
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
                const index = parseInt(e.target.closest('.remove-media').dataset.index);
                this.removeMedia(index);
            });
        });

        // Hiển thị preview nếu có media
        if (this.currentMedia.length > 0) {
            preview.style.display = 'block';
        } else {
            preview.style.display = 'none';
        }

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
        } else {
            console.error(`Invalid media index: ${index}`);
        }
    }

    /**
     * Tạo bài viết mới
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
            alert('Vui lòng nhập nội dung hoặc thêm media');
            postProcessing = false;
            return;
        }

        const originalHTML = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang đăng...';

        try {
            console.log('Creating post...', { content, mediaCount: this.currentMedia.length });
            
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
                this.showNotification('Đăng bài thành công!', 'success');
                
                console.log('Post created successfully, reloading page...');
                
                // Reload trang sau 1 giây
                setTimeout(() => {
                    location.reload();
                }, 1000);
            } else {
                alert(result.error || 'Lỗi khi đăng bài');
            }
        } catch (error) {
            console.error('Create post error:', error);
            alert('Lỗi khi đăng bài');
        } finally {
            postProcessing = false;
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalHTML;
        }
    }

    /**
     * Hiển thị thông báo
     */
    showNotification(message, type = 'info') {
        // Tạo element thông báo
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <i class="fas fa-${type === 'success' ? 'check' : 'info'}-circle"></i>
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
                }
                .notification-success {
                    border-left-color: #28a745;
                }
                .notification-error {
                    border-left-color: #dc3545;
                }
                .notification-content {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }
                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
            `;
            document.head.appendChild(styles);
        }
        
        document.body.appendChild(notification);
        
        // Tự động xóa sau 3 giây
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 3000);
    }
}

// ==================== KHỞI TẠO ỨNG DỤNG ====================
/**
 * Khởi tạo tất cả event listeners cho trang profile
 */
function initializeProfilePage() {
    console.log('Initializing profile page...');
    
    // Ẩn tất cả sections bình luận (nếu chưa được ẩn)
    document.querySelectorAll('.comments-section').forEach(section => {
        if (section.style.display !== 'none') {
            section.style.display = 'none';
        }
    });
    
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

    console.log('Profile page initialization completed');
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
            alert(result.error || 'Lỗi khi tải bài viết');
        }
    } catch (error) {
        console.error('Error opening edit modal:', error);
        alert('Lỗi khi tải bài viết');
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
        alert('Vui lòng nhập nội dung bài viết');
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
            // SỬA: Dùng hàm toàn cục
            showNotification('Cập nhật bài viết thành công!', 'success');
        } else {
            alert(result.error || 'Lỗi khi cập nhật bài viết');
        }
    } catch (error) {
        console.error('Error editing post:', error);
        alert('Lỗi khi cập nhật bài viết');
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
            
            // SỬA: Dùng hàm toàn cục
            showNotification('Xóa bài viết thành công!', 'success');
            
            // Cập nhật số lượng bài viết
            updatePostCount(-1);
        } else {
            alert(result.error || 'Lỗi khi xóa bài viết');
        }
    } catch (error) {
        console.error('Error deleting post:', error);
        alert('Lỗi khi xóa bài viết');
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
// ==================== EVENT LISTENERS ====================
initializePostEditDeleteListeners();
// Khởi tạo khi DOM ready - CHỈ GỌI MỘT LẦN
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        console.log('DOM fully loaded, initializing profile page...');
        initializeProfilePage();
    });
} else {
    // DOM đã sẵn sàng
    console.log('DOM already ready, initializing profile page...');
    setTimeout(initializeProfilePage, 100);
}
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

console.log('Profile JS loaded successfully');