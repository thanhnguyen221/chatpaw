// ==================== SESSION SECURITY MANAGEMENT ====================
class SessionSecurityManager {
    constructor() {
        this.checkInterval = null;
        this.lastCheck = null;
        this.checkFrequency = 30000; // 30 seconds
        this.warningShown = false;
        this.init();
    }

    init() {
        // Bắt đầu kiểm tra session nếu user đã đăng nhập
        if (this.isUserLoggedIn()) {
            this.startSessionMonitoring();
        }

        // Lắng nghe sự kiện socket để nhận thông báo từ server
        this.setupSocketListeners();
        
        // Kiểm tra session khi tab được focus lại
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && this.isUserLoggedIn()) {
                this.checkSessionStatus();
            }
        });

        // Kiểm tra khi user tương tác lại với trang
        ['click', 'keydown', 'scroll', 'mousemove'].forEach(event => {
            document.addEventListener(event, () => {
                if (this.isUserLoggedIn() && !this.checkInterval) {
                    this.startSessionMonitoring();
                }
            }, { once: true });
        });
    }

    isUserLoggedIn() {
        return window.session && window.session.user_id;
    }

    startSessionMonitoring() {
        if (this.checkInterval) return;

        this.checkInterval = setInterval(() => {
            this.checkSessionStatus();
        }, this.checkFrequency);

        // Kiểm tra ngay lập tức
        this.checkSessionStatus();
    }

    stopSessionMonitoring() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }

    async checkSessionStatus() {
        try {
            const response = await fetch('/api/session/check', {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (response.status === 401) {
                // Session không hợp lệ, chuyển về login
                this.handleSessionExpired();
                return;
            }

            const data = await response.json();
            
            if (data.valid) {
                this.lastCheck = new Date();
                this.warningShown = false;

                // Kiểm tra nếu có session cũ bị force logout
                if (data.session_info.previous_session_forced_out) {
                    this.showNotification('info', 'Bạn đã đăng xuất khỏi một thiết bị khác');
                }
            }
        } catch (error) {
            console.error('Session check failed:', error);
            // Nếu lỗi network, thử lại sau
            this.stopSessionMonitoring();
            setTimeout(() => {
                if (this.isUserLoggedIn()) {
                    this.startSessionMonitoring();
                }
            }, 10000);
        }
    }

    handleSessionExpired() {
        this.stopSessionMonitoring();
        
        // Hiển thị thông báo thân thiện
        this.showNotification('warning', 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
        
        // Chuyển về trang login sau 2 giây
        setTimeout(() => {
            window.location.href = '/login';
        }, 2000);
    }

    setupSocketListeners() {
        if (window.socket) {
            // Lắng nghe thông báo force logout từ server
            window.socket.on('force_logout', (data) => {
                this.handleForceLogout(data);
            });

            // Lắng nghe thông báo security
            window.socket.on('security_alert', (data) => {
                this.showNotification('warning', data.message);
            });
        }
    }

    handleForceLogout(data) {
        this.stopSessionMonitoring();
        
        const message = data.reason || 'Tài khoản của bạn đã được đăng xuất từ thiết bị khác vì lý do bảo mật.';
        
        this.showNotification('error', message);
        
        // Chuyển về login ngay lập tức
        setTimeout(() => {
            window.location.href = '/login';
        }, 1000);
    }

    async logoutFromAllDevices() {
        try {
            const response = await fetch('/api/session/force_logout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();
            
            if (data.success) {
                this.showNotification('success', 'Đã đăng xuất khỏi tất cả thiết bị');
                setTimeout(() => {
                    window.location.href = '/login';
                }, 1500);
            } else {
                this.showNotification('error', 'Không thể đăng xuất khỏi tất cả thiết bị');
            }
        } catch (error) {
            console.error('Force logout failed:', error);
            this.showNotification('error', 'Lỗi khi đăng xuất khỏi tất cả thiết bị');
        }
    }

    showNotification(type, message) {
        // Tạo notification element
        const notification = document.createElement('div');
        notification.className = `session-notification ${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <i class="fas ${this.getNotificationIcon(type)}"></i>
                <span>${message}</span>
                <button onclick="this.parentElement.parentElement.remove()" class="close-btn">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;

        // Thêm styles
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            max-width: 400px;
            animation: slideInRight 0.3s ease;
        `;

        document.body.appendChild(notification);

        // Tự động xóa sau 5 giây
        setTimeout(() => {
            if (notification.parentElement) {
                notification.style.animation = 'slideOutRight 0.3s ease';
                setTimeout(() => notification.remove(), 300);
            }
        }, 5000);
    }

    getNotificationIcon(type) {
        const icons = {
            'success': 'fa-check-circle',
            'warning': 'fa-exclamation-triangle',
            'error': 'fa-times-circle',
            'info': 'fa-info-circle'
        };
        return icons[type] || 'fa-info-circle';
    }
}

// CSS cho notifications
const notificationStyles = `
<style>
.session-notification {
    background: white;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    border-left: 4px solid;
    overflow: hidden;
}

.session-notification.success {
    border-left-color: #43b581;
}

.session-notification.warning {
    border-left-color: #faa61a;
}

.session-notification.error {
    border-left-color: #f04747;
}

.session-notification.info {
    border-left-color: #3eb489;
}

.notification-content {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    gap: 12px;
}

.notification-content i {
    font-size: 18px;
}

.notification-content.success i {
    color: #43b581;
}

.notification-content.warning i {
    color: #faa61a;
}

.notification-content.error i {
    color: #f04747;
}

.notification-content.info i {
    color: #3eb489;
}

.notification-content span {
    flex: 1;
    font-size: 14px;
    color: #2c3e50;
}

.close-btn {
    background: none;
    border: none;
    color: #999;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    transition: all 0.2s ease;
}

.close-btn:hover {
    background: rgba(0, 0, 0, 0.1);
    color: #666;
}

@keyframes slideInRight {
    from {
        transform: translateX(100%);
        opacity: 0;
    }
    to {
        transform: translateX(0);
        opacity: 1;
    }
}

@keyframes slideOutRight {
    from {
        transform: translateX(0);
        opacity: 1;
    }
    to {
        transform: translateX(100%);
        opacity: 0;
    }
}
</style>
`;

// Thêm styles vào page
document.head.insertAdjacentHTML('beforeend', notificationStyles);

// Khởi tạo session security manager
window.sessionSecurity = new SessionSecurityManager();

// Global function cho logout từ tất cả thiết bị
window.logoutFromAllDevices = () => {
    if (confirm('Bạn có chắc muốn đăng xuất khỏi tất cả thiết bị?')) {
        window.sessionSecurity.logoutFromAllDevices();
    }
};
