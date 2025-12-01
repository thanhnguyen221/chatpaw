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
    }
    
    initializeElements() {
        this.notificationsList = document.getElementById('notifications-list');
        this.filterTabs = document.querySelectorAll('.tab-btn');
        this.markAllReadBtn = document.getElementById('mark-all-read-btn');
        this.filterSelect = document.getElementById('filter-select');
        this.loadMoreBtn = document.getElementById('load-more-btn');
        this.refreshBtn = document.getElementById('refresh-btn');
        this.emptyState = document.getElementById('empty-state');
        
        // Socket connection
        this.socket = io();
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
                this.handleNewNotification(data);
            });
            
            this.socket.on('notification_read', (data) => {
                this.handleNotificationRead(data);
            });
        }
    }
    // Thay thế function loadNotifications trong notifications_page.js
async loadNotifications(page = 1) {
    if (this.isLoading) return;
    
    this.isLoading = true;
    this.showLoading();
    
    try {
        const response = await fetch(`/api/notifications?page=${page}&filter=${this.currentFilter}&sort=${this.filterSelect?.value || 'newest'}`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Sửa cấu trúc response
        if (data.items) {  // Sửa: dùng data.items thay vì data.notifications
            if (page === 1) {
                this.notifications = data.items;
            } else {
                this.notifications = [...this.notifications, ...data.items];
            }
            
            this.hasMore = data.page < data.total_pages;
            this.renderNotifications();
            this.updateEmptyState();
            this.updateLoadMoreButton();
        } else {
            console.error('Invalid response format:', data);
            this.showError('Không thể tải thông báo');
        }
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
        const postLink = notification.data?.post_id ? 
            `<a href="/post/${notification.data.post_id}" class="post-link">bài viết</a>` : 'bài viết';
        
        const texts = {
            'like': `${userLink} đã thích ${postLink} của bạn`,
            'comment': `${userLink} đã bình luận về ${postLink} của bạn`,
            'friend_request': `${userLink} đã gửi cho bạn lời mời kết bạn`,
            'friend_accept': `${userLink} đã chấp nhận lời mời kết bạn của bạn`,
            'mention': `${userLink} đã đề cập đến bạn trong một bình luận`,
            'message': `${userLink} đã gửi cho bạn một tin nhắn mới`,
            'share': `${userLink} đã chia sẻ ${postLink} của bạn`
        };
        
        return texts[notification.type] || 'Bạn có một thông báo mới';
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
        
        if (['like', 'comment', 'mention', 'share'].includes(notification.type) && notification.data?.post_id) {
            return `
                <div class="notification-item-actions">
                    <button class="action-btn view" onclick="notificationsManager.viewPost('${notification.data.post_id}')">
                        <i class="fas fa-eye"></i> Xem bài viết
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
        this.currentFilter = tab.dataset.filter;
        this.currentPage = 1;
        this.loadNotifications();
    }
    
    handleSortChange(e) {
        this.currentPage = 1;
        this.loadNotifications();
    }
    
    async handleNotificationClick(notification) {
        // Mark as read
        if (!notification.read) {
            await this.markAsRead(notification._id);
            notification.read = true;
            this.updateNotificationElement(notification._id);
        }
        
        // Navigate based on type
        switch (notification.type) {
            case 'friend_request':
                window.location.href = '/friend_requests_page';
                break;
            case 'message':
                if (notification.data?.conversation_id) {
                    window.location.href = `/chat?conversation=${notification.data.conversation_id}`;
                }
                break;
            case 'like':
            case 'comment':
            case 'mention':
            case 'share':
                if (notification.data?.post_id) {
                    window.location.href = `/post/${notification.data.post_id}`;
                }
                break;
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
        // Add to beginning of list
        this.notifications.unshift(notification);
        
        // Update UI
        if (this.currentFilter === 'all' || this.currentFilter === notification.type) {
            this.renderNotifications();
            this.updateEmptyState();
        }
        
        // Show notification count in tab
        this.updateNotificationCount();
        
        // Play sound or show browser notification
        this.showBrowserNotification(notification);
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
        
        // Update badge in navbar if exists
        const badge = document.getElementById('notifications-badge');
        if (badge) {
            if (unreadCount > 0) {
                badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
                badge.style.display = 'inline';
            } else {
                badge.style.display = 'none';
            }
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