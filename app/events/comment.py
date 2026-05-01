from flask import session, request
from bson import ObjectId
from datetime import datetime
from flask_socketio import emit, join_room, leave_room
import json

def register_comment_events(socketio, mongo):
    """
    Đăng ký các sự kiện Socket.IO cho tính năng bình luận và bài viết realtime
    """
    users = mongo.db.users
    posts = mongo.db.posts
    
    # Lưu trữ tạm thời các phòng đang hoạt động
    post_rooms = {}

    # ==================== POST INTERACTION EVENTS ====================

    @socketio.on('post_liked')
    def handle_post_liked(data):
        """Xử lý sự kiện like bài viết từ socket"""
        try:
            post_id = data.get('post_id')
            liked = data.get('liked')
            like_count = data.get('like_count')
            
            # Phát sóng cho tất cả người đang xem bài viết này
            socketio.emit('post_liked_updated', {
                'post_id': post_id,
                'liked': liked,
                'like_count': like_count
            }, room=f'post_{post_id}')
            
        except Exception as e:
            print(f"Error in handle_post_liked: {str(e)}")

    @socketio.on('new_comment')
    def handle_new_comment(data):
        """Xử lý sự kiện comment mới từ socket"""
        try:
            post_id = data.get('post_id')
            comment = data.get('comment')
            
            # Phát sóng cho tất cả người đang xem bài viết này
            socketio.emit('new_comment_added', {
                'post_id': post_id,
                'comment': comment,
                'comment_count': get_comment_count(post_id)
            }, room=f'post_{post_id}')
            
        except Exception as e:
            print(f"Error in handle_new_comment: {str(e)}")

    def get_comment_count(post_id):
        """Lấy số lượng comment của bài viết"""
        try:
            post = posts.find_one({'_id': ObjectId(post_id)})
            if post and 'comments' in post:
                total = 0
                for comment in post['comments']:
                    total += 1  # Comment chính
                    total += len(comment.get('replies', []))
                return total
            return 0
        except:
            return 0

    @socketio.on('join_post_room')
    def handle_join_post_room_complete(data):
        """Khi người dùng vào xem bài viết - VERSION COMPLETE"""
        try:
            user_id = session.get('user_id')
            post_id = data.get('post_id')
            
            if not post_id:
                return
            
            room_name = f'post_{post_id}'
            join_room(room_name)
            
            # Theo dõi người dùng trong phòng
            if room_name not in post_rooms:
                post_rooms[room_name] = set()
            
            if user_id:
                post_rooms[room_name].add(user_id)
            
            print(f"[Socket] User joined post room: {room_name}")
            
        except Exception as e:
            print(f"Error joining post room: {str(e)}")

    # ==================== COMMENT ROOM MANAGEMENT ====================

    @socketio.on('join_post_room')
    def handle_join_post_room_comment(data):
        """Tham gia phòng của bài viết để nhận updates realtime"""
        user_id = session.get('user_id')
        post_id = data.get('post_id')
        
        if not user_id or not post_id:
            return
        
        room_name = f'post_{post_id}'
        join_room(room_name)
        
        # Theo dõi người dùng trong phòng
        if room_name not in post_rooms:
            post_rooms[room_name] = set()
        post_rooms[room_name].add(user_id)
        
        print(f"[Socket] User {user_id} joined post room: {room_name}")
        emit('post_room_joined', {'post_id': post_id}, room=request.sid)

    @socketio.on('leave_post_room')
    def handle_leave_post_room(data):
        """Rời phòng của bài viết"""
        user_id = session.get('user_id')
        post_id = data.get('post_id')
        
        if not user_id or not post_id:
            return
        
        room_name = f'post_{post_id}'
        leave_room(room_name)
        
        # Xóa người dùng khỏi danh sách phòng
        if room_name in post_rooms:
            post_rooms[room_name].discard(user_id)
            if not post_rooms[room_name]:
                del post_rooms[room_name]
        
        print(f"[Socket] User {user_id} left post room: {room_name}")

    # ==================== COMMENT LIKE/UNLIKE ====================

    @socketio.on('comment_liked')
    def handle_comment_liked(data):
        """Xử lý sự kiện like/unlike comment realtime"""
        user_id = session.get('user_id')
        post_id = data.get('post_id')
        comment_id = data.get('comment_id')
        reply_id = data.get('reply_id')
        
        if not all([user_id, post_id, comment_id]):
            emit('comment_error', {
                'message': 'Thiếu thông tin cần thiết'
            }, room=request.sid)
            return
        
        try:
            # Lấy thông tin người dùng
            user = users.find_one({'_id': ObjectId(user_id)}, {'username': 1, 'full_name': 1})
            if not user:
                emit('comment_error', {
                    'message': 'Người dùng không tồn tại'
                }, room=request.sid)
                return
            
            # Tìm bài viết
            post = posts.find_one({'_id': ObjectId(post_id)})
            if not post:
                emit('comment_error', {
                    'message': 'Bài viết không tồn tại'
                }, room=request.sid)
                return
            
            # Tìm comment trong bài viết
            comment_found = None
            comment_index = -1
            
            for i, comment in enumerate(post.get('comments', [])):
                if comment.get('id') == comment_id:
                    comment_found = comment
                    comment_index = i
                    break
            
            if not comment_found:
                emit('comment_error', {
                    'message': 'Bình luận không tồn tại'
                }, room=request.sid)
                return
            
            # Xác định target (comment hoặc reply)
            if reply_id:
                # Tìm reply trong comment
                reply_found = None
                reply_index = -1
                
                for j, reply in enumerate(comment_found.get('replies', [])):
                    if reply.get('id') == reply_id:
                        reply_found = reply
                        reply_index = j
                        break
                
                if not reply_found:
                    emit('comment_error', {
                        'message': 'Phản hồi không tồn tại'
                    }, room=request.sid)
                    return
                
                # Kiểm tra xem đã like reply chưa
                likes = reply_found.get('likes', [])
                if user_id in likes:
                    # Unlike: Xóa user khỏi danh sách likes
                    posts.update_one(
                        {'_id': ObjectId(post_id)},
                        {'$pull': {f'comments.{comment_index}.replies.{reply_index}.likes': user_id}}
                    )
                    liked = False
                    action = 'unliked'
                else:
                    # Like: Thêm user vào danh sách likes
                    posts.update_one(
                        {'_id': ObjectId(post_id)},
                        {'$addToSet': {f'comments.{comment_index}.replies.{reply_index}.likes': user_id}}
                    )
                    liked = True
                    action = 'liked'
                
                # Lấy số lượng like mới
                updated_post = posts.find_one({'_id': ObjectId(post_id)})
                if updated_post:
                    comment = updated_post['comments'][comment_index]
                    reply = comment['replies'][reply_index]
                    like_count = len(reply.get('likes', []))
                else:
                    like_count = 0
            else:
                # Like/Unlike comment chính
                likes = comment_found.get('likes', [])
                if user_id in likes:
                    # Unlike: Xóa user khỏi danh sách likes
                    posts.update_one(
                        {'_id': ObjectId(post_id), 'comments.id': comment_id},
                        {'$pull': {'comments.$.likes': user_id}}
                    )
                    liked = False
                    action = 'unliked'
                else:
                    # Like: Thêm user vào danh sách likes
                    posts.update_one(
                        {'_id': ObjectId(post_id), 'comments.id': comment_id},
                        {'$addToSet': {'comments.$.likes': user_id}}
                    )
                    liked = True
                    action = 'liked'
                
                # Lấy số lượng like mới
                updated_post = posts.find_one({'_id': ObjectId(post_id)})
                if updated_post:
                    for comment in updated_post.get('comments', []):
                        if comment.get('id') == comment_id:
                            like_count = len(comment.get('likes', []))
                            break
                    else:
                        like_count = 0
                else:
                    like_count = 0
            
            # Tạo notification data cho người được like (nếu không phải tự like)
            notification_recipient = None
            if liked:
                # Xác định chủ sở hữu của comment/reply
                target_owner = None
                if reply_id:
                    target_owner = reply_found.get('user_id')
                else:
                    target_owner = comment_found.get('user_id')
                
                # Tạo thông báo nếu không phải tự like
                if target_owner and target_owner != user_id:
                    notification_recipient = target_owner
            
            # Gửi update realtime đến tất cả người dùng đang xem bài viết này
            emit_data = {
                'post_id': post_id,
                'comment_id': comment_id,
                'reply_id': reply_id,
                'user_id': user_id,
                'username': user.get('full_name') or user.get('username', 'Unknown'),
                'action': action,
                'liked': liked,
                'like_count': like_count,
                'timestamp': datetime.utcnow().isoformat()
            }
            
            socketio.emit('comment_liked_updated', emit_data, room=f'post_{post_id}')
            
            # Gửi notification nếu cần
            if notification_recipient:
                # Tạo và gửi notification
                notification_data = {
                    'type': 'comment_like',
                    'recipient_id': notification_recipient,
                    'sender_id': user_id,
                    'sender_name': user.get('full_name') or user.get('username', 'Unknown'),
                    'post_id': post_id,
                    'comment_id': comment_id,
                    'reply_id': reply_id,
                    'timestamp': datetime.utcnow().isoformat()
                }
                socketio.emit('new_notification', notification_data, room=notification_recipient)
            
            # ACK cho client gửi request
            emit('comment_like_acknowledged', {
                'success': True,
                'action': action,
                'like_count': like_count
            }, room=request.sid)
            
        except Exception as e:
            print(f"[Socket] Error handling comment like: {str(e)}")
            emit('comment_error', {
                'message': 'Lỗi khi xử lý like bình luận'
            }, room=request.sid)

    # ==================== ADD NEW COMMENT/REPLY ====================

    @socketio.on('new_comment_reply')
    def handle_new_comment_reply(data):
        """Xử lý sự kiện thêm comment/reply mới realtime"""
        user_id = session.get('user_id')
        post_id = data.get('post_id')
        content = data.get('content')
        reply_to = data.get('reply_to')
        reply_to_username = data.get('reply_to_username')
        
        if not all([user_id, post_id, content]):
            emit('comment_error', {
                'message': 'Thiếu thông tin cần thiết'
            }, room=request.sid)
            return
        
        try:
            # Lấy thông tin người dùng
            user = users.find_one({'_id': ObjectId(user_id)}, 
                                {'username': 1, 'full_name': 1, 'avatar': 1})
            if not user:
                emit('comment_error', {
                    'message': 'Người dùng không tồn tại'
                }, room=request.sid)
                return
            
            # Kiểm tra bài viết tồn tại
            post = posts.find_one({'_id': ObjectId(post_id)})
            if not post:
                emit('comment_error', {
                    'message': 'Bài viết không tồn tại'
                }, room=request.sid)
                return
            
            # Xử lý avatar
            user_avatar = user.get('avatar', '')
            if user_avatar and not user_avatar.startswith(('http', '/static')):
                if not user_avatar.startswith('/'):
                    user_avatar = f'/static/{user_avatar}'
            else:
                user_avatar = '/static/img/default-avatar.png'
            
            # Tạo ID cho comment/reply mới
            import uuid
            new_comment_id = str(uuid.uuid4())
            
            # Tạo comment data
            comment_data = {
                'id': new_comment_id,
                'user_id': user_id,
                'username': user.get('full_name') or user.get('username', 'Unknown'),
                'user_avatar': user_avatar,
                'content': content,
                'created_at': datetime.utcnow(),
                'likes': [],
                'replies': []
            }
            
            # Thêm thông tin reply nếu có
            if reply_to and reply_to_username:
                comment_data['reply_to'] = reply_to
                comment_data['reply_to_username'] = reply_to_username
            
            # Xác định vị trí cần thêm vào database
            is_reply = False
            parent_comment_id = None
            
            if reply_to and not data.get('is_new_comment', False):
                is_reply = True
                
                # Tìm parent comment chứa reply gốc
                for comment in post.get('comments', []):
                    # Nếu reply_to là comment chính
                    if comment.get('id') == reply_to:
                        parent_comment_id = comment.get('id')
                        break
                    
                    # Tìm trong replies của comment
                    for reply in comment.get('replies', []):
                        if reply.get('id') == reply_to:
                            parent_comment_id = comment.get('id')  # Lấy ID comment chính
                            break
                    
                    if parent_comment_id:
                        break
                
                if parent_comment_id:
                    # QUAN TRỌNG: Luôn thêm vào replies của comment chính
                    # Không tạo cấu trúc nested
                    result = posts.update_one(
                        {
                            '_id': ObjectId(post_id),
                            'comments.id': parent_comment_id
                        },
                        {
                            '$push': {
                                'comments.$.replies': comment_data
                            }
                        }
                    )
                    
                    if result.modified_count == 0:
                        emit('comment_error', {
                            'message': 'Không thể thêm reply'
                        }, room=request.sid)
                        return
                else:
                    emit('comment_error', {
                        'message': 'Không tìm thấy comment chính để thêm reply'
                    }, room=request.sid)
                    return
            else:
                # Comment mới (không phải reply)
                comment_data['replies'] = []
                posts.update_one(
                    {'_id': ObjectId(post_id)},
                    {'$push': {'comments': comment_data}}
                )
            
            # 🔴 QUAN TRỌNG: LẤY POST ĐÃ CẬP NHẬT SAU KHI THÊM COMMENT
            updated_post = posts.find_one({'_id': ObjectId(post_id)})
            
            # Tính tổng số comment mới
            total_comments = 0
            if updated_post and 'comments' in updated_post:
                for comment in updated_post['comments']:
                    total_comments += 1  # Comment chính
                    total_comments += len(comment.get('replies', []))
            else:
                total_comments = 0
            
            # Chuẩn bị data để gửi cho client
            # Convert datetime to string để JSON serialize
            comment_data_for_client = comment_data.copy()
            comment_data_for_client['created_at'] = comment_data['created_at'].isoformat()
            
            # Gửi thông báo realtime
            emit_data = {
                'post_id': post_id,
                'comment': comment_data_for_client,
                'is_reply': is_reply,
                'reply_to': reply_to,
                'reply_to_username': reply_to_username,
                'total_comments': total_comments,  # ĐẢM BẢO CÓ TRƯỜNG NÀY
                'timestamp': datetime.utcnow().isoformat()
            }
            
            socketio.emit('new_comment_added', emit_data, room=f'post_{post_id}')
            
            # Tạo notification data cho chủ bài viết và người được reply
            notifications_to_send = []
            
            # 1. Notification cho chủ bài viết (nếu không phải tự comment và không phải reply)
            if post['user_id'] != user_id and not is_reply:
                notifications_to_send.append({
                    'recipient_id': post['user_id'],
                    'type': 'new_comment',
                    'sender_id': user_id,
                    'sender_name': user.get('full_name') or user.get('username', 'Unknown'),
                    'post_id': post_id,
                    'comment_id': new_comment_id,
                    'comment_preview': content[:50] + '...' if len(content) > 50 else content
                })
            
            # 2. Notification cho người được reply (nếu có và không phải tự reply)
            if is_reply and reply_to:
                # Tìm user_id của người được reply
                reply_target_user_id = None
                
                # Tìm trong comments và replies
                for comment in post.get('comments', []):
                    if comment.get('id') == reply_to:
                        reply_target_user_id = comment.get('user_id')
                        break
                    
                    # Tìm trong replies
                    for reply in comment.get('replies', []):
                        if reply.get('id') == reply_to:
                            reply_target_user_id = reply.get('user_id')
                            break
                    
                    if reply_target_user_id:
                        break
                
                # Gửi thông báo nếu không phải tự reply
                if reply_target_user_id and reply_target_user_id != user_id:
                    notifications_to_send.append({
                        'recipient_id': reply_target_user_id,
                        'type': 'comment_reply',
                        'sender_id': user_id,
                        'sender_name': user.get('full_name') or user.get('username', 'Unknown'),
                        'post_id': post_id,
                        'comment_id': reply_to,
                        'reply_id': new_comment_id,
                        'reply_preview': content[:50] + '...' if len(content) > 50 else content
                    })
            
            # Gửi notifications
            for notification in notifications_to_send:
                notification['timestamp'] = datetime.utcnow().isoformat()
                socketio.emit('new_notification', notification, room=notification['recipient_id'])
            
            # ACK cho client gửi request
            emit('comment_added_acknowledged', {
                'success': True,
                'comment_id': new_comment_id,
                'is_reply': is_reply
            }, room=request.sid)
            
        except Exception as e:
            print(f"[Socket] Error handling new comment: {str(e)}")
            import traceback
            traceback.print_exc()
            emit('comment_error', {
                'message': 'Lỗi khi thêm bình luận'
            }, room=request.sid)

    # ==================== DELETE COMMENT/REPLY ====================

    @socketio.on('delete_comment')
    def handle_delete_comment(data):
        """Xử lý xóa comment/reply"""
        user_id = session.get('user_id')
        post_id = data.get('post_id')
        comment_id = data.get('comment_id')
        reply_id = data.get('reply_id')
        
        if not all([user_id, post_id, comment_id]):
            emit('comment_error', {
                'message': 'Thiếu thông tin cần thiết'
            }, room=request.sid)
            return
        
        try:
            # Tìm bài viết
            post = posts.find_one({'_id': ObjectId(post_id)})
            if not post:
                emit('comment_error', {
                    'message': 'Bài viết không tồn tại'
                }, room=request.sid)
                return
            
            # Kiểm tra quyền xóa
            can_delete = False
            comment_owner = None
            
            if reply_id:
                # Xóa reply
                for comment in post.get('comments', []):
                    if comment.get('id') == comment_id:
                        for reply in comment.get('replies', []):
                            if reply.get('id') == reply_id:
                                comment_owner = reply.get('user_id')
                                # Chủ sở hữu reply hoặc chủ bài viết có thể xóa
                                if reply.get('user_id') == user_id or post.get('user_id') == user_id:
                                    can_delete = True
                                break
                        break
            else:
                # Xóa comment
                for comment in post.get('comments', []):
                    if comment.get('id') == comment_id:
                        comment_owner = comment.get('user_id')
                        # Chủ sở hữu comment hoặc chủ bài viết có thể xóa
                        if comment.get('user_id') == user_id or post.get('user_id') == user_id:
                            can_delete = True
                        break
            
            if not can_delete:
                emit('comment_error', {
                    'message': 'Không có quyền xóa bình luận này'
                }, room=request.sid)
                return
            
            # Thực hiện xóa
            if reply_id:
                # Xóa reply
                result = posts.update_one(
                    {
                        '_id': ObjectId(post_id),
                        'comments.id': comment_id
                    },
                    {
                        '$pull': {
                            'comments.$.replies': {'id': reply_id}
                        }
                    }
                )
            else:
                # Xóa comment và tất cả replies của nó
                result = posts.update_one(
                    {'_id': ObjectId(post_id)},
                    {'$pull': {'comments': {'id': comment_id}}}
                )
            
            # Tính lại tổng số comment
            updated_post = posts.find_one({'_id': ObjectId(post_id)})
            total_comments = 0
            if updated_post and 'comments' in updated_post:
                total_comments = len(updated_post['comments'])
                for comment in updated_post['comments']:
                    if 'replies' in comment:
                        total_comments += len(comment['replies'])
            
            # Gửi thông báo realtime
            emit_data = {
                'post_id': post_id,
                'comment_id': comment_id,
                'reply_id': reply_id,
                'deleted_by': user_id,
                'total_comments': total_comments,
                'timestamp': datetime.utcnow().isoformat()
            }
            
            socketio.emit('comment_deleted', emit_data, room=f'post_{post_id}')
            
            # ACK cho client
            emit('comment_deleted_acknowledged', {
                'success': True,
                'deleted_id': reply_id if reply_id else comment_id
            }, room=request.sid)
            
        except Exception as e:
            print(f"[Socket] Error deleting comment: {str(e)}")
            emit('comment_error', {
                'message': 'Lỗi khi xóa bình luận'
            }, room=request.sid)

    # ==================== EDIT COMMENT/REPLY ====================

    @socketio.on('edit_comment')
    def handle_edit_comment(data):
        """Xử lý chỉnh sửa comment/reply"""
        user_id = session.get('user_id')
        post_id = data.get('post_id')
        comment_id = data.get('comment_id')
        reply_id = data.get('reply_id')
        new_content = data.get('new_content')
        
        if not all([user_id, post_id, comment_id, new_content]):
            emit('comment_error', {
                'message': 'Thiếu thông tin cần thiết'
            }, room=request.sid)
            return
        
        try:
            # Tìm bài viết
            post = posts.find_one({'_id': ObjectId(post_id)})
            if not post:
                emit('comment_error', {
                    'message': 'Bài viết không tồn tại'
                }, room=request.sid)
                return
            
            # Kiểm tra quyền chỉnh sửa (chỉ chủ sở hữu)
            can_edit = False
            
            if reply_id:
                # Chỉnh sửa reply
                for comment in post.get('comments', []):
                    if comment.get('id') == comment_id:
                        for reply in comment.get('replies', []):
                            if reply.get('id') == reply_id and reply.get('user_id') == user_id:
                                can_edit = True
                                break
                        break
            else:
                # Chỉnh sửa comment
                for comment in post.get('comments', []):
                    if comment.get('id') == comment_id and comment.get('user_id') == user_id:
                        can_edit = True
                        break
            
            if not can_edit:
                emit('comment_error', {
                    'message': 'Không có quyền chỉnh sửa bình luận này'
                }, room=request.sid)
                return
            
            # Thực hiện chỉnh sửa
            update_path = ""
            if reply_id:
                update_path = f'comments.$[comment].replies.$[reply].content'
                array_filters = [
                    {'comment.id': comment_id},
                    {'reply.id': reply_id}
                ]
            else:
                update_path = 'comments.$[comment].content'
                array_filters = [{'comment.id': comment_id}]
            
            result = posts.update_one(
                {'_id': ObjectId(post_id)},
                {
                    '$set': {
                        update_path: new_content,
                        f'{update_path}_edited': True,
                        f'{update_path}_edited_at': datetime.utcnow()
                    }
                },
                array_filters=array_filters
            )
            
            # Gửi thông báo realtime
            emit_data = {
                'post_id': post_id,
                'comment_id': comment_id,
                'reply_id': reply_id,
                'new_content': new_content,
                'edited_by': user_id,
                'edited_at': datetime.utcnow().isoformat(),
                'timestamp': datetime.utcnow().isoformat()
            }
            
            socketio.emit('comment_edited', emit_data, room=f'post_{post_id}')
            
            # ACK cho client
            emit('comment_edited_acknowledged', {
                'success': True,
                'edited_id': reply_id if reply_id else comment_id
            }, room=request.sid)
            
        except Exception as e:
            print(f"[Socket] Error editing comment: {str(e)}")
            emit('comment_error', {
                'message': 'Lỗi khi chỉnh sửa bình luận'
            }, room=request.sid)

    # ==================== POST ROOM USERS MANAGEMENT ====================

    @socketio.on('get_post_room_users')
    def handle_get_post_room_users(data):
        """Lấy danh sách người dùng đang trong phòng bài viết"""
        post_id = data.get('post_id')
        if not post_id:
            return
        
        room_name = f'post_{post_id}'
        
        # Lấy danh sách người dùng trong phòng
        users_in_room = []
        if room_name in post_rooms:
            for user_id in post_rooms[room_name]:
                user = users.find_one(
                    {'_id': ObjectId(user_id)},
                    {'username': 1, 'full_name': 1, 'avatar': 1}
                )
                if user:
                    users_in_room.append({
                        'user_id': str(user['_id']),
                        'username': user.get('full_name') or user.get('username', 'Unknown'),
                        'avatar': user.get('avatar', '')
                    })
        
        emit('post_room_users', {
            'post_id': post_id,
            'users': users_in_room,
            'count': len(users_in_room)
        }, room=request.sid)
    
    print("[Socket] Post and comment events registered successfully")