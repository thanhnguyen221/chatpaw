// app/static/js/shared/post_interactions.js
// ==================== SHARED POST FUNCTIONS ====================

class PostInteractions {
    constructor() {
        this.isProcessing = false;
        this.socket = window.socket;
        this.initializeSocket();
    }

    initializeSocket() {
        // Sử dụng socket toàn cục hoặc tạo mới
        if (window.socket && window.socket.connected) {
            this.socket = window.socket;
        } else {
            this.socket = io({
                transports: ['websocket', 'polling'],
                reconnection: true
            });
        }
        
        this.setupSocketEvents();
    }

    setupSocketEvents() {
        if (!this.socket) return;

        // Lắng nghe sự kiện like từ server
        this.socket.on('post_liked_updated', (data) => {
            this.updatePostLikeUI(data.post_id, data.liked, data.like_count);
        });

        // Lắng nghe sự kiện comment từ server
        this.socket.on('new_comment_added', (data) => {
            if (window.location.pathname.includes('/post/')) {
                // Nếu đang ở trang chi tiết, thêm comment
                this.addCommentToDetailPage(data);
            } else {
                // Nếu đang ở profile, cập nhật comment count
                this.updateCommentCount(data.post_id, data.comment_count);
            }
        });
    }

    // ==================== LIKE FUNCTIONS ====================

    async likePost(postId) {
        if (this.isProcessing) return;
        this.isProcessing = true;

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
                // Gửi socket event để đồng bộ
                if (this.socket && this.socket.connected) {
                    this.socket.emit('post_liked', {
                        post_id: postId,
                        liked: data.liked,
                        like_count: data.like_count
                    });
                }

                // Cập nhật UI tùy theo trang
                this.updatePostLikeUI(postId, data.liked, data.like_count);
                
                this.showNotification(
                    data.liked ? 'Đã thích bài viết' : 'Đã bỏ thích bài viết',
                    'success'
                );
            } else {
                this.showNotification(data.error || 'Lỗi khi thích bài viết', 'error');
            }
        } catch (error) {
            console.error('Error liking post:', error);
            this.showNotification('Lỗi kết nối', 'error');
        } finally {
            this.isProcessing = false;
        }
    }

    updatePostLikeUI(postId, liked, likeCount) {
        // Cập nhật UI trên profile page
        const profileLikeBtn = document.querySelector(`[data-post-id="${postId}"] .like-btn`);
        if (profileLikeBtn) {
            profileLikeBtn.classList.toggle('liked', liked);
            const likeCountSpan = profileLikeBtn.querySelector('.like-count');
            if (likeCountSpan) {
                likeCountSpan.textContent = likeCount;
            }
        }

        // Cập nhật UI trên post detail page
        const detailLikeBtn = document.getElementById('like-btn');
        if (detailLikeBtn && detailLikeBtn.dataset.postId === postId) {
            detailLikeBtn.classList.toggle('liked', liked);
            detailLikeBtn.innerHTML = liked 
                ? '<i class="fas fa-heart"></i><span>Bỏ thích</span>'
                : '<i class="fas fa-heart"></i><span>Thích</span>';
            
            const detailLikeCount = document.getElementById('like-count');
            if (detailLikeCount) {
                detailLikeCount.textContent = likeCount;
            }
        }
    }

    // ==================== COMMENT FUNCTIONS ====================

    async addComment(postId, content, replyTo = null) {
        if (this.isProcessing) return;
        this.isProcessing = true;

        try {
            const commentData = {
                post_id: postId,
                content: content
            };

            if (replyTo) {
                commentData.reply_to = replyTo;
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
                // Gửi socket event
                if (this.socket && this.socket.connected) {
                    this.socket.emit('new_comment', {
                        post_id: postId,
                        comment: data.comment,
                        is_reply: !!replyTo,
                        reply_to: replyTo
                    });
                }

                // Cập nhật UI
                this.updateCommentUI(postId, data.comment, replyTo);
                
                this.showNotification('Đã thêm bình luận', 'success');
            } else {
                this.showNotification(data.error || 'Lỗi khi đăng bình luận', 'error');
            }
        } catch (error) {
            console.error('Error adding comment:', error);
            this.showNotification('Lỗi kết nối', 'error');
        } finally {
            this.isProcessing = false;
        }
    }

    updateCommentUI(postId, comment, replyTo) {
        // Xác định xem đang ở trang nào
        const isDetailPage = window.location.pathname.includes('/post/');
        
        if (isDetailPage) {
            // Thêm comment vào trang chi tiết
            this.addCommentToDetailPage(comment);
        } else {
            // Cập nhật số lượng comment trên profile
            this.updateCommentCountOnProfile(postId);
        }
    }

    addCommentToDetailPage(comment) {
        const commentsList = document.getElementById('comments-list');
        if (!commentsList) return;

        // Tạo element comment mới
        const commentElement = this.createCommentElement(comment);
        
        // Xóa thông báo "chưa có bình luận"
        const noComments = commentsList.querySelector('.no-comments');
        if (noComments) {
            noComments.remove();
        }

        // Thêm vào đầu danh sách
        commentsList.insertBefore(commentElement, commentsList.firstChild);

        // Cập nhật số lượng
        this.updateCommentCountOnDetailPage();
    }

    createCommentElement(comment) {
        // Tạo element comment (giống như trong post_detail.js)
        const commentItem = document.createElement('div');
        commentItem.className = 'comment-item';
        commentItem.dataset.commentId = comment.id;

        // Format thời gian
        const commentTime = comment.created_at ? 
            new Date(comment.created_at) : new Date();
        const timeAgo = this.getTimeAgo(commentTime);

        // Xử lý avatar
        let avatarUrl = comment.user_avatar;
        if (avatarUrl && !avatarUrl.startsWith('http') && !avatarUrl.startsWith('/static')) {
            avatarUrl = `/static/${avatarUrl}`;
        } else if (!avatarUrl) {
            avatarUrl = '/static/img/default-avatar.png';
        }

        commentItem.innerHTML = `
            <img src="${avatarUrl}" alt="${comment.full_name || comment.username}" class="comment-avatar">
            <div class="comment-content">
                <div class="comment-header">
                    <strong>${comment.full_name || comment.username}</strong>
                    <span class="comment-time">${timeAgo}</span>
                </div>
                ${comment.reply_to ? '<div class="comment-reply-to">Trả lời <span class="reply-target">@' + (comment.reply_to_full_name || comment.reply_to_username || 'người dùng') + '</span></div>' : ''}
                <p class="comment-text">${this.escapeHtml(comment.content)}</p>
                <div class="comment-actions">
                    <button class="comment-action-btn like-comment-btn" data-comment-id="${comment.id}">
                        <i class="far fa-heart"></i>
                        <span class="comment-like-count">${comment.likes ? comment.likes.length : 0}</span>
                    </button>
                    <button class="comment-action-btn reply-comment-btn" data-comment-id="${comment.id}">
                        <i class="far fa-comment"></i> Trả lời
                    </button>
                </div>
            </div>
        `;

        return commentItem;
    }

    updateCommentCountOnProfile(postId) {
        const postElement = document.querySelector(`[data-post-id="${postId}"]`);
        if (!postElement) return;

        const commentCountSpan = postElement.querySelector('.comment-count');
        if (commentCountSpan) {
            const currentCount = parseInt(commentCountSpan.textContent) || 0;
            commentCountSpan.textContent = currentCount + 1;
        }
    }

    updateCommentCountOnDetailPage() {
        const commentCountElement = document.getElementById('comment-count');
        if (commentCountElement) {
            const currentCount = parseInt(commentCountElement.textContent) || 0;
            commentCountElement.textContent = currentCount + 1;
            
            // Cập nhật tiêu đề
            const commentTitle = document.querySelector('.comments-section h3');
            if (commentTitle) {
                commentTitle.textContent = `Bình luận (${currentCount + 1})`;
            }
        }
    }

    // ==================== SHARE FUNCTIONS ====================

    async sharePost(postId, shareType = 'profile', content = '', targetId = null) {
        try {
            const shareData = {
                post_id: postId,
                content: content,
                share_type: shareType
            };

            if (targetId) {
                shareData.target_id = targetId;
            }

            const response = await fetch('/share_post', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(shareData)
            });

            const data = await response.json();
            
            if (data.success) {
                this.showNotification('Đã chia sẻ bài viết', 'success');
                
                // Nếu chia sẻ về profile, reload sau 1.5 giây
                if (shareType === 'profile') {
                    setTimeout(() => {
                        if (!window.location.pathname.includes('/post/')) {
                            location.reload();
                        }
                    }, 1500);
                }
                
                return data;
            } else {
                this.showNotification(data.error || 'Lỗi khi chia sẻ', 'error');
                return null;
            }
        } catch (error) {
            console.error('Error sharing post:', error);
            this.showNotification('Lỗi kết nối khi chia sẻ', 'error');
            return null;
        }
    }

    // ==================== HELPER FUNCTIONS ====================

    showNotification(message, type = 'info') {
        // Sử dụng notification function từ profile.js nếu có
        if (window.showNotification) {
            window.showNotification(message, type);
            return;
        }

        // Fallback notification
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <i class="fas fa-${type === 'success' ? 'check' : type === 'error' ? 'exclamation-triangle' : 'info'}-circle"></i>
                <span>${message}</span>
            </div>
        `;

        // Thêm styles nếu chưa có
        if (!document.querySelector('#shared-notification-styles')) {
            const styles = document.createElement('style');
            styles.id = 'shared-notification-styles';
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

        // Tự động xóa sau 4 giây
        setTimeout(() => {
            notification.remove();
        }, 4000);
    }

    getTimeAgo(date) {
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

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ==================== INITIALIZATION ====================

    initialize() {
        // Gắn event listeners chung
        this.attachGlobalEventListeners();
        console.log('PostInteractions initialized');
    }

    attachGlobalEventListeners() {
        // Sử dụng event delegation cho các nút like
        document.addEventListener('click', (e) => {
            // Like button từ profile page
            const profileLikeBtn = e.target.closest('.post-stat.like-btn');
            if (profileLikeBtn && profileLikeBtn.dataset.postId) {
                e.preventDefault();
                e.stopPropagation();
                const postId = profileLikeBtn.dataset.postId;
                this.likePost(postId);
                return false;
            }

            // Like button từ post detail page
            const detailLikeBtn = e.target.closest('#like-btn');
            if (detailLikeBtn && detailLikeBtn.dataset.postId) {
                e.preventDefault();
                e.stopPropagation();
                const postId = detailLikeBtn.dataset.postId;
                this.likePost(postId);
                return false;
            }

            // Comment submit từ post detail page
            const commentSubmit = e.target.closest('#submit-comment');
            if (commentSubmit) {
                e.preventDefault();
                e.stopPropagation();
                const postId = window.postId; // Biến toàn cục từ template
                const commentInput = document.getElementById('comment-input');
                if (commentInput && postId) {
                    this.addComment(postId, commentInput.value.trim());
                    commentInput.value = '';
                }
                return false;
            }
        });
    }
}
export { PostInteractions };
export default PostInteractions;
// Khởi tạo instance toàn cục
window.PostInteractions = PostInteractions;
