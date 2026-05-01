# app/timeline_blueprint.py
from flask import Blueprint, request, session, jsonify, url_for, current_app
from bson import ObjectId
from datetime import datetime, timedelta
import os
import re
import uuid
import pytz
from datetime import datetime, timedelta
from werkzeug.utils import secure_filename
from app.utils.time_utils import format_timestamp_for_client, get_vietnam_time

# Tạo blueprint với tên 'timeline_api'
timeline_api = Blueprint('timeline_api', __name__)

# Thêm import trong hàm để tránh circular import
def get_db():
    """Lấy mongo instance"""
    from app import mongo
    return mongo

def get_db_collections():
    """Lấy các collections từ mongo"""
    mongo = get_db()
    return {
        'users': mongo.db.users,
        'posts': mongo.db.posts,
        'conversations': mongo.db.conversations,
        'messages': mongo.db.messages,
        'friend_requests': mongo.db.friend_requests,
        'notifications': mongo.db.notifications,
        'stories': mongo.db.stories,
        'groups': mongo.db.groups,
        'group_members': mongo.db.group_members
    }

def calculate_time_ago(post_date):
    """Tính thời gian đã trôi qua kể từ khi đăng bài"""
    try:
        if not post_date:
            return "Vừa xong"
        
        # DEBUG: In ra giá trị để kiểm tra
        # print(f"[DEBUG] calculate_time_ago input: {post_date}, type: {type(post_date)}")
            
        # Dùng giờ Việt Nam để tính toán
        vietnam_tz = pytz.timezone('Asia/Ho_Chi_Minh')
        now = datetime.now(vietnam_tz)
        # print(f"[DEBUG] Current VN time: {now}")
        
        # Đảm bảo post_date là datetime
        if isinstance(post_date, str):
            try:
                # Thử parse ISO format
                if 'T' in post_date:
                    post_date = datetime.fromisoformat(post_date.replace('Z', '+00:00'))
                else:
                    # Thử parse các định dạng khác
                    post_date = datetime.strptime(post_date, '%Y-%m-%d %H:%M:%S')
            except:
                try:
                    post_date = datetime.strptime(post_date, '%Y-%m-%d')
                except:
                    return "Vừa xong"
        
        # print(f"[DEBUG] Parsed post_date: {post_date}, tzinfo: {post_date.tzinfo}")
        
        # Nếu post_date có timezone, chuyển về giờ Việt Nam
        if post_date.tzinfo is not None:
            post_date_vn = post_date.astimezone(vietnam_tz)
        else:
            # Nếu không có timezone, coi là UTC và chuyển sang VN
            utc_dt = pytz.utc.localize(post_date)
            post_date_vn = utc_dt.astimezone(vietnam_tz)
        
        # print(f"[DEBUG] Post date VN: {post_date_vn}")
        
        diff = now - post_date_vn
        # print(f"[DEBUG] Time diff: {diff}, seconds: {diff.total_seconds()}")
        
        if diff.total_seconds() < 60:
            result = "Vừa xong"
        elif diff.total_seconds() < 3600:
            minutes = int(diff.total_seconds() / 60)
            if minutes == 1:
                result = "1 phút trước"
            else:
                result = f"{minutes} phút trước"
        elif diff.total_seconds() < 86400:
            hours = int(diff.total_seconds() / 3600)
            if hours == 1:
                result = "1 giờ trước"
            else:
                result = f"{hours} giờ trước"
        else:
            result = post_date_vn.strftime("%d/%m/%Y")
        
        # print(f"[DEBUG] Result: {result}")
        return result
    except Exception as e:
        # print(f"[DEBUG] Error in calculate_time_ago: {e}")
        return "Vừa xong"

# ==================== TIMELINE POSTS ====================

@timeline_api.route('/posts')
def get_timeline_posts():
    """API lấy danh sách bài viết trên timeline với pagination hoàn chỉnh"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    
    try:
        collections = get_db_collections()
        user_id = session['user_id']
        page = int(request.args.get('page', 1))
        filter_type = request.args.get('filter', 'all')
        per_page = int(request.args.get('per_page', 10))
        
        # Giới hạn per_page giữa 5-50
        per_page = max(5, min(50, per_page))
        
        # 1. Lấy danh sách bạn bè và bài viết đã ẩn
        current_user = collections['users'].find_one({'_id': ObjectId(user_id)})
        friend_ids = current_user.get('friends', []) if current_user else []
        hidden_posts = current_user.get('hidden_posts', []) if current_user else []
        
        # Convert friend_ids sang string để so sánh đúng
        friend_ids_str = [str(fid) for fid in friend_ids if fid]
        
        # Chuyển đổi hidden_posts thành ObjectId để query đúng
        hidden_post_ids = []
        for post_id in hidden_posts:
            if ObjectId.is_valid(post_id):
                hidden_post_ids.append(ObjectId(post_id))
        
        # 2. TẠO DANH SÁCH ID "KÉP" (Cả String và ObjectId) ĐỂ TRÁNH SÓT DỮ LIỆU
        raw_ids = [user_id] + friend_ids
        allowed_user_ids = []
        for rid in raw_ids:
            if rid:
                allowed_user_ids.append(str(rid))  # Dạng chuỗi
                if ObjectId.is_valid(rid):
                    allowed_user_ids.append(ObjectId(rid))  # Dạng ObjectId
        
        # 3. Xây dựng Query - lấy tất cả bài viết từ user và bạn bè
        hashtag_filter = request.args.get('hashtag', '').strip().lower()
        
        query = {
            'user_id': {'$in': allowed_user_ids}
        }
        
        # Loại bỏ bài viết đã ẩn
        if hidden_post_ids:
            query['_id'] = {'$nin': hidden_post_ids}
        
        # Apply hashtag filter if specified
        if hashtag_filter:
            query['tags'] = hashtag_filter
            print(f"[DEBUG] Hashtag filter applied: {hashtag_filter}")
        
        if filter_type == 'friends':
            # Chỉ lấy bài viết của bạn bè
            print(f"[DEBUG] Friends filter - friend_ids: {friend_ids}")
            if not friend_ids:
                # Nếu không có bạn bè, trả về rỗng
                print("[DEBUG] No friends found, returning empty")
                return jsonify({
                    'success': True,
                    'posts': [],
                    'pagination': {
                        'current_page': page,
                        'per_page': per_page,
                        'total_posts': 0,
                        'total_pages': 0,
                        'has_next': False,
                        'has_prev': False,
                        'next_page': None,
                        'prev_page': None,
                        'showing_from': 0,
                        'showing_to': 0
                    },
                    'filter_type': filter_type
                })
            
            f_ids = []
            for fid in friend_ids:
                f_ids.append(str(fid))
                if ObjectId.is_valid(fid):
                    f_ids.append(ObjectId(fid))
            query['user_id'] = {'$in': f_ids}
            print(f"[DEBUG] Friends query user_ids: {f_ids}")
        elif filter_type == 'my_posts':
            # Chỉ bài viết của mình
            query['user_id'] = ObjectId(user_id)
        elif filter_type == 'media':
            # Media posts - vẫn lấy từ tất cả user
            query['media_urls'] = {'$exists': True, '$ne': []}
        elif filter_type == 'following':
            # Bài viết đã thích (liked posts)
            # Tìm tất cả bài viết có user_id trong danh sách likes
            current_user_id_str = str(session['user_id'])  # Use session user_id directly
            print(f"[DEBUG] Current user_id from session: {session['user_id']}")
            print(f"[DEBUG] Current user_id as string: {current_user_id_str}")
            
            # Try both string and ObjectId formats for compatibility
            liked_posts_query = {
                '$or': [
                    {'likes': current_user_id_str},
                    {'likes': session['user_id']}  # Original format
                ]
            }
            
            # Nếu có hidden posts, loại bỏ chúng
            if hidden_post_ids:
                liked_posts_query['_id'] = {'$nin': hidden_post_ids}
            
            print(f"[DEBUG] Liked posts query: {liked_posts_query}")
            
            # Đếm tổng số bài viết đã thích
            total_posts = collections['posts'].count_documents(liked_posts_query)
            print(f"[DEBUG] Total liked posts found: {total_posts}")
            
            total_pages = (total_posts + per_page - 1) // per_page
            
            # Đảm bảo page không vượt quá total_pages
            if page > total_pages and total_pages > 0:
                page = total_pages
            
            # Lấy bài viết đã thích với pagination
            posts_cursor = collections['posts'].find(liked_posts_query).sort('created_at', -1).skip((page-1)*per_page).limit(per_page)
            posts = list(posts_cursor)
            
            # Debug: Check likes array in found posts
            for i, post in enumerate(posts):
                print(f"[DEBUG] Post {i} likes: {post.get('likes', [])}")
                print(f"[DEBUG] Post {i} _id: {post.get('_id')}")
            
            # Bỏ qua phần query chung vì đã có query riêng
            query = None
            
            print(f"[DEBUG] Liked posts query - user_id: {current_user_id_str}, found: {len(posts)} posts")
        elif filter_type == 'popular':
            # Bài viết mà user đã được tag (tagged posts)
            # Tìm tất cả bài viết có user_id trong mảng tagged_friends
            current_user_id_str = str(session['user_id'])
            print(f"[DEBUG] Current user_id from session: {session['user_id']}")
            print(f"[DEBUG] Current user_id as string: {current_user_id_str}")
            
            # Try both string and ObjectId formats for compatibility
            tagged_posts_query = {
                '$or': [
                    {'tagged_friends.id': current_user_id_str},
                    {'tagged_friends.id': session['user_id']}
                ]
            }
            
            # Nếu có hidden posts, loại bỏ chúng
            if hidden_post_ids:
                tagged_posts_query['_id'] = {'$nin': hidden_post_ids}
            
            print(f"[DEBUG] Tagged posts query: {tagged_posts_query}")
            
            # Đếm tổng số bài viết đã được tag
            total_posts = collections['posts'].count_documents(tagged_posts_query)
            print(f"[DEBUG] Total tagged posts found: {total_posts}")
            
            total_pages = (total_posts + per_page - 1) // per_page
            
            # Đảm bảo page không vượt quá total_pages
            if page > total_pages and total_pages > 0:
                page = total_pages
            
            # Lấy bài viết đã được tag với pagination
            posts_cursor = collections['posts'].find(tagged_posts_query).sort('created_at', -1).skip((page-1)*per_page).limit(per_page)
            posts = list(posts_cursor)
            
            # Debug: Check tagged_friends array in found posts
            for i, post in enumerate(posts):
                print(f"[DEBUG] Post {i} tagged_friends: {post.get('tagged_friends', [])}")
                print(f"[DEBUG] Post {i} _id: {post.get('_id')}")
            
            # Bỏ qua phần query chung vì đã có query riêng
            query = None
            
            print(f"[DEBUG] Tagged posts query - user_id: {current_user_id_str}, found: {len(posts)} posts")
        
        # Loại bỏ bài viết đã ẩn cho mọi filter (trừ liked posts)
        if hidden_post_ids and query is not None:
            query['_id'] = {'$nin': hidden_post_ids}

        # 4. Truy vấn dữ liệu với pagination
        if query is None:
            # Đã xử lý trong filter 'following' (liked posts)
            pass
        else:
            # Xử lý các filter khác
            total_posts = collections['posts'].count_documents(query)
            total_pages = (total_posts + per_page - 1) // per_page
            
            # Đảm bảo page không vượt quá total_pages
            if page > total_pages and total_pages > 0:
                page = total_pages
            
            posts_cursor = collections['posts'].find(query).sort('created_at', -1).skip((page-1)*per_page).limit(per_page)
            posts = list(posts_cursor)
        
        # Nếu là filter 'popular', sắp xếp theo số tương tác
        if filter_type == 'popular':
            posts.sort(key=lambda x: (
                len(x.get('likes', [])) + 
                len(x.get('comments', [])) + 
                x.get('shares_count', 0)
            ), reverse=True)
        
        # Tải thông tin các bài gốc trước khi lọc privacy
        original_posts_info = {}
        original_post_ids = []
        for post in posts:
            if post.get('original_post_id'):
                if ObjectId.is_valid(post['original_post_id']):
                    original_post_ids.append(ObjectId(post['original_post_id']))
        
        if original_post_ids:
            original_posts_cursor = collections['posts'].find({'_id': {'$in': original_post_ids}})
            for original_post in original_posts_cursor:
                original_posts_info[str(original_post['_id'])] = original_post
        
        # 5. Apply privacy filtering - lọc bài viết theo quyền xem
        filtered_posts = []
        print(f"[DEBUG] Privacy filter - user_id: {user_id}, friend_ids_str: {friend_ids_str}")
        for post in posts:
            post_user_id = str(post.get('user_id', ''))
            post_privacy = post.get('privacy', 'public')
            post_id = str(post.get('_id', ''))
            
            print(f"[DEBUG] Post {post_id}: user={post_user_id}, privacy={post_privacy}")
            
            # Kiểm tra privacy bài viết chính
            can_view = False
            
            # Public: ai cũng có thể xem
            if post_privacy == 'public':
                can_view = True
            # Friends: chỉ bạn bè và chủ bài viết có thể xem
            elif post_privacy == 'friends':
                if post_user_id in friend_ids_str or post_user_id == user_id:
                    can_view = True
            # Only_me: chỉ chủ bài viết có thể xem
            elif post_privacy == 'only_me':
                if post_user_id == user_id:
                    can_view = True
            # Xử lý legacy 'private' như only_me
            elif post_privacy == 'private':
                if post_user_id == user_id:
                    can_view = True
            
            print(f"[DEBUG] Post {post_id}: can_view after privacy check = {can_view}")
            
            # Nếu là bài chia sẻ, kiểm tra thêm privacy của bài gốc
            if can_view and post.get('is_shared') and post.get('original_post_id'):
                original_post = original_posts_info.get(post['original_post_id'])
                if original_post:
                    original_user_id = str(original_post.get('user_id', ''))
                    original_privacy = original_post.get('privacy', 'public')
                    
                    print(f"[DEBUG] Post {post_id} is shared, original privacy: {original_privacy}, original user: {original_user_id}")
                    
                    # Nếu bài gốc là only_me, chỉ chủ bài gốc mới xem được
                    if original_privacy in ['only_me', 'private']:
                        if original_user_id != user_id:
                            can_view = False
                    # Nếu bài gốc là friends, chỉ bạn bè của chủ bài gốc mới xem được
                    elif original_privacy == 'friends':
                        if original_user_id != user_id and original_user_id not in friend_ids_str:
                            can_view = False
                    
                    print(f"[DEBUG] Post {post_id}: can_view after shared check = {can_view}")
            
            if can_view:
                filtered_posts.append(post)
                print(f"[DEBUG] Post {post_id}: ADDED to filtered_posts")
            else:
                print(f"[DEBUG] Post {post_id}: EXCLUDED from filtered_posts")
        
        print(f"[DEBUG] Total posts: {len(posts)}, Filtered posts: {len(filtered_posts)}")
        
        # Thay thế posts bằng filtered_posts
        posts = filtered_posts
        
        formatted_posts = []
        
        for post in posts:
            # Lấy thông tin tác giả (author)
            author_id = post.get('user_id')
            author = None
            
            # Tìm author bằng cả string và ObjectId
            try:
                if ObjectId.is_valid(author_id):
                    author = collections['users'].find_one({'_id': ObjectId(author_id)})
                else:
                    author = collections['users'].find_one({'_id': ObjectId(author_id)}) or \
                            collections['users'].find_one({'_id': author_id})
            except:
                pass
            
            # Xử lý Avatar
            author_avatar = author.get('avatar') if author else ''
            if not author_avatar or author_avatar == '':
                author_avatar = '/static/img/default-avatar.png'
            elif not author_avatar.startswith(('http', 'data:image', '/static')):
                # Thêm uploads/ vào đường dẫn
                if author_avatar.startswith('uploads/'):
                    author_avatar = f'/static/{author_avatar}'
                else:
                    author_avatar = f'/static/uploads/{author_avatar}'

            # Xác định xem current user đã like chưa
            likes = post.get('likes', [])
            is_liked = str(user_id) in likes or user_id in likes
            
            # Xử lý media URLs
            media_urls = post.get('media_urls', [])
            processed_media_urls = []
            for media in media_urls:
                if isinstance(media, dict):
                    processed_media_urls.append(media)
                else:
                    # Nếu là string, chuyển thành dict
                    processed_media_urls.append({
                        'url': media,
                        'type': 'image' if any(ext in media.lower() for ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp']) else 'video'
                    })
            
            # Đếm tổng comments (gốc + replies)
            comments = post.get('comments', [])
            total_comments = len(comments)
            for comment in comments:
                total_comments += len(comment.get('replies', []))
            
            # Xử lý bài chia sẻ
            original_post_data = None
            if post.get('original_post_id') and post.get('is_shared'):
                original_post = original_posts_info.get(post['original_post_id'])
                if original_post:
                    # Lấy thông tin tác giả bài gốc
                    original_author_id = original_post.get('user_id')
                    original_author = None
                    try:
                        if ObjectId.is_valid(original_author_id):
                            original_author = collections['users'].find_one({'_id': ObjectId(original_author_id)})
                        else:
                            original_author = collections['users'].find_one({'_id': ObjectId(original_author_id)}) or \
                                            collections['users'].find_one({'_id': original_author_id})
                    except:
                        pass
                    
                    # Xử lý avatar tác giả gốc
                    original_avatar = original_author.get('avatar') if original_author else '/static/img/default-avatar.png'
                    if not original_avatar.startswith(('http', 'data:image', '/static')):
                        if original_avatar.startswith('uploads/'):
                            original_avatar = f'/static/{original_avatar}'
                        else:
                            original_avatar = f'/static/uploads/{original_avatar}'
                    
                    original_post_data = {
                        '_id': str(original_post['_id']),
                        'content': original_post.get('content', ''),
                        'media_urls': original_post.get('media_urls', []),
                        'owner_username': original_author.get('username', '') if original_author else '',
                        'owner_full_name': original_author.get('full_name', '') if original_author else '',
                        'owner_avatar': original_avatar,
                        'created_at': original_post.get('created_at').isoformat() if isinstance(original_post.get('created_at'), datetime) else str(original_post.get('created_at'))
                    }
                else:
                    # Bài gốc đã bị xóa
                    original_post_data = {
                        'content': '[Bài viết gốc đã bị xóa]',
                        'owner_username': 'Không xác định',
                        'owner_full_name': 'Không xác định',
                        'owner_avatar': '/static/img/default-avatar.png'
                    }
            
            formatted_post_data = {
                '_id': str(post['_id']),
                'user_id': str(post.get('user_id', '')),  # THÊM: ID của chủ bài viết
                'author_name': author.get('full_name', author.get('username', 'Người dùng')) if author else 'Ẩn danh',
                'author_username': author.get('username', '') if author else '',
                'author_avatar': author_avatar,
                'content': post.get('content', ''),
                'media_urls': processed_media_urls,
                'created_at': post.get('created_at').isoformat() if isinstance(post.get('created_at'), datetime) else str(post.get('created_at')),
                'time_ago': calculate_time_ago(post.get('created_at')),
                'likes_count': len(likes),
                'comments_count': total_comments,
                'shares_count': post.get('shares', 0),
                'is_liked': is_liked,
                'privacy': post.get('privacy', 'public'),
                'post_type': post.get('post_type', 'normal'),
                'is_shared': post.get('is_shared', False),
                'original_post_id': str(post.get('original_post_id', '')) if post.get('original_post_id') else None,
                'original_post': original_post_data,
                'tagged_friends': post.get('tagged_friends', [])  # Add tagged friends
            }
            
            formatted_posts.append(formatted_post_data)
        
        return jsonify({
            'success': True, 
            'posts': formatted_posts,
            'pagination': {
                'current_page': page,
                'per_page': per_page,
                'total_posts': total_posts,
                'total_pages': total_pages,
                'has_next': page < total_pages,
                'has_prev': page > 1,
                'next_page': page + 1 if page < total_pages else None,
                'prev_page': page - 1 if page > 1 else None,
                'showing_from': ((page - 1) * per_page) + 1 if total_posts > 0 else 0,
                'showing_to': min(page * per_page, total_posts) if total_posts > 0 else 0
            },
            'filter_type': filter_type
        })
    except Exception as e:
        print(f"Lỗi get_timeline_posts: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# ==================== SEARCH POSTS BY HASHTAG ====================

@timeline_api.route('/posts/hashtag/<tag>')
def get_posts_by_hashtag(tag):
    """API tìm kiếm bài viết theo hashtag"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    
    try:
        # Decode URL-encoded characters
        from urllib.parse import unquote
        tag = unquote(tag)
        
        collections = get_db_collections()
        user_id = session['user_id']
        page = int(request.args.get('page', 1))
        per_page = 10
        
        # Normalize tag (bỏ # nếu có, chuyển lowercase)
        tag = tag.lower().strip('#')
        
        # Lấy danh sách bạn bè
        current_user = collections['users'].find_one({'_id': ObjectId(user_id)})
        friend_ids = current_user.get('friends', []) if current_user else []
        
        # Query tìm bài viết có chứa hashtag trong content
        # Pattern: #tag_name (có thể có khoảng trắng, dấu câu ở cuối)
        hashtag_pattern = f'#{tag}\\b'
        
        query = {
            'content': {'$regex': hashtag_pattern, '$options': 'i'}
        }
        
        # Lấy bài viết
        posts_cursor = collections['posts'].find(query).sort('created_at', -1).skip((page-1)*per_page).limit(per_page)
        posts = list(posts_cursor)
        
        # Apply privacy filtering
        filtered_posts = []
        for post in posts:
            post_user_id = str(post.get('user_id', ''))
            post_privacy = post.get('privacy', 'public')
            
            # Public: ai cũng xem được
            if post_privacy == 'public':
                filtered_posts.append(post)
            # Friends: bạn bè và chủ bài viết xem được
            elif post_privacy == 'friends':
                if post_user_id in friend_ids or post_user_id == user_id:
                    filtered_posts.append(post)
            # Only_me/Private: chỉ chủ bài viết xem được
            elif post_privacy in ['only_me', 'private']:
                if post_user_id == user_id:
                    filtered_posts.append(post)
        
        # Format posts
        formatted_posts = []
        for post in filtered_posts:
            author_id = post.get('user_id')
            author = collections['users'].find_one({'_id': ObjectId(author_id)}) if ObjectId.is_valid(author_id) else None
            
            # Xử lý avatar
            author_avatar = author.get('avatar', '') if author else ''
            if not author_avatar:
                author_avatar = '/static/img/default-avatar.png'
            elif not author_avatar.startswith(('http', 'data:image', '/static')):
                author_avatar = f'/static/uploads/{author_avatar}'
            
            # Xác định xem current user đã like chưa
            likes = post.get('likes', [])
            is_liked = str(user_id) in likes or user_id in likes
            
            # Đếm tổng comments (gốc + replies)
            comments = post.get('comments', [])
            total_comments = len(comments)
            for comment in comments:
                total_comments += len(comment.get('replies', []))
            
            # Xử lý bài đăng được chia sẻ (shared post)
            shared_post_info = None
            if post.get('is_shared') and post.get('original_post_id'):
                original_post = collections['posts'].find_one({'_id': ObjectId(post['original_post_id'])})
                if original_post:
                    original_author = collections['users'].find_one({'_id': ObjectId(original_post['user_id'])})
                    shared_post_info = {
                        'original_post_id': str(original_post['_id']),
                        'original_content': original_post.get('content', ''),
                        'original_author_name': original_author.get('full_name') or original_author.get('username', 'Unknown') if original_author else 'Unknown',
                        'original_author_username': original_author.get('username') if original_author else None,
                        'original_author_avatar': original_author.get('avatar') if original_author else None,
                        'original_media_urls': original_post.get('media_urls', []),
                        'original_created_at': original_post.get('created_at').isoformat() if isinstance(original_post.get('created_at'), datetime) else str(original_post.get('created_at'))
                    }
            
            # Format time ago
            time_ago = format_timestamp_for_client(post.get('created_at'))
            
            formatted_posts.append({
                '_id': str(post['_id']),
                'author_name': author.get('full_name', author.get('username', 'Người dùng')) if author else 'Ẩn danh',
                'author_username': author.get('username', '') if author else '',
                'author_avatar': author_avatar,
                'content': post.get('content', ''),
                'media_urls': post.get('media_urls', []),
                'created_at': post.get('created_at').isoformat() if isinstance(post.get('created_at'), datetime) else str(post.get('created_at')),
                'time_ago': time_ago,
                'likes': len(post.get('likes', [])),
                'comments': total_comments,
                'shares': post.get('shares', 0),
                'privacy': post.get('privacy', 'public'),
                'is_shared': post.get('is_shared', False),
                'original_post_id': post.get('original_post_id'),
                'shared_post_info': shared_post_info,
                'is_liked': is_liked,
                'tagged_friends': post.get('tagged_friends', [])
            })
        
        return jsonify({
            'success': True,
            'tag': tag,
            'posts': formatted_posts,
            'count': len(formatted_posts)
        })
        
    except Exception as e:
        print(f"Error searching posts by hashtag: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ==================== TRENDING TAGS ====================

@timeline_api.route('/trending-tags')
def get_trending_tags():
    """API lấy trending tags từ database"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    
    try:
        collections = get_db_collections()
        
        # Lấy tất cả posts, đếm frequency của hashtags
        pipeline = [
            {'$match': {'content': {'$exists': True, '$ne': ''}}},
            {'$project': {'content': 1}},
            {'$limit': 1000}  # Giới hạn 1000 posts gần nhất
        ]
        
        posts = list(collections['posts'].aggregate(pipeline))
        
        # Đếm hashtags
        hashtag_counts = {}
        hashtag_pattern = r'#(\w+)'
        
        for post in posts:
            content = post.get('content', '')
            hashtags = re.findall(hashtag_pattern, content, re.IGNORECASE)
            
            for tag in hashtags:
                tag_lower = tag.lower()
                hashtag_counts[tag_lower] = hashtag_counts.get(tag_lower, 0) + 1
        
        # Sắp xếp theo frequency và lấy top 10
        trending = sorted(
            hashtag_counts.items(), 
            key=lambda x: x[1], 
            reverse=True
        )[:10]
        
        # Format kết quả
        trending_tags = [
            {'tag': tag, 'count': count}
            for tag, count in trending
        ]
        
        # print(f"🔥 Found {len(trending_tags)} trending tags")
        
        return jsonify({
            'success': True,
            'trending_tags': trending_tags
        })
        
    except Exception as e:
        print(f"Error getting trending tags: {str(e)}")
        return jsonify({'success': False, 'error': 'Internal server error'}), 500


# ==================== ACTIVE FRIENDS ====================

@timeline_api.route('/reset_all_online', methods=['POST'])
def reset_all_online_status():
    """Reset tất cả users về offline - dùng khi CSDL bị nhầm online/offline"""
    try:
        collections = get_db_collections()
        # Reset tất cả users về offline
        result = collections['users'].update_many(
            {},
            {'$set': {'online': False, 'last_active': None}}
        )
        return jsonify({
            'success': True,
            'message': f'Đã reset {result.modified_count} users về offline'
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@timeline_api.route('/friends/active')
def get_active_friends():
    """API lấy danh sách bạn bè đang hoạt động"""
    
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    
    try:
        collections = get_db_collections()
        
        user_id = session['user_id']
        current_user = collections['users'].find_one({'_id': ObjectId(user_id)})
        
        if not current_user:
            return jsonify({'success': False, 'error': 'User not found'}), 404
        
        friend_ids = current_user.get('friends', [])
        
        # Chuyển đổi friend_ids sang ObjectId
        friend_object_ids = []
        for fid in friend_ids:
            if fid:  # Kiểm tra không None/empty
                try:
                    if isinstance(fid, str) and ObjectId.is_valid(fid):
                        friend_object_ids.append(ObjectId(fid))
                    elif isinstance(fid, ObjectId):
                        friend_object_ids.append(fid)
                except Exception as e:
                    print(f"⚠️ Error converting friend ID {fid}: {e}")
        
        # Chỉ lấy bạn bè đang online
        query = {
            '_id': {'$in': friend_object_ids},
            'online': True
        }
        
        friends = list(collections['users'].find(
            query,
            {
                'username': 1,
                'avatar': 1,
                'full_name': 1,
                'online': 1,
                'last_active': 1,
                'last_seen': 1
            }
        ).limit(15))
        
        # Format dữ liệu
        formatted_friends = []
        for friend in friends:
            username = friend.get('username')
            if not username:
                continue
            
            # Xử lý avatar
            avatar = friend.get('avatar')
            if avatar:
                if not avatar.startswith(('http', 'data:image', '/static')):
                    # Thử nhiều định dạng
                    if avatar.startswith('uploads/'):
                        avatar = f'/static/{avatar}'
                    elif avatar.startswith('img/'):
                        avatar = f'/static/{avatar}'
                    else:
                        avatar = f'/static/uploads/{avatar}'
            else:
                avatar = '/static/img/default-avatar.png'
            
            # Kiểm tra online status
            last_active = friend.get('last_active') or friend.get('last_seen')
            is_online = friend.get('online', False)
            
            if last_active:
                if isinstance(last_active, datetime):
                    # Chỉ check online flag từ database, không so sánh thời gian
                    is_online = friend.get('online', False)
                else:
                    # Convert string to datetime nhưng không so sánh
                    try:
                        datetime.fromisoformat(str(last_active).replace('Z', '+00:00'))
                    except:
                        pass
            
            formatted_friends.append({
                '_id': str(friend['_id']),
                'username': username,
                'avatar': avatar,
                'full_name': friend.get('full_name', username),
                'name': friend.get('full_name') or username,
                'is_online': is_online
            })
        
        return jsonify({
            'success': True,
            'friends': formatted_friends,
            'count': len(formatted_friends)
        })
        
    except Exception as e:
        print(f"❌ ERROR in get_active_friends: {str(e)}")
        return jsonify({
            'success': False, 
            'error': str(e),
            'message': 'Internal server error'
        }), 500

# ==================== TIMELINE STATS ====================

@timeline_api.route('/stats')
def get_timeline_stats():
    """API lấy thống kê timeline"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    
    try:
        collections = get_db_collections()
        
        user_id = session['user_id']
        current_user = collections['users'].find_one({'_id': ObjectId(user_id)})
        
        if not current_user:
            return jsonify({'success': False, 'error': 'User not found'}), 404
        
        friend_ids = current_user.get('friends', [])
        
        # Chuyển đổi friend_ids sang ObjectId
        friend_object_ids = []
        for fid in friend_ids:
            if ObjectId.is_valid(fid):
                friend_object_ids.append(ObjectId(fid))
        
        # Thêm chính mình vào danh sách
        friend_object_ids.append(ObjectId(user_id))
        
        # Bài viết hôm nay
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        today_posts = collections['posts'].count_documents({
            'user_id': {'$in': friend_object_ids},
            'created_at': {'$gte': today_start}
        })
        
        # Bạn bè đang hoạt động (online: True và last_active trong 5 phút qua)
        five_minutes_ago = datetime.utcnow() - timedelta(minutes=5)
        active_friends = collections['users'].count_documents({
            '_id': {'$in': friend_object_ids},
            'online': True,
            '$or': [
                {'last_active': {'$gte': five_minutes_ago}},
                {'last_seen': {'$gte': five_minutes_ago}},
                {'last_active': None},
                {'last_seen': None}
            ]
        })
        
        # Tổng số bài viết
        total_posts = collections['posts'].count_documents({
            'user_id': {'$in': friend_object_ids}
        })
        
        # Tổng số tương tác
        total_interactions = 0
        if total_posts > 0:
            posts = list(collections['posts'].find({
                'user_id': {'$in': friend_object_ids}
            }, {'likes': 1, 'comments': 1, 'shares': 1}))
            
            for post in posts:
                total_interactions += len(post.get('likes', []))
                total_interactions += len(post.get('comments', []))
                total_interactions += post.get('shares', 0)
        
        avg_interactions = round(total_interactions / total_posts, 1) if total_posts > 0 else 0
        
        return jsonify({
            'success': True,
            'stats': {
                'today_posts': today_posts,
                'active_friends': active_friends,
                'total_posts': total_posts,
                'avg_interactions': avg_interactions,
                'friend_count': len(friend_ids)
            }
        })
        
    except Exception as e:
        print(f"Error getting timeline stats: {str(e)}")
        return jsonify({'success': False, 'error': 'Internal server error'}), 500

# ==================== POST LIKE/UNLIKE ====================

@timeline_api.route('/posts/<post_id>/likes', methods=['GET'])
def get_post_likes(post_id):
    """API lấy danh sách người đã thích bài viết"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    
    try:
        collections = get_db_collections()
        
        if not ObjectId.is_valid(post_id):
            return jsonify({'success': False, 'error': 'Invalid post ID'}), 400
        
        post = collections['posts'].find_one({'_id': ObjectId(post_id)})
        
        if not post:
            return jsonify({'success': False, 'error': 'Post not found'}), 404
        
        likes = post.get('likes', [])
        
        if not likes:
            return jsonify({
                'success': True,
                'likes': [],
                'count': 0
            })
        
        # Convert all user IDs to ObjectId for querying
        user_ids = []
        for uid in likes:
            if ObjectId.is_valid(uid):
                user_ids.append(ObjectId(uid))
        
        # Get user info
        users = list(collections['users'].find(
            {'_id': {'$in': user_ids}},
            {'username': 1, 'full_name': 1, 'avatar': 1}
        ))
        
        # Format response
        likes_list = []
        for user in users:
            avatar = user.get('avatar', '')
            if avatar and not avatar.startswith(('http', 'data:image', '/static')):
                avatar = f'/static/{avatar}'
            elif not avatar:
                avatar = '/static/img/default-avatar.png'
            
            likes_list.append({
                'user_id': str(user['_id']),
                'username': user.get('username', 'Unknown'),
                'full_name': user.get('full_name', user.get('username', 'Unknown')),
                'avatar': avatar
            })
        
        return jsonify({
            'success': True,
            'likes': likes_list,
            'count': len(likes_list)
        })
        
    except Exception as e:
        print(f"Error getting post likes: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': 'Internal server error'}), 500

@timeline_api.route('/posts/<post_id>/like', methods=['POST', 'DELETE'])
def handle_post_like(post_id):
    """API like/unlike bài viết"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    
    try:
        from app import socketio
        collections = get_db_collections()
        
        user_id = session['user_id']
        
        # Kiểm tra post_id hợp lệ
        if not ObjectId.is_valid(post_id):
            return jsonify({'success': False, 'error': 'Invalid post ID'}), 400
        
        post_oid = ObjectId(post_id)
        post = collections['posts'].find_one({'_id': post_oid})
        
        if not post:
            return jsonify({'success': False, 'error': 'Post not found'}), 404
        
        # Lấy thông tin người dùng
        user = collections['users'].find_one({'_id': ObjectId(user_id)}, {'username': 1})
        
        if request.method == 'POST':
            # Like bài viết
            result = collections['posts'].update_one(
                {'_id': post_oid},
                {'$addToSet': {'likes': user_id}}
            )
            
            # Lấy số like mới (dù có thay đổi hay không)
            updated_post = collections['posts'].find_one({'_id': post_oid})
            like_count = len(updated_post.get('likes', []))
            is_liked = user_id in updated_post.get('likes', [])
            
            if result.modified_count > 0:
                # Like thành công mới
                # Tạo thông báo (nếu không phải tự like)
                if str(post.get('user_id')) != user_id:
                    print(f"[DEBUG] Creating like notification from timeline blueprint - user_id: {user_id}, post_id: {post['_id']}")
                    
                    notification_data = {
                        'recipient_id': ObjectId(post['user_id']),
                        'sender_id': ObjectId(user_id),
                        'sender_name': user.get('username', 'Unknown'),
                        'type': 'like',
                        'content': 'đã thích bài viết của bạn',
                        'data': {
                            'post_id': str(post['_id']),
                            'post_preview': post.get('content', '')[:50] + '...' if post.get('content') else 'Bài viết'
                        },
                        'read': False,
                        'created_at': get_vietnam_time()
                    }
                    
                    # Lưu thông báo
                    inserted_notif = collections['notifications'].insert_one(notification_data)
                    print(f"[DEBUG] Timeline like notification inserted with ID: {inserted_notif.inserted_id}")
                    
                    # Gửi socket
                    socket_data = notification_data.copy()
                    socket_data['_id'] = str(inserted_notif.inserted_id)
                    socket_data['recipient_id'] = str(socket_data['recipient_id'])
                    socket_data['sender_id'] = str(socket_data['sender_id'])
                    
                    # Chuyển created_at sang string ISO nếu là object datetime
                    if hasattr(socket_data['created_at'], 'isoformat'):
                        socket_data['created_at'] = socket_data['created_at'].isoformat()

                    socketio.emit('new_notification', socket_data, room=str(post['user_id']))
                    print(f"[DEBUG] Timeline like notification sent via socket to room: {post['user_id']}")
                
                return jsonify({
                    'success': True,
                    'action': 'liked',
                    'message': 'Đã thích bài viết',
                    'like_count': like_count,
                    'liked': True,
                    'post_id': post_id
                })
            else:
                # Đã like rồi, trả về trạng thái hiện tại
                return jsonify({
                    'success': True,
                    'action': 'liked',
                    'message': 'Bạn đã thích bài viết này',
                    'like_count': like_count,
                    'liked': True,
                    'post_id': post_id
                })
            
        else:  # DELETE method
            # Unlike bài viết
            result = collections['posts'].update_one(
                {'_id': post_oid},
                {'$pull': {'likes': user_id}}
            )
            
            # Lấy số like mới (dù có thay đổi hay không)
            updated_post = collections['posts'].find_one({'_id': post_oid})
            like_count = len(updated_post.get('likes', []))
            is_liked = user_id in updated_post.get('likes', [])
            
            if result.modified_count > 0:
                return jsonify({
                    'success': True,
                    'action': 'unliked',
                    'message': 'Đã bỏ thích bài viết',
                    'like_count': like_count,
                    'liked': False,
                    'post_id': post_id
                })
            else:
                # Đã unlike rồi, trả về trạng thái hiện tại
                return jsonify({
                    'success': True,
                    'action': 'unliked',
                    'message': 'Bạn chưa thích bài viết này',
                    'like_count': like_count,
                    'liked': False,
                    'post_id': post_id
                })
        
    except Exception as e:
        print(f"Error handling post like: {str(e)}")
        return jsonify({'success': False, 'error': 'Internal server error'}), 500

# ==================== POST COMMENTS ====================

@timeline_api.route('/posts/<post_id>/comments', methods=['GET'])
def get_post_comments(post_id):
    """API lấy danh sách bình luận"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    
    try:
        collections = get_db_collections()
        
        post = collections['posts'].find_one({'_id': ObjectId(post_id)})
        if not post:
            return jsonify({'success': False, 'error': 'Post not found'}), 404
        
        comments = post.get('comments', [])
        
        # Sắp xếp comments mới nhất lên đầu
        comments.sort(key=lambda x: x.get('created_at', datetime.min), reverse=True)
        
        # Chuyển đổi datetime sang string
        for comment in comments:
            if 'created_at' in comment and isinstance(comment['created_at'], datetime):
                comment['created_at'] = comment['created_at'].isoformat()
            if 'replies' in comment:
                for reply in comment['replies']:
                    if 'created_at' in reply and isinstance(reply['created_at'], datetime):
                        reply['created_at'] = reply['created_at'].isoformat()
        
        return jsonify({
            'success': True,
            'comments': comments,
            'count': len(comments) + sum(len(comment.get('replies', [])) for comment in comments)
        })
        
    except Exception as e:
        print(f"Error getting comments: {str(e)}")
        return jsonify({'success': False, 'error': 'Internal server error'}), 500

@timeline_api.route('/posts/<post_id>/comments', methods=['POST'])
def add_post_comment(post_id):
    """API thêm bình luận vào bài viết"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    
    try:
        from app import socketio
        collections = get_db_collections()
        user_id = session['user_id']
        
        data = request.get_json()
        content = data.get('content', '')
        reply_to = data.get('reply_to')  # ID comment được reply
        reply_type = data.get('reply_type', 'comment')
        
        if not content or not content.strip():
            return jsonify({
                'success': False, 
                'error': 'Nội dung bình luận không được để trống'
            }), 400
        
        if not ObjectId.is_valid(post_id):
            return jsonify({'success': False, 'error': 'Invalid post ID'}), 400
        
        # Lấy bài viết
        post = collections['posts'].find_one({'_id': ObjectId(post_id)})
        if not post:
            return jsonify({'success': False, 'error': 'Bài viết không tồn tại'}), 404
        
        # Lấy user
        user = collections['users'].find_one({'_id': ObjectId(user_id)}, {'username': 1, 'full_name': 1, 'avatar': 1})
        if not user:
            return jsonify({'success': False, 'error': 'Người dùng không tồn tại'}), 404
        
        # Xử lý avatar
        user_avatar = user.get('avatar', '')
        if user_avatar:
            if not user_avatar.startswith(('http', '/static', 'data:image')):
                if not user_avatar.startswith('/'):
                    user_avatar = f'/static/{user_avatar}'
        else:
            user_avatar = '/static/img/default-avatar.png'
        
        # Tạo comment
        comment_id = str(uuid.uuid4())
        comment_data = {
            'id': comment_id,
            'user_id': user_id,
            'username': user.get('full_name') or user.get('username', 'Unknown'),
            'full_name': user.get('full_name', user.get('username', 'Unknown')),  # THÊM: Họ tên đầy đủ
            'user_avatar': user_avatar,
            'content': content.strip(),
            'created_at': datetime.utcnow(),
            'likes': [],
            'replies': []
        }
        
        # ==================== XỬ LÝ REPLY ====================
        if reply_to:
            parent_comment_id = None
            reply_to_username = ''
            
            current_comments = post.get('comments', [])
            
            # Tìm comment cha
            for comment in current_comments:
                # Reply vào comment gốc
                if comment.get('id') == reply_to:
                    parent_comment_id = comment.get('id')
                    reply_to_username = comment.get('username')
                    break
                
                # Reply vào reply con
                for reply in comment.get('replies', []):
                    if reply.get('id') == reply_to:
                        parent_comment_id = comment.get('id')
                        reply_to_username = reply.get('username')
                        break
                
                if parent_comment_id:
                    break
            
            if parent_comment_id:
                comment_data['reply_to'] = reply_to
                comment_data['reply_to_username'] = reply_to_username
                
                collections['posts'].update_one(
                    {
                        '_id': ObjectId(post_id),
                        'comments.id': parent_comment_id
                    },
                    {
                        '$push': {'comments.$.replies': comment_data},
                        '$inc': {'comment_count': 1}
                    }
                )
                
                # Chuyển datetime thành string trước khi emit socket và trả về
                comment_data['created_at'] = comment_data['created_at'].isoformat() if isinstance(comment_data['created_at'], datetime) else str(comment_data['created_at'])
                
                # Gửi socket event
                socketio.emit('new_comment', {
                    'post_id': post_id,
                    'comment': comment_data,
                    'parent_id': parent_comment_id,
                    'is_reply': True
                }, room=f'post_{post_id}')
                
                # Tạo thông báo cho chủ comment
                if parent_comment_id and str(post.get('user_id')) != user_id:
                    try:
                        # Tìm chủ comment gốc
                        target_user_id = None
                        for comment in post.get('comments', []):
                            if comment.get('id') == parent_comment_id:
                                target_user_id = comment.get('user_id')
                                break
                        
                        if target_user_id and target_user_id != user_id:
                            notification_data = {
                                'recipient_id': ObjectId(target_user_id),
                                'sender_id': ObjectId(user_id),
                                'sender_name': user.get('full_name') or user.get('username', 'Unknown'),
                                'type': 'comment_reply',
                                'content': 'đã phản hồi bình luận của bạn',
                                'data': {
                                    'post_id': str(post_id),
                                    'comment_id': parent_comment_id,
                                    'reply_id': comment_id,
                                    'post_preview': post.get('content', '')[:50] + '...' if post.get('content') else 'Bài viết'
                                },
                                'read': False,
                                'created_at': datetime.utcnow()
                            }
                            
                            collections['notifications'].insert_one(notification_data)
                            socketio.emit('new_notification', {
                                '_id': str(notification_data.get('_id', '')),
                                'recipient_id': str(notification_data['recipient_id']),
                                'sender_id': str(notification_data['sender_id']),
                                'sender_name': notification_data['sender_name'],
                                'type': notification_data['type'],
                                'content': notification_data['content'],
                                'data': notification_data['data'],
                                'read': False,
                                'created_at': notification_data['created_at'].isoformat()
                            }, room=target_user_id)
                    except Exception as notif_error:
                        print(f"Error creating reply notification: {str(notif_error)}")
                
                return jsonify({
                    'success': True,
                    'comment': comment_data,
                    'parent_id': parent_comment_id
                })
        
        # ==================== COMMENT GỐC ====================
        collections['posts'].update_one(
            {'_id': ObjectId(post_id)},
            {
                '$push': {'comments': comment_data},
                '$inc': {'comment_count': 1}
            }
        )
        
        # Chuyển datetime thành string trước khi trả về và emit socket
        comment_data['created_at'] = comment_data['created_at'].isoformat() if isinstance(comment_data['created_at'], datetime) else str(comment_data['created_at'])
        
        # Gửi socket event
        socketio.emit('new_comment', {
            'post_id': post_id,
            'comment': comment_data,
            'is_reply': False
        }, room=f'post_{post_id}')
        
        # Tạo thông báo cho chủ bài viết (nếu không phải tự comment)
        if str(post.get('user_id')) != user_id:
            try:
                notification_data = {
                    'recipient_id': ObjectId(post['user_id']),
                    'sender_id': ObjectId(user_id),
                    'sender_name': user.get('full_name') or user.get('username', 'Unknown'),
                    'type': 'comment',
                    'content': 'đã bình luận bài viết của bạn',
                    'data': {
                        'post_id': str(post_id),
                        'comment_id': comment_id,
                        'post_preview': post.get('content', '')[:50] + '...' if post.get('content') else 'Bài viết'
                    },
                    'read': False,
                    'created_at': datetime.utcnow()
                }
                
                collections['notifications'].insert_one(notification_data)
                socketio.emit('new_notification', {
                    '_id': str(notification_data.get('_id', '')),
                    'recipient_id': str(notification_data['recipient_id']),
                    'sender_id': str(notification_data['sender_id']),
                    'sender_name': notification_data['sender_name'],
                    'type': notification_data['type'],
                    'content': notification_data['content'],
                    'data': notification_data['data'],
                    'read': False,
                    'created_at': notification_data['created_at'].isoformat()
                }, room=str(post['user_id']))
            except Exception as notif_error:
                print(f"Error creating comment notification: {str(notif_error)}")
        
        # Chuyển datetime thành string trước khi trả về
        comment_data['created_at'] = comment_data['created_at'].isoformat() if isinstance(comment_data['created_at'], datetime) else str(comment_data['created_at'])
        
        return jsonify({'success': True, 'comment': comment_data})
        
    except Exception as e:
        print(f"Error adding comment: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# ==================== COMMENT LIKE/UNLIKE ====================

@timeline_api.route('/posts/<post_id>/comments/<comment_id>/like', methods=['POST', 'DELETE'])
def handle_comment_like(post_id, comment_id):
    """API like/unlike bình luận"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    
    try:
        from app import socketio
        collections = get_db_collections()
        user_id = session['user_id']
        
        if not ObjectId.is_valid(post_id):
            return jsonify({'success': False, 'error': 'Invalid post ID'}), 400
        
        post_oid = ObjectId(post_id)
        post = collections['posts'].find_one({'_id': post_oid})
        
        if not post:
            return jsonify({'success': False, 'error': 'Post not found'}), 404
        
        # Tìm comment (cả trong comments gốc và replies)
        comment_found = None
        comment_parent_index = -1
        comment_index = -1
        is_reply = False
        
        # Tìm trong comments gốc
        for i, comment in enumerate(post.get('comments', [])):
            if comment.get('id') == comment_id:
                comment_found = comment
                comment_parent_index = i
                comment_index = i
                break
        
        # Nếu không tìm thấy, tìm trong replies
        if not comment_found:
            for parent_idx, parent_comment in enumerate(post.get('comments', [])):
                for reply_idx, reply in enumerate(parent_comment.get('replies', [])):
                    if reply.get('id') == comment_id:
                        comment_found = reply
                        comment_parent_index = parent_idx
                        comment_index = reply_idx
                        is_reply = True
                        break
                if comment_found:
                    break
        
        if not comment_found:
            return jsonify({'success': False, 'error': 'Comment not found'}), 404
        
        print(f"[DEBUG] Found comment: {comment_id}, is_reply: {is_reply}, method: {request.method}")
        print(f"[DEBUG] Current likes: {comment_found.get('likes', [])}")
        
        user = collections['users'].find_one({'_id': ObjectId(user_id)}, {'username': 1})
        
        if request.method == 'POST':
            print(f"[DEBUG] Processing POST (like)")
            # Like comment
            if user_id in comment_found.get('likes', []):
                print(f"[DEBUG] Already liked - return 400")
                return jsonify({'success': False, 'error': 'Already liked'}), 400
            
            if is_reply:
                # Update reply - cách đơn giản: tìm và update trong array
                parent_comment = post.get('comments', [])[comment_parent_index]
                replies = list(parent_comment.get('replies', []))  # Tạo copy mới
                replies[comment_index]['likes'] = list(replies[comment_index].get('likes', []))  # Tạo copy mới
                if user_id not in replies[comment_index]['likes']:
                    replies[comment_index]['likes'].append(user_id)
                
                # Update toàn bộ parent comment
                collections['posts'].update_one(
                    {'_id': post_oid, 'comments.id': parent_comment.get('id')},
                    {'$set': {'comments.$.replies': replies}}
                )
            else:
                # Update comment gốc
                collections['posts'].update_one(
                    {'_id': post_oid, 'comments.id': comment_id},
                    {'$addToSet': {'comments.$.likes': user_id}}
                )
            
            action = 'liked'
            liked = True
            
            # Tạo thông báo (nếu không phải tự like)
            if comment_found.get('user_id') != user_id:
                notification_data = {
                    'recipient_id': ObjectId(comment_found['user_id']),
                    'sender_id': ObjectId(user_id),
                    'sender_name': user.get('full_name') or user.get('username', 'Unknown'),
                    'type': 'comment_like',
                    'content': 'đã thích bình luận của bạn',
                    'data': {
                        'post_id': str(post_id),
                        'comment_id': comment_id,
                        'post_preview': post.get('content', '')[:50] + '...' if post.get('content') else 'Bài viết'
                    },
                    'read': False,
                    'created_at': datetime.utcnow()
                }
                
                collections['notifications'].insert_one(notification_data)
                socketio.emit('new_notification', {
                    '_id': str(notification_data.get('_id', '')),
                    'recipient_id': str(notification_data['recipient_id']),
                    'sender_id': str(notification_data['sender_id']),
                    'sender_name': notification_data['sender_name'],
                    'type': notification_data['type'],
                    'content': notification_data['content'],
                    'data': notification_data['data'],
                    'read': False,
                    'created_at': notification_data['created_at'].isoformat()
                }, room=comment_found['user_id'])
        else:
            # Unlike comment - đọc dữ liệu mới nhất từ DB
            print(f"[DEBUG] Processing DELETE (unlike)")
            fresh_post = collections['posts'].find_one({'_id': post_oid})
            fresh_comment_found = None
            fresh_parent_index = -1
            fresh_reply_index = -1
            fresh_is_reply = False
            
            # Tìm lại comment trong dữ liệu mới
            for i, comment in enumerate(fresh_post.get('comments', [])):
                if comment.get('id') == comment_id:
                    fresh_comment_found = comment
                    fresh_parent_index = i
                    fresh_reply_index = i
                    break
                for reply_idx, reply in enumerate(comment.get('replies', [])):
                    if reply.get('id') == comment_id:
                        fresh_comment_found = reply
                        fresh_parent_index = i
                        fresh_reply_index = reply_idx
                        fresh_is_reply = True
                        break
                if fresh_comment_found:
                    break
            
            if not fresh_comment_found:
                return jsonify({'success': False, 'error': 'Comment not found'}), 404
            
            print(f"[DEBUG] Fresh comment likes: {fresh_comment_found.get('likes', [])}")
            
            if fresh_is_reply:
                # Update reply
                parent_comment = fresh_post.get('comments', [])[fresh_parent_index]
                replies = list(parent_comment.get('replies', []))
                replies[fresh_reply_index]['likes'] = list(replies[fresh_reply_index].get('likes', []))
                if user_id in replies[fresh_reply_index]['likes']:
                    replies[fresh_reply_index]['likes'].remove(user_id)
                    print(f"[DEBUG] Removed like from reply")
                
                collections['posts'].update_one(
                    {'_id': post_oid, 'comments.id': parent_comment.get('id')},
                    {'$set': {'comments.$.replies': replies}}
                )
            else:
                # Update comment gốc
                collections['posts'].update_one(
                    {'_id': post_oid, 'comments.id': comment_id},
                    {'$pull': {'comments.$.likes': user_id}}
                )
            
            action = 'unliked'
            liked = False
        
        # Lấy số like mới
        updated_post = collections['posts'].find_one({'_id': post_oid})
        like_count = 0
        
        if is_reply:
            # Tìm trong replies
            for comment in updated_post.get('comments', []):
                for reply in comment.get('replies', []):
                    if reply.get('id') == comment_id:
                        like_count = len(reply.get('likes', []))
                        break
                if like_count > 0:
                    break
        else:
            # Tìm trong comments gốc
            for comment in updated_post.get('comments', []):
                if comment.get('id') == comment_id:
                    like_count = len(comment.get('likes', []))
                    break
        
        # Gửi socket event
        socketio.emit('comment_liked_updated', {
            'post_id': post_id,
            'comment_id': comment_id,
            'user_id': user_id,
            'liked': liked,
            'like_count': like_count
        }, room=f'post_{post_id}')
        
        return jsonify({
            'success': True,
            'action': action,
            'liked': liked,
            'like_count': like_count,
            'user_id': user_id,
            'username': user.get('username', 'Unknown')
        })
        
    except Exception as e:
        print(f"Error handling comment like: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': f'Internal server error: {str(e)}'}), 500

# ==================== STORIES API ====================

@timeline_api.route('/stories')
def get_stories():
    """API lấy danh sách stories của bản thân và bạn bè"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    
    try:
        collections = get_db_collections()
        user_id = session['user_id']
        
        # 1. Lấy danh sách ID (mình + bạn bè)
        current_user = collections['users'].find_one({'_id': ObjectId(user_id)})
        friend_ids = current_user.get('friends', []) if current_user else []
        
        # Tạo danh sách ID để truy vấn (bao gồm cả ObjectId và String để chắc chắn)
        query_ids = [user_id, ObjectId(user_id)]
        for fid in friend_ids:
            if fid:
                query_ids.append(str(fid))
                if ObjectId.is_valid(fid):
                    query_ids.append(ObjectId(fid))
        
        # 2. Lấy stories còn hạn (expires_at > hiện tại)
        now = datetime.utcnow()
        stories_cursor = collections['stories'].find({
            'user_id': {'$in': query_ids},
            'expires_at': {'$gt': now}
        }).sort('created_at', -1)
        
        all_stories = list(stories_cursor)

        for s in all_stories:
            media_url = s.get('media_url', '')
            # Nếu media_url chỉ là tên file (không bắt đầu bằng http hoặc /static)
            if media_url and not media_url.startswith(('http', '/static', 'data:')):
                s['media_url'] = f'/static/uploads/stories/{media_url}'

        # Sau đó mới thực hiện gom nhóm (Gom nhóm stories theo User...)
        grouped_stories = {}
        
        # 3. Gom nhóm stories theo User để hiện thị lên thanh Story
        grouped_stories = {}
        for s in all_stories:
            uid = str(s['user_id'])
            if uid not in grouped_stories:
                user_info = collections['users'].find_one({'_id': ObjectId(uid)})
                # Xử lý avatar
                avatar = user_info.get('avatar') if user_info else ''
                if not avatar or avatar == '':
                    avatar = '/static/img/default-avatar.png'
                elif not avatar.startswith(('http', 'data:image', '/static')):
                    avatar = f'/static/uploads/{avatar}'

                grouped_stories[uid] = {
                    'user_id': uid,
                    'name': user_info.get('full_name') or user_info.get('username', 'Người dùng') if user_info else 'Người dùng',
                    'avatar': avatar,
                    'stories': [],
                    'has_unseen': False
                }
            
            # Kiểm tra xem User hiện tại đã xem story này chưa
            views = s.get('views', [])
            is_seen = user_id in views or str(user_id) in views
            if not is_seen:
                grouped_stories[uid]['has_unseen'] = True
            
            # ĐỒNG BỘ HÓA TRƯỜNG DỮ LIỆU VỚI JS (Sửa lỗi undefined)
            likes_raw = s.get('likes', [])
            unique_likes_list = []
            seen_like_ids = set()
            for l in likes_raw:
                try:
                    if isinstance(l, ObjectId):
                        _uid = str(l)
                    elif isinstance(l, dict):
                        _v = l.get('user_id') or l.get('_id')
                        _uid = str(_v) if _v is not None else str(l)
                    else:
                        _uid = str(l)
                except Exception:
                    _uid = str(l)
                if _uid not in seen_like_ids:
                    seen_like_ids.add(_uid)
                    unique_likes_list.append(_uid)
            story_data = {
                '_id': str(s['_id']),
                'type': s.get('type', 'text'),
                'content': s.get('content', ''),   # Trường trong DB
                'text': s.get('content', ''),      # JS đang gọi .text
                'background': s.get('background', '#3b5998'), # Trường trong DB
                'bg_color': s.get('background', '#3b5998'),   # JS đang gọi .bg_color
                'media_url': s.get('media_url', ''),
                'likes': unique_likes_list,
                'url': s.get('media_url', ''),     # JS đang gọi .url cho ảnh/video
                'created_at': s.get('created_at').isoformat() + 'Z' if isinstance(s.get('created_at'), datetime) else str(s.get('created_at')),
                'views': s.get('views', []),               # ✅ Thêm mảng views
                'views_count': len(s.get('views', []))
            }
            grouped_stories[uid]['stories'].append(story_data)

        return jsonify({
            'success': True,
            'stories': list(grouped_stories.values())
        })
    except Exception as e:
        print(f"Lỗi get_stories: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@timeline_api.route('/stories', methods=['POST'])
def create_story():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
        
    try:
        user_id = session['user_id']
        story_type = request.form.get('type')
        collections = get_db_collections()
        
        new_story = {
            'user_id': ObjectId(user_id),
            'type': story_type,
            'created_at': datetime.utcnow(),
            'expires_at': datetime.utcnow() + timedelta(hours=24),
            'views': []
        }
        
        if story_type == 'text':
            new_story['content'] = request.form.get('content')
            new_story['background'] = request.form.get('background', '#3b5998')
        else:
            if 'file' not in request.files:
                return jsonify({'success': False, 'error': 'Vui lòng thêm file media'}), 400
                
            file = request.files['file']
            if file.filename == '':
                return jsonify({'success': False, 'error': 'File không hợp lệ'}), 400

            # Sử dụng Cloudinary upload
            from app.media_upload import upload_story
            
            # Determine file type
            file_ext = file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else ''
            if file_ext in ['mp4', 'mov', 'avi', 'mkv', 'webm']:
                file_type = 'video'
            else:
                file_type = 'image'
            
            # Upload to Cloudinary
            upload_result = upload_story(file, file_type)
            
            if upload_result['success']:
                new_story['media_url'] = upload_result['url']
                if upload_result.get('thumbnail'):
                    new_story['thumbnail_url'] = upload_result['thumbnail']
                print(f"✅ Story uploaded to Cloudinary: {upload_result['url']}")
            else:
                # Fallback to local storage
                filename = secure_filename(f"{uuid.uuid4()}_{file.filename}")
                upload_path = os.path.join(current_app.root_path, 'static/uploads/stories')
                os.makedirs(upload_path, exist_ok=True)
                file.save(os.path.join(upload_path, filename))
                new_story['media_url'] = f"/static/uploads/stories/{filename}"
                print(f"⚠️ Story saved locally: {filename}")
            
        collections['stories'].insert_one(new_story)
        return jsonify({'success': True})
        
    except Exception as e:
        print(f"Error: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@timeline_api.route('/stories/<story_id>/view', methods=['POST'])
def view_story(story_id):
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401

    try:
        collections = get_db_collections()
        user_id = session['user_id']
        
        # Lấy story trước để kiểm tra owner
        story = collections['stories'].find_one({'_id': ObjectId(story_id)})
        if not story:
            return jsonify({'success': False, 'error': 'Story not found'}), 404
        
        # Không tính view nếu là chủ story
        story_owner_id = str(story.get('user_id'))
        if story_owner_id == user_id:
            return jsonify({'success': True, 'message': 'Owner view not counted'})
        
        # Chuyển user_id sang ObjectId (nếu hợp lệ)
        user_oid = ObjectId(user_id) if ObjectId.is_valid(user_id) else user_id

        result = collections['stories'].update_one(
            {'_id': ObjectId(story_id)},
            {
                '$addToSet': {'views': user_oid},   # ✅ Lưu ObjectId
                '$set': {'last_viewed': datetime.utcnow()}
            }
        )
        return jsonify({'success': True})
    except Exception as e:
        print(f"Error viewing story: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

# Thêm route để lấy thông tin chi tiết story (bao gồm lượt xem của bản thân)
@timeline_api.route('/stories/<story_id>/info')
def get_story_info(story_id):
    """API lấy thông tin chi tiết story (cho chủ story)"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    
    try:
        collections = get_db_collections()
        user_id = session['user_id']
        
        if not ObjectId.is_valid(story_id):
            return jsonify({'success': False, 'error': 'Invalid story ID'}), 400
        
        story = collections['stories'].find_one({'_id': ObjectId(story_id)})
        if not story:
            return jsonify({'success': False, 'error': 'Story not found'}), 404
        
        # Kiểm tra quyền xem chi tiết (chỉ chủ story)
        if str(story.get('user_id')) != user_id:
            return jsonify({'success': False, 'error': 'No permission'}), 403
        
        # Lấy thông tin chi tiết về lượt xem
        view_user_ids = story.get('views', [])
        views_info = []
        
        for view_user_id in view_user_ids[:20]:  # Lấy 20 người gần nhất
            user = collections['users'].find_one(
                {'_id': ObjectId(view_user_id) if ObjectId.is_valid(view_user_id) else view_user_id},
                {'username': 1, 'full_name': 1, 'avatar': 1}
            )
            
            if user:
                avatar = user.get('avatar', '')
                if avatar and not avatar.startswith(('http', '/static', 'data:')):
                    if avatar.startswith('uploads/'):
                        avatar = f'/static/{avatar}'
                    else:
                        avatar = f'/static/uploads/{avatar}'
                else:
                    avatar = '/static/img/default-avatar.png'
                
                views_info.append({
                    'user_id': str(user['_id']),
                    'username': user.get('full_name') or user.get('username', 'Unknown'),
                    'avatar': avatar
                })
        
        # Lấy thông tin về likes
        like_user_ids = story.get('likes', [])
        likes_info = []
        
        for like_user_id in like_user_ids[:20]:  # Lấy 20 like gần nhất
            user = collections['users'].find_one(
                {'_id': ObjectId(like_user_id) if ObjectId.is_valid(like_user_id) else like_user_id},
                {'username': 1, 'full_name': 1, 'avatar': 1}
            )
            
            if user:
                avatar = user.get('avatar', '')
                if avatar and not avatar.startswith(('http', '/static', 'data:')):
                    if avatar.startswith('uploads/'):
                        avatar = f'/static/{avatar}'
                    else:
                        avatar = f'/static/uploads/{avatar}'
                else:
                    avatar = '/static/img/default-avatar.png'
                
                likes_info.append({
                    'user_id': str(user['_id']),
                    'username': user.get('full_name') or user.get('username', 'Unknown'),
                    'avatar': avatar
                })
        
        # Format response
        story_data = {
            '_id': str(story['_id']),
            'type': story.get('type', 'text'),
            'content': story.get('content', ''),
            'background': story.get('background', '#3b5998'),
            'media_url': story.get('media_url', ''),
            'created_at': story.get('created_at').isoformat() if isinstance(story.get('created_at'), datetime) else str(story.get('created_at')),
            'expires_at': story.get('expires_at').isoformat() if isinstance(story.get('expires_at'), datetime) else str(story.get('expires_at')),
            # Trả về dạng array để frontend dễ xử lý
            'views': view_user_ids,
            'views_count': len(view_user_ids),
            'likes': like_user_ids,
            'likes_count': len(like_user_ids),
            'is_viewed_by_me': user_id in view_user_ids,
            'is_liked_by_me': user_id in like_user_ids,
            'can_delete': story.get('user_id') == user_id
        }
        
        return jsonify({
            'success': True,
            'story': story_data
        })
        
    except Exception as e:
        print(f"Error getting story info: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500
    
@timeline_api.route('/stories/<story_id>', methods=['DELETE'])
def delete_story(story_id):
    """API xóa story"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    
    try:
        collections = get_db_collections()
        user_id = session['user_id']
        
        if not ObjectId.is_valid(story_id):
            return jsonify({'success': False, 'error': 'Invalid story ID'}), 400
        
        # Kiểm tra user có quyền xóa không
        story = collections['stories'].find_one({'_id': ObjectId(story_id)})
        
        if not story:
            return jsonify({'success': False, 'error': 'Story not found'}), 404
        
        # Kiểm tra quyền sở hữu - so sánh cả dạng string và ObjectId
        story_owner_id = story.get('user_id')
        owner_id_str = str(story_owner_id) if story_owner_id else ''
        current_user_str = str(user_id)
        
        print(f"[DEBUG] Delete story check: owner_id={owner_id_str}, current_user={current_user_str}")
        
        if owner_id_str != current_user_str:
            return jsonify({'success': False, 'error': 'Permission denied'}), 403
        
        # Xóa story
        result = collections['stories'].delete_one({'_id': ObjectId(story_id)})
        
        if result.deleted_count > 0:
            # Gửi socket event
            try:
                from app import socketio
                socketio.emit('story_deleted', {
                    'story_id': story_id,
                    'user_id': user_id
                }, skip_sid=True)
            except Exception as e:
                print(f"Socket emit error: {e}")
            
            return jsonify({
                'success': True,
                'message': 'Đã xóa story'
            })
        
        return jsonify({'success': False, 'error': 'Delete failed'}), 500
        
    except Exception as e:
        print(f"Lỗi delete_story: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

# ==================== FRIEND SEARCH FOR TAGGING ====================

@timeline_api.route('/friends/search')
def search_friends_for_tagging():
    """API tìm kiếm bạn bè để gắn thẻ"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    
    try:
        collections = get_db_collections()
        user_id = session['user_id']
        query = request.args.get('q', '').strip()
        
        if not query:
            return jsonify({'success': False, 'error': 'Query is required'}), 400
        
        # Lấy danh sách bạn bè của user
        current_user = collections['users'].find_one({'_id': ObjectId(user_id)})
        if not current_user:
            return jsonify({'success': False, 'error': 'User not found'}), 404
        
        friend_ids = current_user.get('friends', [])
        if not friend_ids:
            return jsonify({'success': True, 'friends': []})
        
        # Tìm kiếm bạn bè theo tên hoặc username
        search_regex = {'$regex': query, '$options': 'i'}
        
        friends_cursor = collections['users'].find({
            '_id': {'$in': [ObjectId(fid) for fid in friend_ids if ObjectId.is_valid(fid)]},
            '$or': [
                {'username': search_regex},
                {'full_name': search_regex}
            ]
        }).limit(10)  # Giới hạn kết quả
        
        friends = []
        for friend in friends_cursor:
            avatar = friend.get('avatar', '')
            if avatar and not avatar.startswith(('http', 'data:image', '/static')):
                if avatar.startswith('uploads/'):
                    avatar = f'/static/{avatar}'
                else:
                    avatar = f'/static/uploads/{avatar}'
            elif not avatar:
                avatar = '/static/img/default-avatar.png'
            
            friends.append({
                '_id': str(friend['_id']),
                'username': friend.get('username', ''),
                'full_name': friend.get('full_name', ''),
                'avatar': avatar,
                'display_name': friend.get('full_name', friend.get('username', ''))
            })
        
        # Sắp xếp theo độ phù hợp (username khớp trước, full_name sau)
        friends.sort(key=lambda x: (
            0 if query.lower() == x['username'].lower() else
            1 if x['username'].lower().startswith(query.lower()) else
            2 if x['full_name'].lower().startswith(query.lower()) else
            3
        ))
        
        return jsonify({
            'success': True,
            'friends': friends
        })
        
    except Exception as e:
        print(f"Error searching friends: {str(e)}")
        return jsonify({'success': False, 'error': 'Internal server error'}), 500

# ==================== CREATE POST ====================

@timeline_api.route('/posts/create', methods=['POST'])
def create_post():
    """API tạo bài viết mới"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    
    try:
        from app import socketio
        collections = get_db_collections()
        user_id = session['user_id']
        
        # Nhận dữ liệu từ request
        data = request.get_json()
        
        # Kiểm tra dữ liệu
        if not data:
            return jsonify({'success': False, 'error': 'No data provided'}), 400
        
        content = data.get('content', '')
        privacy = data.get('privacy', 'public')
        media_urls = data.get('media_urls', [])
        tagged_friends = data.get('tagged_friends', [])  # Array of friend IDs
        
        if not content and not media_urls:
            return jsonify({
                'success': False, 
                'error': 'Nội dung hoặc media là bắt buộc'
            }), 400
        
        # Validate tagged friends
        valid_tagged_friends = []
        tagged_info = []
        if tagged_friends:
            # Lấy danh sách bạn bè của user để validate
            current_user = collections['users'].find_one({'_id': ObjectId(user_id)})
            friend_ids = current_user.get('friends', []) if current_user else []
            
            for friend_id in tagged_friends:
                if friend_id in friend_ids:
                    valid_tagged_friends.append(friend_id)
                    # Lấy thông tin friend để lưu vào post
                    friend = collections['users'].find_one({'_id': ObjectId(friend_id)})
                    if friend:
                        tagged_info.append({
                            'id': friend_id,
                            'username': friend.get('username', ''),
                            'full_name': friend.get('full_name', '')
                        })
        
        # Validate privacy settings - CHỈ 3 loại chuẩn
        valid_privacy = ['public', 'friends', 'only_me']
        if privacy not in valid_privacy:
            privacy = 'public'
        
        # Tạo dữ liệu bài viết
        import re
        
        # Trích xuất hashtags từ content
        hashtags = re.findall(r'#(\w+)', content)
        tags = [tag.lower() for tag in hashtags]  # Chuyển về lowercase để đồng nhất
        
        post_data = {
            'user_id': user_id,
            'content': content,
            'privacy': privacy,
            'media_urls': media_urls,
            'created_at': datetime.utcnow(),
            'likes': [],
            'comments': [],
            'comment_count': 0,
            'shares': 0,
            'post_type': 'normal',
            'is_shared': False,
            'edited': False,
            'tags': tags  # Lưu hashtags để tìm kiếm nhanh hơn
        }
        
        # Thêm tagged friends nếu có
        if valid_tagged_friends:
            post_data['tagged_friends'] = tagged_info
        
        # Lưu vào database
        result = collections['posts'].insert_one(post_data)
        post_id = str(result.inserted_id)
        
        # Lấy thông tin user cho notifications và response
        user = collections['users'].find_one({'_id': ObjectId(user_id)})
        
        # Gửi thông báo cho tagged friends
        if valid_tagged_friends:
            for friend_id in valid_tagged_friends:
                notification_data = {
                    'recipient_id': ObjectId(friend_id),
                    'sender_id': ObjectId(user_id),
                    'sender_name': user.get('full_name', user.get('username', 'Unknown')) if user else 'Unknown',
                    'type': 'tag',
                    'content': f'đã gắn thẻ bạn trong một bài viết',
                    'data': {
                        'post_id': post_id,
                        'post_content': content[:100] + '...' if len(content) > 100 else content
                    },
                    'created_at': datetime.utcnow(),
                    'read': False
                }
                
                collections['notifications'].insert_one(notification_data)
                
                # Gửi socket notification cho tagged friend
                try:
                    socketio.emit('notification', {
                        'type': 'tag',
                        'message': f'{user.get("full_name", user.get("username", "Unknown"))} đã gắn thẻ bạn trong một bài viết',
                        'post_id': post_id,
                        'sender_id': user_id
                    }, room=f'user_{friend_id}')
                except Exception as e:
                    print(f"Error sending socket notification to tagged friend: {str(e)}")
        
        # Xử lý avatar
        avatar = user.get('avatar') if user else ''
        if avatar:
            if not avatar.startswith(('http', 'data:image', '/static')):
                if avatar.startswith('uploads/'):
                    avatar = f'/static/{avatar}'
                elif not avatar.startswith('/'):
                    avatar = f'/static/uploads/{avatar}'
        else:
            avatar = '/static/img/default-avatar.png'
        
        # Tạo response data
        post_response = {
            '_id': post_id,
            'author_name': user.get('full_name', user.get('username', 'Người dùng')) if user else 'Ẩn danh',
            'author_username': user.get('username', '') if user else '',
            'author_avatar': avatar,
            'content': content,
            'media_urls': media_urls,
            'created_at': post_data['created_at'].isoformat(),
            'time_ago': calculate_time_ago(post_data['created_at']),
            'likes_count': 0,
            'comments_count': 0,
            'shares_count': 0,
            'is_liked': False,
            'privacy': privacy,
            'post_type': 'normal',
            'is_shared': False,
            'tagged_friends': tagged_info  # Add tagged friends to response
        }
        
        # Gửi socket notification cho bạn bè
        try:
            socketio.emit('new_post', {
                'post': post_response,
                'user_id': user_id
            }, broadcast=True)
            
            # Gửi thông báo riêng cho bạn bè
            if privacy == 'friends' or privacy == 'public':
                # Lấy danh sách bạn bè
                friend_ids = user.get('friends', []) if user else []
                for friend_id in friend_ids:
                    socketio.emit('new_friend_post', {
                        'post': post_response,
                        'from_user_id': user_id
                    }, room=str(friend_id))
        except Exception as socket_error:
            print(f"Socket error: {socket_error}")
        
        return jsonify({
            'success': True,
            'post_id': post_id,
            'post': post_response,
            'message': 'Đăng bài thành công'
        })
        
    except Exception as e:
        print(f"Error creating post: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False, 
            'error': 'Lỗi khi đăng bài: ' + str(e)
        }), 500
# ==================== GET POST DETAIL ====================

@timeline_api.route('/posts/<post_id>')
def get_post_detail(post_id):
    """API lấy chi tiết bài viết"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    
    try:
        collections = get_db_collections()
        user_id = session['user_id']
        
        if not ObjectId.is_valid(post_id):
            return jsonify({'success': False, 'error': 'Invalid post ID'}), 400
        
        post = collections['posts'].find_one({'_id': ObjectId(post_id)})
        if not post:
            return jsonify({'success': False, 'error': 'Post not found'}), 404
        
        # Kiểm tra quyền xem - CHỈ 3 loại chuẩn: public, friends, only_me
        post_privacy = post.get('privacy', 'public')
        if post_privacy in ['only_me', 'private'] and str(post['user_id']) != str(user_id):
            return jsonify({'success': False, 'error': 'No permission to view this post'}), 403
        elif post_privacy == 'friends':
            # Kiểm tra quan hệ bạn bè
            post_owner = collections['users'].find_one({'_id': ObjectId(post['user_id'])}, {'friends': 1})
            if str(post['user_id']) != str(user_id) and (not post_owner or str(user_id) not in [str(f) for f in post_owner.get('friends', [])]):
                return jsonify({'success': False, 'error': 'No permission to view this post'}), 403
        
        # Lấy thông tin tác giả
        author = collections['users'].find_one({'_id': ObjectId(post['user_id'])})
        
        # Xử lý avatar
        author_avatar = author.get('avatar') if author else ''
        if not author_avatar or author_avatar == '':
            author_avatar = '/static/img/default-avatar.png'
        elif not author_avatar.startswith(('http', 'data:image', '/static')):
            author_avatar = f'/static/uploads/{author_avatar}'
        
        # Xác định xem current user đã like chưa
        likes = post.get('likes', [])
        is_liked = str(user_id) in likes or user_id in likes
        
        post_data = {
            '_id': str(post['_id']),
            'author_name': author.get('full_name', author.get('username', 'Người dùng')) if author else 'Ẩn danh',
            'author_username': author.get('username', '') if author else '',
            'author_avatar': author_avatar,
            'content': post.get('content', ''),
            'media_urls': post.get('media_urls', []),
            'created_at': post.get('created_at').isoformat() if isinstance(post.get('created_at'), datetime) else str(post.get('created_at')),
            'time_ago': calculate_time_ago(post.get('created_at')),
            'likes_count': len(likes),
            'comments_count': len(post.get('comments', [])),
            'shares_count': post.get('shares', 0),
            'is_liked': is_liked,
            'privacy': post.get('privacy', 'public'),
            'post_type': post.get('post_type', 'normal'),
            'is_shared': post.get('is_shared', False),
            'original_post_id': str(post.get('original_post_id', '')) if post.get('original_post_id') else None,
            'comments': post.get('comments', [])
        }
        
        return jsonify({
            'success': True,
            'post': post_data
        })
        
    except Exception as e:
        print(f"Error getting post detail: {str(e)}")
        return jsonify({'success': False, 'error': 'Internal server error'}), 500

@timeline_api.route('/api/stories/<story_id>/like', methods=['POST'])
def toggle_story_like(story_id):
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401

    try:
        collections = get_db_collections()
        user_id = session['user_id']
        
        # 1. Validate ID
        if not ObjectId.is_valid(story_id):
            return jsonify({'success': False, 'error': 'Invalid story ID'}), 400
            
        story_oid = ObjectId(story_id)
        story = collections['stories'].find_one({'_id': story_oid})
        
        if not story:
            return jsonify({'success': False, 'error': 'Story not found'}), 404

        # 2. Kiểm tra trạng thái Like hiện tại (Check kỹ cả String lẫn ObjectId)
        current_likes = story.get('likes', [])
        user_id_str = str(user_id)
        
        # Tạo set các ID đã like (đưa hết về string để so sánh)
        liked_users_set = {str(uid) for uid in current_likes}
        is_liked = user_id_str in liked_users_set

        # 3. Thực hiện Like/Unlike
        if is_liked:
            # UNLIKE: Dùng $pull để xóa user_id (xóa cả dạng String và ObjectId cho sạch)
            collections['stories'].update_one(
                {'_id': story_oid},
                {'$pull': {'likes': {'$in': [user_id, user_id_str, ObjectId(user_id) if ObjectId.is_valid(user_id) else None]}}}
            )
            action = 'unliked'
        else:
            # LIKE: Dùng $addToSet để KHÔNG BAO GIỜ bị trùng lặp
            # Ưu tiên lưu ObjectId
            id_to_save = ObjectId(user_id) if ObjectId.is_valid(user_id) else user_id
            collections['stories'].update_one(
                {'_id': story_oid},
                {'$addToSet': {'likes': id_to_save}}
            )
            action = 'liked'

        # 4. Lấy lại số lượng like mới nhất
        updated_story = collections['stories'].find_one({'_id': story_oid})
        updated_likes = updated_story.get('likes', [])
        total_likes = len(updated_likes)

        # Trả về kết quả
        return jsonify({
            'success': True,
            'action': action,
            'total_likes': total_likes,
            'is_liked': not is_liked
        })

    except Exception as e:
        print(f"Error toggle story like: {str(e)}")
        return jsonify({'success': False, 'error': 'Internal server error'}), 500

# In app/timeline_blueprint.py

def normalize_likes_data(likes_array):
    """Chuẩn hóa mảng likes thành các string user_id duy nhất"""
    normalized = []
    seen = set()
    
    for like in likes_array:
        if isinstance(like, ObjectId):
            like_str = str(like)
        elif isinstance(like, dict):
            # Lấy user_id từ dict
            user_id = like.get('user_id') or like.get('_id') or like
            like_str = str(user_id) if user_id else str(like)
        else:
            like_str = str(like)
        
        # Chỉ thêm nếu chưa có
        if like_str and like_str not in seen:
            seen.add(like_str)
            normalized.append(like_str)
    
    return normalized

@timeline_api.route('/stories/<story_id>/like', methods=['POST'])
def like_story(story_id):
    """API to like/unlike a story - ĐÃ CHUẨN HÓA"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
        
    try:
        collections = get_db_collections()
        user_id = session['user_id']
        
        # Validate ObjectId
        if not ObjectId.is_valid(story_id):
            return jsonify({'success': False, 'error': 'Invalid story ID'}), 400
            
        story_oid = ObjectId(story_id)
        story = collections['stories'].find_one({'_id': story_oid})
        
        if not story:
            return jsonify({'success': False, 'error': 'Story not found'}), 404
            
        # CHUẨN HÓA likes thành set các string
        raw_likes = story.get('likes', [])
        normalized_likes = normalize_likes_data(raw_likes)
        
        # Tạo set để kiểm tra nhanh
        likes_set = set(normalized_likes)
        
        # Kiểm tra trạng thái hiện tại
        is_liked = user_id in likes_set
        
        # Xác định hành động
        if is_liked:
            # Unlike: xóa user_id
            likes_set.discard(user_id)
            action = 'unliked'
        else:
            # Like: thêm user_id
            likes_set.add(user_id)
            action = 'liked'
        
        # Chuyển set về list để lưu
        new_likes_list = list(likes_set)
        
        # Cập nhật database
        collections['stories'].update_one(
            {'_id': story_oid},
            {'$set': {'likes': new_likes_list}}
        )
        
        # Lấy số like mới
        total_likes = len(new_likes_list)
        
        # Tạo thông báo nếu không phải story của chính mình
        if str(story.get('user_id')) != user_id and action == 'liked':
            try:
                sender = collections['users'].find_one({'_id': ObjectId(user_id)})
                sender_name = sender.get('username', 'Someone') if sender else 'Someone'
                
                notification = {
                    'recipient_id': ObjectId(story.get('user_id')),
                    'sender_id': ObjectId(user_id),
                    'type': 'story_like',
                    'content': f"{sender_name} đã thích tin của bạn",
                    'link': f"/stories/{story_id}",
                    'created_at': datetime.utcnow(),
                    'read': False
                }
                collections['notifications'].insert_one(notification)
            except Exception as e:
                print(f"Error creating notification: {e}")
        
        return jsonify({
            'success': True,
            'action': action,
            'total_likes': total_likes,
            'likes_count': total_likes,
            'is_liked': action == 'liked'
        })
        
    except Exception as e:
        print(f"Error liking story: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': 'Internal server error'}), 500
    
@timeline_api.route('/stories/cleanup', methods=['POST'])
def cleanup_stories():
    """Chuẩn hóa tất cả stories: loại bỏ trùng lặp trong likes và views, chuyển về string"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    
    try:
        collections = get_db_collections()
        all_stories = collections['stories'].find({})
        cleaned_count = 0
        
        for story in all_stories:
            modified = False
            
            # Chuẩn hóa likes
            raw_likes = story.get('likes', [])
            normalized_likes = []
            seen_likes = set()
            for like in raw_likes:
                like_str = str(like)
                if like_str and like_str not in seen_likes:
                    seen_likes.add(like_str)
                    normalized_likes.append(like_str)
            if len(normalized_likes) != len(raw_likes):
                modified = True
            
            # Chuẩn hóa views
            raw_views = story.get('views', [])
            normalized_views = []
            seen_views = set()
            for view in raw_views:
                view_str = str(view)
                if view_str and view_str not in seen_views:
                    seen_views.add(view_str)
                    normalized_views.append(view_str)
            if len(normalized_views) != len(raw_views):
                modified = True
            
            # Cập nhật nếu có thay đổi
            if modified:
                collections['stories'].update_one(
                    {'_id': story['_id']},
                    {'$set': {
                        'likes': normalized_likes,
                        'views': normalized_views
                    }}
                )
                cleaned_count += 1
        
        return jsonify({
            'success': True,
            'message': f'Đã chuẩn hóa {cleaned_count} stories',
            'cleaned_count': cleaned_count
        })
    except Exception as e:
        print(f"Error cleaning up stories: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@timeline_api.route('/stories/<story_id>/views')
def get_story_views(story_id):
    """API lấy danh sách người đã xem story"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    
    try:
        collections = get_db_collections()
        user_id = session['user_id']
        
        if not ObjectId.is_valid(story_id):
            return jsonify({'success': False, 'error': 'Invalid story ID'}), 400
        
        story = collections['stories'].find_one({'_id': ObjectId(story_id)})
        if not story:
            return jsonify({'success': False, 'error': 'Story not found'}), 404
        
        # Kiểm tra quyền xem (chỉ chủ story mới xem được chi tiết)
        if str(story.get('user_id')) != user_id:
            return jsonify({'success': False, 'error': 'No permission'}), 403
        
        # Lấy danh sách view và thông tin user (khử trùng lặp, hỗn hợp ObjectId/string)
        raw_view_ids = story.get('views', [])
        seen = set()
        unique_view_ids = []
        for v in raw_view_ids:
            try:
                vs = str(v)
            except Exception:
                vs = str(v)
            if vs not in seen:
                seen.add(vs)
                unique_view_ids.append(vs)

        views_data = []
        
        for view_user_id in unique_view_ids[:50]:  # Giới hạn 50 người đầu
            user = collections['users'].find_one(
                {'_id': ObjectId(view_user_id) if ObjectId.is_valid(view_user_id) else view_user_id},
                {'username': 1, 'avatar': 1, 'full_name': 1}
            )
            
            if user:
                # Xử lý avatar
                avatar = user.get('avatar', '')
                if avatar:
                    if not avatar.startswith(('http', 'data:image', '/static')):
                        if avatar.startswith('uploads/'):
                            avatar = f'/static/{avatar}'
                        elif not avatar.startswith('/'):
                            avatar = f'/static/uploads/{avatar}'
                else:
                    avatar = '/static/img/default-avatar.png'
                
                views_data.append({
                    'user_id': str(user['_id']),
                    'username': user.get('username', ''),
                    'full_name': user.get('full_name', user.get('username', 'Unknown')),
                    'avatar': avatar,
                    'viewed_at': story.get('created_at')  # Có thể lưu thời gian xem riêng nếu cần
                })
        
        return jsonify({
            'success': True,
            'views': views_data,
            'total_views': len(unique_view_ids)
        })
        
    except Exception as e:
        print(f"Error getting story views: {str(e)}")
        return jsonify({'success': False, 'error': 'Internal server error'}), 500

# ==================== DELETE POST ====================

@timeline_api.route('/posts/<post_id>', methods=['DELETE'])
def delete_post(post_id):
    """API xóa bài viết"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    
    try:
        from app import socketio
        collections = get_db_collections()
        user_id = session['user_id']
        
        if not ObjectId.is_valid(post_id):
            return jsonify({'success': False, 'error': 'Invalid post ID'}), 400
        
        # Kiểm tra quyền sở hữu
        post = collections['posts'].find_one({'_id': ObjectId(post_id)})
        if not post:
            return jsonify({'success': False, 'error': 'Post not found'}), 404
        
        if post['user_id'] != user_id:
            return jsonify({'success': False, 'error': 'No permission to delete this post'}), 403
        
        # Xóa bài viết
        result = collections['posts'].delete_one({'_id': ObjectId(post_id)})
        
        if result.deleted_count > 0:
            # Gửi socket event
            socketio.emit('post_deleted', {
                'post_id': post_id,
                'user_id': user_id
            })
            
            return jsonify({
                'success': True,
                'message': 'Đã xóa bài viết'
            })
        
        return jsonify({'success': False, 'error': 'Delete failed'}), 500
        
    except Exception as e:
        print(f"Error deleting post: {str(e)}")
        return jsonify({'success': False, 'error': 'Internal server error'}), 500

# ==================== EDIT POST ====================

@timeline_api.route('/posts/<post_id>', methods=['PUT'])
def edit_post(post_id):
    """API chỉnh sửa bài viết"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    
    try:
        from app import socketio
        collections = get_db_collections()
        user_id = session['user_id']
        
        if not ObjectId.is_valid(post_id):
            return jsonify({'success': False, 'error': 'Invalid post ID'}), 400
        
        data = request.get_json()
        content = data.get('content', '')
        media_urls = data.get('media_urls', [])
        privacy = data.get('privacy', 'public')
        
        # Kiểm tra quyền sở hữu
        post = collections['posts'].find_one({'_id': ObjectId(post_id)})
        if not post:
            return jsonify({'success': False, 'error': 'Post not found'}), 404
        
        if post['user_id'] != user_id:
            return jsonify({'success': False, 'error': 'No permission to edit this post'}), 403
        
        # Cập nhật bài viết
        update_data = {
            'content': content,
            'media_urls': media_urls,
            'privacy': privacy,
            'updated_at': datetime.utcnow(),
            'edited': True
        }
        
        result = collections['posts'].update_one(
            {'_id': ObjectId(post_id)},
            {'$set': update_data}
        )
        
        if result.modified_count > 0:
            # Gửi socket event
            socketio.emit('post_updated', {
                'post_id': post_id,
                'user_id': user_id
            }, broadcast=True)
            
            return jsonify({
                'success': True,
                'message': 'Đã cập nhật bài viết'
            })
        
        return jsonify({'success': False, 'error': 'No changes made'}), 400
        
    except Exception as e:
        print(f"Error editing post: {str(e)}")
        return jsonify({'success': False, 'error': 'Internal server error'}), 500
    
# ==================== STORY LIKES DETAILS ====================

@timeline_api.route('/stories/<story_id>/likes')
def get_story_likes(story_id):
    """API lấy danh sách người đã like story"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    
    try:
        collections = get_db_collections()
        user_id = session['user_id']
        
        if not ObjectId.is_valid(story_id):
            return jsonify({'success': False, 'error': 'Invalid story ID'}), 400
        
        story = collections['stories'].find_one({'_id': ObjectId(story_id)})
        if not story:
            return jsonify({'success': False, 'error': 'Story not found'}), 404
        
        likes_raw = story.get('likes', [])
        unique_like_ids = []
        seen_ids = set()
        for l in likes_raw:
            try:
                if isinstance(l, ObjectId):
                    _uid = str(l)
                elif isinstance(l, dict):
                    _v = l.get('user_id') or l.get('_id')
                    _uid = str(_v) if _v is not None else str(l)
                else:
                    _uid = str(l)
            except Exception:
                _uid = str(l)
            if _uid not in seen_ids:
                seen_ids.add(_uid)
                unique_like_ids.append(_uid)

        likes_data = []
        for like_user_id in unique_like_ids[:50]:
            user = collections['users'].find_one(
                {'_id': ObjectId(like_user_id) if ObjectId.is_valid(like_user_id) else like_user_id},
                {'username': 1, 'avatar': 1, 'full_name': 1}
            )
            if user:
                avatar = user.get('avatar', '')
                if avatar:
                    if not avatar.startswith(('http', 'data:image', '/static')):
                        if avatar.startswith('uploads/'):
                            avatar = f'/static/{avatar}'
                        elif not avatar.startswith('/'):
                            avatar = f'/static/uploads/{avatar}'
                else:
                    avatar = '/static/img/default-avatar.png'
                likes_data.append({
                    'user_id': str(user['_id']),
                    'username': user.get('username', ''),
                    'full_name': user.get('full_name', user.get('username', 'Unknown')),
                    'avatar': avatar,
                    'liked_at': story.get('created_at')
                })

        return jsonify({
            'success': True,
            'likes': likes_data,
            'total_likes': len(unique_like_ids),
            'is_liked': str(user_id) in seen_ids
        })
        
    except Exception as e:
        print(f"Error getting story likes: {str(e)}")
        return jsonify({'success': False, 'error': 'Internal server error'}), 500

# ==================== UPLOAD MEDIA ====================

@timeline_api.route('/posts/upload-media', methods=['POST'])
def upload_media():
    """API upload media files cho bài viết"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    
    try:
        # Import media upload utilities (supports Cloudinary)
        from app.media_upload import process_media_files
        
        user_id = session['user_id']
        uploaded_files = []
        
        # Lấy tất cả files từ request
        files = []
        for key in request.files:
            file = request.files[key]
            if file and file.filename:
                files.append(file)
        
        # Tạo thư mục upload nếu chưa có (fallback)
        upload_dir = os.path.join(current_app.root_path, 'static/uploads/posts')
        os.makedirs(upload_dir, exist_ok=True)
        
        # Process all files using the new utility (supports Cloudinary)
        media_urls = process_media_files(files, upload_dir=upload_dir)
        
        return jsonify({
            'success': True,
            'media_urls': media_urls,
            'count': len(media_urls)
        })
        
    except Exception as e:
        print(f"Error uploading media: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# ==================== FRIENDS LIST ====================

@timeline_api.route('/friends/list')
def get_friends_list():
    """API lấy danh sách bạn bè để gắn thẻ"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    
    try:
        collections = get_db_collections()
        user_id = session['user_id']
        
        # Lấy thông tin user hiện tại
        user = collections['users'].find_one({'_id': ObjectId(user_id)})
        if not user:
            return jsonify({'success': False, 'error': 'User not found'}), 404
        
        # Lấy danh sách friend IDs
        friend_ids = user.get('friends', [])
        
        # Lấy thông tin chi tiết của bạn bè
        friends = []
        for friend_id in friend_ids:
            try:
                friend = collections['users'].find_one(
                    {'_id': ObjectId(friend_id) if ObjectId.is_valid(friend_id) else friend_id},
                    {'username': 1, 'avatar': 1, 'full_name': 1}
                )
                if friend:
                    # Xử lý avatar
                    avatar = friend.get('avatar', '')
                    if avatar:
                        if not avatar.startswith(('http', 'data:image', '/static')):
                            if avatar.startswith('uploads/'):
                                avatar = f'/static/{avatar}'
                            elif not avatar.startswith('/'):
                                avatar = f'/static/uploads/{avatar}'
                    else:
                        avatar = '/static/img/default-avatar.png'
                    
                    friends.append({
                        '_id': str(friend['_id']),
                        'username': friend.get('username', ''),
                        'full_name': friend.get('full_name', friend.get('username', '')),
                        'avatar': avatar
                    })
            except Exception as e:
                print(f"Error processing friend {friend_id}: {e}")
                continue
        
        return jsonify({
            'success': True,
            'friends': friends,
            'count': len(friends)
        })
        
    except Exception as e:
        print(f"Error getting friends list: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500