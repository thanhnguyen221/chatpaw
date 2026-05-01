
import { socket } from "./index.js";

class NotificationsManager {
    constructor() {
        this.notifications = [];
        this.currentFilter = 'all';
        this.currentPage = 1;
        this.hasMore = true;
        this.isLoading = false;
        
        // Lưu thời gian lần cuối refresh để tránh spam
        this.lastRefreshTime = 0;
        this.refreshCooldown = 3000; // 3 giây
        
        this.initializeElements();
        this.initializeEvents();
        this.loadNotifications();
        
        // Request notification permission
        if ("Notification" in window && Notification.permission === "default") {
            Notification.requestPermission();
        }
        
        // Load stats and activity data
        this.loadNotificationStats();
        this.loadActivityData();
    }
    
    async loadNotificationStats() {
        try {
            const response = await fetch('/api/notifications/stats');
            if (!response.ok) throw new Error('Failed to load stats');
            
            const data = await response.json();
            if (data.success) {
                this.updateStatsUI(data.stats);
            }
        } catch (error) {
            console.error('Error loading notification stats:', error);
        }
    }
    
    updateStatsUI(stats) {
        // Update main stats
        const totalEl = document.getElementById('total-notifications');
        const unreadEl = document.getElementById('unread-count');
        const readEl = document.getElementById('read-count');
        
        if (totalEl) totalEl.textContent = stats.total || 0;
        if (unreadEl) unreadEl.textContent = stats.unread || 0;
        if (readEl) readEl.textContent = stats.read || 0;
        
        // Update type counts
        const typeMapping = {
            'like': 'like-count',
            'comment': 'comment-count',
            'comment_like': 'like-count',
            'friend_request': 'friend-count',
            'friend_accept': 'friend-count',
            'mention': 'mention-count',
            'share': 'share-count'
        };
        
        for (const [type, count] of Object.entries(stats.by_type || {})) {
            const elementId = typeMapping[type];
            if (elementId) {
                const el = document.getElementById(elementId);
                if (el) {
                    // If element already has count, add to it
                    const currentCount = parseInt(el.textContent) || 0;
                    el.textContent = currentCount + count;
                }
            }
        }
    }
    
    async loadActivityData() {
        try {
            const response = await fetch('/api/notifications/activity');
            if (!response.ok) throw new Error('Failed to load activity');
            
            const data = await response.json();
            if (data.success) {
                this.updateChartUI(data.chart_data);
                this.updateRecentActivityUI(data.recent_activity);
                this.updateActivitySummary(data.percent_change);
            }
        } catch (error) {
            console.error('Error loading activity data:', error);
        }
    }
    
    updateChartUI(chartData) {
        const chartContainer = document.querySelector('.chart-bar-container');
        if (!chartContainer || !chartData || chartData.length === 0) return;
        
        // Find max count for scaling
        const maxCount = Math.max(...chartData.map(d => d.count), 1);
        
        // Update each bar
        const bars = chartContainer.querySelectorAll('.chart-bar');
        bars.forEach((bar, index) => {
            if (chartData[index]) {
                const percentage = (chartData[index].count / maxCount) * 100;
                bar.style.height = `${Math.max(percentage, 5)}%`; // Min 5% for visibility
                bar.dataset.day = chartData[index].day;
                
                // Highlight today
                if (chartData[index].is_today) {
                    bar.classList.add('active');
                } else {
                    bar.classList.remove('active');
                }
            }
        });
        
        // Update labels
        const labelsContainer = document.querySelector('.chart-labels');
        if (labelsContainer) {
            labelsContainer.innerHTML = chartData.map(d => `<span>${d.day}</span>`).join('');
        }
    }
    
    updateRecentActivityUI(activities) {
        const timeline = document.getElementById('activity-timeline');
        if (!timeline || !activities || activities.length === 0) return;
        
        timeline.innerHTML = activities.map(activity => `
            <div class="timeline-item" ${activity.link ? `onclick="window.location.href='${activity.link}'" style="cursor:pointer;"` : ''}>
                <div class="timeline-dot"></div>
                <div class="timeline-content">
                    <p>${activity.text}</p>
                    <span>${activity.time_display}</span>
                </div>
            </div>
        `).join('');
    }
    
    updateActivitySummary(percentChange) {
        const summaryEl = document.querySelector('.activity-summary .summary-item span');
        if (summaryEl) {
            const arrow = percentChange >= 0 ? '↑' : '↓';
            const sign = percentChange >= 0 ? '+' : '';
            summaryEl.textContent = `${arrow} ${sign}${percentChange}% so với tuần trước`;
        }
    }
    
    initializeElements() {
        this.notificationsList = document.getElementById('notifications-list');
        this.filterTabs = document.querySelectorAll('.tab-btn[data-filter]');
        this.markAllReadBtn = document.getElementById('mark-all-read-btn');
        this.filterSelect = document.getElementById('filter-select');
        this.loadMoreBtn = document.getElementById('load-more-btn');
        this.refreshBtn = document.getElementById('refresh-btn');
        this.emptyState = document.getElementById('empty-state');
        
        // Sử dụng socket toàn cục
        this.socket = window.socket || (window.io ? io() : null);
        
        if (this.socket) {
        } else {
            console.warn('⚠️ Socket connection not available for notifications');
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
        
        // Filter select (sort)
        if (this.filterSelect) {
            this.filterSelect.addEventListener('change', (e) => this.handleSortChange(e));
        }
        
        // Load more
        if (this.loadMoreBtn) {
            this.loadMoreBtn.addEventListener('click', () => this.loadMore());
        }
        
        // Refresh button
        if (this.refreshBtn) {
            this.refreshBtn.addEventListener('click', () => this.safeRefreshNotifications());
        }
        
        // Initialize socket events
        this.initializeSocketEvents();
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'r' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this.safeRefreshNotifications();
            }
        });
    }
    
    initializeSocketEvents() {
        if (!this.socket) return;
        
        this.socket.on('new_notification', (data) => {
            this.handleNewNotification(data);
        });
        
        this.socket.on('notification_read', (data) => {
            this.handleNotificationRead(data);
        });
        
        this.socket.on('connect', () => {
            this.loadNotifications(1, true); // Load trực tiếp, không gọi refresh để tránh toast
        });
        
        this.socket.on('disconnect', () => {
        });
    }
    
    async loadNotifications(page = 1, force = false) {
        if (this.isLoading && !force) return;
        
        this.isLoading = true;
        this.showLoading();
        
        try {
            const params = new URLSearchParams({
                page: page,
                per_page: 20,
                sort: this.filterSelect?.value || 'newest'
            });
            
            // Xử lý filter
            if (this.currentFilter && this.currentFilter !== 'all') {
                if (this.currentFilter === 'unread') {
                    params.append('unread', 'true');  // Chỉ lấy thông báo chưa đọc
                } else if (this.currentFilter === 'read') {
                    params.append('read', 'true');    // Chỉ lấy thông báo đã đọc
                } else {
                    // Các filter khác (theo loại thông báo)
                    params.append('type', this.currentFilter);
                }
            }
                        
            const response = await fetch(`/api/notifications?${params.toString()}`);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            
            // Kiểm tra cấu trúc response
            const notifications = data.items || data.notifications || [];
            
            if (page === 1) {
                this.notifications = notifications;
            } else {
                this.notifications = [...this.notifications, ...notifications];
            }
            
            this.hasMore = data.page < data.total_pages;
            this.currentPage = page;
            
            this.renderNotifications();
            this.updateEmptyState();
            this.updateLoadMoreButton();
            this.updateNotificationCount();
            
        } catch (error) {
            console.error('❌ Error loading notifications:', error);
            this.showError('Lỗi khi tải thông báo. Vui lòng thử lại sau.');
        } finally {
            this.isLoading = false;
            this.hideLoading();
        }
    }
    
    renderNotifications() {
        if (!this.notificationsList) return;
        
        // Clear current list
        this.notificationsList.innerHTML = '';
        
        if (this.notifications.length === 0) {
            this.showEmptyState();
            return;
        }
        
        // Render từng notification
        this.notifications.forEach(notification => {
            const notificationElement = this.createNotificationElement(notification);
            this.notificationsList.appendChild(notificationElement);
        });
    }
    
    createNotificationElement(notification) {
        const div = document.createElement('div');
        div.className = `notification-item ${notification.read ? '' : 'unread'}`;
        div.dataset.notificationId = notification._id;
        
        const timeAgo = this.formatTimeAgo(notification.created_at);
        const notificationText = this.getNotificationText(notification);
        
        const senderAvatar = notification.sender_avatar || '/static/img/default-avatar.png';
        const senderName = notification.sender_name || 'Unknown';
        
        div.innerHTML = `
            <!-- Nút ba chấm ở góc trên bên phải -->
            <div class="notification-dropdown">
                <button class="btn btn-sm btn-outline-secondary dropdown-btn" 
                        onclick="window.notificationsManager.toggleDropdown(event, '${notification._id}')">
                    <i class="fas fa-ellipsis-v"></i>
                </button>
                <div class="dropdown-menu" id="dropdown-${notification._id}">
                    <button class="dropdown-item" onclick="window.notificationsManager.deleteNotification('${notification._id}', event)">
                        <i class="fas fa-trash"></i> Xóa thông báo
                    </button>
                </div>
            </div>
            
            <div class="notification-avatar">
                <img src="${senderAvatar}" alt="${senderName}" 
                     onerror="this.onerror=null; this.src='/static/img/default-avatar.png';">
            </div>
            <div class="notification-content">
                <div class="notification-text">
                    ${notificationText}
                    ${notification.data?.post_preview ? 
                        `<div class="post-preview">"${notification.data.post_preview}"</div>` : ''}
                </div>
                <div class="notification-meta">
                    <span class="notification-time">
                        <i class="far fa-clock"></i> ${timeAgo}
                    </span>
                </div>
                ${this.getActionButtons(notification)}
            </div>
            ${!notification.read ? '<div class="unread-dot"></div>' : ''}
        `;
        
        // Thêm sự kiện click
        div.addEventListener('click', (e) => {
            if (!e.target.closest('.action-btn') && !e.target.closest('.notification-dropdown')) {
                this.handleNotificationClick(notification);
            }
        });
        
        return div;
    }
    
    getIconClass(type) {
        const normalizedType = (type || '').toString().toLowerCase().trim();
        const iconMap = {
            'like': 'like',
            'comment': 'comment',
            'comment_like': 'like',
            'comment_reply': 'comment',
            'friend_request': 'friend',
            'friend_accept': 'friend',
            'mention': 'mention',
            'message': 'message',
            'share': 'share'
        };
        return iconMap[normalizedType] || 'default';
    }
    
    getIcon(type) {
        const normalizedType = (type || '').toString().toLowerCase().trim();
        const iconMap = {
            'like': 'fas fa-heart',
            'comment': 'fas fa-comment',
            'comment_like': 'fas fa-heart',
            'comment_reply': 'fas fa-reply',
            'friend_request': 'fas fa-user-plus',
            'friend_accept': 'fas fa-user-check',
            'mention': 'fas fa-at',
            'tag': 'fas fa-at',
            'message': 'fas fa-envelope',
            'share': 'fas fa-share'
        };
        return iconMap[normalizedType] || 'fas fa-bell';
    }
    
    getNotificationText(notification) {
        const senderName = `<strong>${notification.sender_name || 'Ai đó'}</strong>`;
        console.log("DEBUG notification:", JSON.stringify(notification));
        
        
        // Normalize type để xử lý viết hoa và khoảng trắng
        const normalizedType = (notification.type || '').toString().toLowerCase().trim();
        
        const texts = {
            'like': `${senderName} đã thích bài viết của bạn`,
            'comment': `${senderName} đã bình luận về bài viết của bạn`,
            'comment_reply': `${senderName} đã trả lời bình luận của bạn`,
            'comment_like': `${senderName} đã thích bình luận của bạn`,
            'friend_request': `${senderName} đã gửi lời mời kết bạn`,
            'friend_accept': `${senderName} đã chấp nhận lời mời kết bạn`,
            'mention': `${senderName} đã tag tên bạn`,
            'tag': `${senderName} đã tag tên bạn`,
            'message': `${senderName} đã gửi tin nhắn`,
            'share': `${senderName} đã chia sẻ bài viết của bạn`
        };
        
        return texts[normalizedType] || `${senderName} đã tương tác với bạn`;
    }
    
    getActionButtons(notification) {
        const normalizedType = (notification.type || '').toString().toLowerCase().trim();
        if (normalizedType === 'message') {
            return `
                <div class="notification-actions">
                    <button class="btn btn-sm btn-primary action-btn view-message" 
                            onclick="window.notificationsManager.goToMessage('${notification.data?.conversation_id}', event)">
                        <i class="fas fa-paper-plane"></i> Trả lời
                    </button>
                </div>
            `;
        }
        
        if (normalizedType === 'friend_request') {
            // Đã bỏ các nút chấp nhận/từ chối, click vào thông báo sẽ chuyển đến trang lời mời
            return '';
        }
        
        // Không cần action button cho các loại khác
        return '';
    }
    
    formatTimeAgo(timestamp) {
        if (!timestamp) return 'Vừa xong';
        
        const now = new Date();
        let past;
        
        // Handle timestamp format - server sends Vietnam time without timezone
        if (timestamp.includes('T') && !timestamp.includes('Z') && !timestamp.includes('+')) {
            // Server format: Vietnam time without timezone (e.g., "2025-03-08T10:30:00.123456")
            // Treat this as local time since it's already converted to Vietnam time
            past = new Date(timestamp);
        } else {
            // Standard ISO format with timezone
            past = new Date(timestamp);
        }
        
        const diffMs = now - past;
        
        if (diffMs < 60000) return 'Vừa xong';
        if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)} phút trước`;
        if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)} giờ trước`;
        if (diffMs < 604800000) return `${Math.floor(diffMs / 86400000)} ngày trước`;
        
        return past.toLocaleDateString('vi-VN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    }
    
    handleFilterChange(tab) {
        // Đổi tab active
        this.filterTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        // Lấy filter từ data-filter
        const filter = tab.dataset.filter;
        if (!filter) return;
        
        this.currentFilter = filter;
        this.currentPage = 1;
        this.loadNotifications();
    }
    
    handleSortChange(e) {
        this.currentPage = 1;
        this.loadNotifications();
    }
    
    async handleNotificationClick(notification) {
        try {
            // Đánh dấu là đã đọc
            if (!notification.read) {
                await this.markAsRead(notification._id);
                this.updateNotificationUI(notification._id, true);
                this.updateNotificationCount();
            }
            
            // Điều hướng dựa trên loại thông báo
            this.navigateFromNotification(notification);
            
        } catch (error) {
            console.error('Error handling notification click:', error);
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
            
            const data = await response.json();
            return data.success;
            
        } catch (error) {
            console.error('Error marking as read:', error);
            return false;
        }
    }
    
    async markAllAsRead() {
        if (!confirm('Bạn có chắc muốn đánh dấu tất cả thông báo là đã đọc?')) {
            return;
        }
        
        try {
            const response = await fetch('/api/notifications/mark-all-read', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            const data = await response.json();
            
            if (data.success) {
                // Cập nhật UI
                this.notifications.forEach(n => n.read = true);
                this.renderNotifications();
                this.updateNotificationCount();
                
                // Show success message
                this.showToast('Đã đánh dấu tất cả thông báo là đã đọc', 'success');
            }
            
        } catch (error) {
            console.error('Error marking all as read:', error);
            this.showToast('Lỗi khi đánh dấu đã đọc', 'error');
        }
    }
    
    toggleDropdown(event, notificationId) {
        event.stopPropagation();
        event.preventDefault();
        
        // Đóng tất cả các dropdown khác
        document.querySelectorAll('.dropdown-menu').forEach(menu => {
            if (menu.id !== `dropdown-${notificationId}`) {
                menu.classList.remove('show');
            }
        });
        
        // Toggle dropdown hiện tại
        const dropdown = document.getElementById(`dropdown-${notificationId}`);
        if (dropdown) {
            dropdown.classList.toggle('show');
        }
    }
    
    async deleteNotification(notificationId, event) {
        if (event) {
            event.stopPropagation();
            event.preventDefault();
        }
        
        // Đóng dropdown
        document.querySelectorAll('.dropdown-menu').forEach(menu => {
            menu.classList.remove('show');
        });
        
        if (!confirm('Bạn có chắc muốn xóa thông báo này?')) {
            return;
        }
        
        try {
            const response = await fetch(`/api/notifications/${notificationId}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            const data = await response.json();
            if (data.success) {
                // Xóa notification khỏi UI
                this.notifications = this.notifications.filter(n => n._id !== notificationId);
                this.renderNotifications();
                this.updateEmptyState();
                this.updateNotificationCount();
                
                // Không hiện toast success khi xóa để làm phiền
            } else {
                this.showToast(data.error || 'Không thể xóa thông báo', 'error');
            }
        } catch (error) {
            console.error('Error deleting notification:', error);
            this.showToast('Lỗi khi xóa thông báo', 'error');
        }
    }
    
    async handleFriendRequest(notificationId, action, event) {
        if (event) {
            event.stopPropagation();
            event.preventDefault();
        }
        
        try {
            const response = await fetch(`/api/friend_requests/${notificationId}/${action}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            const data = await response.json();
            
            if (data.success) {
                // Xóa notification khỏi UI
                this.notifications = this.notifications.filter(n => n._id !== notificationId);
                this.renderNotifications();
                this.updateEmptyState();
                
                // Show success message
                const actionText = action === 'accept' ? 'chấp nhận' : 'từ chối';
                this.showToast(`Đã ${actionText} lời mời kết bạn`, 'success');
                
                // Cập nhật badge
                this.updateNotificationCount();
            }
            
        } catch (error) {
            console.error('Error handling friend request:', error);
            this.showToast('Lỗi khi xử lý lời mời kết bạn', 'error');
        }
    }
    
    navigateFromNotification(notification) {
        let url = null;
        
        switch (notification.type) {
            case 'like':
            case 'comment':
            case 'comment_like':
            case 'comment_reply':
            case 'mention':
            case 'tag':
            case 'share':
                if (notification.data?.post_id) {
                    url = `/post/${notification.data.post_id}`;
                    
                    // Nếu có comment_id, thêm anchor
                    if (notification.data?.comment_id) {
                        url += `#comment-${notification.data.comment_id}`;
                    }
                }
                break;
                
            case 'friend_request':
            case 'friend_accept':
                url = '/friend_requests_page';
                break;
                
            case 'message':
                if (notification.data?.conversation_id) {
                    url = `/chat?conversation=${notification.data.conversation_id}`;
                } else {
                    url = '/chat';
                }
                break;
        }
        
        if (url) {
            window.location.href = url;
        }
    }
    
    goToMessage(conversationId, event) {
        if (event) {
            event.stopPropagation();
            event.preventDefault();
        }
        
        if (conversationId) {
            window.location.href = `/chat?conversation=${conversationId}`;
        }
    }
    
    goToPost(postId, event) {
        if (event) {
            event.stopPropagation();
            event.preventDefault();
        }
        
        if (postId) {
            window.location.href = `/post/${postId}`;
        }
    }
    
    handleNewNotification(notification) {
        
        // Kiểm tra trùng lặp
        const exists = this.notifications.some(n => n._id === notification._id);
        if (exists) {
            return;
        }
        
        // Thêm vào đầu danh sách
        this.notifications.unshift(notification);
        
        // Kiểm tra filter hiện tại
        const shouldShow = this.shouldShowNotification(notification);
        
        if (shouldShow) {
            this.renderNotifications();
            this.updateEmptyState();
        }
        
        // Cập nhật badge count
        this.updateNotificationCount();
        
        // Hiển thị browser notification
        this.showBrowserNotification(notification);
        
        // Phát âm thanh thông báo
        this.playNotificationSound();
        
        // Hiển thị toast
        this.showToast('Bạn có thông báo mới', 'info');
    }
    
    shouldShowNotification(notification) {
        if (this.currentFilter === 'all') return true;
        if (this.currentFilter === 'unread') return !notification.read;
        if (this.currentFilter === 'read') return notification.read;
        if (this.currentFilter === notification.type) return true;
        return false;
    }
    
    playNotificationSound() {
        try {
            const audio = new Audio('/static/sounds/notification.mp3');
            audio.volume = 0.3;
            audio.play().catch(e => console.log('Could not play sound:', e));
        } catch (error) {
        }
    }
    
    showBrowserNotification(notification) {
        if (!("Notification" in window)) return;
        
        if (Notification.permission === "granted") {
            const title = "PAW TALK - Thông báo mới";
            const body = this.getNotificationText(notification)
                .replace(/<[^>]*>/g, '')
                .replace(/&nbsp;/g, ' ');
            
            const notificationObj = new Notification(title, {
                body: body,
                icon: '/static/img/logo.png',
                tag: 'pawtalk-notification'
            });
            
            // Đóng thông báo sau 5 giây
            setTimeout(() => {
                notificationObj.close();
            }, 5000);
            
            // Click vào thông báo để mở ứng dụng
            notificationObj.onclick = () => {
                window.focus();
                this.navigateFromNotification(notification);
            };
        }
    }
    
    handleNotificationRead(data) {
        if (data.all) {
            // Đánh dấu tất cả là đã đọc
            this.notifications.forEach(n => n.read = true);
            this.renderNotifications();
        } else if (data.notificationId) {
            // Đánh dấu một notification cụ thể
            const notification = this.notifications.find(n => n._id === data.notificationId);
            if (notification) {
                notification.read = true;
                this.updateNotificationUI(data.notificationId, true);
            }
        }
    }
    
    updateNotificationUI(notificationId, isRead) {
        const element = document.querySelector(`[data-notification-id="${notificationId}"]`);
        if (element) {
            if (isRead) {
                element.classList.remove('unread');
                const dot = element.querySelector('.unread-dot');
                if (dot) dot.remove();
                
                // Thêm badge "đã đọc"
                const meta = element.querySelector('.notification-meta');
                if (meta && !meta.querySelector('.read-badge')) {
                    const readBadge = document.createElement('span');
                    readBadge.className = 'read-badge';
                    readBadge.textContent = 'Đã đọc';
                    meta.appendChild(readBadge);
                }
            }
        }
    }
    
    updateNotificationCount() {
        const unreadCount = this.notifications.filter(n => !n.read).length;
        
        // Cập nhật badge trong navbar
        const badge = document.getElementById('notifications-badge');
        if (badge) {
            if (unreadCount > 0) {
                badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
                badge.style.display = 'flex';
                badge.classList.add('has-notifications');
            } else {
                badge.textContent = '';
                badge.style.display = 'none';
                badge.classList.remove('has-notifications');
            }
        }
        
        // Cập nhật title tab
        this.updatePageTitle(unreadCount);
    }
    
    updatePageTitle(unreadCount) {
        const originalTitle = document.title.replace(/^\(\d+\)\s*/, '');
        
        if (unreadCount > 0) {
            document.title = `(${unreadCount}) ${originalTitle}`;
        } else {
            document.title = originalTitle;
        }
    }
    
    async loadMore() {
        if (!this.hasMore || this.isLoading) return;
        
        this.currentPage++;
        await this.loadNotifications(this.currentPage);
    }
    
    safeRefreshNotifications() {
        const now = Date.now();
        if (now - this.lastRefreshTime < this.refreshCooldown) {
            this.showToast('Vui lòng đợi một chút trước khi làm mới lại', 'warning');
            return;
        }
        
        this.lastRefreshTime = now;
        this.refreshNotifications();
    }
    
    refreshNotifications() {
        this.currentPage = 1;
        this.loadNotifications();
        // Không hiện toast để tránh làm phiền khi auto-refresh
    }
    
    showLoading() {
        if (this.notificationsList) {
            this.notificationsList.innerHTML = `
                <div class="loading-state">
                    <div class="loading-spinner">
                        <i class="fas fa-spinner fa-spin"></i>
                    </div>
                    <p>Đang tải thông báo...</p>
                </div>
            `;
        }
        
        if (this.loadMoreBtn) {
            this.loadMoreBtn.disabled = true;
            this.loadMoreBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang tải...';
        }
    }
    
    hideLoading() {
        if (this.loadMoreBtn) {
            this.updateLoadMoreButton();
        }
    }
    
    updateLoadMoreButton() {
        if (!this.loadMoreBtn) return;
        
        if (this.hasMore) {
            this.loadMoreBtn.disabled = false;
            this.loadMoreBtn.innerHTML = '<i class="fas fa-plus"></i> Tải thêm thông báo';
        } else {
            this.loadMoreBtn.disabled = true;
            this.loadMoreBtn.innerHTML = '<i class="fas fa-check"></i> Đã tải hết thông báo';
        }
    }
    
    updateEmptyState() {
        if (!this.emptyState) return;
        
        if (this.notifications.length === 0) {
            this.emptyState.style.display = 'block';
            if (this.notificationsList) {
                this.notificationsList.style.display = 'none';
            }
        } else {
            this.emptyState.style.display = 'none';
            if (this.notificationsList) {
                this.notificationsList.style.display = 'block';
            }
        }
    }
    
    showEmptyState() {
        if (this.notificationsList) {
            this.notificationsList.innerHTML = `
                <div class="empty-state-content">
                    <i class="far fa-bell-slash"></i>
                    <h3>Không có thông báo nào</h3>
                    <p>Khi có hoạt động mới, thông báo sẽ xuất hiện ở đây.</p>
                    <button class="btn btn-primary" onclick="window.notificationsManager.refreshNotifications()">
                        <i class="fas fa-sync-alt"></i> Làm mới
                    </button>
                </div>
            `;
        }
    }
    
    showError(message) {
        if (this.notificationsList) {
            this.notificationsList.innerHTML = `
                <div class="error-state">
                    <i class="fas fa-exclamation-triangle"></i>
                    <h3>Đã xảy ra lỗi</h3>
                    <p>${message}</p>
                    <button class="btn btn-outline" onclick="window.notificationsManager.refreshNotifications()">
                        <i class="fas fa-redo"></i> Thử lại
                    </button>
                </div>
            `;
        }
    }
    
    showToast(message, type = 'info') {
        // Bỏ qua nếu message rỗng, null, hoặc undefined
        if (!message || message.trim() === '') {
            return;
        }
        
        // Tạo toast element
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <div class="toast-content">
                <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
                <span>${message}</span>
            </div>
            <button class="toast-close">
                <i class="fas fa-times"></i>
            </button>
        `;
        
        // Thêm styles nếu chưa có
        if (!document.querySelector('#toast-styles')) {
            const styles = document.createElement('style');
            styles.id = 'toast-styles';
            styles.textContent = `
                .toast {
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    background: white;
                    padding: 12px 16px;
                    border-radius: 8px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    z-index: 9999;
                    border-left: 4px solid #007bff;
                    animation: slideInRight 0.3s ease;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    max-width: 350px;
                }
                .toast-success {
                    border-left-color: #28a745;
                }
                .toast-error {
                    border-left-color: #dc3545;
                }
                .toast-warning {
                    border-left-color: #ffc107;
                }
                .toast-info {
                    border-left-color: #17a2b8;
                }
                .toast-content {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    flex: 1;
                }
                .toast-content i {
                    font-size: 18px;
                }
                .toast-close {
                    background: none;
                    border: none;
                    color: #666;
                    cursor: pointer;
                    padding: 4px;
                    border-radius: 4px;
                    transition: background 0.2s;
                }
                .toast-close:hover {
                    background: rgba(0,0,0,0.05);
                }
                @keyframes slideInRight {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                @keyframes slideOutRight {
                    from { transform: translateX(0); opacity: 1; }
                    to { transform: translateX(100%); opacity: 0; }
                }
            `;
            document.head.appendChild(styles);
        }
        
        document.body.appendChild(toast);
        
        // Tự động đóng sau 4 giây
        const autoClose = setTimeout(() => {
            if (toast.parentNode) {
                toast.style.animation = 'slideOutRight 0.3s ease';
                setTimeout(() => {
                    if (toast.parentNode) {
                        toast.parentNode.removeChild(toast);
                    }
                }, 300);
            }
        }, 4000);
        
        // Nút đóng thủ công
        const closeBtn = toast.querySelector('.toast-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                clearTimeout(autoClose);
                if (toast.parentNode) {
                    toast.style.animation = 'slideOutRight 0.3s ease';
                    setTimeout(() => {
                        if (toast.parentNode) {
                            toast.parentNode.removeChild(toast);
                        }
                    }, 300);
                }
            });
        }
    }
}

// Khởi tạo khi DOM ready
document.addEventListener('DOMContentLoaded', () => {
    // Khởi tạo NotificationsManager
    window.notificationsManager = new NotificationsManager();
    
    // Navigation functionality
    initializeNavigation();
});

function initializeNavigation() {
    const navToggle = document.getElementById('nav-toggle');
    const sideNav = document.getElementById('side-nav');
    const navOverlay = document.getElementById('nav-overlay');
    
    if (navToggle && sideNav && navOverlay) {
        // Toggle menu
        navToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            sideNav.classList.toggle('active');
            navOverlay.classList.toggle('active');
            document.body.classList.toggle('menu-open');
        });
        
        // Close menu when clicking overlay
        navOverlay.addEventListener('click', () => {
            sideNav.classList.remove('active');
            navOverlay.classList.remove('active');
            document.body.classList.remove('menu-open');
        });
        
        // Close menu when clicking outside on mobile
        document.addEventListener('click', (e) => {
            if (window.innerWidth <= 768 && 
                sideNav.classList.contains('active') && 
                !sideNav.contains(e.target) && 
                !navToggle.contains(e.target)) {
                sideNav.classList.remove('active');
                navOverlay.classList.remove('active');
                document.body.classList.remove('menu-open');
            }
        });
        
        // Close menu on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && sideNav.classList.contains('active')) {
                sideNav.classList.remove('active');
                navOverlay.classList.remove('active');
                document.body.classList.remove('menu-open');
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
}

// Cleanup khi đóng tab
window.addEventListener('beforeunload', () => {
    if (window.notificationsManager && window.notificationsManager.socket) {
        window.notificationsManager.socket.disconnect();
    }
});

// Reconnect khi tab trở lại focus
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && window.notificationsManager) {
        window.notificationsManager.loadNotifications(1, true); // Load trực tiếp, không hiện toast
    }
});

// Đóng dropdown khi click bên ngoài
document.addEventListener('click', (event) => {
    if (!event.target.closest('.notification-dropdown')) {
        document.querySelectorAll('.dropdown-menu.show').forEach(menu => {
            menu.classList.remove('show');
        });
    }
    
    // Đóng delete dropdown khi click bên ngoài
    if (!event.target.closest('.dropdown-actions')) {
        const deleteDropdown = document.getElementById('delete-dropdown');
        if (deleteDropdown) {
            deleteDropdown.classList.remove('show');
        }
    }
});

// Toggle delete dropdown
function toggleDeleteDropdown(event) {
    event.stopPropagation();
    event.preventDefault();
    
    const dropdown = document.getElementById('delete-dropdown');
    if (dropdown) {
        dropdown.classList.toggle('show');
    }
}

// Quick Actions Functions
async function markAllRead() {
    try {
        const response = await fetch("/api/notifications/mark-all-read", {
            method: "POST",
            headers: { "Content-Type": "application/json" }
        });
        const data = await response.json();
        if (data.success) {
            showToast("Đã đánh dấu tất cả thông báo là đã đọc");
            if (window.notificationsManager) {
                window.notificationsManager.refreshNotifications();
            }
        } else {
            showToast(data.error || "Có lỗi xảy ra");
        }
    } catch (error) {
        console.error("Error marking all read:", error);
        showToast("Lỗi kết nối, vui lòng thử lại");
    }
}

async function deleteAllRead() {
    if (!confirm("Bạn có chắc muốn xóa tất cả thông báo đã đọc?")) return;
    
    try {
        const response = await fetch("/api/notifications/delete-all-read", {
            method: "POST",
            headers: { "Content-Type": "application/json" }
        });
        const data = await response.json();
        if (data.success) {
            if (data.message) {
                showToast(data.message);
            }
            if (window.notificationsManager) {
                window.notificationsManager.refreshNotifications();
            }
        } else {
            showToast(data.error || "Có lỗi xảy ra");
        }
    } catch (error) {
        console.error("Error deleting all read:", error);
        showToast("Lỗi kết nối, vui lòng thử lại");
    }
}

async function deleteAllNotifications() {
    if (!confirm("Bạn có chắc muốn xóa TẤT CẢ thông báo? Hành động này không thể hoàn tác!")) return;
    
    try {
        const response = await fetch("/api/notifications/delete-all", {
            method: "POST",
            headers: { "Content-Type": "application/json" }
        });
        const data = await response.json();
        if (data.success) {
            if (data.message) {
                showToast(data.message);
            }
            if (window.notificationsManager) {
                window.notificationsManager.refreshNotifications();
            }
        } else {
            showToast(data.error || "Có lỗi xảy ra");
        }
    } catch (error) {
        console.error("Error deleting all notifications:", error);
        showToast("Lỗi kết nối, vui lòng thử lại");
    }
}

function openNotifSettings() {
    // Create modal if not exists
    let modal = document.getElementById("notification-settings-modal");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "notification-settings-modal";
        modal.className = "modal notification-settings-modal";
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3><i class="fas fa-cog"></i> Cài đặt thông báo</h3>
                    <button class="close-btn" onclick="closeNotifSettings()">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="settings-section">
                        <h4>Loại thông báo</h4>
                        <label class="toggle-item">
                            <span>Thích bài viết</span>
                            <input type="checkbox" checked id="setting-like">
                            <span class="toggle-switch"></span>
                        </label>
                        <label class="toggle-item">
                            <span>Bình luận</span>
                            <input type="checkbox" checked id="setting-comment">
                            <span class="toggle-switch"></span>
                        </label>
                        <label class="toggle-item">
                            <span>Lời mời kết bạn</span>
                            <input type="checkbox" checked id="setting-friend">
                            <span class="toggle-switch"></span>
                        </label>
                        <label class="toggle-item">
                            <span>Chia sẻ bài viết</span>
                            <input type="checkbox" checked id="setting-share">
                            <span class="toggle-switch"></span>
                        </label>
                    </div>
                    <div class="settings-section">
                        <h4>Phương thức nhận</h4>
                        <label class="toggle-item">
                            <span>Thông báo trên web</span>
                            <input type="checkbox" checked id="setting-web">
                            <span class="toggle-switch"></span>
                        </label>
                        <label class="toggle-item">
                            <span>Thông báo push</span>
                            <input type="checkbox" id="setting-push">
                            <span class="toggle-switch"></span>
                        </label>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-primary" onclick="saveNotifSettings()">Lưu cài đặt</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        addNotifSettingsStyles();
    }
    modal.style.display = "flex";
}

function closeNotifSettings() {
    const modal = document.getElementById("notification-settings-modal");
    if (modal) modal.style.display = "none";
}

function saveNotifSettings() {
    // Save settings to localStorage for now
    const settings = {
        like: document.getElementById("setting-like")?.checked ?? true,
        comment: document.getElementById("setting-comment")?.checked ?? true,
        friend: document.getElementById("setting-friend")?.checked ?? true,
        share: document.getElementById("setting-share")?.checked ?? true,
        web: document.getElementById("setting-web")?.checked ?? true,
        push: document.getElementById("setting-push")?.checked ?? false
    };
    localStorage.setItem("notificationSettings", JSON.stringify(settings));
    showToast("Đã lưu cài đặt");
    closeNotifSettings();
}

function addNotifSettingsStyles() {
    if (document.getElementById("notif-settings-styles")) return;
    const styles = document.createElement("style");
    styles.id = "notif-settings-styles";
    styles.textContent = `
        .notification-settings-modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 1000;
        }
        .notification-settings-modal .modal-content {
            background: white;
            border-radius: 12px;
            width: 90%;
            max-width: 400px;
            animation: slideUp 0.3s ease;
        }
        .notification-settings-modal .modal-header {
            padding: 20px;
            border-bottom: 1px solid #e0e0e0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .notification-settings-modal .modal-header h3 {
            margin: 0;
            font-size: 18px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .notification-settings-modal .close-btn {
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            color: #666;
        }
        .notification-settings-modal .modal-body {
            padding: 20px;
        }
        .settings-section {
            margin-bottom: 20px;
        }
        .settings-section h4 {
            margin: 0 0 12px 0;
            color: #333;
            font-size: 14px;
        }
        .toggle-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 0;
            border-bottom: 1px solid #f0f0f0;
            cursor: pointer;
        }
        .toggle-item:last-child {
            border-bottom: none;
        }
        .toggle-item span:first-child {
            color: #333;
        }
        .toggle-item input {
            display: none;
        }
        .toggle-switch {
            width: 44px;
            height: 24px;
            background: #ccc;
            border-radius: 12px;
            position: relative;
            transition: background 0.3s;
        }
        .toggle-switch::after {
            content: "";
            position: absolute;
            width: 20px;
            height: 20px;
            background: white;
            border-radius: 50%;
            top: 2px;
            left: 2px;
            transition: transform 0.3s;
        }
        .toggle-item input:checked + .toggle-switch {
            background: #3eb489;
        }
        .toggle-item input:checked + .toggle-switch::after {
            transform: translateX(20px);
        }
        .modal-footer {
            padding: 20px;
            border-top: 1px solid #e0e0e0;
            text-align: right;
        }
        .btn-primary {
            background: linear-gradient(135deg, #3eb489, #2d9a71);
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
        }
        @keyframes slideUp {
            from { transform: translateY(20px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
    `;
    document.head.appendChild(styles);
}

function showToast(message) {
    // Bỏ qua nếu message rỗng, null, hoặc undefined
    if (!message || message.trim() === '') {
        return;
    }
    
    let toast = document.getElementById("toast-notification");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "toast-notification";
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #333;
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            z-index: 9999;
            font-size: 14px;
            opacity: 0;
            transition: opacity 0.3s;
        `;
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = "1";
    setTimeout(() => {
        toast.style.opacity = "0";
    }, 3000);
}

// Expose functions to global scope for onclick handlers
window.markAllRead = markAllRead;
window.deleteAllRead = deleteAllRead;
window.deleteAllNotifications = deleteAllNotifications;
window.toggleDeleteDropdown = toggleDeleteDropdown;
window.closeNotifSettings = closeNotifSettings;
window.saveNotifSettings = saveNotifSettings;

// Export cho các module khác sử dụng
export { NotificationsManager };
