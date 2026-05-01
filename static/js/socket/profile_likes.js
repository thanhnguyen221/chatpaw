/**
 * Profile Likes Module - Tách riêng để dễ quản lý
 */

class ProfileLikesManager {
    constructor() {
        this.currentUserId = null;
        this.profileUserId = null;
        this.isInitialized = false;
    }

    /**
     * Khởi tạo module
     */
    initialize(profileUserId, currentUserId) {
        if (this.isInitialized) return;
        
        this.profileUserId = profileUserId;
        this.currentUserId = currentUserId;
        this.isInitialized = true;
        
        console.log('Profile Likes Manager initialized', {
            profileUserId,
            currentUserId
        });
        
        // Khởi tạo các sự kiện
        this.initializeEventListeners();
        
        // Tải thông tin lượt thích
        this.loadProfileLikesInfo();
        
        // Join profile room cho realtime updates
        this.joinProfileRoom();
        
        // Lắng nghe socket events
        this.setupSocketListeners();
    }

    /**
     * Khởi tạo event listeners
     */
    initializeEventListeners() {
        // Nút thích profile
        const likeBtn = document.getElementById('like-profile-btn');
        if (likeBtn) {
            likeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.handleLikeProfile();
            });
        }

        // Click vào số lượt thích
        const likesStat = document.getElementById('profile-likes-stat');
        if (likesStat) {
            likesStat.addEventListener('click', () => {
                this.showProfileLikersModal();
            });
        }
    }

    /**
     * Xử lý thích/bỏ thích profile
     */
    async handleLikeProfile() {
        try {
            if (!this.profileUserId) return;
            
            const likeBtn = document.getElementById('like-profile-btn');
            const likeCountElement = document.getElementById('profile-likes-count');
            const likeProfileCountBadge = document.getElementById('like-profile-count');
            
            // Lưu trạng thái ban đầu
            const originalLiked = likeBtn.classList.contains('liked');
            const originalCount = parseInt(likeCountElement?.textContent || 0);
            
            // Cập nhật UI tạm thời (optimistic update)
            if (originalLiked) {
                likeBtn.classList.remove('liked');
                likeBtn.innerHTML = '<i class="fas fa-heart"></i> Thích trang';
                if (likeCountElement) likeCountElement.textContent = Math.max(0, originalCount - 1);
                if (likeProfileCountBadge) likeProfileCountBadge.textContent = Math.max(0, originalCount - 1);
            } else {
                likeBtn.classList.add('liked');
                likeBtn.innerHTML = '<i class="fas fa-heart"></i> Đã thích';
                if (likeCountElement) likeCountElement.textContent = originalCount + 1;
                if (likeProfileCountBadge) likeProfileCountBadge.textContent = originalCount + 1;
            }
            
            likeBtn.disabled = true;
            
            // Gọi API từ profile_likes blueprint
            const response = await fetch(`/profile_likes/like/${this.profileUserId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            const result = await response.json();
            
            if (result.success) {
                // Cập nhật UI với dữ liệu thực từ server
                if (likeCountElement) likeCountElement.textContent = result.like_count;
                if (likeProfileCountBadge) likeProfileCountBadge.textContent = result.like_count;
                
                if (result.liked) {
                    likeBtn.classList.add('liked');
                    likeBtn.innerHTML = '<i class="fas fa-heart"></i> Đã thích';
                    this.showNotification('Đã thích trang cá nhân!', 'success');
                } else {
                    likeBtn.classList.remove('liked');
                    likeBtn.innerHTML = '<i class="fas fa-heart"></i> Thích trang';
                    this.showNotification('Đã bỏ thích trang cá nhân', 'info');
                }
                
                // Cập nhật recent likers hiển thị
                this.updateRecentLikersDisplay();
            } else {
                // Khôi phục UI nếu lỗi
                this.restoreUIState(originalLiked, originalCount);
                this.showNotification(result.error || 'Lỗi khi thích trang cá nhân', 'error');
            }
            
        } catch (error) {
            console.error('Error liking profile:', error);
            this.showNotification('Lỗi kết nối khi thích trang cá nhân', 'error');
            this.restoreUIState(originalLiked, originalCount);
        } finally {
            const likeBtn = document.getElementById('like-profile-btn');
            if (likeBtn) likeBtn.disabled = false;
        }
    }

    /**
     * Tải thông tin lượt thích profile
     */
    async loadProfileLikesInfo() {
        try {
            if (!this.profileUserId) return;
            
            const response = await fetch(`/profile_likes/info/${this.profileUserId}`);
            const result = await response.json();
            
            if (result.success) {
                this.updateUI(result);
                console.log(`Loaded profile likes info: ${result.like_count} likes`);
            }
        } catch (error) {
            console.error('Error loading profile likes info:', error);
        }
    }

    /**
     * Cập nhật UI với dữ liệu từ server
     */
    updateUI(data) {
        // Cập nhật số lượt thích
        const likeCountElement = document.getElementById('profile-likes-count');
        const likeProfileCountBadge = document.getElementById('like-profile-count');
        const likeBtn = document.getElementById('like-profile-btn');
        const likeProfileText = document.getElementById('like-profile-text');
        
        if (likeCountElement) likeCountElement.textContent = data.like_count;
        if (likeProfileCountBadge) likeProfileCountBadge.textContent = data.like_count;
        
        // Cập nhật trạng thái nút thích
        if (likeBtn && data.can_like) {
            if (data.current_user_has_liked) {
                likeBtn.classList.add('liked');
                likeBtn.innerHTML = '<i class="fas fa-heart"></i> Đã thích';
                if (likeProfileText) likeProfileText.textContent = 'Đã thích';
            } else {
                likeBtn.classList.remove('liked');
                likeBtn.innerHTML = '<i class="fas fa-heart"></i> Thích trang';
                if (likeProfileText) likeProfileText.textContent = 'Thích trang';
            }
            likeBtn.style.display = 'inline-block';
        } else if (likeBtn) {
            likeBtn.style.display = 'none'; // Ẩn nút nếu là chính mình
        }
        
        // Hiển thị avatars của những người thích gần đây
        this.updateRecentLikersDisplay(data.recent_likers);
    }

    /**
     * Cập nhật hiển thị những người thích gần đây
     */
    updateRecentLikersDisplay(recent_likers = null) {
        if (!recent_likers) {
            // Nếu không có data, gọi API để lấy
            this.loadProfileLikesInfo();
            return;
        }
        
        const profileHeader = document.querySelector('.profile-header');
        
        // Tạo hoặc cập nhật container hiển thị avatars
        let likersContainer = document.getElementById('recent-likers-container');
        
        if (!likersContainer && recent_likers.length > 0) {
            likersContainer = document.createElement('div');
            likersContainer.id = 'recent-likers-container';
            likersContainer.className = 'recent-likers-container';
            
            // Thêm vào phần thích hợp trong profile header
            const profileInfo = document.querySelector('.profile-info');
            if (profileInfo) {
                profileInfo.appendChild(likersContainer);
            }
        }
        
        // Kiểm tra lại trước khi truy cập style
        if (likersContainer) {
            likersContainer.style.display = 'flex';
        }
    }
    /**
     * Hiển thị modal danh sách người đã thích profile
     */
    async showProfileLikersModal() {
        try {
            const response = await fetch(`/profile_likes/likers/${this.profileUserId}`);
            const result = await response.json();
            
            if (result.success) {
                this.createProfileLikersModal(result);
            } else {
                this.showNotification(result.error || 'Lỗi khi tải danh sách người thích', 'error');
            }
        } catch (error) {
            console.error('Error loading profile likers:', error);
            this.showNotification('Lỗi kết nối khi tải danh sách', 'error');
        }
    }

    /**
     * Tạo modal hiển thị danh sách người đã thích profile
     */
    createProfileLikersModal(data) {
        // Đóng modal cũ nếu có
        const existingModal = document.getElementById('profile-likers-modal');
        if (existingModal) existingModal.remove();
        
        const modalHTML = `
            <div class="profile-likers-modal" id="profile-likers-modal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>
                            <i class="fas fa-heart" style="color: #e74c3c;"></i>
                            Người đã thích trang cá nhân
                            <span class="total-count">(${data.total})</span>
                        </h3>
                        <button class="close-btn" onclick="window.closeProfileLikersModal()">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="likers-list">
                            ${data.likers.length > 0 ? data.likers.map(liker => `
                                <div class="liker-item" data-user-id="${liker._id}">
                                    <div class="liker-avatar-container">
                                        <img src="${liker.avatar}" 
                                             alt="${liker.full_name || liker.username}"
                                             class="liker-avatar"
                                             onerror="this.src='/static/img/default-avatar.png'">
                                        ${liker.online ? '<div class="liker-online-status"></div>' : ''}
                                    </div>
                                    <div class="liker-info">
                                        <div class="liker-name">${liker.full_name || liker.username}</div>
                                        <div class="liker-username">@${liker.username}</div>
                                    </div>
                                    <div class="liker-actions">
                                        <button class="btn btn-outline btn-sm" onclick="window.viewUserProfile('${liker._id}')">
                                            <i class="fas fa-user"></i> Xem trang
                                        </button>
                                    </div>
                                </div>
                            `).join('') : `
                                <div class="no-likers">
                                    <i class="fas fa-heart-broken" style="font-size: 48px; color: #ddd;"></i>
                                    <p>Chưa có ai thích trang cá nhân này</p>
                                </div>
                            `}
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-outline" onclick="window.closeProfileLikersModal()">Đóng</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        // Thêm CSS nếu chưa có
        this.addProfileLikersModalStyles();
    }

    /**
     * Đóng modal danh sách người thích
     */
    closeProfileLikersModal() {
        const modal = document.getElementById('profile-likers-modal');
        if (modal) modal.remove();
    }

    /**
     * Khôi phục UI về trạng thái cũ
     */
    restoreUIState(wasLiked, originalCount) {
        const likeBtn = document.getElementById('like-profile-btn');
        const likeCountElement = document.getElementById('profile-likes-count');
        const likeProfileCountBadge = document.getElementById('like-profile-count');
        
        if (wasLiked) {
            likeBtn.classList.add('liked');
            likeBtn.innerHTML = '<i class="fas fa-heart"></i> Đã thích';
            if (likeCountElement) likeCountElement.textContent = originalCount;
            if (likeProfileCountBadge) likeProfileCountBadge.textContent = originalCount;
        } else {
            likeBtn.classList.remove('liked');
            likeBtn.innerHTML = '<i class="fas fa-heart"></i> Thích trang';
            if (likeCountElement) likeCountElement.textContent = originalCount;
            if (likeProfileCountBadge) likeProfileCountBadge.textContent = originalCount;
        }
    }

    /**
     * Join profile room cho realtime updates
     */
    joinProfileRoom() {
        if (window.socket && this.profileUserId) {
            window.socket.emit('join_profile_room', {
                profile_user_id: this.profileUserId
            });
        }
    }

    /**
     * Setup socket listeners
     */
    setupSocketListeners() {
        if (!window.socket) return;
        
        // Lắng nghe sự kiện cập nhật lượt thích
        window.socket.on('profile_like_updated', (data) => {
            if (data.profile_user_id === this.profileUserId) {
                this.handleRealtimeUpdate(data);
            }
        });
    }

    /**
     * Xử lý cập nhật realtime
     */
    handleRealtimeUpdate(data) {
        // Cập nhật số lượt thích
        const likeCountElement = document.getElementById('profile-likes-count');
        const likeProfileCountBadge = document.getElementById('like-profile-count');
        
        if (likeCountElement) likeCountElement.textContent = data.like_count;
        if (likeProfileCountBadge) likeProfileCountBadge.textContent = data.like_count;
        
        // Nếu là người dùng hiện tại like/unlike, cập nhật nút
        if (data.user_id === this.currentUserId) {
            const likeBtn = document.getElementById('like-profile-btn');
            if (likeBtn) {
                if (data.liked) {
                    likeBtn.classList.add('liked');
                    likeBtn.innerHTML = '<i class="fas fa-heart"></i> Đã thích';
                } else {
                    likeBtn.classList.remove('liked');
                    likeBtn.innerHTML = '<i class="fas fa-heart"></i> Thích trang';
                }
            }
        }
        
        // Reload recent likers
        this.updateRecentLikersDisplay();
        
        // Hiệu ứng animation
        if (data.liked) {
            this.animateHeart();
        }
    }

    /**
     * Hiệu ứng animation cho trái tim
     */
    animateHeart() {
        const likeBtn = document.getElementById('like-profile-btn');
        if (likeBtn) {
            likeBtn.classList.add('heart-animation');
            setTimeout(() => {
                likeBtn.classList.remove('heart-animation');
            }, 1000);
        }
    }

    /**
     * Thêm CSS cho modal
     */
    addProfileLikersModalStyles() {
        if (!document.querySelector('#profile-likers-modal-styles')) {
            const styles = document.createElement('style');
            styles.id = 'profile-likers-modal-styles';
            styles.textContent = `
                .profile-likers-modal {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0,0,0,0.5);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 10000;
                }
                
                .profile-likers-modal .modal-content {
                    background: white;
                    border-radius: 12px;
                    width: 90%;
                    max-width: 500px;
                    max-height: 80vh;
                    display: flex;
                    flex-direction: column;
                }
                
                .profile-likers-modal .modal-header {
                    padding: 20px;
                    border-bottom: 1px solid #e0e0e0;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                
                .profile-likers-modal .modal-header h3 {
                    margin: 0;
                    font-size: 18px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                
                .profile-likers-modal .total-count {
                    color: #666;
                    font-weight: normal;
                }
                
                .profile-likers-modal .modal-body {
                    padding: 20px;
                    flex: 1;
                    overflow-y: auto;
                }
                
                .profile-likers-modal .likers-list {
                    max-height: 400px;
                    overflow-y: auto;
                }
                
                .profile-likers-modal .liker-item {
                    display: flex;
                    align-items: center;
                    padding: 12px;
                    border-radius: 8px;
                    margin-bottom: 8px;
                    transition: background 0.2s;
                }
                
                .profile-likers-modal .liker-item:hover {
                    background: #f5f5f5;
                }
                
                .profile-likers-modal .liker-avatar-container {
                    position: relative;
                    margin-right: 12px;
                }
                
                .profile-likers-modal .liker-avatar {
                    width: 50px;
                    height: 50px;
                    border-radius: 50%;
                    object-fit: cover;
                }
                
                .profile-likers-modal .liker-online-status {
                    position: absolute;
                    bottom: 2px;
                    right: 2px;
                    width: 12px;
                    height: 12px;
                    border-radius: 50%;
                    background: #2ecc71;
                    border: 2px solid white;
                }
                
                .profile-likers-modal .liker-info {
                    flex: 1;
                }
                
                .profile-likers-modal .liker-name {
                    font-weight: 600;
                    margin-bottom: 2px;
                }
                
                .profile-likers-modal .liker-username {
                    font-size: 13px;
                    color: #666;
                }
                
                .profile-likers-modal .no-likers {
                    text-align: center;
                    padding: 40px 20px;
                    color: #999;
                }
                
                .profile-likers-modal .no-likers i {
                    margin-bottom: 16px;
                }
                
                .profile-likers-modal .modal-footer {
                    padding: 15px 20px;
                    border-top: 1px solid #e0e0e0;
                    display: flex;
                    justify-content: flex-end;
                }
            `;
            document.head.appendChild(styles);
        }
    }

    /**
     * Helper function để hiển thị notification
     */
    showNotification(message, type = 'info') {
        // Sử dụng hàm showNotification có sẵn hoặc tạo mới
        if (typeof showNotification === 'function') {
            showNotification(message, type);
        } else {
            console.log(`[${type}] ${message}`);
        }
    }
}

// Export singleton instance
window.profileLikesManager = new ProfileLikesManager();

// Export các hàm cần thiết ra global scope
window.showProfileLikersModal = function(userId) {
    if (window.profileLikesManager) {
        window.profileLikesManager.showProfileLikersModal(userId);
    }
};

window.closeProfileLikersModal = function() {
    if (window.profileLikesManager) {
        window.profileLikesManager.closeProfileLikersModal();
    }
};

window.likeProfile = function(userId) {
    if (window.profileLikesManager) {
        window.profileLikesManager.handleLikeProfile(userId);
    }
};
// Mở trang profile người dùng
window.viewUserProfile = function(userId) {
    if (!userId) return;

    // Tuỳ route profile của bạn
    window.location.href = `/profile/${userId}`;
};
