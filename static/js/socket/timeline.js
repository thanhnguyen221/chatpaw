// ==================== TIMELINE MANAGER CLASS ====================
class TimelineManager {
    constructor() {
        this.posts = [];
        this.currentPage = 1;
        this.perPage = 10;
        this.totalPosts = 0;
        this.totalPages = 0;
        this.hasMore = true;
        this.isLoading = false;
        this.currentFilter = 'all';
        this.pagination = null;
        this.currentSort = 'newest';
        this.activeFriends = [];
        this.socket = null;
        this.init();
    }
    
    async init() {
        await this.loadTimelinePosts();
        this.setupEventListeners();
        await this.loadActiveFriends();
        await this.loadTrendingTags();
        await this.loadTimelineStats();
        this.setupSocket();
        
        // Thiết lập scroll event với debounce
        let scrollTimeout;
        window.addEventListener('scroll', () => {
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                if (window.innerHeight + window.scrollY >= document.documentElement.offsetHeight - 100) {
                    this.loadMore();
                }
            }, 100);
        }, { passive: true });
    }
    
    setupEventListeners() {
        // Filter buttons
        document.querySelectorAll('.filter-tab-modern').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const filter = e.target.dataset.filter || e.target.closest('.filter-tab-modern').dataset.filter;
                if (filter) {
                    this.setFilter(filter);
                }
            });
        });
        
        // Load more button
        const loadMoreBtn = document.getElementById('load-more-btn');
        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', () => {
                this.loadMorePosts();
            });
        }
        
        // Quick post input
        const quickPostInput = document.querySelector('.post-input-mini');
        if (quickPostInput) {
            quickPostInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.createQuickPost();
                }
            });
        }
    }
    
    setFilter(filter) {
        if (this.currentFilter === filter) return;
        
        console.log(`[Timeline] Changing filter from ${this.currentFilter} to ${filter}`);
        this.currentFilter = filter;
        
        // Update active button
        document.querySelectorAll('.filter-tab-modern').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === filter);
        });
        
        // Cập nhật URL parameter
        const url = new URL(window.location);
        url.searchParams.set('filter', filter);
        window.history.replaceState({}, '', url);
        
        // Reset pagination và reload posts
        this.currentPage = 1;
        this.posts = [];
        this.pagination = null;
        const postsContainer = document.getElementById('timeline-posts');
        if (postsContainer) {
            postsContainer.innerHTML = '';
        }
        
        this.loadTimelinePosts();
    }
    
    async loadTimelinePosts() {
        if (this.isLoading) return;
        
        this.isLoading = true;
        this.showLoading(true);
        
        try {
            const params = new URLSearchParams({
                page: this.currentPage,
                filter: this.currentFilter,
                per_page: this.perPage,
                sort: this.currentSort
            });
            
            // Add hashtag parameter if present in URL
            const urlParams = new URLSearchParams(window.location.search);
            const hashtag = urlParams.get('hashtag');
            if (hashtag) {
                params.append('hashtag', hashtag);
                console.log('[DEBUG] Adding hashtag to API call:', hashtag);
            }
            
            const response = await fetch(`/api/timeline/posts?${params}`);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                // Update pagination info
                this.pagination = data.pagination;
                this.totalPosts = data.pagination.total_posts;
                this.totalPages = data.pagination.total_pages;
                this.hasMore = data.pagination.has_next;
                
                // If this is first page, replace posts; otherwise append
                if (this.currentPage === 1) {
                    this.posts = data.posts;
                } else {
                    this.posts = [...this.posts, ...data.posts];
                }
                
                this.renderPosts(data.posts);
                this.updatePaginationUI();
                
                // Show/hide no posts message
                const noPostsMsg = document.getElementById('no-posts-message');
                if (noPostsMsg) {
                    noPostsMsg.style.display = this.posts.length === 0 ? 'block' : 'none';
                }
                
                console.log(`Loaded ${data.posts.length} posts, total: ${this.posts.length}, page ${this.currentPage}/${this.totalPages}`);
            } else {
                console.error('Failed to load timeline posts:', data.error);
                this.showToast('Không thể tải bài viết', 'error');
            }
        } catch (error) {
            console.error('Error loading timeline posts:', error);
            this.showToast('Lỗi kết nối mạng', 'error');
        } finally {
            this.isLoading = false;
            this.showLoading(false);
        }
    }
    
    /**
     * Refresh sidebar trending tags - simple version
     */
    async refreshSidebarTrendingTags() {
        console.log('🔄 Refreshing sidebar trending tags...');
        
        try {
            // Fetch fresh data with cache-busting
            const timestamp = new Date().getTime();
            const response = await fetch(`/api/timeline/trending-tags?t=${timestamp}`);
            
            if (response.ok) {
                const data = await response.json();
                console.log('🔄 [DEBUG] Sidebar trending API response:', data);
                
                if (data.success && data.trending_tags) {
                    // Update sidebar only
                    this.renderSidebarTrendingTags(data.trending_tags);
                    console.log('✅ Sidebar trending tags refreshed');
                }
            }
        } catch (error) {
            console.error('❌ Error refreshing sidebar trending tags:', error);
        }
    }
    
    /**
     * Render trending tags in sidebar
     */
    renderSidebarTrendingTags(trendingTags) {
        const sidebarContainer = document.querySelector('.right-sidebar .trending-list-modern');
        if (!sidebarContainer) {
            console.log('🔄 [DEBUG] Sidebar trending container not found');
            return;
        }
        
        if (!trendingTags || trendingTags.length === 0) {
            sidebarContainer.innerHTML = `
                <div class="no-trending-tags">
                    <i class="fas fa-hashtag"></i>
                    <p>Chưa có xu hướng nào</p>
                </div>
            `;
            return;
        }
        
        const tagsHTML = trendingTags.map((trend, index) => `
            <div class="trending-item-modern" onclick="searchTag('${trend.tag}')">
                <div class="trending-rank">${index + 1}</div>
                <div class="trending-content-modern">
                    <div class="trending-title">#${trend.tag}</div>
                    <div class="trending-stats">${trend.count} bài viết</div>
                </div>
                <button class="trending-follow-btn">
                    <i class="fas fa-hashtag"></i>
                </button>
            </div>
        `).join('');
        
        sidebarContainer.innerHTML = tagsHTML;
        console.log('✅ [DEBUG] Sidebar trending tags rendered successfully');
    }
    
    /**
     * Test function - add to window for easy testing
     */
    testSidebarRefresh() {
        console.log('🧪 Testing sidebar refresh...');
        this.refreshSidebarTrendingTags();
    }
    
    async loadActiveFriends() {
        try {
            console.log('🔄 [DEBUG] Loading active friends...');
            const response = await fetch('/api/timeline/friends/active');
            
            console.log('🔄 [DEBUG] Response status:', response.status, response.statusText);
            
            if (!response.ok) {
                console.error('HTTP error:', response.status, response.statusText);
                return;
            }
            
            const data = await response.json();
            console.log('🔄 [DEBUG] API response:', data);
            
            if (data.success) {
                console.log(`✅ Loaded ${data.friends?.length || 0} active friends`);
                this.renderActiveFriends(data.friends || []);
            } else {
                console.error('❌ Error from server:', data.error);
            }
        } catch (error) {
            console.error('❌ Error loading active friends:', error);
        }
    }
    
    async loadTrendingTags() {
        try {
            console.log('🔥 [DEBUG] Loading trending tags...');
            const response = await fetch('/api/timeline/trending-tags');
            
            console.log('🔥 [DEBUG] Response status:', response.status, response.statusText);
            
            if (!response.ok) {
                console.error('HTTP error:', response.status, response.statusText);
                return;
            }
            
            const data = await response.json();
            console.log('🔥 [DEBUG] API response:', data);
            
            if (data.success) {
                console.log(`✅ Loaded ${data.trending_tags?.length || 0} trending tags`);
                this.renderTrendingTags(data.trending_tags || []);
            } else {
                console.error('❌ Error from server:', data.error);
            }
        } catch (error) {
            console.error('❌ Error loading trending tags:', error);
        }
    }
    
    renderTrendingTags(trendingTags) {
        console.log('🔥 [DEBUG] renderTrendingTags called with:', trendingTags);
        
        const container = document.querySelector('.trending-list-modern');
        console.log('🔥 [DEBUG] Container found:', !!container);
        
        if (!container) {
            console.error('❌ Không tìm thấy container cho trending tags');
            return;
        }
        
        if (!trendingTags || trendingTags.length === 0) {
            console.log('🔥 [DEBUG] No trending tags to display, showing empty state');
            container.innerHTML = `
                <div class="no-trending-tags">
                    <i class="fas fa-hashtag"></i>
                    <p>Chưa có xu hướng nào</p>
                </div>
            `;
            return;
        }
        
        console.log(`🔥 [DEBUG] Rendering ${trendingTags.length} trending tags`);
        container.innerHTML = trendingTags.map((trend, index) => `
            <div class="trending-item-modern" onclick="searchTag('${trend.tag}')">
                <div class="trending-rank">${index + 1}</div>
                <div class="trending-content-modern">
                    <div class="trending-title">#${trend.tag}</div>
                    <div class="trending-stats">${trend.count} bài viết</div>
                </div>
                <button class="trending-follow-btn">
                    <i class="fas fa-hashtag"></i>
                </button>
            </div>
        `).join('');
    }
    
    async loadTimelineStats() {
        try {
            const response = await fetch('/api/timeline/stats');
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                this.updateStats(data.stats);
            } else {
                console.error('Error loading timeline stats:', data.error);
            }
        } catch (error) {
            console.error('Error loading timeline stats:', error);
        }
    }
    
    async loadMorePosts() {
        if (this.isLoading || !this.hasMore) return;
        
        this.currentPage++;
        await this.loadTimelinePosts();
    }
    
    handleScroll() {
        if (this.isLoading || !this.hasMore) return;
        
        const scrollPosition = window.innerHeight + window.scrollY;
        const documentHeight = document.documentElement.scrollHeight;
        
        // Load more when 80% scrolled
        if (scrollPosition >= documentHeight * 0.8) {
            this.loadMorePosts();
        }
    }
    
    renderPosts(posts) {
        const postsContainer = document.getElementById('timeline-posts');
        if (!postsContainer) {
            console.error('Posts container not found!');
            return;
        }
        
        // Clear container before rendering to prevent duplicates
        postsContainer.innerHTML = '';
        
        posts.forEach(post => {
            const postElement = this.createPostElement(post);
            postsContainer.appendChild(postElement);
        });
        
        // Animate new posts
        this.animatePosts();
        
        // Initialize toggle functionality for newly added posts
        initializeTimelinePostContentToggle();
    }
    
    createPostElement(post) {
        const div = document.createElement('div');
        div.className = 'modern-post-card glass-effect';
        div.dataset.postId = post._id;
        div.dataset.userId = post.user_id; // Thêm data-user-id để kiểm tra owner
        div.dataset.isShared = post.is_shared || false;
        if (post.original_post_id) {
            div.dataset.originalPostId = post.original_post_id;
        }
        
        // Format date
        const timeAgo = this.formatTimeAgo(post.created_at);
        
        // Escape các giá trị để tránh lỗi template
        const authorAvatar = this.escapeHtml(post.author_avatar || '/static/img/default-avatar.png');
        const authorName = this.escapeHtml(post.author_full_name || post.author_name || 'Unknown User');
        const authorUsername = this.escapeHtml(post.author_username || '');
        
        // Shared post info
        let sharedContent = '';
        if (post.is_shared && post.original_post) {
            const original = post.original_post;
            sharedContent = `
            <div class="shared-post-embed" onclick="timelineManager.viewOriginalPost('${original._id}')" style="cursor: pointer;">
                <div class="shared-post-header">
                    <img src="${original.owner_avatar || '/static/img/default-avatar.png'}"
                        alt="${original.owner_full_name || original.owner_username}"
                        class="shared-avatar">
                    <div class="shared-meta">
                        <a href="/profile/${original.owner_username}" class="shared-author" onclick="event.stopPropagation()">
                            ${original.owner_full_name || original.owner_username}
                        </a>
                        <span class="shared-time">
                            ${original.created_at ? this.formatTimeAgo(original.created_at) : ''}
                        </span>
                    </div>
                </div>
                ${original.content ? `<div class="shared-content">${this.formatPostContent(original.content, original.tagged_friends)}</div>` : ''}
                ${original.media_urls && original.media_urls.length > 0 ? `
                <div class="shared-media-preview">
                    ${original.media_urls.slice(0, 1).map(media => `
                        ${media.type === 'image'
                            ? `<img src="${media.url}" class="shared-media-item">`
                            : `<video src="${media.url}" controls class="shared-media-item"></video>`
                        }
                    `).join('')}
                    ${original.media_urls.length > 1 ? `
                    <div class="shared-media-more">+${original.media_urls.length - 1}</div>
                    ` : ''}
                </div>
                ` : ''}
            </div>
            `;
        }
        
        // Comments section with full functionality
        const commentsSection = this.createCommentsSection(post);
        
        div.innerHTML = `
            <!-- Post Header -->
            <div class="post-header-modern">
                <div class="post-author-modern">
                    <div class="author-avatar-modern" onclick="window.location.href='/profile/${authorUsername}'">
                        <img src="${authorAvatar}" alt="${authorName}">
                        <div class="author-status"></div>
                    </div>
                    <div class="author-info-modern">
                        <div class="author-name-time">
                            <h3 class="author-name">
                                <a href="/profile/${authorUsername}">${authorName}</a>
                            </h3>
                            ${post.is_shared ? `
                            <span class="share-indicator">
                                <i class="fas fa-retweet"></i> đã chia sẻ
                            </span>
                            ` : ''}
                            <span class="post-time-modern">${timeAgo}</span>
                        </div>
                        <div class="post-privacy-modern">
                            <i class="fas ${post.privacy === 'only_me' || post.privacy === 'private' ? 'fa-lock' : post.privacy === 'friends' ? 'fa-user-friends' : 'fa-globe-asia'}"></i>
                            ${post.privacy === 'only_me' || post.privacy === 'private' ? 'Chỉ mình tôi' : post.privacy === 'friends' ? 'Bạn bè' : 'Công khai'}
                        </div>
                    </div>
                </div>
                <button class="post-menu-modern" onclick="timelineManager.togglePostMenu('${post._id}', event)">
                    <i class="fas fa-ellipsis-h"></i>
                </button>
            </div>
            
            <!-- Post Content -->
            ${post.content ? `
            <div class="post-content-modern" id="post-content-${post._id}">
                ${this.formatPostContent(post.content, post.tagged_friends)}
            </div>
            ` : ''}
            
            <!-- Shared Post -->
            ${sharedContent}
            
            <!-- Post Tags -->
            ${post.tags && post.tags.length > 0 ? `
            <div class="post-tags-modern">
                ${post.tags.map(tag => `
                    <span class="post-tag-modern" onclick="searchTag('${tag}')">#${tag}</span>
                `).join('')}
            </div>
            ` : ''}
            
            <!-- Post Media (only if not shared post with original media) -->
            ${!post.is_shared && post.media_urls && post.media_urls.length > 0 ? this.createMediaHTML(post) : ''}
            
            <!-- Post Stats -->
            <div class="post-stats-modern">
                <div class="stats-left">
                    <div class="reaction-stats" onclick="timelineManager.viewPostLikes('${post._id}')" style="cursor: pointer;">
                        <div class="reaction-icons-mini">
                            <span class="reaction-icon-mini" style="background: #27ae60;">
                                <i class="fas fa-heart"></i>
                            </span>
                        </div>
                        <span class="stats-count like-count-${post._id}">${post.likes_count || 0}</span>
                    </div>
                    <span class="stats-separator">•</span>
                    <span class="comments-count comment-count-${post._id}">${post.comments_count || 0} bình luận</span>
                    <span class="stats-separator">•</span>
                    <span class="shares-count">${post.shares_count || 0} chia sẻ</span>
                </div>
            </div>
            
            <!-- Post Actions -->
            <div class="post-actions-modern">
                <button class="action-btn like-btn ${post.is_liked ? 'liked' : ''}" 
                        id="like-btn-${post._id}"
                        onclick="timelineManager.handleLike('${post._id}', this, event)">
                    <i class="fas fa-heart"></i>
                    <span>${post.is_liked ? 'Đã thích' : 'Thích'}</span>
                </button>
                <button class="action-btn comment-btn" onclick="timelineManager.toggleComments('${post._id}')">
                    <i class="fas fa-comment"></i>
                    <span>Bình luận</span>
                </button>
                <button class="action-btn share-btn" onclick="timelineManager.handleShare('${post._id}')">
                    <i class="fas fa-share"></i>
                    <span>Chia sẻ</span>
                </button>
            </div>
            
            <!-- Comments Section -->
            <div id="comments-section-${post._id}" class="comments-section-modern" style="display: none;">
                ${commentsSection}
            </div>
        `;
        
        return div;
    }
    
    createCommentsSection(post) {
        const postId = post._id;
        const comments = post.comments || [];
        
        // Build comment tree
        const commentTree = this.buildCommentTree(comments);
        
        return `
            <!-- Comments List -->
            <div class="comments-list-modern" id="comments-list-${postId}">
                ${commentTree.length > 0 ? commentTree.map(comment => this.renderComment(comment, postId)).join('') : 
                    `<div class="no-comments" id="no-comments-${postId}">Chưa có bình luận nào</div>`}
            </div>
            
            <!-- Add Comment -->
            <div class="add-comment-modern">
                <img src="${window.userAvatar || '/static/img/default-avatar.png'}" 
                     alt="Your avatar" 
                     class="comment-avatar-you">
                <div class="comment-input-wrapper">
                    <!-- Reply Info -->
                    <div class="reply-info-display" id="reply-info-${postId}" style="display: none;">
                        <i class="fas fa-reply"></i>
                        <span>Đang trả lời <strong id="reply-to-name-${postId}"></strong></span>
                        <button onclick="timelineManager.cancelReply('${postId}')" class="cancel-reply-btn">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    
                    <div class="comment-input-area">
                        <textarea 
                            class="comment-input-modern" 
                            id="comment-input-${postId}"
                            placeholder="Viết bình luận..."
                            rows="1"
                            oninput="this.style.height = 'auto'; this.style.height = this.scrollHeight + 'px';"></textarea>
                        <button class="comment-submit-btn" onclick="timelineManager.submitComment('${postId}')">
                            <i class="fas fa-paper-plane"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }
    
    buildCommentTree(comments) {
        if (!comments || comments.length === 0) return [];
        
        // Backend trả về comments gốc với mảng replies bên trong
        // Chỉ cần xử lý datetime và trả về comments gốc
        return comments.map(comment => ({
            ...comment,
            replies: comment.replies || []
        }));
    }
    
    renderComment(comment, postId) {
        const hasReplies = comment.replies && comment.replies.length > 0;
        const repliesHtml = hasReplies ? `
            <div class="comment-replies-container" id="replies-${postId}-${comment.id}" style="display: block;">
                ${comment.replies.map(reply => this.renderReply(reply, postId, comment.id)).join('')}
            </div>
        ` : '';
        
        // Sử dụng đúng tên trường từ backend: full_name, username và user_avatar
        const authorName = comment.full_name || comment.username || 'Unknown';
        const authorAvatar = comment.author_avatar || comment.user_avatar || '/static/img/default-avatar.png';
        
        // Kiểm tra liked - chuyển tất cả về string để so sánh
        const currentUserId = String(window.currentUserId || '');
        const likes = comment.likes || [];
        const isLiked = comment.is_liked || likes.some(like => String(like) === currentUserId);
        const likesCount = comment.likes_count || likes.length;
        
        return `
            <div class="comment-item-modern" data-comment-id="${comment.id}" data-post-id="${postId}">
                <img src="${authorAvatar}" 
                     alt="${authorName}" 
                     class="comment-avatar-modern">
                <div class="comment-content-modern">
                    <div class="comment-header-modern">
                        <span class="comment-author-modern">${authorName}</span>
                        <span class="comment-time-modern">${this.formatTimeAgo(comment.created_at)}</span>
                    </div>
                    <div class="comment-text-modern">${this.formatPostContent(comment.content)}</div>
                    <div class="comment-actions-modern">
                        <button class="comment-like-btn ${isLiked ? 'liked' : ''}" 
                                onclick="timelineManager.likeComment('${postId}', '${comment.id}')">
                            <i class="${isLiked ? 'fas' : 'far'} fa-heart"></i>
                            <span class="like-count">${likesCount}</span>
                        </button>
                        <button class="comment-reply-btn" onclick="timelineManager.startReply('${postId}', '${comment.id}', '${authorName}')">
                            <i class="fas fa-reply"></i> Trả lời
                        </button>
                        ${hasReplies ? `
                        <button class="view-replies-btn" onclick="timelineManager.toggleReplies('${postId}', '${comment.id}')">
                            <i class="fas fa-comments"></i>
                            <span class="reply-count">${comment.replies.length}</span> trả lời
                            <i class="fas fa-chevron-down toggle-icon"></i>
                        </button>
                        ` : ''}
                    </div>
                    ${repliesHtml}
                </div>
            </div>
        `;
    }
    
    renderReply(reply, postId, parentCommentId) {
        // Sử dụng đúng tên trường từ backend: full_name, username và user_avatar
        const authorName = reply.full_name || reply.username || 'Unknown';
        const authorAvatar = reply.author_avatar || reply.user_avatar || '/static/img/default-avatar.png';
        
        // Kiểm tra liked - chuyển tất cả về string để so sánh
        const currentUserId = String(window.currentUserId || '');
        const likes = reply.likes || [];
        const isLiked = reply.is_liked || likes.some(like => String(like) === currentUserId);
        const likesCount = reply.likes_count || likes.length;
        
        return `
            <div class="comment-reply-modern" data-comment-id="${reply.id}" data-post-id="${postId}">
                <img src="${authorAvatar}" 
                     alt="${authorName}" 
                     class="comment-avatar-modern small">
                <div class="comment-content-modern">
                    <div class="comment-header-modern">
                        <span class="comment-author-modern">${authorName}</span>
                        ${reply.reply_to_username ? `<span class="reply-to">→ @${reply.reply_to_username}</span>` : ''}
                        <span class="comment-time-modern">${this.formatTimeAgo(reply.created_at)}</span>
                    </div>
                    <div class="comment-text-modern">${this.formatPostContent(reply.content)}</div>
                    <div class="comment-actions-modern">
                        <button class="comment-like-btn ${isLiked ? 'liked' : ''}" 
                                onclick="timelineManager.likeComment('${postId}', '${parentCommentId}', '${reply.id}')">
                            <i class="${isLiked ? 'fas' : 'far'} fa-heart"></i>
                            <span class="like-count">${likesCount}</span>
                        </button>
                        <button class="comment-reply-btn" onclick="timelineManager.startReply('${postId}', '${reply.id}', '${authorName}')">
                            <i class="fas fa-reply"></i> Trả lời
                        </button>
                    </div>
                </div>
            </div>
        `;
    }
    
    formatPostContent(content, taggedFriends = []) {
        console.log('[DEBUG] formatPostContent called with:', { content, taggedFriends });
        let formattedContent = content;
        
        // Convert @mentions to blue clickable links
        if (taggedFriends && taggedFriends.length > 0) {
            console.log('[DEBUG] Processing tagged friends:', taggedFriends);
            taggedFriends.forEach(friend => {
                // Use display_name (full name) instead of username since that's what gets inserted
                const displayName = friend.display_name || friend.full_name || friend.username;
                const mentionRegex = new RegExp(`@${displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
                console.log('[DEBUG] Looking for:', `@${displayName}`, 'in content:', formattedContent);
                formattedContent = formattedContent.replace(mentionRegex, 
                    `<a href="/profile/${friend.username}" class="tagged-friend-mention" onclick="event.stopPropagation()">@${displayName}</a>`
                );
                console.log('[DEBUG] After replacement:', formattedContent);
            });
        } else {
            console.log('[DEBUG] No tagged friends to process');
        }
        
        // Convert hashtags to clickable links - add hashtag-link class
        // Use [^\s#] to match any non-whitespace, non-hash character including Vietnamese
        const hashtagRegex = /#([^\s#]+)/g;
        formattedContent = formattedContent.replace(hashtagRegex, 
            '<a href="/hashtag/$1" class="hashtag-link">#$1</a>'
        );
        
        // Convert URLs to links
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        formattedContent = formattedContent.replace(urlRegex, url => 
            `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
        );
        
        // Convert line breaks to <br>
        const result = formattedContent.replace(/\n/g, '<br>');
        console.log('[DEBUG] Final formatted content:', result);
        return result;
    }
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    formatTimeAgo(timestamp) {
        if (!timestamp) return '';
        
        // Parse timestamp - xử lý ISO format từ UTC
        let date;
        if (timestamp.includes('T') && timestamp.includes('Z')) {
            // UTC format với Z suffix
            date = new Date(timestamp);
        } else if (timestamp.includes('T')) {
            // ISO format không có Z, thêm Z để chỉ định UTC
            date = new Date(timestamp + 'Z');
        } else {
            // Format khác, coi là local time
            date = new Date(timestamp);
        }
        
        const now = new Date();
        
        // Tính khoảng cách thời gian (milliseconds)
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);
        
        // Debug log
        console.log(`[Timeline Debug] timestamp: ${timestamp}, date: ${date}, now: ${now}, diffMs: ${diffMs}, diffMins: ${diffMins}`);
        
        if (diffMins < 1) return 'Vừa xong';
        if (diffMins < 60) return `${diffMins} phút trước`;
        if (diffHours < 24) return `${diffHours} giờ trước`;
        if (diffDays < 7) return `${diffDays} ngày trước`;
        
        // Format ngày tháng cho bài cũ
        return date.toLocaleDateString('vi-VN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });
    }
    
    createMediaHTML(post) {
        const mediaUrls = post.media_urls || [];
        
        if (mediaUrls.length === 1) {
            const media = mediaUrls[0];
            if (media.type === 'image') {
                return `
                <div class="post-media-modern">
                    <div class="single-media" onclick="openMediaViewer('${post._id}', 0)">
                        <img src="${media.url}" alt="Post image" class="media-item-single" loading="lazy">
                    </div>
                </div>
                `;
            } else if (media.type === 'video') {
                return `
                <div class="post-media-modern">
                    <div class="single-media" onclick="openMediaViewer('${post._id}', 0)" data-video-url="${media.url}">
                        <img src="${media.thumbnail || media.url}" alt="Video" class="media-item-single" loading="lazy">
                        <div class="video-play-btn" style="pointer-events: none;">
                            <i class="fas fa-play"></i>
                        </div>
                    </div>
                </div>
                `;
            }
        } else if (mediaUrls.length > 1) {
            // Determine optimal grid layout based on number of images
            const imageCount = mediaUrls.length;
            let maxDisplay = imageCount;
            
            if (imageCount > 9) {
                maxDisplay = 9;
            }
            
            const displayUrls = mediaUrls.slice(0, maxDisplay);
            const remaining = mediaUrls.length - maxDisplay;
            
            return `
            <div class="post-media-modern">
                <div class="media-grid-modern" data-images="${Math.min(imageCount, 9)}">
                    ${displayUrls.map((media, index) => `
                    <div class="media-grid-item" onclick="openMediaViewer('${post._id}', ${index})">
                        ${media.type === 'image' ? 
                            `<img src="${media.url}" alt="Post image" loading="lazy">` : 
                            `<div class="video-thumbnail">
                                <img src="${media.thumbnail || media.url || '/static/img/default-avatar.png'}" alt="Video" loading="lazy">
                                <div class="video-overlay">
                                    <i class="fas fa-play"></i>
                                </div>
                            </div>`
                        }
                        ${index === maxDisplay - 1 && remaining > 0 ? 
                            `<div class="media-more-overlay">+${remaining}</div>` : ''
                        }
                    </div>
                    `).join('')}
                </div>
            </div>
            `;
        }
        
        return '';
    }
    
    renderActiveFriends(friends) {
        console.log('🎨 [DEBUG] renderActiveFriends called with:', friends);
        
        const container = document.querySelector('.online-list-scroll');
        console.log('🎨 [DEBUG] Container found:', !!container);
        
        if (!container) {
            console.error('❌ Không tìm thấy container cho active friends');
            return;
        }
        
        if (!friends || friends.length === 0) {
            console.log('🎨 [DEBUG] No friends to display, showing empty state');
            container.innerHTML = `
                <div class="no-active-friends">
                    <i class="fas fa-user-slash"></i>
                    <p>Không có bạn bè nào đang hoạt động</p>
                </div>
            `;
            return;
        }
        
        console.log(`🎨 [DEBUG] Rendering ${friends.length} friends`);
        container.innerHTML = friends.map(friend => `
            <div class="online-friend-mini" onclick="window.location.href='/profile/${friend.username}'">
                <div class="friend-avatar-mini">
                    <img src="${friend.avatar || '/static/img/default-avatar.png'}" 
                         alt="${friend.full_name || friend.username}"
                         loading="lazy">
                    <div class="active-dot"></div>
                </div>
                <span class="friend-name-mini">${friend.full_name || friend.username}</span>
            </div>
        `).join('');
    }
    
    updateStats(stats) {
        if (!stats) return;
        
        const todayPosts = document.getElementById('today-posts');
        const activeFriendsCount = document.getElementById('active-friends-count');
        const avgInteractions = document.getElementById('avg-interactions');
        
        if (todayPosts) todayPosts.textContent = stats.today_posts || 0;
        if (activeFriendsCount) activeFriendsCount.textContent = stats.active_friends || 0;
        if (avgInteractions) avgInteractions.textContent = stats.avg_interactions || 0;
    }
    
    showLoading(show) {
        const loadingIndicator = document.getElementById('timeline-loading');
        if (loadingIndicator) {
            loadingIndicator.style.display = show ? 'block' : 'none';
        }
        
        const loadMoreBtn = document.getElementById('load-more-btn');
        if (loadMoreBtn) {
            if (show) {
                loadMoreBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang tải...';
                loadMoreBtn.disabled = true;
            } else {
                loadMoreBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Tải thêm bài viết';
                loadMoreBtn.disabled = !this.hasMore;
            }
        }
    }
    
    animatePosts() {
        const posts = document.querySelectorAll('.modern-post-card');
        posts.forEach((post, index) => {
            post.style.animationDelay = `${index * 0.05}s`;
        });
    }
    
    // ==================== POST INTERACTIONS ====================
    
    async handleLike(postId, button, event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        
        // Kiểm tra nếu đang xử lý
        if (button.disabled) return;
        
        console.log(`[DEBUG] handleLike called - postId: ${postId}, disabled: ${button.disabled}`);
        
        try {
            // Disable button để tránh double click
            button.disabled = true;
            
            // Kiểm tra trạng thái hiện tại
            const isLiked = button.classList.contains('liked');
            const method = isLiked ? 'DELETE' : 'POST';
            
            console.log(`[DEBUG] Sending ${method} request to /api/timeline/posts/${postId}/like`);
            
            const response = await fetch(`/api/timeline/posts/${postId}/like`, {
                method: method,
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            const data = await response.json();
            console.log(`[DEBUG] Like response:`, data);
            
            if (data.success) {
                // Update button
                button.classList.toggle('liked', data.action === 'liked');
                const icon = button.querySelector('i');
                const text = button.querySelector('span');
                
                if (data.action === 'liked') {
                    icon.className = 'fas fa-heart';
                    if (text) text.textContent = 'Đã thích';
                } else {
                    icon.className = 'fas fa-heart';
                    if (text) text.textContent = 'Thích';
                }
                
                // Update count
                const statsCount = button.closest('.modern-post-card')?.querySelector('.stats-count');
                if (statsCount && data.like_count !== undefined) {
                    statsCount.textContent = data.like_count;
                }
                
                // Emit socket event
                if (this.socket) {
                    this.socket.emit('post_liked', {
                        post_id: postId,
                        user_id: window.currentUserId,
                        action: data.action
                    });
                }
            }
        } catch (error) {
            console.error('Error liking post:', error);
            this.showToast('Không thể thích bài viết', 'error');
        } finally {
            // Re-enable button
            button.disabled = false;
        }
    }
    
    focusCommentInput(postId) {
        const input = document.getElementById(`comment-input-${postId}`);
        if (input) {
            input.focus();
        }
    }
    
    async addComment(postId, inputElement) {
        const content = inputElement.value.trim();
        if (!content) return;
        
        try {
            const response = await fetch(`/api/posts/${postId}/comments`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ content: content })
            });
            
            const data = await response.json();
            
            if (data.success) {
                inputElement.value = '';
                this.showToast('Đã thêm bình luận', 'success');
                
                // Update comments preview
                await this.loadCommentsPreview(postId);
                
                // Emit socket event
                if (this.socket) {
                    this.socket.emit('new_comment', {
                        post_id: postId,
                        comment: data.comment
                    });
                }
            }
        } catch (error) {
            console.error('Error adding comment:', error);
            this.showToast('Không thể thêm bình luận', 'error');
        }
    }
    
    async loadCommentsPreview(postId) {
        try {
            const response = await fetch(`/api/posts/${postId}/comments/preview`);
            const data = await response.json();
            
            if (data.success) {
                const previewContainer = document.getElementById(`comments-preview-${postId}`);
                if (previewContainer) {
                    previewContainer.innerHTML = data.comments.map(comment => `
                        <div class="comment-preview-item">
                            <img src="${comment.author_avatar || '/static/img/default-avatar.png'}" 
                                 alt="${comment.author_full_name || comment.author_name}" 
                                 class="comment-avatar-preview">
                            <div class="comment-preview-content">
                                <span class="comment-author-preview">${comment.author_full_name || comment.author_name}</span>
                                <span class="comment-text-preview">${comment.content}</span>
                            </div>
                        </div>
                    `).join('');
                    
                    if (data.total > 2) {
                        previewContainer.innerHTML += `
                            <button class="view-all-comments" onclick="timelineManager.loadAllComments('${postId}')">
                                Xem tất cả ${data.total} bình luận
                            </button>
                        `;
                    }
                }
            }
        } catch (error) {
            console.error('Error loading comments preview:', error);
        }
    }
    
    async loadAllComments(postId) {
        // Open comments modal or expand comments section
        console.log('Load all comments for post:', postId);
        // Implement modal for viewing all comments
    }
    
    handleShare(postId) {
        // Dùng modal chia sẻ thống nhất
        window.shareToProfile(postId);
    }
    
    showShareMenu(postId) {
        // Đóng các menu cũ nếu có
        const existingMenu = document.getElementById(`share-menu-${postId}`);
        if (existingMenu) existingMenu.remove();
        
        // Tạo menu chia sẻ
        const menuHTML = `
        <div class="share-menu" id="share-menu-${postId}">
            <div class="share-menu-content">
                <div class="share-menu-header">
                    <h3><i class="fas fa-share-alt" style="color: #3eb489;"></i> Chia sẻ bài viết</h3>
                    <button class="close-btn" onclick="this.closest('.share-menu').remove()">&times;</button>
                </div>
                <div class="share-menu-body">
                    <button class="share-item" onclick="timelineManager.shareToProfile('${postId}')">
                        <div class="share-icon"><i class="fas fa-user-edit"></i></div>
                        <div class="share-text">
                            <strong>Chia sẻ ngay</strong>
                            <span>Đăng lên trang cá nhân của bạn</span>
                        </div>
                    </button>
                    
                    <button class="share-item" onclick="timelineManager.copyPostLink('${postId}')">
                        <div class="share-icon"><i class="fas fa-link"></i></div>
                        <div class="share-text">
                            <strong>Sao chép liên kết</strong>
                            <span>Lưu đường dẫn bài viết này</span>
                        </div>
                    </button>
                </div>
            </div>
        </div>
        `;
        
        // Thêm menu vào body
        document.body.insertAdjacentHTML('beforeend', menuHTML);
        
        // Đóng menu khi click bên ngoài
        setTimeout(() => {
            document.addEventListener('click', function closeMenu(e) {
                const menu = document.getElementById(`share-menu-${postId}`);
                if (menu && !menu.contains(e.target)) {
                    menu.remove();
                    document.removeEventListener('click', closeMenu);
                }
            });
        }, 100);
    }
    
    async viewOriginalPost(originalPostId) {
        try {
            // Chuyển đến trang chi tiết bài viết gốc
            window.location.href = `/post/${originalPostId}`;
        } catch (error) {
            console.error('Error navigating to original post:', error);
            this.showToast('Không thể chuyển đến bài viết gốc', 'error');
        }
    }

    async toggleComments(postId) {
        const commentsSection = document.getElementById(`comments-section-${postId}`);
        if (commentsSection) {
            const isVisible = commentsSection.style.display !== 'none';
            commentsSection.style.display = isVisible ? 'none' : 'block';
            
            if (!isVisible) {
                // Tải bình luận khi mở
                await this.loadComments(postId);
                // Focus vào input khi mở
                const input = document.getElementById(`comment-input-${postId}`);
                if (input) input.focus();
            }
        }
    }
    
    async loadComments(postId) {
        try {
            const response = await fetch(`/api/timeline/posts/${postId}/comments`);
            const data = await response.json();
            
            if (data.success) {
                const commentsList = document.getElementById(`comments-list-${postId}`);
                if (commentsList) {
                    // Xóa nội dung cũ
                    commentsList.innerHTML = '';
                    
                    if (data.comments && data.comments.length > 0) {
                        // Xây dựng cây bình luận
                        const commentTree = this.buildCommentTree(data.comments);
                        // Render từng bình luận gốc
                        commentTree.forEach(comment => {
                            const commentHtml = this.renderComment(comment, postId);
                            commentsList.insertAdjacentHTML('beforeend', commentHtml);
                        });
                    } else {
                        // Không có bình luận
                        commentsList.innerHTML = `
                            <div id="no-comments-${postId}" class="no-comments">
                                <i class="far fa-comment-dots" style="font-size: 24px; opacity: 0.5; margin-bottom: 8px;"></i>
                                <p>Chưa có bình luận nào. Hãy là người đầu tiên bình luận!</p>
                            </div>
                        `;
                    }
                }
            }
        } catch (error) {
            console.error('Error loading comments:', error);
        }
    }
    
    async submitComment(postId) {
        const input = document.getElementById(`comment-input-${postId}`);
        const content = input.value.trim();
        if (!content) return;
        
        // Lấy thông tin reply nếu có
        const replyInfo = document.getElementById(`reply-info-${postId}`);
        const isReply = replyInfo.style.display !== 'none';
        const replyToName = document.getElementById(`reply-to-name-${postId}`)?.textContent;
        
        // Lấy reply_to từ input data attribute
        const replyToId = input.dataset.replyTo || null;
        
        try {
            const requestData = {
                post_id: postId,
                content: content
            };
            
            if (replyToId) {
                requestData.reply_to = replyToId;
                requestData.reply_to_username = replyToName;
            }
            
            const response = await fetch(`/api/timeline/posts/${postId}/comments`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestData)
            });
            
            const data = await response.json();
            
            if (data.success) {
                input.value = '';
                input.style.height = 'auto';
                
                // Xóa trạng thái reply
                this.cancelReply(postId);
                
                this.showToast('Đã thêm bình luận', 'success');
                
                // Cập nhật số lượng comment
                const commentCount = document.querySelector(`.comment-count-${postId}`);
                if (commentCount) {
                    const currentCount = parseInt(commentCount.textContent) || 0;
                    commentCount.textContent = `${currentCount + 1} bình luận`;
                }
                
                // Thêm comment mới vào UI
                this.addCommentToUI(postId, data.comment);
                
                // Emit socket event
                if (this.socket) {
                    this.socket.emit('new_comment', {
                        post_id: postId,
                        comment: data.comment
                    });
                }
            } else {
                this.showToast(data.error || 'Không thể thêm bình luận', 'error');
            }
        } catch (error) {
            console.error('Error adding comment:', error);
            this.showToast('Không thể thêm bình luận', 'error');
        }
    }
    
    addCommentToUI(postId, comment) {
        // Kiểm tra nếu là reply (có reply_to)
        if (comment.reply_to) {
            // Tìm comment cha
            const parentComment = document.querySelector(`[data-comment-id="${comment.reply_to}"]`);
            if (parentComment) {
                // Tìm hoặc tạo replies container
                let repliesContainer = parentComment.querySelector('.comment-replies-container');
                if (!repliesContainer) {
                    // Tạo container mới nếu chưa có
                    const repliesHtml = `
                        <div class="comment-replies-container" id="replies-${postId}-${comment.reply_to}" style="display: block;">
                        </div>
                    `;
                    parentComment.querySelector('.comment-content-modern').insertAdjacentHTML('beforeend', repliesHtml);
                    repliesContainer = parentComment.querySelector('.comment-replies-container');
                    
                    // Cập nhật nút xem replies nếu có
                    const viewRepliesBtn = parentComment.querySelector('.view-replies-btn');
                    if (viewRepliesBtn) {
                        const replyCount = viewRepliesBtn.querySelector('.reply-count');
                        const currentCount = parseInt(replyCount.textContent) || 0;
                        replyCount.textContent = currentCount + 1;
                    } else {
                        // Thêm nút xem replies nếu chưa có
                        const actionsContainer = parentComment.querySelector('.comment-actions-modern');
                        const viewBtnHtml = `
                            <button class="view-replies-btn" onclick="timelineManager.toggleReplies('${postId}', '${comment.reply_to}')">
                                <i class="fas fa-comments"></i>
                                <span class="reply-count">1</span> trả lời
                                <i class="fas fa-chevron-up toggle-icon"></i>
                            </button>
                        `;
                        actionsContainer.insertAdjacentHTML('beforeend', viewBtnHtml);
                    }
                }
                
                // Render reply và thêm vào container
                const replyHtml = this.renderReply(comment, postId, comment.reply_to);
                repliesContainer.insertAdjacentHTML('beforeend', replyHtml);
                repliesContainer.style.display = 'block';
                return;
            }
        }
        
        // Comment gốc - thêm vào danh sách chính
        const commentsList = document.getElementById(`comments-list-${postId}`);
        if (!commentsList) return;
        
        // Xóa "no comments" message nếu có
        const noComments = document.getElementById(`no-comments-${postId}`);
        if (noComments) noComments.remove();
        
        // Render comment mới
        const commentHtml = this.renderComment(comment, postId);
        
        // Thêm vào đầu danh sách
        commentsList.insertAdjacentHTML('afterbegin', commentHtml);
    }
    
    async likeComment(postId, commentId, replyId = null) {
        const targetId = replyId || commentId;
        const btn = document.querySelector(`[data-comment-id="${targetId}"] .comment-like-btn`);
        
        if (!btn) return;
        
        try {
            // Kiểm tra trạng thái hiện tại
            const isLiked = btn.classList.contains('liked');
            const method = isLiked ? 'DELETE' : 'POST';
            
            const response = await fetch(`/api/timeline/posts/${postId}/comments/${targetId}/like`, {
                method: method,
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            const data = await response.json();
            
            if (data.success && btn) {
                const icon = btn.querySelector('i');
                const countSpan = btn.querySelector('.like-count');
                
                if (data.action === 'liked') {
                    btn.classList.add('liked');
                    icon.className = 'fas fa-heart';
                } else {
                    btn.classList.remove('liked');
                    icon.className = 'far fa-heart';
                }
                
                if (countSpan) {
                    countSpan.textContent = data.like_count || 0;
                }
            }
        } catch (error) {
            console.error('Error liking comment:', error);
            this.showToast('Không thể thích bình luận', 'error');
        }
    }
    
    startReply(postId, commentId, username) {
        const input = document.getElementById(`comment-input-${postId}`);
        const replyInfo = document.getElementById(`reply-info-${postId}`);
        const replyToName = document.getElementById(`reply-to-name-${postId}`);
        
        // Set data attribute cho input
        input.dataset.replyTo = commentId;
        
        // Hiển thị reply info
        replyInfo.style.display = 'flex';
        replyToName.textContent = username;
        
        // Focus vào input
        input.focus();
        input.placeholder = `Trả lời ${username}...`;
    }
    
    cancelReply(postId) {
        const input = document.getElementById(`comment-input-${postId}`);
        const replyInfo = document.getElementById(`reply-info-${postId}`);
        
        // Xóa data attribute
        delete input.dataset.replyTo;
        
        // Ẩn reply info
        replyInfo.style.display = 'none';
        
        // Reset placeholder
        input.placeholder = 'Viết bình luận...';
    }
    
    toggleReplies(postId, commentId) {
        const repliesContainer = document.getElementById(`replies-${postId}-${commentId}`);
        if (repliesContainer) {
            const isVisible = repliesContainer.style.display !== 'none';
            repliesContainer.style.display = isVisible ? 'none' : 'block';
            
            // Cập nhật icon
            const btn = document.querySelector(`[data-comment-id="${commentId}"] .view-replies-btn`);
            if (btn) {
                const icon = btn.querySelector('.toggle-icon');
                if (isVisible) {
                    icon.className = 'fas fa-chevron-down toggle-icon';
                } else {
                    icon.className = 'fas fa-chevron-up toggle-icon';
                }
            }
        }
    }
    
    async createQuickPost() {
        const input = document.querySelector('.post-input-mini');
        const content = input.value.trim();
        
        if (!content) {
            this.showToast('Vui lòng nhập nội dung!', 'warning');
            return;
        }
        
        try {
            const response = await fetch('/api/timeline/posts/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    content: content,
                    privacy: 'public'
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                input.value = '';
                this.showToast('Đã đăng bài thành công!', 'success');
                
                // Add new post to top
                this.addNewPost(data.post);
                
                // Refresh sidebar trending tags to show new hashtags
                setTimeout(() => {
                    this.refreshSidebarTrendingTags();
                }, 500);
            } else {
                this.showToast('Lỗi: ' + (data.error || 'Không thể đăng bài'), 'error');
            }
        } catch (error) {
            console.error('Error creating quick post:', error);
            this.showToast('Có lỗi xảy ra!', 'error');
        }
    }
    
    async submitModernPost() {
        console.log('🧪 [DEBUG] submitModernPost called');
        const content = document.getElementById('modern-post-content').value.trim();
        const privacy = document.getElementById('modern-post-privacy').value;
        
        console.log('🧪 [DEBUG] Content:', content, 'Privacy:', privacy);
        
        if (!content) {
            this.showToast('Vui lòng nhập nội dung bài viết!', 'warning');
            return;
        }
        
        const submitBtn = document.querySelector('#modern-create-post-modal .modal-btn.primary');
        const originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang đăng...';
        submitBtn.disabled = true;
        
        try {
            const response = await fetch('/api/timeline/posts/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    content: content,
                    privacy: privacy
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                console.log('🧪 [DEBUG] Post created successfully, preparing sidebar refresh...');
                this.showToast('Đã đăng bài thành công!', 'success');
                closeCreatePostModal();
                document.getElementById('modern-post-content').value = '';
                
                // Add new post to top
                this.addNewPost(data.post);
                
                console.log('🧪 [DEBUG] About to refresh sidebar trending tags...');
                // Refresh sidebar trending tags to show new hashtags
                setTimeout(() => {
                    console.log('🧪 [DEBUG] Calling refreshSidebarTrendingTags...');
                    this.refreshSidebarTrendingTags();
                }, 500);
            } else {
                this.showToast('Lỗi: ' + (data.error || 'Không thể đăng bài'), 'error');
            }
        } catch (error) {
            console.error('Error submitting post:', error);
            this.showToast('Có lỗi xảy ra khi đăng bài!', 'error');
        } finally {
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
        }
    }
    
    // ==================== POST MENU ====================
    
    togglePostMenu(postId, event) {
        if (event) event.stopPropagation();
        
        const dropdown = document.getElementById('post-menu-dropdown');
        const post = document.querySelector(`[data-post-id="${postId}"]`);
        
        if (!post || !dropdown) return;
        
        // Lấy thông tin user_id của bài viết
        const postUserId = post.dataset.userId || post.dataset.authorId;
        const currentUserId = window.currentUserId;
        
        console.log('[DEBUG] postUserId:', postUserId, 'type:', typeof postUserId);
        console.log('[DEBUG] currentUserId:', currentUserId, 'type:', typeof currentUserId);
        console.log('[DEBUG] post.dataset:', post.dataset);
        
        const isOwner = String(postUserId) === String(currentUserId);
        
        console.log('[DEBUG] isOwner:', isOwner);
        
        const rect = post.getBoundingClientRect();
        
        // Tạo menu tùy theo owner
        let menuHtml = '';
        
        if (isOwner) {
            // Menu cho chủ bài viết
            menuHtml = `
                <div class="dropdown-item" onclick="timelineManager.editPost('${postId}')">
                    <i class="fas fa-edit"></i> Chỉnh sửa
                </div>
                <div class="dropdown-item" onclick="timelineManager.deletePost('${postId}')">
                    <i class="fas fa-trash"></i> Xóa
                </div>
            `;
        } else {
            // Menu cho bài viết của bạn bè
            menuHtml = `
                <div class="dropdown-item" onclick="timelineManager.hidePost('${postId}')">
                    <i class="fas fa-eye-slash"></i> Ẩn bài đăng
                </div>
            `;
        }
        
        dropdown.innerHTML = menuHtml;
        dropdown.style.left = `${rect.right - 200}px`;
        dropdown.style.top = `${rect.top + 40}px`;
        dropdown.classList.add('show');
        
        // Close dropdown when clicking outside
        setTimeout(() => {
            const closeDropdown = (e) => {
                if (!e.target.closest('.post-menu-modern') && !e.target.closest('.modern-dropdown')) {
                    dropdown.classList.remove('show');
                    document.removeEventListener('click', closeDropdown);
                }
            };
            document.addEventListener('click', closeDropdown);
        }, 0);
    }
    
    async editPost(postId) {
        const post = this.posts.find(p => p._id === postId);
        if (!post) return;
        
        // Mở modal edit
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
                postContent.setSelectionRange(postContent.value.length, postContent.value.length);
            }, 100);
        }
    }
    
    async deletePost(postId) {
        if (!confirm('Bạn có chắc chắn muốn xóa bài viết này?')) return;
        
        try {
            const response = await fetch(`/api/timeline/posts/${postId}`, {
                method: 'DELETE'
            });
            
            const data = await response.json();
            if (data.success) {
                this.showToast('Đã xóa bài viết', 'success');
                this.removePost(postId);
            }
        } catch (error) {
            console.error('Error deleting post:', error);
            this.showToast('Không thể xóa bài viết', 'error');
        }
    }
    
    async hidePost(postId) {
        if (!confirm('Bạn có chắc chắn muốn ẩn bài đăng này? Bài viết sẽ không hiển thị trên timeline của bạn nữa.')) return;
        
        try {
            const response = await fetch(`/api/posts/${postId}/hide`, {
                method: 'POST'
            });
            
            const data = await response.json();
            if (data.success) {
                this.showToast('Đã ẩn bài đăng', 'success');
                
                // Xóa bài viết khỏi UI ngay lập tức
                const postElement = document.querySelector(`[data-post-id="${postId}"]`);
                if (postElement) {
                    postElement.style.animation = 'fadeOut 0.3s ease';
                    setTimeout(() => postElement.remove(), 300);
                }
                
                // Xóa khỏi posts array để không load lại
                this.posts = this.posts.filter(p => p._id !== postId);
            } else {
                this.showToast(data.error || 'Không thể ẩn bài đăng', 'error');
            }
        } catch (error) {
            console.error('Error hiding post:', error);
            this.showToast('Không thể ẩn bài đăng', 'error');
        }
    }
    
    async savePost(postId) {
        try {
            const response = await fetch(`/api/posts/${postId}/save`, {
                method: 'POST'
            });
            
            const data = await response.json();
            if (data.success) {
                this.showToast('Đã lưu bài viết', 'success');
            }
        } catch (error) {
            console.error('Error saving post:', error);
            this.showToast('Không thể lưu bài viết', 'error');
        }
    }
    
    async reportPost(postId) {
        const reason = prompt('Nhập lý do báo cáo bài viết này:');
        if (!reason) return;
        
        try {
            const response = await fetch(`/api/posts/${postId}/report`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ reason: reason })
            });
            
            const data = await response.json();
            if (data.success) {
                this.showToast('Đã gửi báo cáo', 'success');
            }
        } catch (error) {
            console.error('Error reporting post:', error);
            this.showToast('Không thể gửi báo cáo', 'error');
        }
    }
    
    // ==================== VIEW POST LIKES MODAL ====================
    
    async viewPostLikes(postId) {
        try {
            // Create modal if not exists
            let modal = document.getElementById('post-likes-modal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'post-likes-modal';
                modal.className = 'post-likes-modal';
                modal.innerHTML = `
                    <div class="post-likes-modal-content">
                        <div class="post-likes-modal-header">
                            <h3><i class="fas fa-heart" style="color: #e74c3c;"></i> Người đã thích</h3>
                            <button class="close-post-likes-modal" onclick="document.getElementById('post-likes-modal').style.display='none'">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                        <div class="post-likes-list" id="post-likes-list">
                            <div class="post-likes-loading">
                                <i class="fas fa-spinner fa-spin"></i>
                                <span>Đang tải...</span>
                            </div>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
                
                // Close when clicking outside
                modal.addEventListener('click', (e) => {
                    if (e.target === modal) {
                        modal.style.display = 'none';
                    }
                });
            }
            
            // Show modal with loading state
            modal.style.display = 'flex';
            const listContainer = document.getElementById('post-likes-list');
            listContainer.innerHTML = `
                <div class="post-likes-loading">
                    <i class="fas fa-spinner fa-spin"></i>
                    <span>Đang tải...</span>
                </div>
            `;
            
            // Fetch likes data
            const response = await fetch(`/api/timeline/posts/${postId}/likes`);
            const data = await response.json();
            
            if (data.success) {
                if (data.likes && data.likes.length > 0) {
                    listContainer.innerHTML = data.likes.map(user => `
                        <div class="post-likes-user-item" onclick="window.location.href='/profile/${user.username}'">
                            <img src="${user.avatar}" 
                                 alt="${user.full_name || user.username}" 
                                 class="post-likes-user-avatar"
                                 onerror="this.src='/static/img/default-avatar.png'">
                            <div class="post-likes-user-info">
                                <div class="post-likes-user-name">${user.full_name || user.username}</div>
                                <div class="post-likes-user-username">@${user.username}</div>
                            </div>
                            <i class="fas fa-heart post-likes-user-icon" style="color: #e74c3c;"></i>
                        </div>
                    `).join('');
                } else {
                    listContainer.innerHTML = `
                        <div class="post-likes-empty">
                            <i class="far fa-heart" style="font-size: 48px; color: #ddd; margin-bottom: 16px;"></i>
                            <p>Chưa có ai thích bài viết này</p>
                        </div>
                    `;
                }
            } else {
                listContainer.innerHTML = `
                    <div class="post-likes-error">
                        <i class="fas fa-exclamation-circle" style="color: #e74c3c;"></i>
                        <p>${data.error || 'Không thể tải danh sách'}</p>
                    </div>
                `;
            }
        } catch (error) {
            console.error('Error loading post likes:', error);
            const listContainer = document.getElementById('post-likes-list');
            if (listContainer) {
                listContainer.innerHTML = `
                    <div class="post-likes-error">
                        <i class="fas fa-exclamation-circle" style="color: #e74c3c;"></i>
                        <p>Lỗi kết nối. Vui lòng thử lại sau.</p>
                    </div>
                `;
            }
        }
    }
    
    // ==================== SOCKET.IO ====================
    
    setupSocket() {
        try {
            this.socket = io({
                transports: ['websocket', 'polling'],
                reconnectionAttempts: 5,
                reconnectionDelay: 1000
            });
    
            this.socket.on('connect', () => {
                console.log('✅ Đã kết nối Socket.io thành công!');
                // Join timeline room
                this.socket.emit('join_timeline', { user_id: window.currentUserId });
                
                // Reload active friends sau khi connect để hiển thị trạng thái online đúng
                console.log('🔄 Reloading active friends after socket connect...');
                setTimeout(() => {
                    this.loadActiveFriends();
                    this.loadTimelineStats();
                }, 500);
            });
    
            this.socket.on('connect_error', (error) => {
                console.warn('⚠️ Lỗi kết nối Socket:', error.message);
            });
    
            this.socket.on('new_post', (data) => {
                if (data?.post) {
                    this.addNewPost(data.post);
                }
            });
    
            this.socket.on('post_updated', (data) => {
                if (data?.post) {
                    this.updatePost(data.post);
                }
            });
    
            this.socket.on('post_deleted', (data) => {
                if (data?.post_id) {
                    this.removePost(data.post_id);
                }
            });
    
            this.socket.on('post_liked', (data) => {
                if (data?.post_id && data?.likes_count) {
                    this.updatePostLike(data.post_id, data.likes_count);
                }
            });
    
            this.socket.on('new_comment', (data) => {
                if (data?.post_id && data?.comment) {
                    this.addNewComment(data.post_id, data.comment);
                }
            });
    
        } catch (error) {
            console.error('❌ Error setting up socket:', error);
        }
    }
    
    addNewPost(post) {
        // Add to beginning of posts array
        this.posts.unshift(post);
        
        // Create and insert post element
        const postElement = this.createPostElement(post);
        const postsContainer = document.getElementById('timeline-posts');
        
        if (!postsContainer) return;
        
        if (postsContainer.firstChild) {
            postsContainer.insertBefore(postElement, postsContainer.firstChild);
        } else {
            postsContainer.appendChild(postElement);
        }
        
        // Hide no posts message if exists
        const noPostsMsg = document.getElementById('no-posts-message');
        if (noPostsMsg) {
            noPostsMsg.style.display = 'none';
        }
        
        // Animate new post
        postElement.style.animationDelay = '0s';
        postElement.style.animation = 'fadeInUp 0.5s cubic-bezier(0.4, 0, 0.2, 1) forwards';
        
        // Initialize toggle functionality for the new post
        setTimeout(() => {
            initializeTimelinePostContentToggle();
        }, 100);
    }
    
    updatePost(updatedPost) {
        const postIndex = this.posts.findIndex(p => p._id === updatedPost._id);
        if (postIndex !== -1) {
            this.posts[postIndex] = updatedPost;
            
            const postElement = document.querySelector(`.modern-post-card[data-post-id="${updatedPost._id}"]`);
            if (postElement) {
                postElement.replaceWith(this.createPostElement(updatedPost));
                
                // Re-initialize toggle functionality for the updated post
                setTimeout(() => {
                    initializeTimelinePostContentToggle();
                }, 100);
            }
        }
    }
    
    // ==================== PAGINATION METHODS ====================
    
    updatePaginationUI() {
        if (!this.pagination) return;
        
        const paginationContainer = document.getElementById('pagination-container');
        if (!paginationContainer) return;
        
        // Show pagination container
        paginationContainer.style.display = 'block';
        
        const { current_page, total_pages, has_next, has_prev, showing_from, showing_to, total_posts } = this.pagination;
        
        // Update pagination info
        const pageInfo = document.getElementById('page-info');
        if (pageInfo) {
            if (total_posts > 0) {
                pageInfo.textContent = `Hiển thị ${showing_from}-${showing_to} của ${total_posts} bài viết`;
            } else {
                pageInfo.textContent = 'Không có bài viết nào';
            }
        }
        
        // Update pagination buttons
        this.updatePaginationButtons(current_page, total_pages, has_prev, has_next);
        
        // Update per page selector
        const perPageSelect = document.getElementById('per-page-select');
        if (perPageSelect) {
            perPageSelect.value = this.perPage;
        }
        
        // Show/hide load more button based on whether there are more posts
        const loadMoreBtn = document.getElementById('load-more-btn');
        if (loadMoreBtn) {
            if (has_next && total_pages > 1) {
                loadMoreBtn.style.display = 'inline-flex';
                loadMoreBtn.disabled = false;
            } else {
                loadMoreBtn.style.display = 'none';
            }
        }
    }
    
    updatePaginationButtons(currentPage, totalPages, hasPrev, hasNext) {
        const prevBtn = document.getElementById('prev-page-btn');
        const nextBtn = document.getElementById('next-page-btn');
        const pageNumbers = document.getElementById('page-numbers');
        
        // Update prev/next buttons
        if (prevBtn) {
            prevBtn.disabled = !hasPrev;
            prevBtn.onclick = () => this.goToPage(currentPage - 1);
        }
        
        if (nextBtn) {
            nextBtn.disabled = !hasNext;
            nextBtn.onclick = () => this.goToPage(currentPage + 1);
        }
        
        // Update page numbers
        if (pageNumbers) {
            pageNumbers.innerHTML = '';
            
            const pages = this.getPageNumbers(currentPage, totalPages);
            pages.forEach(page => {
                const button = document.createElement('button');
                button.className = `page-number ${page === currentPage ? 'active' : ''}`;
                button.textContent = page;
                button.onclick = () => this.goToPage(page);
                
                if (page === '...') {
                    button.disabled = true;
                    button.className = 'page-ellipsis';
                }
                
                pageNumbers.appendChild(button);
            });
        }
    }
    
    getPageNumbers(currentPage, totalPages) {
        const pages = [];
        const maxVisible = 5;
        
        if (totalPages <= maxVisible) {
            for (let i = 1; i <= totalPages; i++) {
                pages.push(i);
            }
        } else {
            // Always show first page
            pages.push(1);
            
            if (currentPage <= 3) {
                // Show pages 1-5 and last page
                for (let i = 2; i <= 5; i++) {
                    pages.push(i);
                }
                pages.push('...');
                pages.push(totalPages);
            } else if (currentPage >= totalPages - 2) {
                // Show first page, last 5 pages
                pages.push('...');
                for (let i = totalPages - 4; i <= totalPages; i++) {
                    pages.push(i);
                }
            } else {
                // Show first page, current page - 1 to + 1, last page
                pages.push('...');
                for (let i = currentPage - 1; i <= currentPage + 1; i++) {
                    pages.push(i);
                }
                pages.push('...');
                pages.push(totalPages);
            }
        }
        
        return pages;
    }
    
    async goToPage(page) {
        if (page < 1 || page > this.totalPages || page === this.currentPage) {
            return;
        }
        
        this.currentPage = page;
        
        // Clear posts container if going to first page
        if (page === 1) {
            const postsContainer = document.getElementById('timeline-posts');
            if (postsContainer) {
                postsContainer.innerHTML = '';
            }
            this.posts = [];
        }
        
        await this.loadTimelinePosts();
        
        // Scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    
    async loadMore() {
        if (!this.hasMore || this.isLoading) return;
        
        this.currentPage++;
        await this.loadTimelinePosts();
    }
    
    changePerPage(perPage) {
        this.perPage = parseInt(perPage);
        this.currentPage = 1;
        this.posts = [];
        
        const postsContainer = document.getElementById('timeline-posts');
        if (postsContainer) {
            postsContainer.innerHTML = '';
        }
        
        this.loadTimelinePosts();
    }
    
    async loadMore() {
        if (!this.hasMore || this.isLoading) return;
        
        this.currentPage++;
        await this.loadTimelinePosts();
    }
    
    updatePostLike(postId, likeCount) {
        const postElement = document.querySelector(`.modern-post-card[data-post-id="${postId}"]`);
        if (postElement) {
            const statsCount = postElement.querySelector('.stats-count');
            if (statsCount) {
                statsCount.textContent = likeCount;
            }
        }
    }
    
    addNewComment(postId, comment) {
        const postElement = document.querySelector(`.modern-post-card[data-post-id="${postId}"]`);
        if (postElement) {
            // Update comments count
            const commentsCount = postElement.querySelector('.comments-count');
            if (commentsCount) {
                const currentCount = parseInt(commentsCount.textContent) || 0;
                commentsCount.textContent = currentCount + 1;
            }
            
            // Add to comments preview if exists
            const previewContainer = postElement.querySelector('.comments-preview');
            if (previewContainer) {
                const commentElement = document.createElement('div');
                commentElement.className = 'comment-preview-item';
                commentElement.innerHTML = `
                    <img src="${comment.author_avatar || '/static/img/default-avatar.png'}" 
                         alt="${comment.author_full_name || comment.author_name}" 
                         class="comment-avatar-preview">
                    <div class="comment-preview-content">
                        <span class="comment-author-preview">${comment.author_full_name || comment.author_name}</span>
                        <span class="comment-text-preview">${comment.content}</span>
                    </div>
                `;
                
                // Insert at beginning
                if (previewContainer.firstChild) {
                    previewContainer.insertBefore(commentElement, previewContainer.firstChild);
                } else {
                    previewContainer.appendChild(commentElement);
                }
            }
        }
    }
    
    removePost(postId) {
        this.posts = this.posts.filter(p => p._id !== postId);
        
        const postElement = document.querySelector(`.modern-post-card[data-post-id="${postId}"]`);
        if (postElement) {
            postElement.remove();
        }
        
        if (this.posts.length === 0) {
            const noPostsMsg = document.getElementById('no-posts-message');
            if (noPostsMsg) {
                noPostsMsg.style.display = 'block';
            }
        }
    }
    
    // ==================== UTILITIES ====================
    
    showToast(message, type = 'info') {
        // Create toast element
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : 
                              type === 'error' ? 'exclamation-circle' : 
                              type === 'warning' ? 'exclamation-triangle' : 'info-circle'}"></i>
            <span>${message}</span>
            <button class="toast-close" onclick="this.parentElement.remove()">
                <i class="fas fa-times"></i>
            </button>
        `;
        
        // Add to document
        document.body.appendChild(toast);
        
        // Remove after 3 seconds
        setTimeout(() => {
            if (toast.parentElement) {
                toast.remove();
            }
        }, 3000);
    }
}

// ==================== STORIES MANAGER CLASS ====================
class StoriesManager {
    constructor() {
        this.stories = [];
        this.currentStoryIndex = 0;
        this.currentUserIndex = 0;
        this.isPlaying = false;
        this.progressInterval = null;
        this.storyDuration = 5000;
        this.currentStory = null;
        this.currentStoryUser = null;
        
        // Thêm biến để theo dõi story viewer modal
        this.storyViewerModal = null;
        
        this.init();
    }
    
    async init() {
        await this.loadStories();
        this.setupEventListeners();
    }
    
    async loadStories() {
        try {
            const response = await fetch('/api/timeline/stories');
            const data = await response.json();
            
            if (data.success) {
                this.stories = this.normalizeStoriesData(data.stories || []);
                this.renderStoriesList();
            }
        } catch (error) {
            console.error('Error loading stories:', error);
        }
    }
    async refreshCurrentStory() {
        if (!this.currentStoryId) return;
        
        try {
            const response = await fetch(`/api/timeline/stories/${this.currentStoryId}/info`);
            const data = await response.json();
            
            if (data.success && data.story) {
                // Cập nhật story hiện tại
                this.currentStory = this.normalizeStoryData(data.story);
                
                // Cập nhật trong stories array
                for (let userStories of this.stories) {
                    const storyIndex = userStories.stories.findIndex(s => s._id === this.currentStoryId);
                    if (storyIndex !== -1) {
                        userStories.stories[storyIndex] = this.normalizeStoryData(data.story);
                        break;
                    }
                }
                
                // Render lại UI
                this.showStory(this.currentStory);
            }
        } catch (error) {
            console.error('Error refreshing story:', error);
        }
    }
    
    normalizeStoriesData(storiesData) {
        return storiesData.map(userStory => ({
            user_id: String(userStory.user_id || userStory.id || ''),
            name: userStory.name || userStory.username,
            avatar: userStory.avatar || '/static/img/default-avatar.png',
            has_unseen: userStory.has_unseen || false,
            stories: (userStory.stories || []).map(story => {
                // CHUẨN HÓA likes thành mảng string
                const likes = Array.isArray(story.likes) ? story.likes : [];
                const normalizedLikes = [];
                const seen = new Set();
                
                for (const like of likes) {
                    let likeId;
                    if (typeof like === 'object' && like !== null) {
                        likeId = String(like.user_id || like._id || like);
                    } else {
                        likeId = String(like);
                    }
                    
                    if (likeId && !seen.has(likeId)) {
                        seen.add(likeId);
                        normalizedLikes.push(likeId);
                    }
                }
                
                return {
                    _id: story._id || story.id,
                    id: story._id || story.id,
                    type: story.type || 'text',
                    content: story.content || story.text || '',
                    background: story.background || story.bg_color || '#3b5998',
                    media_url: story.media_url || story.url || '',
                    likes: normalizedLikes,  // Đã chuẩn hóa
                    likes_count: story.likes_count || normalizedLikes.length,
                    views: story.views || [],
                    views_count: story.views_count || (Array.isArray(story.views) ? story.views.length : 0),
                    author_id: String(story.author_id || story.user_id || ''),
                    author_name: story.author_name || story.username,
                    created_at: story.created_at,
                    is_liked: normalizedLikes.includes(String(window.currentUserId || ''))
                };
            })
        }));
    }
    
    renderStoriesList() {
        const container = document.getElementById('stories-container');
        if (!container) return;
        
        // Clear container
        container.innerHTML = '';
        
        // Add create story button
        const createStoryBtn = document.createElement('div');
        createStoryBtn.className = 'story-modern add-story-modern';
        createStoryBtn.innerHTML = `
            <div class="add-story-circle">
                <i class="fas fa-plus"></i>
            </div>
            <span class="story-label">Tạo tin</span>
        `;
        createStoryBtn.onclick = () => createStory();
        container.appendChild(createStoryBtn);
        
        // Add stories
        this.stories.forEach(storyUser => {
            const storyElement = this.createStoryElement(storyUser);
            container.appendChild(storyElement);
        });
    }
    
    createStoryElement(storyUser) {
        const div = document.createElement('div');
        div.className = 'story-modern';
        if (storyUser.has_unseen) {
            div.classList.add('has-unseen');
        }
        
        div.innerHTML = `
            <div class="story-gradient-border ${storyUser.has_unseen ? 'unseen' : ''}">
                <img src="${storyUser.avatar}" 
                     alt="${storyUser.name}" 
                     class="story-avatar"
                     loading="lazy"
                     onerror="this.src='/static/img/default-avatar.png'">
            </div>
            <span class="story-label">${storyUser.name}</span>
        `;
        
        div.addEventListener('click', () => {
            this.openStoriesViewer(storyUser);
        });
        
        return div;
    }
    
    openStoriesViewer(storyUser) {
        if (!storyUser?.stories?.length) {
            this.showToast('Không có story để hiển thị', 'warning');
            return;
        }
    
        this.closeViewer();
    
        this.storyViewerModal = document.createElement('div');
        this.storyViewerModal.className = 'stories-viewer-modal';
        
        this.storyViewerModal.innerHTML = `
            <div class="stories-viewer-container">
                <div class="story-viewer-header">
                    <div class="story-user-info">
                        <img src="${storyUser.avatar}" alt="${storyUser.name}" class="story-user-avatar"
                             onerror="this.src='/static/img/default-avatar.png'">
                        <div class="story-user-details">
                            <h4>${storyUser.name}</h4>
                            <span class="story-time">${this.formatTime(storyUser.stories[0]?.created_at)}</span>
                        </div>
                    </div>
                    <div class="story-viewer-actions">
                        <button class="story-close-btn" onclick="window.storiesManager.closeViewer()">
                            <i class="fas fa-times"></i>
                        </button>
                        <button class="story-more-btn" onclick="window.storiesManager.toggleStoryMenu(event)" title="Tùy chọn">
                            <i class="fas fa-ellipsis-h"></i>
                        </button>
                    </div>
                </div>
    
                <!-- Progress bars -->
                <div class="story-progress-bars">
                    ${storyUser.stories.map((story, index) => `
                        <div class="progress-bar">
                            <div class="progress-fill ${index === 0 ? 'active' : ''}" data-story-index="${index}"></div>
                        </div>
                    `).join('')}
                </div>
    
                <!-- Vùng chứa story, sẽ xử lý click để chuyển -->
                <div class="story-content-wrapper" id="story-content-wrapper">
                    <div class="story-content" id="current-story-content"></div>
                </div>
                
                <!-- Story Menu Dropdown -->
                <div id="story-menu-dropdown" class="story-menu-dropdown" style="display: none;">
                    <div class="story-menu-item" onclick="window.storiesManager.deleteCurrentStory()">
                        <i class="fas fa-trash-alt"></i>
                        <span>Xóa story</span>
                    </div>
                    <div class="story-menu-item" onclick="window.storiesManager.closeStoryMenu()">
                        <i class="fas fa-times"></i>
                        <span>Hủy</span>
                    </div>
                </div>
            </div>
        `;
    
        document.body.appendChild(this.storyViewerModal);
    
        // Sự kiện đóng khi click vào nền (modal)
        this.storyViewerModal.addEventListener('click', (e) => {
            if (e.target === this.storyViewerModal) {
                this.closeViewer();
            }
        });
    
        // Xử lý click để chuyển story dựa vào tọa độ
        const wrapper = this.storyViewerModal.querySelector('#story-content-wrapper');
        wrapper.addEventListener('click', (e) => {
            // Nếu click vào nút like hoặc stats mini, không chuyển story
            if (e.target.closest('.story-like-btn') || e.target.closest('.story-stats-mini')) {
                return;
            }
            
            const rect = wrapper.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const threshold = rect.width / 2;
            
            if (clickX < threshold) {
                this.prevStory();
            } else {
                this.nextStory();
            }
        });
    
        // Tạm dừng auto-play khi rê chuột vào container
        const container = this.storyViewerModal.querySelector('.stories-viewer-container');
        container.addEventListener('mouseenter', () => this.stopAutoPlay());
        container.addEventListener('mouseleave', () => this.startAutoPlay());
    
        this.currentUserIndex = this.stories.findIndex(s => s.user_id === storyUser.user_id);
        this.currentStoryIndex = 0;
        this.currentStoryUser = storyUser;
        
        this.showStory(storyUser.stories[0]);
        this.markStoryAsViewed(storyUser.stories[0]._id);
        this.startAutoPlay();
    }

    setupStoryViewerEventDelegation() {
        if (!this.storyViewerModal) return;
        
        // Chỉ xử lý các click không phải trên nút like
        this.storyViewerModal.addEventListener('click', (e) => {
            // Bỏ qua nút like - đã được xử lý riêng
            if (e.target.closest('.story-like-btn')) {
                return;
            }
            
            // Xử lý các nút khác
            if (e.target.closest('.story-close-btn')) {
                this.closeViewer();
                return;
            }
            
            if (e.target.closest('.story-nav-btn.prev')) {
                this.prevStory();
                return;
            }
            
            if (e.target.closest('.story-nav-btn.next')) {
                this.nextStory();
                return;
            }
            
            // Xử lý stats overlay
            const statsOverlay = e.target.closest('.story-stats-overlay');
            if (statsOverlay) {
                e.stopPropagation();
                const storyStat = e.target.closest('.story-stat');
                if (storyStat) {
                    const storyId = this.currentStory?._id;
                    if (storyId) {
                        if (storyStat.querySelector('.fa-eye')) {
                            this.showStoryViews(storyId);
                        } else if (storyStat.querySelector('.fa-heart')) {
                            this.showStoryLikes(storyId);
                        }
                    }
                }
                return;
            }
        });
    }
    createViewerHTML(storyUser) {
        return `
            <div class="stories-viewer-container">
                <div class="stories-header">
                    <div class="story-user-info">
                        <img src="${storyUser.avatar}" 
                             alt="${storyUser.name}" 
                             class="story-user-avatar"
                             onerror="this.src='/static/img/default-avatar.png'">
                        <div class="story-user-details">
                            <h4>${storyUser.name}</h4>
                            <span class="story-time">${this.formatTime(storyUser.stories[0]?.created_at)}</span>
                        </div>
                    </div>
                    <button class="story-close-btn" onclick="window.storiesManager.closeViewer()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="story-progress-bars">
                    ${storyUser.stories.map((story, index) => `
                        <div class="progress-bar">
                            <div class="progress-fill ${index === 0 ? 'active' : ''}" 
                                 data-story-index="${index}"></div>
                        </div>
                    `).join('')}
                </div>
                
                <div class="story-content-container">
                <div class="story-content" id="current-story-content"></div>
            </div>
        </div>
    `;
    }
    
    showStory(story) {
        const container = document.getElementById('current-story-content');
        if (!container || !story) return;
    
        const storyData = this.normalizeStoryData(story);
        const storyId = storyData._id || storyData.id;
        if (!storyId) return console.error('Missing story ID', storyData);
    
        this.currentStory = storyData;
        this.currentStoryId = storyId;
    
        const currentUserId = window.currentUserId;
    
        // Chuẩn hóa likes → mảng string ID
        const likeIds = Array.isArray(storyData.likes)
            ? storyData.likes.map(l =>
                typeof l === 'object' ? (l.user_id || l._id)?.toString() : l?.toString()
            ).filter(Boolean)
            : [];
    
        const isLiked = likeIds.includes(currentUserId);
        const likeCount = new Set(likeIds).size;
        const isOwner = this.sameId(this.currentStoryUser?.user_id, currentUserId) 
            || this.sameText(this.currentStoryUser?.name, this.getCurrentUsername());
        try {
            console.debug('Story owner check', {
                curUserId: window.currentUserId,
                storyUserId: this.currentStoryUser?.user_id,
                curUserName: this.getCurrentUsername(),
                storyUserName: this.currentStoryUser?.name,
                isOwner
            });
        } catch (_) {}
    
        const likeOverlay = this.createLikeOverlay(storyId, isLiked, likeCount);
        const statsOverlay = isOwner ? this.createStatsOverlay(storyData) : '';
    
        let content = '';
        switch (storyData.type) {
            case 'text':
                content = `
                    <div class="story-text-content" style="background:${storyData.background || '#3b5998'}">
                        <div class="story-text">${storyData.content || ''}</div>
                        ${likeOverlay}
                        ${statsOverlay}
                    </div>`;
                break;
    
            case 'image':
                content = `
                    <div class="story-image-content">
                        <img src="${this.getMediaUrl(storyData.media_url)}"
                             class="story-media"
                             onerror="this.src='/static/img/default-image.jpg'">
                        ${likeOverlay}
                        ${statsOverlay}
                    </div>`;
                break;
    
            case 'video':
                content = `
                    <div class="story-video-content">
                        <video playsinline autoplay>
                            <source src="${this.getMediaUrl(storyData.media_url)}" type="video/mp4">
                        </video>
                        ${likeOverlay}
                        ${statsOverlay}
                    </div>`;
                break;
        }
    
        container.innerHTML = content;
    
        // Gán event like (1 LẦN DUY NHẤT)
        const likeBtn = container.querySelector(`#story-like-btn-${storyId}`);
        if (likeBtn) {
            likeBtn.onclick = (e) => {
                e.stopPropagation();
                this.handleStoryLike(storyId, likeBtn, e);
            };
        }
    
        // Autoplay video
        const video = container.querySelector('video');
        if (video) {
            video.play().catch(() => {});
        }
        this.updateHeaderTime(story);
        this.updateProgressBars();
        this.updateViewDetailsButton();
        
        // Cập nhật stats overlay với cả likes và views
        const viewCount = storyData.views_count || (Array.isArray(storyData.views) ? storyData.views.length : 0);
        this.updateStatsOverlay(likeCount, viewCount);
        
    }
// Trong class StoriesManager
createLikeOverlay(storyId, isLiked, likeCount) {
    const count = parseInt(likeCount) || 0;
    
    return `
        <div class="story-like-overlay" onclick="event.stopPropagation()">
            <button class="story-like-btn ${isLiked ? 'liked' : ''}" 
                    id="story-like-btn-${storyId}"
                    title="${isLiked ? 'Bỏ thích' : 'Thích'}"
                    data-like-count="${count}">
                <span class="heart-stack">
                    <i class="far fa-heart heart-outline"></i>
                    <i class="fas fa-heart heart-filled"></i>
                </span>
            </button>
        </div>
    `;
}
    createStatsOverlay(storyData) {
        const viewsCount = storyData.views_count || (Array.isArray(storyData.views) ? storyData.views.length : 0);
        const likesCount = Array.isArray(storyData.likes) ? storyData.likes.length : (storyData.likes_count || 0);
        
        // DEBUG: Log để kiểm tra dữ liệu
        console.log('🔍 createStatsOverlay debug:', {
            storyId: storyData._id,
            views_count: storyData.views_count,
            views: storyData.views,
            viewsCount_calculated: viewsCount,
            likes_count: storyData.likes_count,
            likes: storyData.likes,
            likesCount_calculated: likesCount
        });
        
        return `
        <div class="story-stats-mini" onclick="event.stopPropagation()">
            <div class="stats-mini-item views" onclick="window.storiesManager.showStoryViews('${storyData._id}')" 
                 title="Xem chi tiết lượt xem">
                <i class="fas fa-eye"></i>
                <span>${viewsCount}</span>
            </div>
            <div class="stats-mini-divider"></div>
            <div class="stats-mini-item likes" onclick="window.storiesManager.showStoryLikes('${storyData._id}')"
                 title="Xem chi tiết lượt thích">
                <i class="fas fa-heart"></i>
                <span>${likesCount}</span>
            </div>
        </div>
    `;
    }
    
    normalizeStoryData(story) {
        const likes = Array.isArray(story.likes) ? Array.from(new Set(story.likes.map(l => {
            if (typeof l === 'object' && l !== null) {
                return String(l.user_id || l._id || l);
            }
            return String(l);
        }))) : [];
        
        const views = story.views || [];
        
        return {
            _id: story._id,
            id: story._id,
            type: story.type,
            content: story.content,
            background: story.background,
            media_url: story.media_url,
            likes: likes,
            likes_count: story.likes_count || likes.length,
            views: views,
            views_count: story.views_count || views.length,
            author_id: (story.author_id || story.user_id) ? String(story.author_id || story.user_id) : '',
            author_name: story.author_name,
            created_at: story.created_at
        };
    }
    normalizeId(id) {
        if (!id) return '';
        const s = String(id);
        const m = s.match(/[a-fA-F0-9]{24}/);
        if (m) return m[0].toLowerCase();
        return s.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    }
    sameId(a, b) {
        return this.normalizeId(a) === this.normalizeId(b);
    }
    sameText(a, b) {
        if (!a || !b) return false;
        return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
    }
    getCurrentUsername() {
        try {
            if (window.currentUserName) return String(window.currentUserName).trim();
            const el = document.querySelector('.username-mini');
            if (el && el.textContent) return el.textContent.trim();
        } catch (_) {}
        return '';
    }
    
    getMediaUrl(url) {
        if (!url) return '/static/img/default-image.jpg';
        if (url.startsWith('http') || url.startsWith('/static')) return url;
        return `/static/uploads/stories/${url}`;
    }
    
    // ==================== STORY LIKE HANDLING ====================
    
    async handleStoryLike(storyId, button, event) {
        if (event) event.stopPropagation();
        
        if (button.classList.contains('processing')) return;
        button.classList.add('processing');
    
        const heartOutline = button.querySelector('.heart-outline');
        const heartFilled = button.querySelector('.heart-filled');
        // Đã xóa dòng lấy countSpan
    
        const isCurrentlyLiked = button.classList.contains('liked');
        
        // Optimistic update UI
        const newLikedState = !isCurrentlyLiked;
        button.classList.toggle('liked', newLikedState);
    
        // Hiệu ứng trái tim
        if (newLikedState) {
            if (heartFilled) {
                heartFilled.classList.add('active');
                setTimeout(() => heartFilled.classList.remove('active'), 350);
            }
            if (event) {
                button.style.animation = 'heartBeat 0.6s ease';
                setTimeout(() => button.style.animation = '', 600);
                this.createLikeEffect(event.clientX, event.clientY);
            }
        } else {
            if (heartOutline) {
                heartOutline.classList.add('active');
                setTimeout(() => heartOutline.classList.remove('active'), 350);
            }
        }
    
        // Gửi request
        try {
            const encodedStoryId = encodeURIComponent(storyId);
            const response = await fetch(`/api/timeline/stories/${encodedStoryId}/like`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin'
            });
    
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
    
            if (data.success) {
                // Cập nhật dữ liệu trong memory (nếu cần)
                this.updateStoryLikeInMemory(storyId, data.is_liked, data.total_likes);
                // Cập nhật stats overlay (phần hiển thị số ở góc dưới)
                this.updateStatsOverlay(data.total_likes);
                
                this.showToast(
                    data.is_liked ? 'Đã thích story! ❤️' : 'Đã bỏ thích story',
                    data.is_liked ? 'success' : 'info'
                );
            } else {
                // Rollback UI
                button.classList.toggle('liked', isCurrentlyLiked);
                throw new Error(data.error || 'Lỗi server');
            }
        } catch (error) {
            console.error('❌ Like error:', error);
            button.classList.toggle('liked', isCurrentlyLiked);
            this.showToast('Không thể thích story', 'error');
        } finally {
            setTimeout(() => button.classList.remove('processing'), 500);
        }
    }
    updateStoryLikeInMemory(storyId, isLiked, totalLikes) {
        // Cập nhật trong currentStory
        if (this.currentStory && this.currentStory._id === storyId) {
            this.currentStory.is_liked = isLiked;
            this.currentStory.likes_count = totalLikes;
            this.currentStory.total_likes = totalLikes;
            
            // Cập nhật likes array
            const userId = window.currentUserId;
            if (isLiked) {
                if (!this.currentStory.likes.includes(userId)) {
                    this.currentStory.likes.push(userId);
                }
            } else {
                const index = this.currentStory.likes.indexOf(userId);
                if (index > -1) {
                    this.currentStory.likes.splice(index, 1);
                }
            }
        }
        
        // Cập nhật trong stories array
        for (let userStories of this.stories) {
            for (let story of userStories.stories) {
                if (story._id === storyId) {
                    story.is_liked = isLiked;
                    story.likes_count = totalLikes;
                    story.total_likes = totalLikes;
                    
                    // Cập nhật likes array
                    const userId = window.currentUserId;
                    if (isLiked) {
                        if (!story.likes.includes(userId)) {
                            story.likes.push(userId);
                        }
                    } else {
                        const index = story.likes.indexOf(userId);
                        if (index > -1) {
                            story.likes.splice(index, 1);
                        }
                    }
                    break;
                }
            }
        }
    }
    updateStatsOverlay(likeCount, viewCount) {
        const container = document.getElementById('current-story-content');
        if (!container) return;
        
        // Tìm stats overlay trong story content
        let statsOverlay = container.querySelector('.story-stats-mini');
        
        // Nếu không tìm thấy trong container, tìm trong toàn bộ story viewer
        if (!statsOverlay && this.storyViewerModal) {
            statsOverlay = this.storyViewerModal.querySelector('.story-stats-mini');
        }
        
        if (!statsOverlay) {
            console.log('No stats overlay found');
            return;
        }
        
        // Cập nhật số lượt thích
        if (likeCount !== undefined) {
            const likeStat = statsOverlay.querySelector('.stats-mini-item.likes span');
            if (likeStat) {
                likeStat.textContent = likeCount;
                
                // Thêm hiệu ứng cho số đếm mới
                likeStat.parentElement.style.transform = 'scale(1.1)';
                setTimeout(() => {
                    likeStat.parentElement.style.transform = 'scale(1)';
                }, 300);
            }
        }
        
        // Cập nhật số lượt xem
        if (viewCount !== undefined) {
            const viewStat = statsOverlay.querySelector('.stats-mini-item.views span');
            if (viewStat) {
                viewStat.textContent = viewCount;
                
                // Thêm hiệu ứng cho số đếm mới
                viewStat.parentElement.style.transform = 'scale(1.1)';
                setTimeout(() => {
                    viewStat.parentElement.style.transform = 'scale(1)';
                }, 300);
            }
        }
    }
    
    createLikeEffect(x, y) {
        const effect = document.createElement('div');
        effect.className = 'like-effect-animated';
        effect.style.cssText = `
            position: fixed;
            left: ${x}px;
            top: ${y}px;
            width: 24px;
            height: 24px;
            z-index: 10000;
            pointer-events: none;
            display: flex;
            align-items: center;
            justify-content: center;
            transform: translate(-50%, -50%);
        `;
        
        const heart = document.createElement('i');
        heart.className = 'fas fa-heart';
        heart.style.cssText = `
            color: #ff3b5c;
            font-size: 24px;
            filter: drop-shadow(0 2px 4px rgba(255, 59, 92, 0.3));
        `;
        
        effect.appendChild(heart);
        document.body.appendChild(effect);
        
        // Animation sequence
        const keyframes = [
            { 
                transform: 'translate(-50%, -50%) scale(0)', 
                opacity: 1 
            },
            { 
                transform: 'translate(-50%, -50%) scale(1.3)', 
                opacity: 0.9,
                offset: 0.3
            },
            { 
                transform: 'translate(-50%, -120px) scale(0.8)', 
                opacity: 0.7,
                offset: 0.6
            },
            { 
                transform: 'translate(-50%, -180px) scale(0.5)', 
                opacity: 0 
            }
        ];
        
        const animation = effect.animate(keyframes, {
            duration: 1200,
            easing: 'cubic-bezier(0.215, 0.61, 0.355, 1)'
        });
        
        // Remove after animation
        animation.onfinish = () => {
            if (effect.parentElement) {
                effect.remove();
            }
        };
    }
    
    updateViewDetailsButton() {
        if (!this.currentStory || !window.currentUserId) return;
        
        const viewBtn = document.getElementById('story-view-details-btn');
        if (!viewBtn) return;
        
        const isOwner = this.sameId(this.currentStoryUser?.user_id, window.currentUserId) 
            || this.sameText(this.currentStoryUser?.name, this.getCurrentUsername());
        viewBtn.style.display = isOwner ? 'flex' : 'none';
    }
    
    // ==================== STORY VIEWS & LIKES DETAILS ====================
    
    async showViewDetails() {
        if (!this.currentStory?._id) return;
        
        const isOwner = this.sameId(this.currentStoryUser?.user_id, window.currentUserId) 
            || this.sameText(this.currentStoryUser?.name, this.getCurrentUsername());
        if (!isOwner) {
            this.showToast('Chỉ chủ story mới có thể xem chi tiết', 'warning');
            return;
        }
        
        await this.showStoryViews(this.currentStory._id);
    }
    
    async showStoryViews(storyId) {
        console.log('📢 showStoryViews called for:', storyId);
        
        try {
            const response = await fetch(`/api/timeline/stories/${storyId}/views`);
            const data = await response.json();
            
            if (data.success) {
                this.createViewsModal(data.views, data.total_views);
            } else {
                this.showToast("Không thể tải danh sách lượt xem", 'error');
            }
        } catch (error) {
            console.error('❌ Error fetching views:', error);
            this.showToast('Lỗi khi tải lượt xem', 'error');
        }
    }
    
    async showStoryLikes(storyId) {
        console.log('📢 showStoryLikes called for:', storyId);
        
        try {
            const response = await fetch(`/api/timeline/stories/${storyId}/likes`);
            const data = await response.json();
            
            if (data.success) {
                this.createLikesModal(data.likes, data.total_likes);
            } else {
                this.showToast("Không thể tải danh sách lượt thích", 'error');
            }
        } catch (error) {
            console.error('❌ Error fetching likes:', error);
            this.showToast('Lỗi khi tải lượt thích', 'error');
        }
    }
    
    createViewsModal(views, totalViews) {
        const oldModal = document.querySelector('.story-views-modal');
        if (oldModal) oldModal.remove();
        
        const modal = document.createElement('div');
        modal.className = 'story-views-modal';
        modal.innerHTML = `
            <div class="views-modal-content">
                <div class="views-modal-header">
                    <h4><i class="fas fa-eye" style="color:#3eb489;"></i> Lượt xem (${totalViews})</h4>
                    <button class="close-views-btn" onclick="this.closest('.story-views-modal').remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="views-list">
                    ${views && views.length > 0 ? 
                        views.map(view => `
                            <div class="view-item" onclick="window.location.href='/profile/${view.username}'">
                                <img src="${view.avatar || '/static/img/default-avatar.png'}" 
                                     alt="${view.username}" 
                                     class="viewer-avatar"
                                     onerror="this.src='/static/img/default-avatar.png'">
                                <div class="viewer-info">
                                    <h5>${view.full_name || view.username}</h5>
                                    <span>@${view.username}</span>
                                </div>
                            </div>
                        `).join('') : 
                        '<div class="no-views">Chưa có lượt xem nào</div>'
                    }
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Close when clicking outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }
    
    createLikesModal(likes, totalLikes) {
        const oldModal = document.querySelector('.story-likes-modal');
        if (oldModal) oldModal.remove();
        
        const modal = document.createElement('div');
        modal.className = 'story-likes-modal';
        modal.innerHTML = `
            <div class="likes-modal-content">
                <div class="likes-modal-header">
                    <h4><i class="fas fa-heart" style="color:#ff3b5c;"></i> Lượt thích (${totalLikes})</h4>
                    <button class="close-likes-btn" onclick="this.closest('.story-likes-modal').remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="likes-list">
                    ${likes && likes.length > 0 ? 
                        likes.map(like => `
                            <div class="like-item" onclick="window.location.href='/profile/${like.username}'">
                                <img src="${like.avatar || '/static/img/default-avatar.png'}" 
                                     alt="${like.username}" 
                                     class="liker-avatar"
                                     onerror="this.src='/static/img/default-avatar.png'">
                                <div class="liker-info">
                                    <h5>${like.full_name || like.username}</h5>
                                    <span>@${like.username}</span>
                                </div>
                            </div>
                        `).join('') : 
                        '<div class="no-likes">Chưa có lượt thích nào</div>'
                    }
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Close when clicking outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }
    
    // ==================== STORY PLAYER FUNCTIONS ====================
    
    startAutoPlay() {
        this.stopAutoPlay();
        this.isPlaying = true;
        
        this.progressInterval = setInterval(() => {
            this.nextStory();
        }, this.storyDuration);
    }
    
    stopAutoPlay() {
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
            this.progressInterval = null;
        }
        if (this.currentProgressInterval) {
            clearInterval(this.currentProgressInterval);
            this.currentProgressInterval = null;
        }
        this.isPlaying = false;
    }
    
    nextStory() {
        this.stopAutoPlay(); // dừng auto-play hiện tại
    
        if (!this.currentStoryUser?.stories?.length) {
            this.closeViewer();
            return;
        }
    
        // Nếu còn story trong cùng user
        if (this.currentStoryIndex < this.currentStoryUser.stories.length - 1) {
            this.currentStoryIndex++;
            const nextStory = this.currentStoryUser.stories[this.currentStoryIndex];
            this.showStory(nextStory);
            this.markStoryAsViewed(nextStory._id);
        } else {
            // Hết story của user hiện tại -> chuyển sang user tiếp theo
            if (this.currentUserIndex < this.stories.length - 1) {
                this.currentUserIndex++;
                const nextUser = this.stories[this.currentUserIndex];
                if (nextUser?.stories?.length) {
                    // Cập nhật user hiện tại và reset index
                    this.currentStoryUser = nextUser;
                    this.currentStoryIndex = 0;
                    const firstStory = nextUser.stories[0];
                    
                    // Cập nhật header và progress bars
                    this.updateViewerHeader(nextUser);
                    this.renderProgressBars(nextUser.stories);
                    
                    this.showStory(firstStory);
                    this.markStoryAsViewed(firstStory._id);
                } else {
                    this.closeViewer();
                }
            } else {
                this.closeViewer();
            }
        }
    
        this.startAutoPlay(); // khởi động lại auto-play
    }
    
    prevStory() {
        this.stopAutoPlay();
    
        if (!this.currentStoryUser?.stories?.length) {
            this.closeViewer();
            return;
        }
    
        if (this.currentStoryIndex > 0) {
            this.currentStoryIndex--;
            const prevStory = this.currentStoryUser.stories[this.currentStoryIndex];
            this.showStory(prevStory);
            this.markStoryAsViewed(prevStory._id);
        } else {
            // Quay lại user trước
            if (this.currentUserIndex > 0) {
                this.currentUserIndex--;
                const prevUser = this.stories[this.currentUserIndex];
                if (prevUser?.stories?.length) {
                    this.currentStoryUser = prevUser;
                    this.currentStoryIndex = prevUser.stories.length - 1; // story cuối của user trước
                    const lastStory = prevUser.stories[this.currentStoryIndex];
                    
                    this.updateViewerHeader(prevUser);
                    this.renderProgressBars(prevUser.stories);
                    
                    this.showStory(lastStory);
                    this.markStoryAsViewed(lastStory._id);
                } else {
                    this.closeViewer();
                }
            } else {
                this.closeViewer();
            }
        }
    
        this.startAutoPlay();
    }
    updateViewerHeader(user) {
        const header = this.storyViewerModal?.querySelector('.story-user-info');
        if (header) {
            header.innerHTML = `
                <img src="${user.avatar}" alt="${user.name}" class="story-user-avatar"
                     onerror="this.src='/static/img/default-avatar.png'">
                <div class="story-user-details">
                    <h4>${user.name}</h4>
                    <span class="story-time">${this.formatTime(user.stories[0]?.created_at)}</span>
                </div>
            `;
        }
    }
    
    renderProgressBars(stories) {
        const barsContainer = this.storyViewerModal?.querySelector('.story-progress-bars');
        if (barsContainer) {
            barsContainer.innerHTML = stories.map((story, index) => `
                <div class="progress-bar">
                    <div class="progress-fill ${index === 0 ? 'active' : ''}" data-story-index="${index}"></div>
                </div>
            `).join('');
        }
    }
    updateProgressBars() {
        const bars = this.storyViewerModal?.querySelectorAll('.progress-fill');
        if (!bars) return;
    
        // Xóa active và reset width của tất cả
        bars.forEach(bar => {
            bar.classList.remove('active');
            bar.style.width = '0%';
        });
    
        // Active bar hiện tại
        const currentBar = bars[this.currentStoryIndex];
        if (currentBar) {
            currentBar.classList.add('active');
            
            // Bắt đầu tăng width
            let width = 0;
            const interval = setInterval(() => {
                if (width >= 100) {
                    clearInterval(interval);
                    // Khi đầy, tự động next (nếu không pause)
                    if (this.isPlaying) {
                        this.nextStory();
                    }
                } else {
                    width += 100 / (this.storyDuration / 100); // tăng mỗi 100ms
                    currentBar.style.width = width + '%';
                }
            }, 100);
            
            // Lưu interval để có thể hủy nếu chuyển story
            this.currentProgressInterval = interval;
        }
    }
    async markStoryAsViewed(storyId) {
        if (!storyId) return;
        try {
            const res = await fetch(`/api/timeline/stories/${storyId}/view`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const isOwner = this.sameId(this.currentStoryUser?.user_id, window.currentUserId);
            if (res && res.ok && isOwner && this.currentStoryId === storyId) {
                await this.refreshCurrentStory();
            }
        } catch (error) {
            console.error('Error marking story as viewed:', error);
        }
    }
    
    closeViewer() {
        this.stopAutoPlay();
        
        // Xóa sự kiện trước khi xóa modal
        if (this.storyViewerModal) {
            // Xóa tất cả event listeners
            const newModal = this.storyViewerModal.cloneNode(true);
            this.storyViewerModal.parentNode.replaceChild(newModal, this.storyViewerModal);
            newModal.remove();
            this.storyViewerModal = null;
        }
        
        this.currentStory = null;
        this.currentStoryUser = null;
        this.currentStoryIndex = 0;
    }
    
    formatTime(timestamp) {
        if (!timestamp) return '';
        
        // Đảm bảo timestamp có timezone Z (UTC) nếu chưa có
        let normalizedTimestamp = timestamp;
        if (typeof timestamp === 'string' && !timestamp.endsWith('Z')) {
            // Nếu không có timezone, thêm Z để đảm bảo parse là UTC
            normalizedTimestamp = timestamp + 'Z';
        }
        
        const date = new Date(normalizedTimestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);
        
        if (diffMins < 1) return 'Vừa xong';
        if (diffMins < 60) return `${diffMins} phút trước`;
        if (diffHours < 24) return `${diffHours} giờ trước`;
        if (diffDays < 7) return `${diffDays} ngày trước`;
        
        return date.toLocaleDateString('vi-VN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        }).replace(/\//g, '/');
    }
updateHeaderTime(story) {
    if (!this.storyViewerModal) return;
    const timeSpan = this.storyViewerModal.querySelector('.story-time');
    if (timeSpan) {
        timeSpan.textContent = this.formatTime(story.created_at);
    }
}
    
    setupEventListeners() {
        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            const modal = document.querySelector('.stories-viewer-modal');
            if (!modal) return;
            
            if (e.key === 'Escape') this.closeViewer();
            else if (e.key === 'ArrowRight') this.nextStory();
            else if (e.key === 'ArrowLeft') this.prevStory();
        });
        
        // Swipe gestures
        this.setupSwipeGestures();
    }
    
    setupSwipeGestures() {
        let startX = 0;
        let startY = 0;
        
        document.addEventListener('touchstart', (e) => {
            if (!document.querySelector('.stories-viewer-modal')) return;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        });
        
        document.addEventListener('touchend', (e) => {
            if (!document.querySelector('.stories-viewer-modal')) return;
            
            const endX = e.changedTouches[0].clientX;
            const endY = e.changedTouches[0].clientY;
            
            const diffX = endX - startX;
            const diffY = endY - startY;
            
            if (Math.abs(diffX) > Math.abs(diffY)) {
                if (diffX > 50) this.prevStory();
                else if (diffX < -50) this.nextStory();
            } else if (diffY > 50) {
                this.closeViewer();
            }
        });
    }
    
    // ==================== STORY ACTIONS ====================
    
    sendMessage() {
        const story = this.currentStoryUser?.stories?.[this.currentStoryIndex];
        if (story) {
            const message = prompt('Nhập tin nhắn cho story này:');
            if (message) {
                console.log('Gửi tin nhắn cho story:', story._id, message);
                this.showToast('Đã gửi tin nhắn', 'success');
            }
        }
    }
    
    shareStory() {
        const story = this.currentStoryUser?.stories?.[this.currentStoryIndex];
        if (!story) return;
        
        if (navigator.share) {
            navigator.share({
                title: 'Story từ ' + this.currentStoryUser.name,
                text: story.content || 'Xem story thú vị này!',
                url: `${window.location.origin}/story/${story._id}`
            }).catch(err => {
                console.error('Share failed:', err);
                this.copyStoryLink(story._id);
            });
        } else {
            this.copyStoryLink(story._id);
        }
    }
    
    copyStoryLink(storyId) {
        const link = `${window.location.origin}/story/${storyId}`;
        navigator.clipboard.writeText(link)
            .then(() => {
                this.showToast('Đã sao chép link story!', 'success');
            })
            .catch(err => {
                console.error('Error copying link:', err);
                this.showToast('Không thể sao chép link', 'error');
            });
    }
    
    moreOptions() {
        const story = this.currentStoryUser?.stories?.[this.currentStoryIndex];
        if (!story) return;
        
        const options = [];
        const isOwner = this.sameId(this.currentStoryUser?.user_id, window.currentUserId);
        
        if (isOwner) {
            options.push({ 
                text: 'Xóa story', 
                action: () => this.deleteStory(story._id) 
            });
        }
        
        options.push(
            { text: 'Báo cáo story', action: () => this.reportStory(story._id) },
            { text: 'Ẩn story', action: () => this.hideStory(this.currentStoryUser?.user_id) },
            { text: 'Tắt âm', action: () => this.muteUser(this.currentStoryUser?.user_id) }
        );
        
        this.showOptionsMenu(options);
    }
    
    async deleteStory(storyId) {
        if (!confirm('Bạn có chắc chắn muốn xóa story này?')) return;
        
        try {
            const response = await fetch(`/api/timeline/stories/${storyId}`, {
                method: 'DELETE'
            });
            
            const data = await response.json();
            if (data.success) {
                this.closeViewer();
                await this.loadStories();
                this.showToast('Đã xóa story', 'success');
            }
        } catch (error) {
            console.error('Error deleting story:', error);
            this.showToast('Không thể xóa story', 'error');
        }
    }
    
    // Xóa story trực tiếp từ timeline (không cần mở viewer)
    async deleteStoryFromTimeline(userId, event) {
        event.stopPropagation();
        
        // Tìm story của user trong danh sách
        const userStories = this.stories.find(s => this.sameId(s.user_id, userId));
        if (!userStories || !userStories.stories || userStories.stories.length === 0) {
            this.showToast('Không tìm thấy story', 'error');
            return;
        }
        
        // Nếu có nhiều story, hỏi xóa tất cả hay từng cái
        const storyCount = userStories.stories.length;
        let confirmMsg = storyCount > 1 
            ? `Bạn có ${storyCount} story. Xóa tất cả?` 
            : 'Bạn có chắc muốn gỡ story này?';
        
        if (!confirm(confirmMsg)) return;
        
        try {
            let deletedCount = 0;
            // Xóa tất cả story của user hiện tại
            for (const story of [...userStories.stories]) {
                const response = await fetch(`/api/timeline/stories/${story._id}`, {
                    method: 'DELETE'
                });
                
                const data = await response.json();
                if (data.success) {
                    deletedCount++;
                }
            }
            
            // Reload stories để cập nhật UI
            await this.loadStories();
            this.showToast(`Đã gỡ ${deletedCount} story`, 'success');
            
        } catch (error) {
            console.error('Error deleting stories:', error);
            this.showToast('Lỗi khi gỡ story', 'error');
        }
    }
    
    // Toggle menu dropdown trong story viewer
    toggleStoryMenu(event) {
        event.stopPropagation();
        
        const menu = document.getElementById('story-menu-dropdown');
        if (!menu) return;
        
        // Kiểm tra có phải story của chính mình không
        const isOwner = this.sameId(this.currentStoryUser?.user_id, window.currentUserId) 
            || this.sameText(this.currentStoryUser?.name, this.getCurrentUsername());
        
        // Chỉ hiện menu xóa nếu là chủ story
        const deleteItem = menu.querySelector('.story-menu-item:first-child');
        if (deleteItem) {
            deleteItem.style.display = isOwner ? 'flex' : 'none';
        }
        
        // Toggle hiển thị menu
        const isVisible = menu.style.display === 'block';
        this.closeStoryMenu();
        
        if (!isVisible) {
            menu.style.display = 'block';
            // Tạm dừng autoplay khi menu mở
            this.stopAutoPlay();
        }
    }
    
    // Đóng menu dropdown
    closeStoryMenu() {
        const menu = document.getElementById('story-menu-dropdown');
        if (menu) {
            menu.style.display = 'none';
        }
        // Khởi động lại autoplay
        this.startAutoPlay();
    }
    
    // Xóa story hiện tại đang xem
    async deleteCurrentStory() {
        if (!this.currentStory?._id) {
            this.showToast('Không tìm thấy story để xóa', 'error');
            return;
        }
        
        // Kiểm tra quyền sở hữu
        const isOwner = this.sameId(this.currentStoryUser?.user_id, window.currentUserId) 
            || this.sameText(this.currentStoryUser?.name, this.getCurrentUsername());
        
        if (!isOwner) {
            this.showToast('Bạn không có quyền xóa story này', 'error');
            this.closeStoryMenu();
            return;
        }
        
        if (!confirm('Bạn có chắc chắn muốn xóa story này?')) {
            this.closeStoryMenu();
            return;
        }
        
        try {
            const response = await fetch(`/api/timeline/stories/${this.currentStory._id}`, {
                method: 'DELETE'
            });
            
            const data = await response.json();
            if (data.success) {
                this.closeStoryMenu();
                
                // Xóa story khỏi danh sách hiện tại
                const storyIndex = this.currentStoryUser.stories.findIndex(
                    s => s._id === this.currentStory._id
                );
                
                if (storyIndex > -1) {
                    this.currentStoryUser.stories.splice(storyIndex, 1);
                }
                
                // Nếu còn story khác của user này
                if (this.currentStoryUser.stories.length > 0) {
                    // Điều chỉnh index nếu cần
                    if (this.currentStoryIndex >= this.currentStoryUser.stories.length) {
                        this.currentStoryIndex = this.currentStoryUser.stories.length - 1;
                    }
                    // Hiển thị story tiếp theo
                    const nextStory = this.currentStoryUser.stories[this.currentStoryIndex];
                    this.showStory(nextStory);
                    this.renderProgressBars(this.currentStoryUser.stories);
                    this.showToast('Đã xóa story', 'success');
                } else {
                    // Không còn story nào -> đóng viewer
                    this.closeViewer();
                    await this.loadStories();
                    this.showToast('Đã xóa story', 'success');
                }
            } else {
                this.showToast(data.error || 'Không thể xóa story', 'error');
                this.closeStoryMenu();
            }
        } catch (error) {
            console.error('Error deleting story:', error);
            this.showToast('Lỗi khi xóa story', 'error');
            this.closeStoryMenu();
        }
    }
    
    reportStory(storyId) {
        const reason = prompt('Lý do báo cáo:');
        if (reason) {
            console.log('Báo cáo story:', storyId, reason);
            this.showToast('Đã gửi báo cáo', 'success');
        }
    }
    
    hideStory(userId) {
        console.log('Ẩn story của user:', userId);
        this.showToast('Đã ẩn story', 'success');
    }
    
    muteUser(userId) {
        console.log('Tắt âm user:', userId);
        this.showToast('Đã tắt âm', 'success');
    }
    
    showOptionsMenu(options) {
        const menu = document.createElement('div');
        menu.className = 'story-options-menu';
        menu.innerHTML = options.map(option => `
            <div class="story-option-item" onclick="${option.action}">
                ${option.text}
            </div>
        `).join('');
        
        document.body.appendChild(menu);
        setTimeout(() => {
            if (menu.parentElement) {
                menu.remove();
            }
        }, 3000);
    }
    
    showToast(message, type = 'info') {
        // Create toast element
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : 
                              type === 'error' ? 'exclamation-circle' : 
                              type === 'warning' ? 'exclamation-triangle' : 'info-circle'}"></i>
            <span>${message}</span>
            <button class="toast-close" onclick="this.parentElement.remove()">
                <i class="fas fa-times"></i>
            </button>
        `;
        
        // Add to document
        document.body.appendChild(toast);
        
        // Remove after 3 seconds
        setTimeout(() => {
            if (toast.parentElement) {
                toast.remove();
            }
        }, 3000);
    }
}

// ==================== GLOBAL FUNCTIONS ====================

// Initialize managers when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    // Do not override template-provided globals from HTML
    if (typeof window.userAvatar === 'undefined' || !window.userAvatar) {
        window.userAvatar = '/static/img/default-avatar.png';
    }
    
    // Initialize managers
    window.timelineManager = new TimelineManager();
    window.storiesManager = new StoriesManager();
    
    // Set current year
    const yearEl = document.getElementById('current-year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();
    
    // Load notification counts
    loadNotificationCounts();
    
    // Initialize stories scroll
    initStoriesScroll();
    
    // Initialize post content toggle functionality
    initializeTimelinePostContentToggle();
});

function loadNotificationCounts() {
    fetch('/api/notifications/count')
        .then(response => response.json())
        .then(data => {
            if (data.success && data.count > 0) {
                const badge = document.getElementById('notifications-badge');
                if (badge) {
                    badge.textContent = data.count > 99 ? '99+' : data.count;
                    badge.style.display = 'flex';
                }
            }
        })
        .catch(console.error);
    
    fetch('/friend_requests_count')
        .then(response => response.json())
        .then(data => {
            if (data.count > 0) {
                const badge = document.getElementById('friend-requests-badge');
                if (badge) {
                    badge.textContent = data.count > 99 ? '99+' : data.count;
                    badge.style.display = 'flex';
                }
            }
        })
        .catch(console.error);
}

function initStoriesScroll() {
    const container = document.getElementById('stories-container');
    if (!container) return;
    
    let isDown = false;
    let startX;
    let scrollLeft;
    
    container.addEventListener('mousedown', (e) => {
        isDown = true;
        container.classList.add('active');
        startX = e.pageX - container.offsetLeft;
        scrollLeft = container.scrollLeft;
    });
    
    container.addEventListener('mouseleave', () => {
        isDown = false;
        container.classList.remove('active');
    });
    
    container.addEventListener('mouseup', () => {
        isDown = false;
        container.classList.remove('active');
    });
    
    container.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - container.offsetLeft;
        const walk = (x - startX) * 2;
        container.scrollLeft = scrollLeft - walk;
    });
}

// ==================== MEDIA FUNCTIONS ====================

function playVideo(element) {
    const video = element.querySelector('.video-player');
    const playBtn = element.querySelector('.video-play-btn');
    
    if (video.style.display === 'none') {
        video.style.display = 'block';
        playBtn.style.display = 'none';
        video.play().catch(e => console.warn("Video play failed:", e));
    } else {
        video.style.display = 'none';
        playBtn.style.display = 'flex';
        video.pause();
    }
}

// Media Viewer Variables
let postMedia = [];
let currentMediaIndex = 0;

function openMediaViewer(postId, index) {
    const postElement = document.querySelector(`[data-post-id="${postId}"]`);
    if (!postElement) return;

    postMedia = [];

    // Lấy tất cả các container media
    const mediaContainers = postElement.querySelectorAll('.single-media, .media-grid-item');

    mediaContainers.forEach((container, idx) => {
        const img = container.querySelector('img');
        const videoUrl = container.dataset.videoUrl;

        if (videoUrl) {
            // Ưu tiên video từ data attribute
            postMedia.push({
                type: 'video',
                url: videoUrl,
                thumbnail: img ? img.src : null
            });
        } else if (img) {
            const imgUrl = img.src;
            // Kiểm tra phần mở rộng file để phân biệt ảnh/video
            if (imgUrl.match(/\.(mp4|webm|ogg|mov|avi|mkv)$/i)) {
                postMedia.push({ type: 'video', url: imgUrl, thumbnail: imgUrl });
            } else {
                postMedia.push({ type: 'image', url: imgUrl });
            }
        }
    });

    if (postMedia.length === 0) {
        console.warn('Không tìm thấy media');
        return;
    }

    currentMediaIndex = index !== undefined ? Math.min(index, postMedia.length - 1) : 0;
    updateMediaViewer();
    document.getElementById('media-viewer').classList.add('active');
    document.body.style.overflow = 'hidden';
}
function updateMediaViewer() {
    if (!postMedia || postMedia.length === 0) return;

    const media = postMedia[currentMediaIndex];
    const viewerMedia = document.getElementById('viewer-media');
    viewerMedia.innerHTML = '';

    if (media.type === 'image') {
        const img = document.createElement('img');
        img.src = media.url;
        img.className = 'viewer-media-item';
        viewerMedia.appendChild(img);
    } else if (media.type === 'video') {
        const video = document.createElement('video');
        video.controls = true;
        video.autoplay = true;
        video.className = 'viewer-media-item';
        if (media.thumbnail) {
            video.poster = media.thumbnail;
        }
        const source = document.createElement('source');
        source.src = media.url;
        source.type = 'video/mp4';
        video.appendChild(source);
        viewerMedia.appendChild(video);

        video.play().catch(e => console.warn('Autoplay bị chặn:', e));
    }

    // Cập nhật counter và indicators
    const viewerCounter = document.getElementById('viewer-counter');
    if (viewerCounter) {
        viewerCounter.textContent = `${currentMediaIndex + 1} / ${postMedia.length}`;
    }

    const viewerIndicators = document.getElementById('viewer-indicators');
    if (viewerIndicators) {
        viewerIndicators.innerHTML = '';
        for (let i = 0; i < postMedia.length; i++) {
            const indicator = document.createElement('button');
            indicator.className = `viewer-indicator ${i === currentMediaIndex ? 'active' : ''}`;
            indicator.addEventListener('click', () => {
                currentMediaIndex = i;
                updateMediaViewer();
            });
            viewerIndicators.appendChild(indicator);
        }
    }

    const prevBtn = document.getElementById('prev-media');
    const nextBtn = document.getElementById('next-media');
    if (prevBtn) prevBtn.disabled = currentMediaIndex === 0;
    if (nextBtn) nextBtn.disabled = currentMediaIndex === postMedia.length - 1;
}
function closeMediaViewer() {
    const mediaViewer = document.getElementById('media-viewer');
    if (mediaViewer) {
        mediaViewer.classList.remove('active');
        document.body.style.overflow = 'auto';
    }
}

function prevMedia() {
    if (currentMediaIndex > 0) {
        currentMediaIndex--;
        updateMediaViewer();
    }
}

function nextMedia() {
    if (currentMediaIndex < postMedia.length - 1) {
        currentMediaIndex++;
        updateMediaViewer();
    }
}

function searchTag(tag) {
    const cleanTag = tag.startsWith('#') ? tag.substring(1) : tag;
    window.location.href = `/hashtag/${encodeURIComponent(cleanTag)}`;
}

function viewEvent(eventId) {
    window.location.href = `/events/${eventId}`;
}

async function sendFriendRequest(userId, button) {
    if (!userId) return;
    
    // Check current state
    const isAdded = button.classList.contains('added');
    const isFriend = button.classList.contains('friend');
    
    try {
        if (isAdded || isFriend) {
            // Already sent request or friends - cancel/unfriend
            if (isFriend) {
                // Unfriend
                if (!confirm('Bạn có chắc chắn muốn hủy kết bạn?')) {
                    return;
                }
                
                const response = await fetch('/unfriend', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        friend_id: userId
                    })
                });
                
                const data = await response.json();
                if (data.success) {
                    button.innerHTML = '<i class="fas fa-user-plus"></i>';
                    button.classList.remove('added', 'friend');
                    button.disabled = false;
                    if (window.timelineManager) {
                        window.timelineManager.showToast('Đã hủy kết bạn', 'success');
                    }
                } else {
                    throw new Error(data.error || 'Failed to unfriend');
                }
            } else {
                // Cancel friend request
                const response = await fetch('/cancel_friend_request', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        target_user_id: userId
                    })
                });
                
                const data = await response.json();
                if (data.success) {
                    button.innerHTML = '<i class="fas fa-user-plus"></i>';
                    button.classList.remove('added', 'friend');
                    button.disabled = false;
                    if (window.timelineManager) {
                        window.timelineManager.showToast('Đã hủy lời mời kết bạn', 'success');
                    }
                } else {
                    throw new Error(data.error || 'Failed to cancel request');
                }
            }
        } else {
            // Not friends yet - send friend request
            const response = await fetch('/send_friend_request', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    target_user_id: userId
                })
            });
            
            const data = await response.json();
            if (data.success) {
                button.innerHTML = '<i class="fas fa-check"></i>';
                button.classList.add('added');
                button.disabled = false; // Keep enabled for toggle
                if (window.timelineManager) {
                    window.timelineManager.showToast('Đã gửi lời mời kết bạn', 'success');
                }
            } else if (data.error === 'Friend request already sent') {
                // Already sent, treat as toggle
                button.innerHTML = '<i class="fas fa-check"></i>';
                button.classList.add('added');
                button.disabled = false;
                if (window.timelineManager) {
                    window.timelineManager.showToast('Lời mời đã được gửi trước đó', 'info');
                }
            } else if (data.error === 'Already friends') {
                // Already friends
                button.innerHTML = '<i class="fas fa-user-check"></i>';
                button.classList.add('friend');
                button.disabled = false;
                if (window.timelineManager) {
                    window.timelineManager.showToast('Đã là bạn bè', 'info');
                }
            } else {
                throw new Error(data.error || 'Failed to send request');
            }
        }
    } catch (error) {
        console.error('Error handling friend request:', error);
        if (window.timelineManager) {
            window.timelineManager.showToast('Không thể thực hiện', 'error');
        }
    }
}

// ==================== MODAL FUNCTIONS ====================

function openCreatePostModal() {
    document.getElementById('modern-create-post-modal').style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeCreatePostModal() {
    document.getElementById('modern-create-post-modal').style.display = 'none';
    document.body.style.overflow = 'auto';
    document.getElementById('modern-post-content').value = '';
}

// Close modal when clicking outside
document.addEventListener('click', function(event) {
    const modal = document.getElementById('modern-create-post-modal');
    if (event.target === modal) {
        closeCreatePostModal();
    }
});

// Close modal with ESC key
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        const modal = document.getElementById('modern-create-post-modal');
        if (modal && modal.style.display === 'flex') {
            closeCreatePostModal();
        }
        
        const storyModal = document.getElementById('create-story-modal');
        if (storyModal && storyModal.style.display === 'flex') {
            closeStoryModal();
        }
    }
});

// ==================== STORY CREATION FUNCTIONS ====================

let currentStoryType = 'text';
let currentStoryBgColor = '#3b5998';
let uploadedImage = null;
let uploadedVideo = null;

function createStory() {
    const modal = document.getElementById('create-story-modal');
    if (modal) {
        resetStoryForm();
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        setTimeout(() => selectStoryType('text'), 100);
    }
}

function closeStoryModal() {
    const modal = document.getElementById('create-story-modal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
        setTimeout(resetStoryForm, 300);
    }
}

function selectStoryType(type) {
    currentStoryType = type;
    
    document.querySelectorAll('.story-type-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    document.querySelectorAll('.story-type-tab').forEach(tab => {
        const icon = tab.querySelector('i');
        if ((icon.classList.contains('fa-font') && type === 'text') ||
            (icon.classList.contains('fa-image') && type === 'image') ||
            (icon.classList.contains('fa-video') && type === 'video')) {
            tab.classList.add('active');
        }
    });
    
    document.querySelectorAll('.story-editor').forEach(editor => {
        editor.classList.remove('active');
    });
    
    const editor = document.getElementById(`${type}-story-editor`);
    if (editor) {
        editor.classList.add('active');
    }
}

function setStoryBgColor(color) {
    currentStoryBgColor = color;
    const previewArea = document.getElementById('text-preview-area');
    if (previewArea) {
        previewArea.style.background = color;
    }
}

function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
        alert('Vui lòng chọn file ảnh!');
        return;
    }
    
    uploadedImage = file;
    const reader = new FileReader();
    reader.onload = function(e) {
        const preview = document.getElementById('image-preview');
        const uploadZone = document.getElementById('image-upload-zone');
        if (preview) {
            preview.style.display = 'block';
            const img = preview.querySelector('img') || document.getElementById('uploaded-image-src');
            if (img) img.src = e.target.result;
        }
        if (uploadZone) uploadZone.style.display = 'none';
    };
    reader.readAsDataURL(file);
}

function handleVideoUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (!file.type.startsWith('video/')) {
        alert('Vui lòng chọn file video!');
        return;
    }
    
    const video = document.createElement('video');
    video.preload = 'metadata';
    
    video.onloadedmetadata = function() {
        if (video.duration > 15) {
            alert('Video không được dài quá 15 giây!');
            return;
        }
        
        uploadedVideo = file;
        const url = URL.createObjectURL(file);
        
        const preview = document.getElementById('video-preview');
        const uploadZone = document.getElementById('video-upload-zone');
        
        if (preview) {
            preview.style.display = 'block';
            const videoElem = preview.querySelector('video') || document.getElementById('uploaded-video');
            if (videoElem) {
                videoElem.src = url;
                videoElem.load();
            }
        }
        if (uploadZone) uploadZone.style.display = 'none';
    };
    
    video.src = URL.createObjectURL(file);
}

function resetStoryForm() {
    ['image-upload-zone', 'video-upload-zone'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'flex';
    });
    
    ['image-preview', 'video-preview'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    
    const textInput = document.getElementById('story-text-input');
    if (textInput) textInput.value = '';
    
    uploadedImage = null;
    uploadedVideo = null;
}

async function submitStory() {
    const createBtn = document.getElementById('create-story-btn');
    if (!createBtn) return;
    
    const originalText = createBtn.innerHTML;
    
    try {
        const formData = new FormData();
        formData.append('type', currentStoryType);
        
        if (currentStoryType === 'text') {
            const text = document.getElementById('story-text-input').value.trim();
            if (!text) {
                alert('Vui lòng nhập nội dung story!');
                return;
            }
            formData.append('content', text);
            formData.append('background', currentStoryBgColor);
        } else if (currentStoryType === 'image') {
            if (!uploadedImage) {
                alert('Vui lòng chọn ảnh!');
                return;
            }
            formData.append('file', uploadedImage);
        } else if (currentStoryType === 'video') {
            if (!uploadedVideo) {
                alert('Vui lòng chọn video!');
                return;
            }
            formData.append('file', uploadedVideo);
        }
        
        createBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang đăng...';
        createBtn.disabled = true;
        
        const response = await fetch('/api/timeline/stories', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert('Đã tạo story thành công!');
            closeStoryModal();
            if (window.storiesManager) {
                await window.storiesManager.loadStories();
            }
        } else {
            throw new Error(data.error || 'Lỗi không xác định');
        }
    } catch (error) {
        console.error('Error creating story:', error);
        alert('Có lỗi xảy ra: ' + error.message);
    } finally {
        createBtn.innerHTML = originalText;
        createBtn.disabled = false;
    }
}

// ==================== STORIES SCROLL ====================

function scrollStories(direction) {
    const container = document.getElementById('stories-container');
    if (!container) return;
    
    const scrollAmount = 200;
    container.scrollBy({
        left: scrollAmount * direction,
        behavior: 'smooth'
    });
}

// ==================== NOTIFICATION FUNCTION ====================

function showNotification(message, type = 'info') {
    // Tạo element thông báo
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
        <span>${message}</span>
        <button onclick="this.parentElement.remove()" style="background: none; border: none; color: inherit; cursor: pointer; padding: 5px;">
            <i class="fas fa-times"></i>
        </button>
    `;
    
    // Style cho notification
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'success' ? '#d4edda' : type === 'error' ? '#f8d7da' : '#d1ecf1'};
        color: ${type === 'success' ? '#155724' : type === 'error' ? '#721c24' : '#0c5460'};
        padding: 15px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 9999;
        display: flex;
        align-items: center;
        gap: 10px;
        max-width: 300px;
        animation: slideIn 0.3s ease-out;
    `;
    
    document.body.appendChild(notification);
    
    // Tự động remove sau 5 giây
    setTimeout(() => {
        if (notification.parentElement) {
            notification.remove();
        }
    }, 5000);
}

// ==================== NOTIFICATION FUNCTION ====================

function showNotification(message, type = 'info') {
    // Tạo element thông báo
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
        <span>${message}</span>
        <button onclick="this.parentElement.remove()" style="background: none; border: none; color: inherit; cursor: pointer; padding: 5px;">
            <i class="fas fa-times"></i>
        </button>
    `;
    
    // Style cho notification
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'success' ? '#d4edda' : type === 'error' ? '#f8d7da' : '#d1ecf1'};
        color: ${type === 'success' ? '#155724' : type === 'error' ? '#721c24' : '#0c5460'};
        padding: 15px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 9999;
        display: flex;
        align-items: center;
        gap: 10px;
        max-width: 300px;
        animation: slideIn 0.3s ease-out;
    `;
    
    document.body.appendChild(notification);
    
    // Tự động remove sau 5 giây
    setTimeout(() => {
        if (notification.parentElement) {
            notification.remove();
        }
    }, 5000);
}

// ==================== TRENDING TAGS FUNCTIONS ====================

function searchTag(tag) {
    console.log('🔍 Searching for tag:', tag);
    const cleanTag = tag.startsWith('#') ? tag.substring(1) : tag;
    window.location.href = `/hashtag/${encodeURIComponent(cleanTag)}`;
}

// Đảm bảo hàm có sẵn trong global scope
window.searchTag = searchTag;

function followTag(tag, event) {
    event.stopPropagation();
    console.log('🔥 Following tag:', tag);
    
    // Toggle follow/unfollow
    const btn = event.target.closest('.trending-follow-btn');
    const isFollowing = btn.classList.contains('following');
    
    if (isFollowing) {
        // Unfollow
        btn.classList.remove('following');
        btn.innerHTML = '<i class="fas fa-hashtag"></i>';
        showNotification(`Đã bỏ theo dõi #${tag}`, 'info');
    } else {
        // Follow
        btn.classList.add('following');
        btn.innerHTML = '<i class="fas fa-check"></i>';
        showNotification(`Đã theo dõi #${tag}`, 'success');
    }
    
    // Có thể gọi API để lưu trạng thái follow
    // fetch('/api/timeline/follow-tag', { method: 'POST', body: JSON.stringify({ tag }) })
}

// Đảm bảo hàm có sẵn trong global scope
window.followTag = followTag;

// ==================== MEDIA VIEWER EVENTS ====================
function initializeMediaViewerEvents() {
    const closeBtn = document.getElementById('close-viewer');
    const prevBtn = document.getElementById('prev-media');
    const nextBtn = document.getElementById('next-media');
    const modal = document.getElementById('media-viewer');
    
    if (closeBtn) closeBtn.addEventListener('click', closeMediaViewer);
    if (prevBtn) prevBtn.addEventListener('click', prevMedia);
    if (nextBtn) nextBtn.addEventListener('click', nextMedia);
    
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeMediaViewer();
        });
    }
    
    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        const modal = document.getElementById('media-viewer');
        if (!modal || !modal.classList.contains('active')) return;
        
        switch(e.key) {
            case 'Escape':
                closeMediaViewer();
                break;
            case 'ArrowLeft':
                prevMedia();
                break;
            case 'ArrowRight':
                nextMedia();
                break;
        }
    });
}

// ==================== EDIT POST MODAL FUNCTIONS ====================

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

async function handleEditPost(e) {
    e.preventDefault();
    
    const postId = document.getElementById('edit-post-id').value;
    const content = document.getElementById('edit-post-content').value.trim();
    
    if (!content) {
        timelineManager.showToast('Vui lòng nhập nội dung bài viết', 'warning');
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
            closeEditPostModal();
            timelineManager.showToast('Cập nhật bài viết thành công!', 'success');
            
            // Reload posts để cập nhật UI
            timelineManager.currentPage = 1;
            timelineManager.posts = [];
            const postsContainer = document.getElementById('timeline-posts');
            if (postsContainer) postsContainer.innerHTML = '';
            await timelineManager.loadTimelinePosts();
        } else {
            timelineManager.showToast(result.error || 'Lỗi khi cập nhật bài viết', 'error');
        }
    } catch (error) {
        console.error('Error editing post:', error);
        timelineManager.showToast('Lỗi khi cập nhật bài viết', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalHTML;
    }
}

// Initialize edit modal events
function initializeEditModalEvents() {
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

// Initialize media viewer events when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initializeMediaViewerEvents();
    initializeEditModalEvents();
});

// ==================== TIMELINE POST CONTENT TOGGLE FUNCTIONALITY ====================
/**
 * Khởi tạo chức năng xem thêm/rút gọn cho bài viết dài trên timeline
 */
function initializeTimelinePostContentToggle() {
    // Tìm tất cả nội dung bài viết chính chưa có toggle button
    const postContents = document.querySelectorAll('.post-content-modern:not(.toggle-initialized)');
    
    postContents.forEach(content => {
        const postId = content.id.replace('post-content-', '');
        const textContent = content.textContent.trim();
        
        // Đánh dấu là đã khởi tạo
        content.classList.add('toggle-initialized');
        
        // Chỉ thêm nút xem thêm nếu nội dung dài hơn 3 dòng (khoảng 150 ký tự)
        if (textContent.length > 150) {
            // Thêm class truncated ban đầu
            content.classList.add('truncated');
            
            // Tạo nút xem thêm
            const toggleBtn = document.createElement('button');
            toggleBtn.className = 'post-content-toggle';
            toggleBtn.innerHTML = '<span>Xem thêm</span> <i class="fas fa-chevron-down"></i>';
            toggleBtn.onclick = () => toggleTimelinePostContent(postId);
            
            // Chèn nút sau nội dung bài viết
            content.parentNode.insertBefore(toggleBtn, content.nextSibling);
        }
    });
    
    // Xử lý cả nội dung bài viết được chia sẻ chưa có toggle button
    const sharedContents = document.querySelectorAll('.shared-content:not(.toggle-initialized)');
    sharedContents.forEach((content, index) => {
        const textContent = content.textContent.trim();
        
        // Đánh dấu là đã khởi tạo
        content.classList.add('toggle-initialized');
        
        if (textContent.length > 150) {
            // Tạo ID unique cho shared content
            const sharedId = `timeline-shared-${index}`;
            content.id = `shared-content-${sharedId}`;
            
            // Thêm class truncated
            content.classList.add('truncated');
            
            // Tạo nút xem thêm
            const toggleBtn = document.createElement('button');
            toggleBtn.className = 'post-content-toggle';
            toggleBtn.innerHTML = '<span>Xem thêm</span> <i class="fas fa-chevron-down"></i>';
            toggleBtn.onclick = () => toggleTimelineSharedContent(sharedId);
            
            // Chèn nút sau nội dung
            content.parentNode.insertBefore(toggleBtn, content.nextSibling);
        }
    });
}

/**
 * Toggle hiển thị đầy đủ/rút gọn nội dung bài viết trên timeline
 */
function toggleTimelinePostContent(postId) {
    const content = document.getElementById(`post-content-${postId}`);
    const toggleBtn = content.nextElementSibling;
    
    if (content.classList.contains('truncated')) {
        // Hiển thị đầy đủ
        content.classList.remove('truncated');
        content.classList.add('expanded');
        toggleBtn.innerHTML = '<span>Rút gọn</span> <i class="fas fa-chevron-up"></i>';
        toggleBtn.classList.add('expanded');
    } else {
        // Rút gọn
        content.classList.remove('expanded');
        content.classList.add('truncated');
        toggleBtn.innerHTML = '<span>Xem thêm</span> <i class="fas fa-chevron-down"></i>';
        toggleBtn.classList.remove('expanded');
    }
}

/**
 * Toggle hiển thị đầy đủ/rút gọn nội dung bài viết được chia sẻ trên timeline
 */
function toggleTimelineSharedContent(sharedId) {
    const content = document.getElementById(`shared-content-${sharedId}`);
    const toggleBtn = content.nextElementSibling;
    
    if (content.classList.contains('truncated')) {
        // Hiển thị đầy đủ
        content.classList.remove('truncated');
        content.classList.add('expanded');
        toggleBtn.innerHTML = '<span>Rút gọn</span> <i class="fas fa-chevron-up"></i>';
        toggleBtn.classList.add('expanded');
    } else {
        // Rút gọn
        content.classList.remove('expanded');
        content.classList.add('truncated');
        toggleBtn.innerHTML = '<span>Xem thêm</span> <i class="fas fa-chevron-down"></i>';
        toggleBtn.classList.remove('expanded');
    }
}