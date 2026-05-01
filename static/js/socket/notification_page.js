import { socket } from "./index.js";

class NotificationsManager {
    constructor() {
        this.notifications = [];
        this.currentFilter = 'all';
        this.currentPage = 1;
        this.hasMore = true;
        this.isLoading = false;
        
        this.initializeElements();
        this.initializeEvents();
        this.loadNotifications();
        
        // Initialize notification count
        this.updateNotificationCount();
    }
    
    initializeElements() {
        this.notificationsList = document.getElementById('notifications-list');
        this.filterTabs = document.querySelectorAll('.tab-btn');
        this.markAllReadBtn = document.getElementById('mark-all-read-btn');
        this.filterSelect = document.getElementById('filter-select');
        this.loadMoreBtn = document.getElementById('load-more-btn');
        this.refreshBtn = document.getElementById('refresh-btn');
        this.emptyState = document.getElementById('empty-state');
        
        // FIXED: Sử dụng socket từ index.js hoặc tạo mới
        this.socket = window.socket || (window.io ? io() : null);
        
        if (this.socket) {
            console.log('Socket connected for notifications');
        } else {
            console.warn('Socket connection not available');
        }
    }
    initializeEvents() {
        // Filter tabs
        this.filterTabs.forEach(tab => {
            tab.addEventListener('click', () => this.handleFilterChange(tab));
        });
        
        // Mark all as read
        if (this.markAllReadBtn) {
            this.markAllReadBtn.addEventListener('click', () => this.markAllAsRead());
        }
        
        // Filter select
        if (this.filterSelect) {
            this.filterSelect.addEventListener('change', (e) => this.handleSortChange(e));
        }
        
        // Load more
        if (this.loadMoreBtn) {
            this.loadMoreBtn.addEventListener('click', () => this.loadMore());
        }
        
        // Refresh
        if (this.refreshBtn) {
            this.refreshBtn.addEventListener('click', () => this.refreshNotifications());
        }
        
        // Socket events
        if (this.socket) {
            this.socket.on('new_notification', (data) => {
                console.log('New notification received:', data);
                this.handleNewNotification(data);
            });
            
            this.socket.on('notification_read', (data) => {
                console.log('Notification read event:', data);
                this.handleNotificationRead(data);
            });
            
            this.socket.on('connect', () => {
                console.log('Socket connected');
            });
            
            this.socket.on('disconnect', () => {
                console.log('Socket disconnected');
            });
        }
    }
    async loadNotifications(page = 1) {
        if (this.isLoading) return;
        
        this.isLoading = true;
        this.showLoading();
        
        try {
            const params = new URLSearchParams({
                page: page,
                sort: this.filterSelect?.value || 'newest'
            });
            
            // FIXED: Xử lý filter đúng cách
            if (this.currentFilter && this.currentFilter !== 'all') {
                if (this.currentFilter === 'unread' || this.currentFilter === 'read') {
                    params.append('read', this.currentFilter === 'read' ? 'true' : 'false');
                } else {
                    params.append('type', this.currentFilter);
                }
            }
            
            const response = await fetch(`/api/notifications?${params}`);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            // Xử lý response
            const notifications = data.items || data.notifications || [];
            
            if (page === 1) {
                this.notifications = notifications;
            } else {
                this.notifications = [...this.notifications, ...notifications];
            }
            
            this.hasMore = data.page < data.total_pages;
            this.renderNotifications();
            this.updateEmptyState();
            this.updateLoadMoreButton();
            
            // Cập nhật notification count
            this.updateNotificationCount();
            
        } catch (error) {
            console.error('Error loading notifications:', error);
            this.showError('Lỗi khi tải thông báo');
        } finally {
            this.isLoading = false;
            this.hideLoading();
        }
    }

// Thêm function showError
showError(message) {
    if (this.notificationsList) {
        this.notificationsList.innerHTML = `
            <div class="error-state">
                <i class="fas fa-exclamation-triangle"></i>
                <p>${message}</p>
                <button class="retry-btn" onclick="notificationsManager.refreshNotifications()">
                    <i class="fas fa-redo"></i> Thử lại
                </button>
            </div>
        `;
    }
}
    renderNotifications() {
        if (!this.notificationsList) return;
        
        this.notificationsList.innerHTML = '';
        
        this.notifications.forEach(notification => {
            const notificationElement = this.createNotificationElement(notification);
            this.notificationsList.appendChild(notificationElement);
        });
    }
    
    createNotificationElement(notification) {
        const div = document.createElement('div');
        div.className = `notification-item ${notification.read ? '' : 'unread'}`;
        div.dataset.notificationId = notification._id;
        
        const iconClass = this.getIconClass(notification.type);
        const timeAgo = this.getTimeAgo(notification.created_at);
        
        div.innerHTML = `
            <div class="notification-icon ${iconClass}">
                <i class="${this.getIcon(notification.type)}"></i>
            </div>
            <div class="notification-content">
                <div class="notification-text">
                    ${this.getNotificationText(notification)}
                    ${notification.data?.post_preview ? 
                        `<span class="post-preview">"${notification.data.post_preview}"</span>` : ''}
                </div>
                <div class="notification-time">
                    <i class="far fa-clock"></i>
                    ${timeAgo}
                </div>
                ${this.getActionButtons(notification)}
            </div>
            ${!notification.read ? '<div class="unread-dot"></div>' : ''}
        `;
        
        // Add click event
        div.addEventListener('click', (e) => {
            if (!e.target.closest('.action-btn')) {
                this.handleNotificationClick(notification);
            }
        });
        
        return div;
    }
    
    getIconClass(type) {
        const iconMap = {
            'like': 'like',
            'comment': 'comment',
            'friend_request': 'friend',
            'friend_accept': 'friend',
            'mention': 'mention',
            'message': 'message',
            'share': 'share'
        };
        return iconMap[type] || 'comment';
    }
    
    getIcon(type) {
        const iconMap = {
            'like': 'fas fa-heart',
            'comment': 'fas fa-comment',
            'friend_request': 'fas fa-user-plus',
            'friend_accept': 'fas fa-user-check',
            'mention': 'fas fa-at',
            'message': 'fas fa-envelope',
            'share': 'fas fa-share'
        };
        return iconMap[type] || 'fas fa-bell';
    }
    
    getNotificationText(notification) {
        const userLink = `<strong>${notification.sender_name}</strong>`;
        
        const texts = {
            'like': `${userLink} đã thích bài viết của bạn`,
            'comment': `${userLink} đã bình luận về bài viết của bạn`,
            'friend_request': `${userLink} đã gửi lời mời kết bạn`,
            'friend_accept': `${userLink} đã chấp nhận lời mời kết bạn`,
            'mention': `${userLink} đã đề cập đến bạn`,
            'message': `${userLink} đã gửi tin nhắn`,
            'share': `${userLink} đã chia sẻ bài viết của bạn`
        };
        
        return texts[notification.type] || 'Bạn có thông báo mới';
    }
    getActionButtons(notification) {
        if (notification.type === 'friend_request') {
            return `
                <div class="notification-item-actions">
                    <button class="action-btn accept" onclick="notificationsManager.handleFriendRequest('${notification._id}', 'accept')">
                        <i class="fas fa-check"></i> Chấp nhận
                    </button>
                    <button class="action-btn decline" onclick="notificationsManager.handleFriendRequest('${notification._id}', 'decline')">
                        <i class="fas fa-times"></i> Từ chối
                    </button>
                </div>
            `;
        }
        
        if (notification.type === 'message') {
            return `
                <div class="notification-item-actions">
                    <button class="action-btn view" onclick="notificationsManager.goToMessage('${notification.data?.conversation_id}')">
                        <i class="fas fa-paper-plane"></i> Trả lời
                    </button>
                </div>
            `;
        }
    
        return '';
    }
    
    getTimeAgo(timestamp) {
        const now = new Date();
        const past = new Date(timestamp);
        const diffMs = now - past;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);
        
        if (diffMins < 1) return 'Vừa xong';
        if (diffMins < 60) return `${diffMins} phút trước`;
        if (diffHours < 24) return `${diffHours} giờ trước`;
        if (diffDays < 7) return `${diffDays} ngày trước`;
        
        return past.toLocaleDateString('vi-VN');
    }
    
    handleFilterChange(tab) {
        this.filterTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        // SỬA: Lấy filter từ data-filter (đã thêm trong HTML)
        let filter = tab.dataset.filter;
        
        // Nếu không có data-filter, fallback về text
        if (!filter) {
            const filterMap = {
                'Tất cả': 'all',
                'Chưa đọc': 'unread',
                'Đã đọc': 'read',  // THÊM mapping cho "Đã đọc"
                'Tin nhắn': 'message',
                'Bình luận': 'comment',
                'Thích': 'like',
                'Bạn bè': 'friend',
                'Đề cập': 'mention',
                'Chia sẻ': 'share'
            };
            filter = filterMap[tab.textContent.trim()] || 'all';
        }
        
        this.currentFilter = filter;
        this.currentPage = 1;
        this.loadNotifications();
    }
    handleSortChange(e) {
        this.currentPage = 1;
        this.loadNotifications();
    }
    
    async handleNotificationClick(notification) {
        // Đánh dấu là đã đọc
        if (!notification.read) {
            await this.markAsRead(notification._id);
            notification.read = true;
            this.updateNotificationElement(notification._id);
            this.updateNotificationCount();
        }
        
        // Điều hướng dựa trên loại thông báo
        let redirectUrl = null;
        
        switch (notification.type) {
            case 'friend_request':
            case 'friend_accept':
                redirectUrl = '/friend_requests_page';
                break;
                
            case 'message':
                if (notification.data?.conversation_id) {
                    redirectUrl = `/chat?conversation=${notification.data.conversation_id}`;
                } else {
                    redirectUrl = '/chat';
                }
                break;
                
            // Trong phương thức handleNotificationClick, sửa phần case 'like' và 'comment':
case 'like':
    case 'comment':
    case 'mention':
    case 'share':
        // Kiểm tra và xử lý post_id
        const postId = notification.data?.post_id;
        if (postId) {
            console.log('Redirecting to post:', postId);
            
            // Tạo URL chính xác
            const postUrl = `/post/${postId}`;
            
            // Kiểm tra nếu có comment_id, thêm anchor
            if (notification.data?.comment_id) {
                window.location.href = `${postUrl}#comment-${notification.data.comment_id}`;
            } else {
                window.location.href = postUrl;
            }
            
            // Hoặc sử dụng:
            // window.open(postUrl, '_blank'); // Mở tab mới
        } else {
            console.error('No post_id in notification:', notification);
            // Fallback: chuyển đến trang feed
            window.location.href = '/feed';
        }
        break;
                
            default:
                redirectUrl = '/feed';
        }
        
        // Điều hướng
        if (redirectUrl) {
            console.log('Redirecting to:', redirectUrl);
            window.location.href = redirectUrl;
        }
    }
    async markAsRead(notificationId) {
        try {
            const response = await fetch(`/api/notifications/${notificationId}/read`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            return response.json();
        } catch (error) {
            console.error('Error marking as read:', error);
        }
    }
    
    async markAllAsRead() {
        if (!confirm('Đánh dấu tất cả thông báo là đã đọc?')) return;
        
        try {
            const response = await fetch('/api/notifications/mark-all-read', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            const data = await response.json();
            if (data.success) {
                // Update UI
                this.notifications.forEach(n => n.read = true);
                this.renderNotifications();
                
                // Emit socket event
                if (this.socket) {
                    this.socket.emit('notifications_read', { all: true });
                }
            }
        } catch (error) {
            console.error('Error marking all as read:', error);
        }
    }
    
    async handleFriendRequest(notificationId, action) {
        try {
            const response = await fetch(`/api/friend_requests/${notificationId}/${action}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            const data = await response.json();
            if (data.success) {
                // Remove or update notification
                this.notifications = this.notifications.filter(n => n._id !== notificationId);
                this.renderNotifications();
                this.updateEmptyState();
                
                // Show success message
                alert(`Đã ${action === 'accept' ? 'chấp nhận' : 'từ chối'} lời mời kết bạn`);
            }
        } catch (error) {
            console.error('Error handling friend request:', error);
        }
    }
    
    goToMessage(conversationId) {
        if (conversationId) {
            window.location.href = `/chat?conversation=${conversationId}`;
        }
    }
    
    viewPost(postId) {
        window.location.href = `/post/${postId}`;
    }
    
    updateNotificationElement(notificationId) {
        const element = document.querySelector(`[data-notification-id="${notificationId}"]`);
        if (element) {
            element.classList.remove('unread');
            const dot = element.querySelector('.unread-dot');
            if (dot) dot.remove();
        }
    }
    
    handleNewNotification(notification) {
        console.log('Processing new notification:', notification);
        
        // Kiểm tra xem notification đã tồn tại chưa (tránh trùng lặp)
        const exists = this.notifications.some(n => n._id === notification._id);
        if (exists) {
            console.log('Notification already exists, skipping');
            return;
        }
        
        // Thêm vào đầu danh sách
        this.notifications.unshift(notification);
        
        // Kiểm tra filter hiện tại
        const shouldShow = this.currentFilter === 'all' || 
                          this.currentFilter === notification.type ||
                          (this.currentFilter === 'unread' && !notification.read) ||
                          (this.currentFilter === 'read' && notification.read);
        
        if (shouldShow) {
            this.renderNotifications();
            this.updateEmptyState();
        }
        
        // Cập nhật badge count
        this.updateNotificationCount();
        
        // Hiển thị browser notification
        this.showBrowserNotification(notification);
        
        // Phát âm thanh nếu cần
        this.playNotificationSound();
    }
    
    playNotificationSound() {
        try {
            const audio = new Audio('/static/sounds/notification.mp3');
            audio.volume = 0.3;
            audio.play().catch(e => console.log('Could not play sound:', e));
        } catch (error) {
            console.log('Error playing notification sound:', error);
        }
    }
    
    handleNotificationRead(data) {
        if (data.all) {
            this.notifications.forEach(n => n.read = true);
            this.renderNotifications();
        } else if (data.notificationId) {
            const notification = this.notifications.find(n => n._id === data.notificationId);
            if (notification) {
                notification.read = true;
                this.updateNotificationElement(data.notificationId);
            }
        }
    }
    
    showBrowserNotification(notification) {
        if (!("Notification" in window)) return;
        
        if (Notification.permission === "granted") {
            new Notification("PAW TALK - Thông báo mới", {
                body: this.getNotificationText(notification).replace(/<[^>]*>/g, ''),
                icon: '/static/img/logo.png'
            });
        }
    }
    
    updateNotificationCount() {
        const unreadCount = this.notifications.filter(n => !n.read).length;
        console.log('Updating notification count:', unreadCount);
        
        // Update badge trong navbar
        const badge = document.getElementById('notifications-badge');
        if (badge) {
            if (unreadCount > 0) {
                badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
                badge.style.display = 'flex'; // Sử dụng flex để căn giữa
                badge.classList.add('has-notifications');
            } else {
                badge.textContent = '';
                badge.style.display = 'none';
                badge.classList.remove('has-notifications');
            }
        }
        
        // Cập nhật title tab nếu cần
        if (unreadCount > 0 && !document.title.includes('(')) {
            document.title = `(${unreadCount}) ${document.title.replace(/^\(\d+\)\s*/, '')}`;
        } else if (unreadCount === 0 && document.title.includes('(')) {
            document.title = document.title.replace(/^\(\d+\)\s*/, '');
        }
    }
    
    async loadMore() {
        if (!this.hasMore || this.isLoading) return;
        
        this.currentPage++;
        await this.loadNotifications(this.currentPage);
    }
    
    refreshNotifications() {
        this.currentPage = 1;
        this.loadNotifications();
    }
    
    showLoading() {
        if (this.notificationsList) {
            this.notificationsList.innerHTML = `
                <div class="loading-state">
                    <i class="fas fa-spinner fa-spin"></i>
                    <p>Đang tải thông báo...</p>
                </div>
            `;
        }
    }
    
    hideLoading() {
        // Loading state will be replaced by renderNotifications
    }
    
    updateEmptyState() {
        if (!this.emptyState) return;
        
        if (this.notifications.length === 0) {
            this.emptyState.style.display = 'block';
            this.notificationsList.style.display = 'none';
        } else {
            this.emptyState.style.display = 'none';
            this.notificationsList.style.display = 'block';
        }
    }
    
    updateLoadMoreButton() {
        if (this.loadMoreBtn) {
            this.loadMoreBtn.disabled = !this.hasMore;
            this.loadMoreBtn.textContent = this.hasMore ? 'Tải thêm thông báo' : 'Đã tải hết thông báo';
        }
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.notificationsManager = new NotificationsManager();
    
    // Request notification permission
    if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
    }
});
// Menu Navigation Functionality
document.addEventListener('DOMContentLoaded', function() {
    const navToggle = document.getElementById('nav-toggle');
    const sideNav = document.getElementById('side-nav');
    const navOverlay = document.getElementById('nav-overlay');
    const body = document.body;
    
    if (navToggle && sideNav && navOverlay) {
        // Toggle menu
        navToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            sideNav.classList.toggle('active');
            navOverlay.classList.toggle('active');
            body.classList.toggle('menu-open');
        });
        
        // Close menu when clicking overlay
        navOverlay.addEventListener('click', () => {
            sideNav.classList.remove('active');
            navOverlay.classList.remove('active');
            body.classList.remove('menu-open');
        });
        
        // Close menu when clicking outside on mobile
        document.addEventListener('click', (e) => {
            if (window.innerWidth <= 768 && 
                sideNav.classList.contains('active') && 
                !sideNav.contains(e.target) && 
                !navToggle.contains(e.target)) {
                sideNav.classList.remove('active');
                navOverlay.classList.remove('active');
                body.classList.remove('menu-open');
            }
        });
        
        // Close menu on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && sideNav.classList.contains('active')) {
                sideNav.classList.remove('active');
                navOverlay.classList.remove('active');
                body.classList.remove('menu-open');
            }
        });
    }
    
    // Highlight active menu item
    const currentPath = window.location.pathname;
    const navItems = document.querySelectorAll('.nav-item');
    
    navItems.forEach(item => {
        const href = item.getAttribute('href');
        if (href && currentPath.includes(href.replace('/', ''))) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
});
// Thêm vào cuối file
window.addEventListener('beforeunload', () => {
    if (window.notificationsManager && window.notificationsManager.socket) {
        window.notificationsManager.socket.disconnect();
    }
});

// Reconnect khi tab trở lại focus
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && window.notificationsManager) {
        window.notificationsManager.initializeSocket();
        window.notificationsManager.refreshNotifications();
    }
});