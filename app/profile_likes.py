"""
Blueprint riêng cho tính năng thích trang cá nhân
Giúp sắp xếp code gọn gàng, dễ bảo trì
"""

from flask import Blueprint, request, session, jsonify, render_template
from bson import ObjectId
import json
from datetime import datetime
from app import mongo, socketio
from app.utils.time_utils import get_vietnam_time
from flask import url_for

# Tạo blueprint
profile_likes_bp = Blueprint('profile_likes', __name__, url_prefix='/profile_likes')

# Helper functions để lấy collections
def users_col():
    return mongo.db.users

def notifications_col():
    return mongo.db.notifications

def posts_col():
    return mongo.db.posts

# ============================================================
# API ENDPOINTS
# ============================================================

@profile_likes_bp.route('/like/<profile_user_id>', methods=['POST'])
def like_profile(profile_user_id):
    """Thích/bỏ thích trang cá nhân của người khác"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        current_user_id = session['user_id']
        
        # Kiểm tra không được thích chính mình
        if current_user_id == profile_user_id:
            return jsonify({
                'success': False,
                'error': 'Bạn không thể thích trang cá nhân của chính mình'
            }), 400
        
        # Kiểm tra profile_user_id hợp lệ
        if not ObjectId.is_valid(profile_user_id):
            return jsonify({'error': 'ID người dùng không hợp lệ'}), 400
        
        # Lấy thông tin người dùng
        current_user = users_col().find_one({'_id': ObjectId(current_user_id)})
        profile_user = users_col().find_one({'_id': ObjectId(profile_user_id)})
        
        if not current_user or not profile_user:
            return jsonify({'error': 'Người dùng không tồn tại'}), 404
        
        # Kiểm tra đã thích chưa
        profile_likes = profile_user.get('profile_likes', [])
        has_liked = current_user_id in profile_likes
        
        if has_liked:
            # Bỏ thích
            users_col().update_one(
                {'_id': ObjectId(profile_user_id)},
                {'$pull': {'profile_likes': current_user_id}}
            )
            liked = False
            action = 'unliked'
            message = 'Đã bỏ thích trang cá nhân'
        else:
            # Thêm lượt thích
            users_col().update_one(
                {'_id': ObjectId(profile_user_id)},
                {'$addToSet': {'profile_likes': current_user_id}}
            )
            liked = True
            action = 'liked'
            message = 'Đã thích trang cá nhân'
        
        # Lấy số lượt thích mới
        updated_profile = users_col().find_one({'_id': ObjectId(profile_user_id)})
        like_count = len(updated_profile.get('profile_likes', []))
        
        # Tạo thông báo cho chủ profile (nếu không phải tự like)
        if liked and profile_user_id != current_user_id:
            _create_profile_like_notification(
                current_user_id=current_user_id,
                profile_user_id=profile_user_id,
                current_user=current_user,
                profile_user=profile_user
            )
        
        # Gửi socket event cho realtime update
        socketio.emit('profile_like_updated', {
            'profile_user_id': profile_user_id,
            'liked': liked,
            'like_count': like_count,
            'user_id': current_user_id,
            'username': current_user.get('full_name') or current_user.get('username', 'Unknown')
        }, room=f'profile_{profile_user_id}')
        
        return jsonify({
            'success': True,
            'liked': liked,
            'like_count': like_count,
            'message': message,
            'action': action
        })
        
    except Exception as e:
        print(f"Error liking profile: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Lỗi khi thích trang cá nhân'}), 500


@profile_likes_bp.route('/info/<profile_user_id>')
def get_profile_likes_info(profile_user_id):
    """Lấy thông tin lượt thích của một profile"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        current_user_id = session['user_id']
        
        if not ObjectId.is_valid(profile_user_id):
            return jsonify({'error': 'ID người dùng không hợp lệ'}), 400
        
        profile_user = users_col().find_one({'_id': ObjectId(profile_user_id)})
        if not profile_user:
            return jsonify({'error': 'Người dùng không tồn tại'}), 404
        
        # Lấy danh sách người đã thích profile này
        profile_likes = profile_user.get('profile_likes', [])
        like_count = len(profile_likes)
        
        # Kiểm tra người dùng hiện tại đã thích profile này chưa
        current_user_has_liked = current_user_id in profile_likes
        
        # Lấy thông tin của một vài người đã thích (cho hiển thị avatar)
        recent_likers = _get_recent_likers_info(profile_likes)
        
        return jsonify({
            'success': True,
            'like_count': like_count,
            'current_user_has_liked': current_user_has_liked,
            'recent_likers': recent_likers,
            'profile_user_id': profile_user_id,
            'can_like': current_user_id != profile_user_id  # Không thể thích chính mình
        })
        
    except Exception as e:
        print(f"Error getting profile likes info: {str(e)}")
        return jsonify({'error': 'Lỗi khi lấy thông tin lượt thích'}), 500


@profile_likes_bp.route('/likers/<profile_user_id>')
def get_profile_likers(profile_user_id):
    """Lấy danh sách chi tiết người đã thích profile"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        if not ObjectId.is_valid(profile_user_id):
            return jsonify({'error': 'ID người dùng không hợp lệ'}), 400
        
        profile_user = users_col().find_one({'_id': ObjectId(profile_user_id)})
        if not profile_user:
            return jsonify({'error': 'Người dùng không tồn tại'}), 404
        
        profile_likes = profile_user.get('profile_likes', [])
        
        # Lấy thông tin chi tiết tất cả người đã thích
        likers = _get_all_likers_info(profile_likes)
        
        return jsonify({
            'success': True,
            'likers': likers,
            'total': len(likers),
            'profile_user_id': profile_user_id,
            'profile_username': profile_user.get('full_name') or profile_user.get('username', 'Unknown')
        })
        
    except Exception as e:
        print(f"Error getting profile likers: {str(e)}")
        return jsonify({'error': 'Lỗi khi lấy danh sách người thích'}), 500


@profile_likes_bp.route('/page/<profile_user_id>')
def profile_likers_page(profile_user_id):
    """Trang hiển thị danh sách người đã thích profile"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        if not ObjectId.is_valid(profile_user_id):
            return "ID người dùng không hợp lệ", 400
        
        profile_user = users_col().find_one({'_id': ObjectId(profile_user_id)})
        if not profile_user:
            return "Người dùng không tồn tại", 404
        
        # Lấy danh sách người đã thích
        profile_likes = profile_user.get('profile_likes', [])
        likers = _get_all_likers_info(profile_likes)
        
        return render_template(
            'profile_likers.html',
            likers=likers,
            total_likes=len(likers),
            profile_user_id=profile_user_id,
            profile_username=profile_user.get('full_name') or profile_user.get('username', 'Unknown')
        )
        
    except Exception as e:
        print(f"Error loading profile likers page: {str(e)}")
        return "Lỗi khi tải trang", 500


@profile_likes_bp.route('/stats/<profile_user_id>')
def get_profile_likes_stats(profile_user_id):
    """Lấy thống kê lượt thích profile"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        if not ObjectId.is_valid(profile_user_id):
            return jsonify({'error': 'ID người dùng không hợp lệ'}), 400
        
        profile_user = users_col().find_one({'_id': ObjectId(profile_user_id)})
        if not profile_user:
            return jsonify({'error': 'Người dùng không tồn tại'}), 404
        
        profile_likes = profile_user.get('profile_likes', [])
        
        # Tính toán thống kê
        total_likes = len(profile_likes)
        
        # Lấy thông tin về người thích gần đây nhất
        latest_liker = None
        if profile_likes:
            latest_liker_id = profile_likes[-1]  # Người thích gần nhất
            if ObjectId.is_valid(latest_liker_id):
                latest_liker_user = users_col().find_one(
                    {'_id': ObjectId(latest_liker_id)},
                    {'full_name': 1, 'avatar': 1}
                )
                if latest_liker_user:
                    avatar = latest_liker_user.get('avatar')
                    if avatar and not avatar.startswith(('http', 'data:image')):
                        avatar = url_for('static', filename=avatar)
                    
                    latest_liker = {
                        'username': latest_liker_user.get('full_name') or 'Unknown',
                        'username': latest_liker_user.get('full_name') or latest_liker_user.get('username', 'Unknown'),
                        'avatar': avatar or url_for('static', filename='img/default-avatar.png'),
                        'user_id': str(latest_liker_user['_id'])
                    }
        
        return jsonify({
            'success': True,
            'total_likes': total_likes,
            'latest_liker': latest_liker,
            'profile_user_id': profile_user_id,
            'profile_username': profile_user.get('full_name') or profile_user.get('username', 'Unknown')
        })
        
    except Exception as e:
        print(f"Error getting profile likes stats: {str(e)}")
        return jsonify({'error': 'Lỗi khi lấy thống kê'}), 500


@profile_likes_bp.route('/check/<profile_user_id>')
def check_profile_like_status(profile_user_id):
    """Kiểm tra trạng thái like profile của người dùng hiện tại"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        current_user_id = session['user_id']
        
        if not ObjectId.is_valid(profile_user_id):
            return jsonify({'error': 'ID người dùng không hợp lệ'}), 400
        
        profile_user = users_col().find_one({'_id': ObjectId(profile_user_id)})
        if not profile_user:
            return jsonify({'error': 'Người dùng không tồn tại'}), 404
        
        profile_likes = profile_user.get('profile_likes', [])
        has_liked = current_user_id in profile_likes
        
        return jsonify({
            'success': True,
            'has_liked': has_liked,
            'profile_user_id': profile_user_id,
            'current_user_id': current_user_id,
            'can_like': current_user_id != profile_user_id
        })
        
    except Exception as e:
        print(f"Error checking profile like status: {str(e)}")
        return jsonify({'error': 'Lỗi khi kiểm tra trạng thái'}), 500


# ============================================================
# HELPER FUNCTIONS
# ============================================================

def _create_profile_like_notification(current_user_id, profile_user_id, current_user, profile_user):
    """Tạo thông báo khi có người thích profile"""
    try:
        notification_data = {
            'recipient_id': ObjectId(profile_user_id),
            'sender_id': ObjectId(current_user_id),
            'sender_name': current_user.get('full_name') or current_user.get('username', 'Unknown'),
            'type': 'profile_like',
            'content': 'đã thích trang cá nhân của bạn',
            'data': {
                'profile_user_id': profile_user_id,
                'profile_username': profile_user.get('full_name') or profile_user.get('username', '')
            },
            'read': False,
            'created_at': get_vietnam_time()
        }
        
        # Lưu thông báo vào database
        notifications_col().insert_one(notification_data)
        
        # Gửi socket event
        socketio.emit('new_notification', notification_data, room=profile_user_id)
        
    except Exception as notif_error:
        print(f"Error creating profile like notification: {str(notif_error)}")


def _get_recent_likers_info(profile_likes, limit=4):
    """Lấy thông tin của những người thích gần đây"""
    recent_likers = []
    
    if profile_likes:
        # Lấy tối đa 4 người thích gần nhất (từ cuối mảng)
        recent_liker_ids = [ObjectId(uid) for uid in profile_likes[-limit:] if ObjectId.is_valid(uid)]
        if recent_liker_ids:
            likers = list(users_col().find(
                {'_id': {'$in': recent_liker_ids}},
                {'username': 1, 'full_name': 1, 'avatar': 1}
            ))
            for liker in likers:
                avatar = liker.get('avatar')
                if avatar and not avatar.startswith(('http', 'data:image')):
                    avatar = url_for('static', filename=avatar)
                
                recent_likers.append({
                    '_id': str(liker['_id']),
                    'username': liker.get('full_name') or liker.get('username', 'Unknown'),
                    'avatar': avatar or url_for('static', filename='img/default-avatar.png')
                })
    
    return recent_likers


def _get_all_likers_info(profile_likes):
    """Lấy thông tin chi tiết tất cả người đã thích"""
    likers = []
    
    if profile_likes:
        liker_ids = [ObjectId(uid) for uid in profile_likes if ObjectId.is_valid(uid)]
        if liker_ids:
            users_list = list(users_col().find(
                {'_id': {'$in': liker_ids}},
                {'username': 1, 'avatar': 1, 'full_name': 1, 'online': 1}
            ))
            
            for user in users_list:
                avatar = user.get('avatar')
                if avatar and not avatar.startswith(('http', 'data:image')):
                    avatar = url_for('static', filename=avatar)
                
                likers.append({
                    '_id': str(user['_id']),
                    'username': user.get('full_name') or user.get('username', 'Unknown'),
                    'full_name': user.get('full_name', ''),
                    'avatar': avatar or url_for('static', filename='img/default-avatar.png'),
                    'online': user.get('online', False)
                })
    
    return likers


def _get_profile_like_count(profile_user_id):
    """Lấy số lượt thích của một profile (helper function)"""
    try:
        if not ObjectId.is_valid(profile_user_id):
            return 0
        
        profile_user = users_col().find_one({'_id': ObjectId(profile_user_id)})
        if not profile_user:
            return 0
        
        return len(profile_user.get('profile_likes', []))
    except:
        return 0


# ============================================================
# SOCKET.IO HANDLERS
# ============================================================

@socketio.on('join_profile_room')
def handle_join_profile_room(data):
    """Join profile room for realtime updates"""
    if 'user_id' not in session:
        return
    
    profile_user_id = data.get('profile_user_id')
    if profile_user_id:
        socketio.join_room(f'profile_{profile_user_id}')


@socketio.on('leave_profile_room')
def handle_leave_profile_room(data):
    """Leave profile room"""
    if 'user_id' not in session:
        return
    
    profile_user_id = data.get('profile_user_id')
    if profile_user_id:
        socketio.leave_room(f'profile_{profile_user_id}')