// DOM Elements
const likeBtn = document.getElementById('like-btn');
const likeCount = document.getElementById('like-count');
const commentBtn = document.getElementById('comment-btn');
const commentInput = document.getElementById('comment-input');
const submitComment = document.getElementById('submit-comment');
const commentsList = document.getElementById('comments-list');
const commentCount = document.getElementById('comment-count');

// Media Viewer Elements
const mediaViewer = document.getElementById('media-viewer');
const viewerMedia = document.getElementById('viewer-media');
const viewerCounter = document.getElementById('viewer-counter');
const viewerIndicators = document.getElementById('viewer-indicators');
const prevMediaBtn = document.getElementById('prev-media');
const nextMediaBtn = document.getElementById('next-media');
const closeViewerBtn = document.getElementById('close-viewer');

let currentMediaIndex = 0;

// Like functionality
likeBtn.addEventListener('click', async function() {
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
            // Update UI
            likeBtn.classList.toggle('liked');
            likeBtn.innerHTML = data.liked 
                ? '<i class="fas fa-heart"></i><span>Bỏ thích</span>'
                : '<i class="fas fa-heart"></i><span>Thích</span>';
            
            likeCount.textContent = data.like_count;
            
            // Update stats item
            const likeStat = document.getElementById('like-stat');
            likeStat.classList.toggle('liked');
        }
    } catch (error) {
        console.error('Error liking post:', error);
    }
});

// Comment functionality
async function submitCommentHandler() {
    const content = commentInput.value.trim();
    
    if (!content) {
        alert('Vui lòng nhập nội dung bình luận!');
        return;
    }
    
    try {
        // Disable button and show loading
        submitComment.disabled = true;
        submitComment.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        
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
        
        const data = await response.json();
        
        if (data.success) {
            // Add new comment to list
            const comment = data.comment;
            
            const commentItem = document.createElement('div');
            commentItem.className = 'comment-item';
            commentItem.dataset.commentId = comment.id;
            commentItem.innerHTML = `
                <img src="${comment.user_avatar}" alt="${comment.username}" class="comment-avatar">
                <div class="comment-content">
                    <div class="comment-header">
                        <strong>${comment.username}</strong>
                        <span class="comment-time">Vừa xong</span>
                    </div>
                    <p class="comment-text">${comment.content}</p>
                </div>
            `;
            
            // Remove no comments message if exists
            const noComments = document.querySelector('.no-comments');
            if (noComments) {
                noComments.remove();
            }
            
            // Add to top of comments list
            commentsList.prepend(commentItem);
            
            // Update comment count
            const currentCount = parseInt(commentCount.textContent);
            commentCount.textContent = currentCount + 1;
            
            // Clear input
            commentInput.value = '';
            
            // Scroll to new comment
            commentItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    } catch (error) {
        console.error('Error posting comment:', error);
        alert('Có lỗi xảy ra khi đăng bình luận!');
    } finally {
        // Re-enable button
        submitComment.disabled = false;
        submitComment.innerHTML = '<i class="fas fa-paper-plane"></i>';
    }
}

// Event listeners for comment
submitComment.addEventListener('click', submitCommentHandler);

commentInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitCommentHandler();
    }
});

// Media viewer functionality
function openMediaViewer(index) {
    currentMediaIndex = index;
    updateMediaViewer();
    mediaViewer.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function updateMediaViewer() {
    if (!postMedia || postMedia.length === 0) return;
    
    const media = postMedia[currentMediaIndex];
    viewerMedia.innerHTML = '';
    
    if (media.type === 'image') {
        const img = document.createElement('img');
        img.src = media.url;
        img.alt = 'Post image';
        img.className = 'viewer-media-item';
        viewerMedia.appendChild(img);
    } else if (media.type === 'video') {
        const video = document.createElement('video');
        video.controls = true;
        video.className = 'viewer-media-item';
        const source = document.createElement('source');
        source.src = media.url;
        source.type = 'video/mp4';
        video.appendChild(source);
        viewerMedia.appendChild(video);
    }
    
    // Update counter
    viewerCounter.textContent = `${currentMediaIndex + 1} / ${postMedia.length}`;
    
    // Update indicators
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
    
    // Update navigation buttons
    prevMediaBtn.disabled = currentMediaIndex === 0;
    nextMediaBtn.disabled = currentMediaIndex === postMedia.length - 1;
}

// Event listeners for media viewer
prevMediaBtn.addEventListener('click', () => {
    if (currentMediaIndex > 0) {
        currentMediaIndex--;
        updateMediaViewer();
    }
});

nextMediaBtn.addEventListener('click', () => {
    if (currentMediaIndex < postMedia.length - 1) {
        currentMediaIndex++;
        updateMediaViewer();
    }
});

closeViewerBtn.addEventListener('click', () => {
    mediaViewer.classList.remove('active');
    document.body.style.overflow = 'auto';
});

// Close viewer with ESC key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mediaViewer.classList.contains('active')) {
        mediaViewer.classList.remove('active');
        document.body.style.overflow = 'auto';
    }
});

// Open media viewer when clicking on media
document.addEventListener('DOMContentLoaded', () => {
    const mediaItems = document.querySelectorAll('.media-item img, .media-item video, .post-image-detail, .post-video-detail');
    
    mediaItems.forEach((item, index) => {
        item.style.cursor = 'pointer';
        item.addEventListener('click', () => {
            openMediaViewer(index);
        });
    });
});

// Share functionality
const shareBtn = document.getElementById('share-btn');
shareBtn.addEventListener('click', () => {
    const postUrl = window.location.href;
    
    if (navigator.share) {
        navigator.share({
            title: 'Bài viết từ Paw Talk',
            text: 'Xem bài viết này trên Paw Talk',
            url: postUrl,
        })
        .catch(console.error);
    } else {
        // Fallback: copy to clipboard
        navigator.clipboard.writeText(postUrl).then(() => {
            alert('Đã sao chép link bài viết vào clipboard!');
        }).catch(console.error);
    }
});