/**
 * Connection Status Manager
 * Quản lý trạng thái kết nối và hiển thị thông báo khi mất/kết nối lại
 */
class ConnectionManager {
    constructor() {
        this.isOnline = navigator.onLine;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectInterval = 3000; // 3 seconds
        this.notificationElement = null;
        this.statusIndicator = null;
        this.heartbeatInterval = null;
        this.heartbeatTimeout = null;
        this.heartbeatDelay = 5000; // 5 seconds
        
        this.init();
        
        // Intercept fetch to detect server failures immediately
        this.interceptFetch();
    }
    
    /**
     * Intercept fetch calls to detect server failures
     */
    interceptFetch() {
        const originalFetch = window.fetch;
        const self = this;
        
        window.fetch = async function(...args) {
            try {
                const response = await originalFetch.apply(this, args);
                
                // Check if it's a server error (5xx) but avoid health check endpoint
                if (!response.ok && response.status >= 500 && !args[0].includes('/api/health')) {
                    console.log('[ConnectionManager] Server error detected:', response.status);
                    if (self.isOnline) {
                        self.handleHeartbeatFailure();
                    }
                }
                
                return response;
            } catch (error) {
                console.log('[ConnectionManager] Fetch error detected:', error.message);
                
                // Detect network failures immediately but avoid health check endpoint
                if ((error.message.includes('Failed to fetch') || 
                    error.message.includes('NetworkError') ||
                    error.message.includes('ERR_NETWORK') ||
                    error.name === 'TypeError') && 
                    !args[0].includes('/api/health')) {
                    
                    if (self.isOnline) {
                        console.log('[ConnectionManager] Immediate network failure detected');
                        self.handleHeartbeatFailure();
                    }
                }
                
                throw error;
            }
        };
    }
    
    init() {
        this.createConnectionStatusUI();
        this.bindEvents();
        this.startHeartbeat();
        console.log('[ConnectionManager] Initialized, online status:', this.isOnline);
    }
    
    /**
     * Tạo UI elements cho trạng thái kết nối
     */
    createConnectionStatusUI() {
        // Tạo notification banner
        this.notificationElement = document.createElement('div');
        this.notificationElement.id = 'connection-status-notification';
        this.notificationElement.className = 'connection-notification';
        this.notificationElement.style.cssText = `
            position: fixed;
            top: -100px;
            left: 0;
            right: 0;
            z-index: 99999;
            padding: 15px;
            text-align: center;
            font-weight: 600;
            font-size: 14px;
            transition: top 0.3s ease;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            border-bottom: 3px solid;
        `;
        document.body.appendChild(this.notificationElement);
        
        // Tạo status indicator nhỏ
        this.statusIndicator = document.createElement('div');
        this.statusIndicator.id = 'connection-status-indicator';
        this.statusIndicator.className = 'connection-indicator';
        this.statusIndicator.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            border: 2px solid white;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            transition: all 0.3s ease;
            z-index: 99998;
            opacity: 0;
            transform: scale(0);
        `;
        document.body.appendChild(this.statusIndicator);
    }
    
    /**
     * Bind các events
     */
    bindEvents() {
        // Browser online/offline events
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());
        
        // Page visibility events - check immediately when page becomes visible
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                console.log('[ConnectionManager] Page became visible, checking connection...');
                this.checkConnection();
            }
        });
        
        // Focus events - check when window gains focus
        window.addEventListener('focus', () => {
            console.log('[ConnectionManager] Window gained focus, checking connection...');
            this.checkConnection();
        });
        
        // Socket events (nếu có socket)
        if (window.socket) {
            window.socket.on('connect', () => this.handleSocketConnect());
            window.socket.on('disconnect', () => this.handleSocketDisconnect());
        }
        
        // Listen for server shutdown events (if any)
        window.addEventListener('beforeunload', () => {
            console.log('[ConnectionManager] Page unloading...');
        });
    }
    
    /**
     * Bắt đầu heartbeat để kiểm tra kết nối
     */
    startHeartbeat() {
        this.stopHeartbeat();
        
        const heartbeat = async () => {
            try {
                // Create AbortController for timeout
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
                
                const response = await fetch('/api/health', {
                    method: 'GET',
                    cache: 'no-cache',
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                if (response.ok) {
                    this.handleHeartbeatSuccess();
                } else {
                    this.handleHeartbeatFailure();
                }
            } catch (error) {
                if (error.name === 'AbortError') {
                    console.log('[ConnectionManager] Health check timeout');
                }
                this.handleHeartbeatFailure();
            }
        };
        
        // Heartbeat mỗi 5 giây (thay vì 30 giây)
        this.heartbeatInterval = setInterval(heartbeat, this.heartbeatDelay);
        
        // Heartbeat đầu tiên ngay lập tức sau 1 giây
        this.heartbeatTimeout = setTimeout(() => {
            heartbeat();
        }, 1000);
    }
    
    /**
     * Dừng heartbeat
     */
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        if (this.heartbeatTimeout) {
            clearTimeout(this.heartbeatTimeout);
            this.heartbeatTimeout = null;
        }
    }
    
    /**
     * Xử lý khi online
     */
    handleOnline() {
        console.log('[ConnectionManager] Browser detected online');
        this.isOnline = true;
        this.showNotification('Đã kết nối lại với server', 'success');
        this.updateStatusIndicator('online');
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        
        // Gửi event cho các component khác
        window.dispatchEvent(new CustomEvent('connectionRestored'));
    }
    
    /**
     * Xử lý khi offline
     */
    handleOffline() {
        console.log('[ConnectionManager] Browser detected offline');
        this.isOnline = false;
        this.showNotification('Mất kết nối internet. Vui lòng kiểm tra kết nối mạng.', 'error');
        this.updateStatusIndicator('offline');
        this.stopHeartbeat();
        
        // Gửi event cho các component khác
        window.dispatchEvent(new CustomEvent('connectionLost'));
    }
    
    /**
     * Xử lý khi socket connect
     */
    handleSocketConnect() {
        console.log('[ConnectionManager] Socket connected');
        this.updateStatusIndicator('online');
        if (this.notificationElement.style.top !== '0px') {
            this.showNotification('Kết nối real-time đã được thiết lập', 'success');
        }
    }
    
    /**
     * Xử lý khi socket disconnect
     */
    handleSocketDisconnect() {
        console.log('[ConnectionManager] Socket disconnected');
        this.updateStatusIndicator('warning');
        this.showNotification('Mất kết nối real-time. Đang thử kết nối lại...', 'warning');
    }
    
    /**
     * Xử lý khi heartbeat thất bại
     */
    handleHeartbeatFailure() {
        if (this.isOnline) {
            console.log('[ConnectionManager] Connection lost detected');
            this.isOnline = false;
            this.showNotification('Mất kết nối với server, vui lòng chờ trong giây lát...', 'error');
            this.updateStatusIndicator('offline');
            this.stopHeartbeat(); // Stop current heartbeat to prevent conflicts
            
            // Start simple reconnect without showing attempts
            this.startSilentReconnect();
        }
    }
    
    /**
     * Xử lý heartbeat thành công
     */
    handleHeartbeatSuccess() {
        if (!this.isOnline) {
            this.isOnline = true;
            this.handleOnline();
        }
        this.reconnectAttempts = 0; // Reset attempts on success
        this.updateStatusIndicator('online');
    }
    
    /**
     * Bắt đầu reconnect thầm lặng (không hiển thị attempts)
     */
    startSilentReconnect() {
        let attempts = 0;
        const maxAttempts = 10; // Try more times silently
        
        const tryReconnect = () => {
            attempts++;
            console.log(`[ConnectionManager] Silent reconnect attempt ${attempts}/${maxAttempts}`);
            
            this.checkConnection().then(() => {
                if (!this.isOnline && attempts < maxAttempts) {
                    setTimeout(tryReconnect, 2000); // Try every 2 seconds
                }
            }).catch(() => {
                if (attempts < maxAttempts) {
                    setTimeout(tryReconnect, 2000);
                } else {
                    // After max attempts, show final message
                    this.showNotification('Không thể kết nối lại với server. Vui lòng tải lại trang.', 'error');
                }
            });
        };
        
        // Start trying immediately
        tryReconnect();
    }
    
    /**
     * Thử kết nối lại
     */
    attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.showNotification('Không thể kết nối lại với server. Vui lòng tải lại trang.', 'error');
            this.updateStatusIndicator('offline');
            return;
        }
        
        this.reconnectAttempts++;
        console.log(`[ConnectionManager] Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
        
        this.showNotification(
            `Đang thử kết nối lại... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`,
            'warning'
        );
        
        // Check connection immediately
        this.checkConnection().then(() => {
            // If still offline, schedule next attempt
            if (!this.isOnline && this.reconnectAttempts < this.maxReconnectAttempts) {
                setTimeout(() => {
                    this.attemptReconnect(); // Recursive call
                }, this.reconnectInterval);
            }
        }).catch(() => {
            // If check fails, still schedule next attempt
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                setTimeout(() => {
                    this.attemptReconnect(); // Recursive call
                }, this.reconnectInterval);
            }
        });
    }
    
    /**
     * Kiểm tra kết nối
     */
    async checkConnection() {
        try {
            const response = await fetch('/api/health', {
                method: 'GET',
                cache: 'no-cache',
                timeout: 3000
            });
            
            if (response.ok) {
                if (!this.isOnline) {
                    this.handleHeartbeatSuccess();
                    // Restart heartbeat if connection restored
                    this.startHeartbeat();
                }
            } else {
                if (this.isOnline) {
                    this.handleHeartbeatFailure();
                }
            }
        } catch (error) {
            if (this.isOnline) {
                this.handleHeartbeatFailure();
            }
        }
    }
    
    /**
     * Hiển thị thông báo
     */
    showNotification(message, type = 'info') {
        const colors = {
            success: { bg: '#28a745', border: '#1e7e34', text: '#ffffff' },
            error: { bg: '#dc3545', border: '#bd2130', text: '#ffffff' },
            warning: { bg: '#ffc107', border: '#d39e00', text: '#212529' },
            info: { bg: '#17a2b8', border: '#138496', text: '#ffffff' }
        };
        
        const color = colors[type] || colors.info;
        
        this.notificationElement.style.backgroundColor = color.bg;
        this.notificationElement.style.borderBottomColor = color.border;
        this.notificationElement.style.color = color.text;
        this.notificationElement.textContent = message;
        this.notificationElement.style.top = '0px';
        
        // Tự động ẩn sau 5 giây (trừ error)
        if (type !== 'error') {
            setTimeout(() => {
                this.hideNotification();
            }, 5000);
        }
    }
    
    /**
     * Ẩn thông báo
     */
    hideNotification() {
        this.notificationElement.style.top = '-100px';
    }
    
    /**
     * Cập nhật status indicator
     */
    updateStatusIndicator(status) {
        const colors = {
            online: '#28a745',
            offline: '#dc3545',
            warning: '#ffc107'
        };
        
        const color = colors[status] || colors.offline;
        
        this.statusIndicator.style.backgroundColor = color;
        this.statusIndicator.style.opacity = '1';
        this.statusIndicator.style.transform = 'scale(1)';
        
        // ẩn indicator sau 3 giây
        setTimeout(() => {
            this.statusIndicator.style.opacity = '0';
            this.statusIndicator.style.transform = 'scale(0)';
        }, 3000);
    }
    
    /**
     * Lấy trạng thái kết nối hiện tại
     */
    getConnectionStatus() {
        return {
            isOnline: this.isOnline,
            reconnectAttempts: this.reconnectAttempts,
            maxReconnectAttempts: this.maxReconnectAttempts
        };
    }
    
    /**
     * Hủy connection manager
     */
    destroy() {
        this.stopHeartbeat();
        if (this.notificationElement) {
            this.notificationElement.remove();
        }
        if (this.statusIndicator) {
            this.statusIndicator.remove();
        }
        
        // Remove event listeners
        window.removeEventListener('online', this.handleOnline);
        window.removeEventListener('offline', this.handleOffline);
        document.removeEventListener('visibilitychange', this.checkConnection);
    }
}

// Khởi tạo connection manager
window.connectionManager = new ConnectionManager();

// Export để sử dụng trong các file khác
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ConnectionManager;
}
