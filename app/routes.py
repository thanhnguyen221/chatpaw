import os
import uuid
import re
import shutil
from flask import Blueprint, current_app, render_template, request, redirect, url_for, session, jsonify
from bson import InvalidDocument, ObjectId
import pytz
from app import mongo, socketio
from app.auth import login_user, register_user, logout_user, check_session_valid
from datetime import datetime,timedelta
from app.utils.time_utils import get_vietnam_timezone, get_vietnam_time, format_timestamp_for_client
from app.message_encryption import encrypt_message, decrypt_message
from werkzeug.utils import secure_filename
from PIL import Image
from flask import send_from_directory
import json
from flask_login import current_user
import functools

def get_vietnam_timezone():
    """Trả về timezone Việt Nam (UTC+7)"""
    return pytz.timezone('Asia/Ho_Chi_Minh')

main = Blueprint('main', __name__)

UPLOAD_FOLDER = 'app/static/uploads'
ALLOWED_EXTENSIONS = {
    # Text
    'txt', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 
    # Microsoft Office
    'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    # Code Files
    'py', 'js', 'jsx', 'ts', 'tsx', 'html', 'htm', 'css', 'scss', 'sass', 'less',
    'json', 'xml', 'yaml', 'yml', 'sql', 'md', 'markdown', 'sh', 'bash', 'zsh',
    'c', 'cpp', 'h', 'hpp', 'java', 'class', 'jar', 'cs', 'vb', 'php', 'rb',
    'go', 'rs', 'swift', 'kt', 'kts', 'scala', 'r', 'm', 'mm', 'pl', 'pm',
    'lua', 'dart', 'groovy', 'gradle', 'properties', 'ini', 'conf', 'cfg',
    'dockerfile', 'gitignore', 'htaccess', 'env', 'log', 'csv', 'tsv',
    # Web
    'vue', 'svelte', 'php', 'asp', 'aspx', 'jsp', 'cgi',
    # Audio
    'mp3', 'wav', 'ogg', 'webm', 'm4a', 'flac', 'aac', 'wma',
    # Video
    'mp4', 'avi', 'mov', 'mkv', 'flv', 'wmv', 'm4v', '3gp',
    # Archive (for folder/project uploads)
    'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'tbz2',
}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB cho file lớn hơn


users_col = lambda: mongo.db['users']
conversations_col = lambda: mongo.db['conversations']
messages_col = lambda: mongo.db['messages']
friend_requests_col = lambda: mongo.db['friend_requests']
groups_col = lambda: mongo.db['groups']
group_members_col = lambda: mongo.db['group_members']
friends_col = lambda: mongo.db['friends']
posts_col = lambda: mongo.db['posts']
notifications_col = lambda: mongo.db['notifications']

online_users = {}

def messages_col():
    return mongo.db.messages

def conversations_col():
    return mongo.db.conversations

def users_col():
    return mongo.db.users

def group_messages_col():  # THÊM HÀM NÀY
    return mongo.db.group_messages

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# ==================== SINGLE SESSION DECORATOR ====================
def require_session_valid(f):
    """Decorator kiểm tra session token (single session login với fingerprint)"""
    @functools.wraps(f)
    def decorated_function(*args, **kwargs):
        user_id = session.get('user_id')
        session_token = session.get('session_token')
        
        # Nếu không có session, redirect về login
        if not user_id or not session_token:
            if request.is_json:
                return jsonify({'error': 'Unauthorized - No session', 'redirect': '/login'}), 401
            return redirect(url_for('main.login'))
        
        # Kiểm tra session token có hợp lệ không
        is_valid, message = check_session_valid(user_id, session_token)
        
        if not is_valid:
            # Session không hợp lệ, clear session và báo lỗi
            session.clear()
            
            if request.is_json:
                error_messages = {
                    'No session': 'Unauthorized - No session',
                    'Invalid session': 'Session expired - Bạn đã đăng nhập ở thiết bị khác',
                    'Session fingerprint mismatch': 'Security alert - Session không hợp lệ',
                    'Session expired': 'Session expired - Vui lòng đăng nhập lại',
                    'Session validation error': 'Session validation error'
                }
                
                return jsonify({
                    'error': error_messages.get(message, 'Session validation failed'),
                    'redirect': '/login',
                    'force_logout': True,
                    'reason': message
                }), 401
            
            # Nếu là request thường, redirect về login với thông báo lỗi
            error_messages = {
                'No session': 'Vui lòng đăng nhập!',
                'Invalid session': 'Phiên đăng nhập đã hết hạn!',
                'Session fingerprint mismatch': 'Phiên đăng nhập không hợp lệ!',
                'Session expired': 'Phiên đăng nhập đã hết hạn!',
                'Session validation error': 'Lỗi xác thực phiên đăng nhập!'
            }
            
            return render_template('login.html', error=error_messages.get(message, 'Lỗi đăng nhập!'))
        
        return f(*args, **kwargs)
    return decorated_function

# --- [THÊM VÀO ĐẦU FILE] HÀM HỖ TRỢ LẤY THÔNG TIN REPLY ---
def resolve_reply_context(msg, collection_type='private'):
    """
    Tìm tin nhắn gốc và tạo object reply_context
    collection_type: 'private' hoặc 'group'
    """
    if not msg.get('reply_to'):
        return None
        
    try:
        reply_id = msg['reply_to']
        
        # Xác định collection cần tìm
        target_col = messages_col() if collection_type == 'private' else group_messages_col()
        
        # Tìm tin nhắn gốc
        original_msg = target_col.find_one({'_id': ObjectId(reply_id)})
        
        if original_msg:
            # Tìm người gửi tin nhắn gốc
            sender = users_col().find_one({'_id': original_msg['sender_id']})
            sender_name = sender.get('username', 'Unknown') if sender else "Unknown"
            
            return {
                'message_id': str(original_msg['_id']),
                'sender_id': str(original_msg['sender_id']),
                'sender_name': sender_name,
                'content': original_msg['content']
            }
    except Exception as e:
        print(f"Error resolving reply context: {e}")
        return None

@main.route('/')
def home():
    if 'username' in session:
        return redirect(url_for('main.chat'))
    return redirect(url_for('main.login'))

@main.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')

        if not username or not password:
            return render_template('login.html', error="Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu!")

        success, message = login_user(username, password)
        
        if success:
            # Kiểm tra xem có bị force logout từ thiết bị khác không
            from app.auth import get_active_sessions
            user_id = session.get('user_id')
            sessions = get_active_sessions(user_id)
            
            if sessions and sessions.get('current_session', {}).get('previous_session_forced_out'):
                # Hiển thị thông báo đã đăng xuất từ thiết bị khác
                return render_template('login.html', 
                    success="Đăng nhập thành công! Bạn đã đăng xuất khỏi thiết bị khác.",
                    username=username)
            
            return redirect(url_for('main.chat'))
        
        return render_template('login.html', error=message)

    return render_template('login.html')

@main.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        full_name = request.form.get('full_name')
        username = request.form.get('username')
        email = request.form.get('email')
        phone = request.form.get('phone')
        date_of_birth = request.form.get('date_of_birth')
        gender = request.form.get('gender')
        password = request.form.get('password')
        confirm_password = request.form.get('confirm_password')

        success, message = register_user(
            full_name,
            username,
            email,
            phone,
            password,
            confirm_password,
            date_of_birth,
            gender
        )

        if success:
            from flask import flash
            flash('Đăng ký thành công! Vui lòng đăng nhập để tiếp tục.', 'success')
            return redirect(url_for('main.login'))
        
        # Pass form data back to template on error
        form_data = {
            'full_name': full_name,
            'username': username,
            'email': email,
            'phone': phone,
            'date_of_birth': date_of_birth,
            'gender': gender
        }
        return render_template('register.html', error=message, form_data=form_data)

    return render_template('register.html')
@main.route('/chat')
def chat():
    # Kiểm tra đăng nhập
    if 'username' not in session or 'user_id' not in session:
        return redirect(url_for('main.login'))

    user_id = ObjectId(session['user_id'])
    users = mongo.db.users
    conversations_db = mongo.db.conversations
    messages = mongo.db.messages

    # Lấy thông tin người dùng
    user_doc = users.find_one({'_id': user_id})
    user_avatar = user_doc.get('avatar') or url_for('static', filename='img/default-avatar.png')

    # Lấy danh sách hội thoại
    conversations = []

    # 13/12/2025 - Bỏ qua các hội thoại đã bị user này xóa (deleted_for dùng dạng mảng)
    conv_cursor = conversations_db.find({
        'participants': str(user_id),
        '$or': [
            {'deleted_for': {'$exists': False}},
            {'deleted_for': {'$nin': [str(user_id)]}}
        ]
    })

    for conv in conv_cursor:
        friend_id = next((pid for pid in conv['participants'] if pid != str(user_id)), None)

        # An toàn khi convert ObjectId
        friend = None
        if friend_id and ObjectId.is_valid(friend_id):
            friend = users.find_one({'_id': ObjectId(friend_id)})

        # Xử lý avatar bạn bè
        if friend:
            raw_avatar = friend.get('avatar')
            if raw_avatar and (raw_avatar.startswith('http') or raw_avatar.startswith('data:image')):
                friend_avatar = raw_avatar
            elif raw_avatar:
                friend_avatar = url_for('static', filename=raw_avatar)
            else:
                friend_avatar = url_for('static', filename='img/default-avatar.png')
        else:
            friend_avatar = url_for('static', filename='img/default-avatar.png')

        # QUAN TRỌNG: Sửa query last_message - dùng ObjectId thay vì string
        last_message = messages.find_one(
            {'conversation_id': conv['_id']},  # SỬA: dùng conv['_id'] (ObjectId) thay vì str(conv['_id'])
            sort=[('timestamp', -1)]
        )

        # DEBUG
        print(f"\n=== DEBUG CONVERSATION {conv['_id']} ===")
        print(f"Friend: {friend['username'] if friend else 'Unknown'}")
        print(f"Last message exists: {last_message is not None}")
        
        if last_message:
            print(f"Last message content: {last_message['content']}")
            print(f"Last message type: {last_message.get('message_type', 'text')}")
            print(f"Last message sender: {last_message.get('sender_id')}")
        else:
            print("No last message found!")

        # Đếm số tin chưa đọc
        unread_count = messages.count_documents({
            'conversation_id': conv['_id'],
            'sender_id': {'$ne': str(user_id)},
            'read_by': {'$ne': str(user_id)}  # SỬA: dùng $ne thay vì $nin
        })
        print(f"Unread count for conversation {conv['_id']}: {unread_count}")
        
        # XỬ LÝ PREVIEW
        if last_message:
            last_message_content = last_message['content']
            last_message_type = last_message.get('message_type', 'text')
            last_message_sender = str(last_message['sender_id']) if last_message.get('sender_id') else ''
            last_message_time = last_message['timestamp']
            
            # Sử dụng hàm get_message_preview
            last_message_preview = get_message_preview(last_message_content, last_message_type)
            print(f"Generated preview: '{last_message_preview}'")
        else:
            last_message_content = 'Bắt đầu trò chuyện'
            last_message_type = 'text'
            last_message_sender = ''
            last_message_time = conv.get('created_at')
            last_message_preview = 'Bắt đầu trò chuyện'
            print("Using default preview")

        is_online = friend.get('online', False) if friend else False

        # 13/12/2025 - Tính trạng thái mute & theme riêng cho từng user trong hội thoại
        user_id_str = str(user_id)

        mute_map = conv.get('mute_until', {}) or {}
        raw_mute_value = mute_map.get(user_id_str)
        is_muted = False
        mute_until = None

        if isinstance(raw_mute_value, datetime):
            try:
                now_vn = get_vietnam_time()
                # Nếu raw_mute_value không có timezone, thêm timezone Việt Nam
                if raw_mute_value.tzinfo is None:
                    vietnam_tz = get_vietnam_timezone()
                    raw_mute_value = vietnam_tz.localize(raw_mute_value)
                is_muted = raw_mute_value > now_vn
                mute_until = raw_mute_value
            except Exception:
                is_muted = False
        elif isinstance(raw_mute_value, str) and raw_mute_value == 'forever':
            is_muted = True

        themes_map = conv.get('themes', {}) or {}
        theme_for_user = themes_map.get(user_id_str, 'default')

        # Thêm vào danh sách
        conversations.append({
            '_id': conv['_id'],
            'friend_id': friend_id,
            'friend_name': friend.get('full_name') or friend.get('username') if friend else 'Unknown',
            'friend_avatar': friend_avatar,
            'last_message': last_message_content,
            'last_message_sender': last_message_sender,
            'last_message_preview': last_message_preview,
            'last_message_time': last_message_time,
            'last_message_type': last_message_type,
            'unread_count': unread_count,
            'is_online': is_online,
            'is_muted': is_muted,
            'muted_until': mute_until,
            'theme': theme_for_user,
        })

    # Lấy danh sách bạn bè
    friend_ids = user_doc.get('friends', []) if user_doc else []
    friends = list(users.find(
        {'_id': {'$in': [ObjectId(fid) for fid in friend_ids if ObjectId.is_valid(fid)]}},
        {'password': 0}
    ))
    for friend in friends:
        friend.setdefault('avatar', None)

    return render_template(
        'chat.html',
        user_id=str(user_id),
        username=session['username'],
        full_name=user_doc.get('full_name', ''),
        user_avatar=user_avatar,
        conversations=conversations,
        friends=friends
    )

@main.route('/conversation/<conversation_id>')
def get_conversation(conversation_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        conv_id = ObjectId(conversation_id)
    except Exception:
        return jsonify({'error': 'Invalid conversation ID'}), 400

    conv = conversations_col().find_one({'_id': conv_id})
    if not conv or session['user_id'] not in conv['participants']:
        return jsonify({'error': 'Conversation not found or access denied'}), 404
    
    # 13/12/2025 - Nếu user đã từng xóa hội thoại này, chỉ hiển thị các tin
    # nhắn sau thời điểm xóa (deleted_at_for.<user_id>) để tránh hiện lại lịch sử cũ
    user_id_str = str(session['user_id'])
    deleted_at_map = conv.get('deleted_at_for', {}) or {}
    deleted_at = deleted_at_map.get(user_id_str)

    msg_query = {'conversation_id': conv_id}
    if deleted_at and isinstance(deleted_at, datetime):
        # 13/12/2025 - Không dùng trường timestamp (kiểu có thể là string)
        # mà dùng _id của tin nhắn để lọc theo thời gian tạo
        cutoff_oid = ObjectId.from_datetime(deleted_at)
        msg_query['_id'] = {'$gt': cutoff_oid}

    messages = list(messages_col().find({
        '$and': [
            msg_query,
            {'$or': [
                {'hidden_for': {'$exists': False}},
                {'hidden_for': {'$nin': [ObjectId(session['user_id'])]}}
            ]}
        ]
    }).sort('timestamp', 1))

    # Cache thông tin sender
    sender_ids = list(set(msg['sender_id'] for msg in messages))
    senders = list(users_col().find({'_id': {'$in': sender_ids}}, {'username': 1, 'avatar': 1}))
    sender_map = {}
    for s in senders:
        avatar = s.get('avatar')
        if avatar and not avatar.startswith(('http', 'data:image')):
            avatar = url_for('static', filename=avatar)
        sender_map[str(s['_id'])] = {
            'username': s['username'],
            'avatar': avatar or url_for('static', filename='img/default-avatar.png')
        }

    message_list = []
    for msg in messages:
        sender_info = sender_map.get(str(msg['sender_id']), {'username': 'Unknown', 'avatar': url_for('static', filename='img/default-avatar.png')})
        
        timestamp = msg.get('timestamp')
        if isinstance(timestamp, datetime):
            if timestamp.tzinfo is None:
                vietnam_tz = pytz.timezone('Asia/Ho_Chi_Minh')
                timestamp = vietnam_tz.localize(timestamp)
            timestamp_str = timestamp.isoformat()
        else:
            timestamp_str = str(timestamp)

        # 🔥 [FIX LỖI] Tính toán xem user đã mở quà chưa TRƯỚC KHI dùng
        opened_by = msg.get('opened_by', [])
        # Lưu ý: session['user_id'] là string, opened_by trong DB cũng nên lưu string
        is_gift_open = session['user_id'] in opened_by

        # Decrypt message content if encrypted
        msg_content = msg.get('content', '')
        if msg.get('encrypted') or msg.get('message_type') == 'text':
            msg_content = decrypt_message(msg_content)

        message_data = {
            'message_id': str(msg['_id']),
            'conversation_id': conversation_id,
            'sender_id': str(msg['sender_id']),
            'sender_name': sender_info.get('full_name') or sender_info.get('username', 'Unknown'),
            'sender_avatar': sender_info['avatar'],
            'content': msg_content,
            'timestamp': timestamp_str,
            'status': msg.get('status', 'sent'),  
            'read_by': [str(uid) for uid in msg.get('read_by', [])],
            'reply_context': resolve_reply_context(msg, 'private'),
            
            # Giờ thì biến này đã có giá trị
            'gift_style': msg.get('gift_style'),
            'is_gift_open': is_gift_open,
            # 🔥 [MỚI - THÊM DÒNG NÀY] Trả về danh sách cảm xúc
            'reactions': msg.get('reactions', {})
        }

        if 'message_type' in msg:
            message_data['message_type'] = msg['message_type']
        else:
            try:
                content_data = json.loads(msg['content'])
                if isinstance(content_data, dict) and 'type' in content_data:
                    message_data['message_type'] = content_data['type']
            except:
                message_data['message_type'] = 'text'

        message_list.append(message_data)

    return jsonify({
        'conversation_id': conversation_id,
        'messages': message_list,
        'participants': conv['participants'] 
    })


@main.route('/api/conversation/<conversation_id>')
def api_get_conversation(conversation_id):
    """API endpoint để lấy thông tin conversation cho call từ timeline"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        conv_id = ObjectId(conversation_id)
    except:
        return jsonify({'error': 'Invalid conversation ID'}), 400

    conv = conversations_col().find_one({'_id': conv_id})
    if not conv or session['user_id'] not in conv['participants']:
        return jsonify({'error': 'Conversation not found'}), 404
    
    return jsonify({
        'conversation_id': conversation_id,
        'participants': conv['participants']
    })


@main.route('/search_friends', methods=['GET', 'POST'])
def search_friends():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    search_term = request.args.get('q', '')
    if not search_term:
        return jsonify({'results': []})

    query = {
        '$and': [
            {'_id': {'$ne': ObjectId(session['user_id'])}},
            {'$or': [
                {'username': {'$regex': search_term, '$options': 'i'}},
                {'email': {'$regex': search_term, '$options': 'i'}}
            ]}
        ]
    }

    results = list(users_col().find(query, {'password': 0}))

    user_id = session['user_id']
    for user in results:
        user['_id'] = str(user['_id'])
        user['is_friend'] = user_id in user.get('friends', [])

        # Xử lý avatar
        if user.get('avatar'):
            if not user['avatar'].startswith(('http', 'data:image')):
                user['avatar'] = url_for('static', filename=user['avatar'])
        else:
            user['avatar'] = url_for('static', filename='img/default-avatar.png')

    return jsonify({'results': results})


@main.route('/debug_friends_data')
def debug_friends_data():
    """Debug API to check raw friends data"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    user_id = session['user_id']
    user = users_col().find_one({'_id': ObjectId(user_id)})
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    # Get raw friends list from current user
    my_friends_ids = user.get('friends', [])
    
    # Check each friend - verify mutual friendship
    friends_details = []
    for fid in my_friends_ids:
        friend = users_col().find_one({'_id': ObjectId(fid)}, {'username': 1, 'friends': 1, 'avatar': 1})
        if friend:
            friend_data = {
                '_id': str(friend['_id']),
                'username': friend.get('username'),
                'has_me_in_friends': user_id in friend.get('friends', []),
                'their_friends_count': len(friend.get('friends', [])),
                'their_friends': friend.get('friends', [])[:5]  # First 5 for debug
            }
            friends_details.append(friend_data)
    
    # Also check pending friend requests
    pending_requests = list(friend_requests_col().find({
        'recipient_id': ObjectId(user_id),
        'status': 'pending'
    }))
    
    request_details = []
    for req in pending_requests:
        sender = users_col().find_one({'_id': req['sender_id']}, {'username': 1})
        request_details.append({
            'request_id': str(req['_id']),
            'sender_id': str(req['sender_id']),
            'sender_username': sender.get('username') if sender else 'Unknown'
        })
    
    return jsonify({
        'current_user_id': user_id,
        'my_friends_count': len(my_friends_ids),
        'my_friends_ids': my_friends_ids,
        'friends_details': friends_details,
        'pending_requests': request_details
    })

@main.route('/get_friends', methods=['GET'])
def get_friends():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    user_id = session['user_id']
    user = users_col().find_one({'_id': ObjectId(user_id)})
    
    if not user or 'friends' not in user:
        return jsonify({'friends': []})

    friend_ids = [ObjectId(fid) for fid in user['friends']]
    
    # Get all potential friends
    potential_friends = list(users_col().find({'_id': {'$in': friend_ids}}, {'password': 0}))
    
    # Filter: Only return users who also have current user in THEIR friends list
    # This ensures mutual friendship (accepted on both sides)
    friends = []
    for friend in potential_friends:
        friend_id_str = str(friend['_id'])
        # Check if this friend also has current user in their friends list
        friend_doc = users_col().find_one(
            {'_id': friend['_id']},
            {'friends': 1}
        )
        if friend_doc and user_id in friend_doc.get('friends', []):
            friends.append(friend)

    # Thêm trạng thái online và format avatar
    for friend in friends:
        friend['_id'] = str(friend['_id'])
        friend['online'] = online_users.get(friend['_id'], False)

        # ✅ Cập nhật avatar
        if friend.get('avatar'):
            if friend['avatar'].startswith(('http', 'data:image')):
                pass  # Giữ nguyên
            else:
                friend['avatar'] = url_for('static', filename=friend['avatar'])
        else:
            friend['avatar'] = url_for('static', filename='img/default-avatar.png')

    return jsonify({'friends': friends})

@main.route('/logout')
def logout():
    """Logout - xóa session token và clear session với tracking"""
    user_id = session.get('user_id')
    if user_id:
        try:
            # Sử dụng hàm logout_user đã cải tiến
            logout_user(user_id)
            print(f"[Logout] User {user_id} logged out successfully")
        except Exception as e:
            print(f"Error on logout: {str(e)}")
    
    return redirect(url_for('main.login'))


# ==================== SESSION MANAGEMENT API ====================
@main.route('/api/session/check', methods=['GET'])
@require_session_valid
def check_session_status():
    """API kiểm tra trạng thái session hiện tại"""
    user_id = session.get('user_id')
    from app.auth import get_active_sessions
    
    sessions = get_active_sessions(user_id)
    if not sessions:
        return jsonify({'error': 'No session data found'}), 404
    
    current_session = sessions.get('current_session', {})
    return jsonify({
        'valid': True,
        'session_info': {
            'login_time': current_session.get('login_time'),
            'device': current_session.get('device'),
            'ip': current_session.get('ip'),
            'previous_session_forced_out': current_session.get('previous_session_forced_out', False)
        }
    })


@main.route('/api/session/force_logout', methods=['POST'])
@require_session_valid
def force_logout_current_session():
    """API force logout session hiện tại (dùng khi user muốn logout từ tất cả thiết bị)"""
    user_id = session.get('user_id')
    from app.auth import force_logout_user
    
    success = force_logout_user(user_id, "User requested logout from all devices")
    
    if success:
        session.clear()
        return jsonify({
            'success': True,
            'message': 'Đã đăng xuất khỏi tất cả thiết bị'
        })
    
    return jsonify({'error': 'Failed to force logout'}), 500


@main.route('/api/session/history', methods=['GET'])
@require_session_valid
def get_session_history():
    """API lấy lịch sử đăng nhập"""
    user_id = session.get('user_id')
    from app.auth import get_active_sessions
    
    sessions = get_active_sessions(user_id)
    if not sessions:
        return jsonify({'error': 'No session data found'}), 404
    
    return jsonify({
        'login_history': sessions.get('login_history', [])
    })



# sửa
# Thêm template filter vào main Blueprint (tìm trong routes.py)
@main.app_template_filter('format_time')
def format_time_filter(dt):
    if isinstance(dt, str):
        try:
            # Chuyển đổi string sang datetime object
            if 'T' in dt:
                dt = datetime.fromisoformat(dt.replace('Z', '+00:00'))
            else:
                dt = datetime.fromisoformat(dt)
        except:
            return dt

    # Đảm bảo datetime có timezone
    vietnam_tz = pytz.timezone('Asia/Ho_Chi_Minh')
    if dt.tzinfo is None:
        dt = vietnam_tz.localize(dt)
    else:
        dt = dt.astimezone(vietnam_tz)
    
    now = get_vietnam_time()
    delta = now - dt

    if delta < timedelta(minutes=1):
        return "Vừa xong"
    elif delta < timedelta(hours=1):
        minutes = int(delta.total_seconds() // 60)
        return f"{minutes} phút trước"
    elif dt.date() == (now - timedelta(days=1)).date():
        return "Hôm qua"
    elif dt.year == now.year:
        return dt.strftime("%d/%m")
    else:
        return dt.strftime("%d/%m/%Y")

# [THÊM MỚI] Filter an toàn để convert sang ISO format cho data-time
@main.app_template_filter('to_iso_string')
def to_iso_string_filter(dt):
    if isinstance(dt, datetime):
        return dt.isoformat()
    if isinstance(dt, str):
        try:
            # Thử parse string, rồi re-format
            if 'T' in dt:
                return datetime.fromisoformat(dt.replace('Z', '+00:00')).isoformat()
            return datetime.fromisoformat(dt).isoformat()
        except:
            return dt # Trả về string cũ nếu không parse được
    return "" # Trả về rỗng cho None hoặc type khác


# [THÊM MỚI] Filter an toàn để convert sang ISO format cho data-time
@main.app_template_filter('to_iso_string')
def to_iso_string_filter(dt):
    if isinstance(dt, datetime):
        return dt.isoformat()
    if isinstance(dt, str):
        try:
            # Thử parse string, rồi re-format
            if 'T' in dt:
                return datetime.fromisoformat(dt.replace('Z', '+00:00')).isoformat()
            return datetime.fromisoformat(dt).isoformat()
        except:
            return dt # Trả về string cũ nếu không parse được
    return "" # Trả về rỗng cho None hoặc type khác

@main.route('/update_profile', methods=['POST'])
def update_profile():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        data = request.get_json()
        user_id = ObjectId(session['user_id'])

        update_data = {
            'full_name': data.get('full_name'),
            'username': data.get('username'),
            'email': data.get('email'),
            'phone': data.get('phone'),
            'date_of_birth': data.get('dob'),
            'gender': data.get('gender'),
            # Thêm các trường mở rộng
            'bio': data.get('bio'),
            'workplace': data.get('workplace'),
            'location': data.get('location'),
            'interests': data.get('interests'),
            'education': data.get('education')
        }

        # Loại bỏ các trường None để không ghi đè dữ liệu hiện có
        update_data = {k: v for k, v in update_data.items() if v is not None}

        # KHÔNG xử lý avatar ở đây - dùng endpoint /upload_avatar riêng
        # Avatar sẽ được upload qua /upload_avatar endpoint

        result = users_col().update_one(
            {'_id': user_id},
            {'$set': update_data}
        )

        # Cập nhật session
        if data.get('username'):
            session['username'] = data.get('username')
        
        return jsonify({
            'success': True,
            'message': 'Profile updated successfully',
            'modified_count': result.modified_count
        })
    except Exception as e:
        print(f"[Update Profile Error]: {str(e)}")
        return jsonify({'error': f'Failed to update profile: {str(e)}'}), 500

@main.route('/upload_avatar', methods=['POST'])
def upload_avatar():
    """Upload avatar image to Cloudinary"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    if 'avatar' not in request.files:
        return jsonify({'error': 'No avatar file'}), 400

    file = request.files['avatar']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400

    user_id = ObjectId(session['user_id'])

    try:
        # Use Cloudinary upload for avatar
        from app.media_upload import upload_avatar as upload_avatar_cloudinary
        
        upload_result = upload_avatar_cloudinary(file)
        
        if upload_result['success']:
            avatar_url = upload_result['url']
            
            # Update user's avatar in database
            users_col().update_one(
                {'_id': user_id},
                {'$set': {
                    'avatar': avatar_url,
                    'avatar_updated_at': datetime.utcnow()
                }}
            )
            
            print(f"✅ Avatar uploaded to Cloudinary: {avatar_url}")
            
            return jsonify({
                'success': True,
                'avatar_url': avatar_url,
                'message': 'Avatar uploaded successfully'
            })
        else:
            # Fallback to base64 if Cloudinary fails
            print(f"⚠️ Cloudinary avatar upload failed: {upload_result.get('error')}")
            return jsonify({
                'success': False,
                'error': 'Failed to upload avatar to Cloudinary'
            }), 500
            
    except Exception as e:
        print(f"Avatar upload error: {str(e)}")
        return jsonify({'error': f'Error uploading avatar: {str(e)}'}), 500

@main.route('/get_profile')
def get_profile():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    user_id = ObjectId(session['user_id'])
    user = users_col().find_one({'_id': user_id}, {'password': 0})
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
        
    # Chuyển ObjectId thành string
    user['_id'] = str(user['_id'])
    return jsonify(user)


@main.route('/user_mini_profile/<user_id>')
def user_mini_profile(user_id):
    """API trả thông tin gọn để hiển thị mini profile theo user_id."""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        target_id = ObjectId(user_id)
    except Exception as e:
        return jsonify({'error': 'Invalid user ID', 'detail': str(e)}), 400

    user = users_col().find_one({'_id': target_id}, {'password': 0})
    if not user:
        return jsonify({'error': 'User not found'}), 404

    # Chuẩn hóa avatar giống filter get_avatar_url
    avatar_raw = user.get('avatar')
    if not avatar_raw:
        avatar_url = url_for('static', filename='img/default-avatar.png')
    elif isinstance(avatar_raw, str) and (avatar_raw.startswith('http') or avatar_raw.startswith('data:image')):
        avatar_url = avatar_raw
    else:
        avatar_url = url_for('static', filename=avatar_raw)

    # Get cover photo
    # 10/12/2025 - Get cover photo for mini profile
    cover_photo_url = user.get('cover_photo', '')

    # Tính số bạn chung và nhóm chung với người đang đăng nhập
    current_user_id = ObjectId(session['user_id'])
    mutual_friends_count = 0
    mutual_groups_count = 0

    # 10/12/2025 - Xử lý custom status có thời hạn 24h cho mini profile
    status_text = (user.get('status', '') or '').strip()
    custom_status = ''
    if status_text:
        status_updated_at = user.get('status_updated_at')
        expired = False
        if status_updated_at:
            try:
                now = get_vietnam_time()
                # Hỗ trợ cả datetime có timezone và không có timezone
                if getattr(status_updated_at, 'tzinfo', None) is not None:
                    delta = now - status_updated_at
                else:
                    delta = now.replace(tzinfo=None) - status_updated_at
                if delta.total_seconds() >= 24 * 3600:
                    expired = True
            except Exception as e:
                print(f"Error checking status expiration: {e}")
        if expired:
            try:
                # 10/12/2025 - Xoá luôn reaction khi status hết hạn
                users_col().update_one(
                    {'_id': target_id},
                    {
                        '$set': {'status': ''},
                        '$unset': {'status_updated_at': "", 'status_reactions': ""}
                    }
                )
            except Exception as e:
                print(f"Error clearing expired status: {e}")
            custom_status = ''
        else:
            custom_status = status_text

    # 10/12/2025 - Tổng hợp reaction cho cảm nghĩ
    reactions = user.get('status_reactions', []) or []
    total_reactions = len(reactions) if custom_status else 0
    reacted_by_me = False
    if custom_status and reactions:
        reacted_by_me = any(
            str(r.get('user_id')) == str(current_user_id)
for r in reactions
        )

    # Bạn chung: những người mà cả 2 đã kết bạn
    my_friends_list = users_col().find_one({'_id': current_user_id}, {'friends': 1})
    my_friends = set(my_friends_list.get('friends', [])) if my_friends_list else set()

    target_friends_list = users_col().find_one({'_id': target_id}, {'friends': 1})
    target_friends = set(target_friends_list.get('friends', [])) if target_friends_list else set()

    mutual_friends_ids = my_friends.intersection(target_friends)
    mutual_friends_count = len(mutual_friends_ids)

    # Nhóm chung: những nhóm mà cả 2 đều là thành viên
    my_groups = set(str(g['group_id']) for g in group_members_col().find({'user_id': current_user_id}))
    target_groups = set(str(g['group_id']) for g in group_members_col().find({'user_id': target_id}))
    mutual_groups_count = len(my_groups.intersection(target_groups))

    # Lấy mẫu 2-3 bạn chung để hiển thị avatar
    mutual_friends_sample = []
    if mutual_friends_count > 0:
        sample_ids = [ObjectId(uid) for uid in list(mutual_friends_ids)[:3]]
        sample_users = list(users_col().find(
            {'_id': {'$in': sample_ids}},
            {'username': 1, 'avatar': 1}
        ))
        for u in sample_users:
            avatar_raw = u.get('avatar')
            if not avatar_raw:
                avatar = url_for('static', filename='img/default-avatar.png')
            elif isinstance(avatar_raw, str) and (avatar_raw.startswith('http') or avatar_raw.startswith('data:image')):
                avatar = avatar_raw
            else:
                avatar = url_for('static', filename=avatar_raw)
            mutual_friends_sample.append({
                'user_id': str(u['_id']),
                'username': u.get('username', ''),
                'avatar': avatar
            })

    # Kiểm tra trạng thái bạn bè
    friend_status = 'none'
    if str(current_user_id) == user_id:
        friend_status = 'self'
    elif user_id in my_friends:
        friend_status = 'accepted'
    else:
        # Check for pending friend requests
        request_sent = friend_requests_col().find_one({
            'sender_id': current_user_id,
            'recipient_id': target_id,
            'status': 'pending'
        })
        if request_sent:
            friend_status = 'sent'
        else:
            request_received = friend_requests_col().find_one({
                'sender_id': target_id,
                'recipient_id': current_user_id,
                'status': 'pending'
            })
            if request_received:
                friend_status = 'received'

    response = {
        'user_id': str(user['_id']),
        'username': user.get('username', ''),
        'full_name': user.get('full_name', ''),
        'email': user.get('email', ''),
        'phone': user.get('phone', ''),
        'avatar': avatar_url,
        'cover_photo': cover_photo_url,
        'custom_status': custom_status,
'status_reaction_total': total_reactions,
        'status_reaction_by_me': reacted_by_me,
        'mutual_friends_count': mutual_friends_count,
        'mutual_groups_count': mutual_groups_count,
        'mutual_friends_sample': mutual_friends_sample,
        'friend_status': friend_status
    }

    return jsonify(response)


# 🔥 [NEW] API lấy trạng thái online của user
@main.route('/user_status/<user_id>')
def get_user_status(user_id):
    """API trả về trạng thái online và last_active của user"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        target_id = ObjectId(user_id)
    except Exception as e:
        return jsonify({'error': 'Invalid user ID'}), 400
    
    try:
        user = users_col().find_one(
            {'_id': target_id}, 
            {'online': 1, 'last_active': 1}
        )
        
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        is_online = user.get('online', False)
        last_active = user.get('last_active')
        
        # Format last_active nếu có
        last_active_str = None
        if last_active:
            try:
                if hasattr(last_active, 'isoformat'):
                    last_active_str = last_active.isoformat()
                else:
                    last_active_str = str(last_active)
            except:
                pass
        
        return jsonify({
            'success': True,
            'user_id': user_id,
            'online': is_online,
            'last_active': last_active_str
        })
        
    except Exception as e:
        print(f"[User Status] Error: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500


# Thêm hàm này trong main.py
@main.app_template_filter('get_avatar_url')
def get_avatar_url(avatar_path):
    if not avatar_path:
        return url_for('static', filename='img/default-avatar.png')
    
    # Nếu là URL đầy đủ
    if avatar_path.startswith('http'):
        return avatar_path
    
    # Nếu là base64 (dữ liệu ảnh trực tiếp)
    if avatar_path.startswith('data:image'):
        return avatar_path
    
    # Nếu là đường dẫn tương đối
    return url_for('static', filename=avatar_path)

# Tạo nhóm mới
@main.route('/create_group', methods=['POST'])
def create_group():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.get_json()
    group_name = data.get('name')
    member_ids = data.get('members', [])  # Danh sách user_id (dạng string)

    if not group_name:
        return jsonify({'error': 'Group name is required'}), 400

    try:
        user_id = session['user_id']
        # Chuyển đổi member_ids thành ObjectId
        member_ids = [ObjectId(mid) for mid in member_ids]
        
        # Tạo nhóm
        group_data = {
            'name': group_name,
            'created_by': ObjectId(user_id),
            'last_message': None,
            'last_message_time': None,
            'created_at': get_vietnam_time(),
            'avatar': data.get('avatar', '')
        }
        group_id = groups_col().insert_one(group_data).inserted_id

        socketio.emit('group_created', {
        '_id': str(group_id),
        'name': group_name,
        'created_by': user_id
        }, room=user_id)

        # Thêm thành viên vào nhóm (bao gồm người tạo)
        members = [ObjectId(user_id)] + member_ids
        for member_id in members:
            group_members_col().insert_one({
                'group_id': group_id,
                'user_id': member_id,
                'joined_at': datetime.utcnow(),
                'role': 'admin' if member_id == ObjectId(user_id) else 'member',
                'is_creator': True
            })

        return jsonify({
        'message': 'Group created successfully',
        'group_id': str(group_id)
    })

    except Exception as e:
        print(f"Error creating group: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500
    
# Lấy thông tin nhóm
@main.route('/group/<group_id>', methods=['GET'])
def get_group(group_id):
    try:
        group_oid = ObjectId(group_id)
    except:
        return jsonify({'error': 'Invalid group ID'}), 400

    group = groups_col().find_one({'_id': group_oid})
    if not group:
        return jsonify({'error': 'Group not found'}), 404

    # Lấy danh sách thành viên
    members = list(group_members_col().find({'group_id': group_oid}))
    member_ids = [str(m['user_id']) for m in members]
    
    # Lấy thông tin chi tiết thành viên
    users = list(users_col().find(
        {'_id': {'$in': [ObjectId(mid) for mid in member_ids]}},
        {'username': 1, 'avatar': 1}
    ))
    
    # Định dạng kết quả
    group['_id'] = str(group['_id'])
    group['created_by'] = str(group['created_by'])
    
    return jsonify({
        'group': group,
        'members': [{
            'user_id': str(u['_id']),
            'username': u['username'],
            'avatar': u.get('avatar') or url_for('static', filename='img/default-avatar.png')
        } for u in users]
    })

# Thêm thành viên vào nhóm
@main.route('/group/<group_id>/add_member', methods=['POST'])
def add_group_member(group_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.get_json()
    user_id_to_add = data.get('user_id')
    if not user_id_to_add:
        return jsonify({'error': 'User ID is required'}), 400

    try:
        group_oid = ObjectId(group_id)
        user_oid_to_add = ObjectId(user_id_to_add)
    except:
        return jsonify({'error': 'Invalid ID'}), 400

    # Kiểm tra quyền: chỉ admin mới có thể thêm thành viên
    current_user_oid = ObjectId(session['user_id'])
    member = group_members_col().find_one({
        'group_id': group_oid,
        'user_id': current_user_oid,
        'role': 'admin'
    })
    
    if not member:
        return jsonify({'error': 'Permission denied'}), 403

    # Kiểm tra xem user đã trong nhóm chưa
    existing_member = group_members_col().find_one({
        'group_id': group_oid,
        'user_id': user_oid_to_add
    })
    
    if existing_member:
        return jsonify({'error': 'User already in group'}), 400

    # Thêm thành viên
    group_members_col().insert_one({
        'group_id': group_oid,
        'user_id': user_oid_to_add,
        'joined_at': datetime.utcnow(),
        'role': 'member'
    })

    return jsonify({'message': 'Member added successfully'})

# Xóa thành viên khỏi nhóm
@main.route('/group/<group_id>/remove_member', methods=['POST'])
def remove_group_member(group_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.get_json()
    user_id_to_remove = data.get('user_id')
    if not user_id_to_remove:
        return jsonify({'error': 'User ID is required'}), 400

    try:
        group_oid = ObjectId(group_id)
        user_oid_to_remove = ObjectId(user_id_to_remove)
    except:
        return jsonify({'error': 'Invalid ID'}), 400

    # Kiểm tra quyền: admin hoặc tự xóa chính mình
    current_user_oid = ObjectId(session['user_id'])
    
    if user_oid_to_remove != current_user_oid:
        # Nếu không phải tự xóa mình, cần quyền admin
        admin = group_members_col().find_one({
            'group_id': group_oid,
            'user_id': current_user_oid,
            'role': 'admin'
        })
        if not admin:
            return jsonify({'error': 'Permission denied'}), 403

    # Xóa thành viên
    result = group_members_col().delete_one({
        'group_id': group_oid,
        'user_id': user_oid_to_remove
    })

    if result.deleted_count == 0:
        return jsonify({'error': 'Member not found'}), 404

    # Kiểm tra nếu nhóm hết thành viên thì xóa nhóm
    remaining_members = group_members_col().count_documents({'group_id': group_oid})
    if remaining_members == 0:
        groups_col().delete_one({'_id': group_oid})

    return jsonify({'message': 'Member removed successfully'})

# Cập nhật thông tin nhóm
@main.route('/group/<group_id>/update', methods=['POST'])
def update_group(group_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        group_oid = ObjectId(group_id)
    except:
        return jsonify({'error': 'Invalid group ID'}), 400

    data = request.get_json()
    new_name = data.get('name')
    new_avatar = data.get('avatar')

    if not new_name and not new_avatar:
        return jsonify({'error': 'No data to update'}), 400

    # Kiểm tra quyền: chỉ admin mới có thể cập nhật
    current_user_oid = ObjectId(session['user_id'])
# Sửa phần kiểm tra quyền trong handle_update_group_avatar
    admin = group_members_col().find_one({
        'group_id': group_oid,
        'user_id': current_user_oid,
        '$or': [
            {'role': 'admin'},
            {'is_creator': True}  # Cho phép người tạo nhóm
        ]
    })

    if not admin:
        return jsonify({'error': 'Permission denied'}), 403

    # Tạo dữ liệu cập nhật
    update_data = {}
    if new_name:
        update_data['name'] = new_name
    if new_avatar:
        update_data['avatar'] = new_avatar

    # Cập nhật nhóm
    groups_col().update_one(
        {'_id': group_oid},
        {'$set': update_data}
    )

    return jsonify({'message': 'Group updated successfully'})


@main.route('/user_groups', methods=['GET'])
def get_user_groups():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        user_oid = ObjectId(session['user_id'])
        
        # 13/12/2025 - Lấy tất cả nhóm mà user tham gia và KHÔNG bị ẩn (hidden)
        user_groups = list(group_members_col().find({
            'user_id': user_oid,
            'hidden': {'$ne': True}
        }))
        group_ids = [g['group_id'] for g in user_groups]
        # print(f"[DEBUG] User {session['user_id']} group_ids: {group_ids}")
        
        # Lấy thông tin chi tiết các nhóm
        groups = list(groups_col().find({'_id': {'$in': group_ids}}))
        # print(f"[DEBUG] Found groups: {len(groups)}")
        
        # Định dạng kết quả
        result = []
        current_user_id = session['user_id']

        for group in groups:
            # Lấy số lượng thành viên
            member_count = group_members_col().count_documents({'group_id': group['_id']})

            # Lấy thông tin last_message và unread cho user hiện tại (nếu có)
            last_message = group.get('last_message') or ''
            last_message_time = group.get('last_message_time')
            last_message_time = format_timestamp_for_client(last_message_time)

            # 15/12/2025 - Chuẩn hóa created_at sang string để tránh lỗi JSON không serialize được datetime
            created_at = group.get('created_at')
            created_at_str = format_timestamp_for_client(created_at) if created_at else None

            unread_counts = group.get('unread_counts', {}) or {}
            unread_count = unread_counts.get(current_user_id, 0)

            last_sender_id = group.get('last_message_user')
            last_sender_id_str = str(last_sender_id) if last_sender_id else ''
            last_sender_name = group.get('last_sender_name', '')

            # 13/12/2025 - Tính trạng thái mute group cho user hiện tại (tương tự hội thoại 1v1)
            mute_map = group.get('mute_until', {}) or {}
            raw_mute_value = mute_map.get(current_user_id)
            is_muted = False
            mute_until = None

            if isinstance(raw_mute_value, datetime):
                try:
                    now_vn = get_vietnam_time()  # datetime có tz Asia/Ho_Chi_Minh
                except Exception:
                    now_vn = datetime.utcnow().replace(tzinfo=pytz.timezone('Asia/Ho_Chi_Minh'))

                # Chuẩn hóa raw_mute_value về datetime có timezone VN để so sánh an toàn
                vn_tz = get_vietnam_timezone()
                if raw_mute_value.tzinfo is None:
                    raw_dt = vn_tz.localize(raw_mute_value)
                else:
                    raw_dt = raw_mute_value.astimezone(vn_tz)

                is_muted = raw_dt > now_vn
                mute_until = raw_dt
            elif isinstance(raw_mute_value, str) and raw_mute_value == 'forever':
                is_muted = True

            result.append({
                '_id': str(group['_id']),
                'name': group.get('name', 'Unnamed Group'),
                'avatar': group.get('avatar', ''),
                'created_by': str(group.get('created_by', '')),
                'created_at': created_at_str,
                'member_count': member_count,
                'last_message': last_message,
                'last_message_time': last_message_time,
                'last_sender_id': last_sender_id_str,
                'last_sender_name': last_sender_name,
                'unread_count': unread_count,
                'is_muted': is_muted,
                'mute_until': mute_until.isoformat() if mute_until else None
            })

        return jsonify({'groups': result})
    
    except Exception as e:
        print(f"Error getting user groups: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Internal server error'}), 500



@main.route('/group_message', methods=['GET'])
def get_group_messages():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    group_id = request.args.get('group_id')
    if not group_id:
        return jsonify({'error': 'Group ID is required'}), 400

    try:
        group_oid = ObjectId(group_id)
        user_oid = ObjectId(session['user_id'])
    except Exception:
        return jsonify({'error': 'Invalid ID'}), 400

    is_member = group_members_col().find_one({'group_id': group_oid, 'user_id': user_oid})
    if not is_member:
        return jsonify({'error': 'Not a member of this group'}), 403

    messages_cursor = group_messages_col().find({
        '$and': [
            {'group_id': group_oid},
            {'$or': [
                {'hidden_for': {'$exists': False}},
                {'hidden_for': {'$nin': [user_oid]}}
            ]}
        ]
    }, sort=[('timestamp', 1)])

    message_list = []
    for msg in messages_cursor:
        # Lấy thông tin sender
        sender_oid = msg.get('sender_id')
        sender = users_col().find_one({'_id': sender_oid}, {'username': 1, 'full_name': 1, 'avatar': 1}) if sender_oid else None
        sender_name = sender.get('full_name') or sender.get('username') if sender else 'Unknown'
        
        avatar = sender.get('avatar') if sender else None
        if avatar and avatar.startswith(('http', 'data:image')):
            sender_avatar = avatar
        elif avatar:
            sender_avatar = url_for('static', filename=avatar)
        else:
            sender_avatar = url_for('static', filename='img/default-avatar.png')
        
        ts = msg.get('timestamp')
        ts_iso = format_timestamp_for_client(ts)
        
        # 🔥 [FIX LỖI] Tính toán xem user đã mở quà chưa
        opened_by = msg.get('opened_by', [])
        is_gift_open = session['user_id'] in opened_by

        # Decrypt message content if encrypted
        msg_content = msg.get('content', '')
        if msg.get('encrypted') or msg.get('message_type') == 'text':
            msg_content = decrypt_message(msg_content)

        message_data = {
            'group_id': str(msg.get('group_id', group_id)),
            'message_id': str(msg.get('_id')),
            'sender_id': str(msg.get('sender_id')),
            'sender_name': sender_name,
            'content': msg_content,
            'sender_avatar': sender_avatar,
            'timestamp': ts_iso,
            'reply_context': resolve_reply_context(msg, 'group'),
            
            # Giờ biến này đã được định nghĩa
            'gift_style': msg.get('gift_style'),
            'is_gift_open': is_gift_open,
            # 🔥 [MỚI - THÊM DÒNG NÀY] Trả về danh sách cảm xúc
            'reactions': msg.get('reactions', {})
        }
        
        if 'message_type' in msg:
            message_data['message_type'] = msg['message_type']
        else:
            try:
                content_data = json.loads(msg.get('content', ''))
                if isinstance(content_data, dict) and 'type' in content_data:
                    message_data['message_type'] = content_data['type']
            except:
                sticker_codes = ['sticker1', 'sticker2', 'sticker3', 'sticker4', 'sticker5', 'sticker6']
                if msg.get('content') in sticker_codes:
                    message_data['message_type'] = 'sticker'
                else:
                    message_data['message_type'] = 'text'

        message_list.append(message_data)

    return jsonify({'messages': message_list})

@main.route('/get_or_create_conversation/<friend_id>')
def get_or_create_conversation(friend_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    user_id = session['user_id']
    
    # Tìm hội thoại đã tồn tại giữa hai người
    conversation = conversations_col().find_one({
        'participants': {
            '$all': [str(user_id), friend_id],
            '$size': 2
        }
    })

    # 13/12/2025 - Nếu hội thoại tồn tại nhưng trước đó user đã xóa, thì bỏ cờ deleted_for để hiện lại
    user_id_str = str(user_id)
    if conversation:
        if 'deleted_for' in conversation and user_id_str in conversation.get('deleted_for', []):
            conversations_col().update_one(
                {'_id': conversation['_id']},
                {'$pull': {'deleted_for': user_id_str}}
            )

        return jsonify({
            'conversation_id': str(conversation['_id'])
        })
    
    # Tạo hội thoại mới
    new_conv = {
        'participants': [str(user_id), friend_id],
        'created_at': datetime.utcnow(),
        'last_message': None,
        'last_message_time': None
    }
    conv_id = conversations_col().insert_one(new_conv).inserted_id
    
    return jsonify({
        'conversation_id': str(conv_id)
    })


@main.route('/conversation_info_with_preview/<conversation_id>')
def get_conversation_info_with_preview(conversation_id):
    """Endpoint mới trả về thông tin hội thoại với preview đã xử lý"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        conv_id = ObjectId(conversation_id)  # Đảm bảo convert sang ObjectId
    except:
        return jsonify({'error': 'Invalid ID'}), 400

    user_id = session['user_id']

    conv = conversations_col().find_one({'_id': conv_id})
    if not conv or user_id not in conv['participants']:
        return jsonify({'error': 'Conversation not found'}), 404

    # 13/12/2025 - Lấy trạng thái mute & theme cho user hiện tại trong endpoint preview
    mute_map = conv.get('mute_until', {}) or {}
    raw_mute_value = mute_map.get(user_id)
    is_muted = False
    mute_until = None

    if isinstance(raw_mute_value, datetime):
        try:
            now_vn = get_vietnam_time()
        except Exception:
            now_vn = datetime.utcnow()
        is_muted = raw_mute_value > now_vn
        mute_until = raw_mute_value
    elif isinstance(raw_mute_value, str) and raw_mute_value == 'forever':
        is_muted = True

    themes_map = conv.get('themes', {}) or {}
    theme_for_user = themes_map.get(user_id, 'default')

    # Lấy thông tin người chat cùng
    friend_id = next((pid for pid in conv['participants'] if pid != user_id), None)
    friend = users_col().find_one({'_id': ObjectId(friend_id)}) if friend_id else None

    # QUAN TRỌNG: Sửa query last_message - dùng ObjectId
    last_message = messages_col().find_one(
        {'conversation_id': conv_id},  # SỬA: dùng ObjectId
        sort=[('timestamp', -1)]
    )

    # Tạo preview từ server-side
    last_message_content = last_message['content'] if last_message else 'Bắt đầu trò chuyện'
    last_message_type = last_message.get('message_type', 'text') if last_message else 'text'
    last_message_preview = get_message_preview(last_message_content, last_message_type)

    # QUAN TRỌNG: Đảm bảo last_message_sender không bao giờ là None
    if last_message:
        last_message_sender = str(last_message['sender_id']) if last_message.get('sender_id') else ''
    else:
        last_message_sender = ''

    # Đếm số tin chưa đọc - SỬA: dùng ObjectId
    unread_count = messages_col().count_documents({
        'conversation_id': conv_id,  # SỬA: dùng ObjectId
        'sender_id': {'$ne': user_id},
        'read_by': {'$nin': [user_id]}
    })

    return jsonify({
        'friend_id': friend_id,
        'friend_name': friend.get('full_name') or friend.get('username') if friend else 'Unknown',
        'friend_avatar': friend.get('avatar', url_for('static', filename='img/default-avatar.png')),
        'last_message': last_message_content,
        'last_message_preview': last_message_preview,
        'last_message_type': last_message_type,
        'last_message_sender': last_message_sender,
        'last_message_time': last_message['timestamp'] if last_message else conv['created_at'],
        'unread_count': unread_count,
        'is_muted': is_muted,
        'mute_until': mute_until.isoformat() if mute_until else None,
        'theme': theme_for_user
    })



@main.route('/conversation_info/<conversation_id>')
def get_conversation_info(conversation_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        conv_id = ObjectId(conversation_id)
    except:
        return jsonify({'error': 'Invalid ID'}), 400

    conv = conversations_col().find_one({'_id': conv_id})
    if not conv or session['user_id'] not in conv['participants']:
        return jsonify({'error': 'Conversation not found'}), 404

    # Lấy thông tin người chat cùng
    friend_id = next((pid for pid in conv['participants'] if pid != session['user_id']), None)
    friend = users_col().find_one({'_id': ObjectId(friend_id)}) if friend_id else None

    # Lấy tin nhắn cuối
    last_message = messages_col().find_one(
        {'conversation_id': conversation_id},
        sort=[('timestamp', -1)]
    )

    return jsonify({
        'friend_id': friend_id,
        'friend_name': friend.get('full_name') or friend.get('username') if friend else 'Unknown',
        'friend_avatar': friend.get('avatar', url_for('static', filename='img/default-avatar.png')),
        'last_message': last_message['content'] if last_message else None,
        'last_message_time': last_message['timestamp'] if last_message else conv['created_at']
    })

@main.route('/group_info/<group_id>', methods=['GET'])
def get_group_info(group_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        group_oid = ObjectId(group_id)
    except:
        return jsonify({'error': 'Invalid group ID'}), 400

    group = groups_col().find_one({'_id': group_oid})
    if not group:
        return jsonify({'error': 'Group not found'}), 404

    # Kiểm tra người dùng có phải thành viên nhóm không
    is_member = group_members_col().find_one({
        'group_id': group_oid,
        'user_id': ObjectId(session['user_id'])
    })
    if not is_member:
        return jsonify({'error': 'Not a member of this group'}), 403

    # Lấy danh sách tất cả thành viên của nhóm
    members = list(group_members_col().find({'group_id': group_oid}))
    member_ids = [member['user_id'] for member in members]

    # Lấy thông tin user tương ứng
    users = list(users_col().find(
        {'_id': {'$in': member_ids}},
        {'username': 1, 'avatar': 1, 'online': 1}
    ))

    # Lấy vai trò của người dùng hiện tại
    current_user_role = None
    for member in members:
        if str(member['user_id']) == session['user_id']:
            current_user_role = member.get('role', 'member')
            break

    # 13/12/2025 - Lấy theme nhóm cho user hiện tại (màu hoặc ảnh nền)
    themes_map = group.get('themes', {}) or {}
    user_theme_raw = themes_map.get(session['user_id'])
    if isinstance(user_theme_raw, dict):
        theme_payload = {
            'type': user_theme_raw.get('type', 'color'),
            'name': user_theme_raw.get('name'),
            'image_url': user_theme_raw.get('image_url'),
            'thumbnail_url': user_theme_raw.get('thumbnail_url')
        }
    else:
        theme_payload = {
            'type': 'color',
            'name': 'default'
        }

    # Gộp dữ liệu trả về
    result = {
        '_id': str(group['_id']),
        'name': group.get('name', 'Unnamed Group'),
        'created_by': str(group.get('created_by', '')),
        'created_at': group.get('created_at', datetime.utcnow()).isoformat(),
        'avatar': group.get('avatar', ''),
        'current_user_role': current_user_role,
        'members': [],
        'theme': theme_payload
    }

    for u in users:
        avatar = u.get('avatar')
        if not avatar or not avatar.startswith(('http', 'data:image')):
            avatar = url_for('static', filename=avatar or 'img/default-avatar.png')

        result['members'].append({
            '_id': str(u['_id']),
            'username': u['username'],
            'avatar': avatar,
            'is_creator': str(u['_id']) == str(group.get('created_by'))
        })

    return jsonify(result)

@main.route('/leave_group/<group_id>', methods=['POST'])
def leave_group(group_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        group_oid = ObjectId(group_id)
        user_oid = ObjectId(session['user_id'])
    except:
        return jsonify({'error': 'Invalid ID'}), 400

    # Xóa thành viên
    result = group_members_col().delete_one({
        'group_id': group_oid,
        'user_id': user_oid
    })

    if result.deleted_count == 0:
        return jsonify({'error': 'Member not found'}), 404

    # Kiểm tra nếu nhóm hết thành viên thì xóa nhóm
    remaining_members = group_members_col().count_documents({'group_id': group_oid})
    if remaining_members == 0:
        groups_col().delete_one({'_id': group_oid})

    return jsonify({'message': 'Left group successfully'})

@main.route('/mark_as_read/<conversation_id>', methods=['POST'])
def mark_messages_as_read(conversation_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
        
    user_id = session['user_id']
    
    try:
        # Convert conversation_id to ObjectId
        conv_oid = ObjectId(conversation_id)
    except:
        return jsonify({'error': 'Invalid conversation ID'}), 400
    
    # Update all unread messages in this conversation as read
    result = messages_col().update_many(
        {
            'conversation_id': conv_oid,  # SỬA: dùng ObjectId
            'sender_id': {'$ne': user_id},
            'read_by': {'$nin': [user_id]}
        },
        {'$addToSet': {'read_by': user_id}}
    )
    
    return jsonify({
        'success': True,
        'modified_count': result.modified_count
    })
@main.route('/upload_image', methods=['POST'])
def upload_image():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    if 'image' not in request.files:
        return jsonify({'error': 'No image part'}), 400

    image = request.files['image']
    if image.filename == '':
        return jsonify({'error': 'No selected image'}), 400

    conversation_id = request.form.get('conversation_id')
    conversation_type = request.form.get('conversation_type')

    if not conversation_id or conversation_id == 'null':
        return jsonify({'error': 'No conversation specified'}), 400

    try:
        if isinstance(conversation_id, str) and ObjectId.is_valid(conversation_id):
            conversation_oid = ObjectId(conversation_id)
        else:
            conversation_oid = conversation_id
    except:
        return jsonify({'error': 'Invalid conversation ID'}), 400

    if not conversation_type:
        return jsonify({'error': 'Missing conversation type'}), 400

    user_id = ObjectId(session['user_id'])

    # Check quyền
    if conversation_type == 'private':
        conv = conversations_col().find_one({'_id': conversation_oid})
        if not conv or str(user_id) not in conv['participants']:
            return jsonify({'error': 'Invalid conversation'}), 403
    else:  # group
        is_member = group_members_col().find_one({
            'group_id': conversation_oid,
            'user_id': user_id
        })
        if not is_member:
            return jsonify({'error': 'Not a member of this group'}), 403

    if image and allowed_file(image.filename):
        try:
            # Sử dụng Cloudinary upload cho chat
            from app.media_upload import upload_chat_media
            
            # Determine file type
            filename_lower = image.filename.lower()
            if filename_lower.endswith(('.mp4', '.avi', '.mov', '.mkv', '.webm')):
                file_type = 'video'
            else:
                file_type = 'image'
            
            # Upload to Cloudinary
            upload_result = upload_chat_media(image, file_type)
            
            if upload_result['success']:
                image_url = upload_result['url']
                thumbnail_url = upload_result.get('thumbnail_url', image_url)
                print(f"✅ Chat image uploaded to Cloudinary: {image_url}")
                
                return jsonify({
                    'success': True,
                    'image_url': image_url,
                    'thumbnail_url': thumbnail_url,
                    'image_name': secure_filename(image.filename)
                })
            else:
                # Fallback to local storage
                print(f"⚠️ Cloudinary upload failed, falling back to local")
                raise Exception("Cloudinary upload failed")
                
        except Exception as e:
            print(f"Image upload error: {str(e)}")
            # Fallback to local storage
            filename = f"{uuid.uuid4().hex}_{secure_filename(image.filename)}"
            base_dir = os.path.dirname(os.path.abspath(__file__))
            upload_folder = os.path.join(base_dir, 'static', 'uploads')
            os.makedirs(upload_folder, exist_ok=True)
            
            filepath = os.path.join(upload_folder, filename)
            img = Image.open(image)
            img.save(filepath)
            
            # Create thumbnail
            thumbnail_size = (200, 200)
            thumb_img = img.copy()
            thumb_img.thumbnail(thumbnail_size)
            thumbnail_filename = f"thumb_{filename}"
            thumbnail_path = os.path.join(upload_folder, thumbnail_filename)
            thumb_img.save(thumbnail_path)
            
            image_url = f"/static/uploads/{filename}"
            thumbnail_url = f"/static/uploads/{thumbnail_filename}"
            
            print(f"✅ Chat image saved locally: {image_url}")
            
            return jsonify({
                'success': True,
                'image_url': image_url,
                'thumbnail_url': thumbnail_url,
                'image_name': secure_filename(image.filename)
            })

    return jsonify({'error': 'Image type not allowed'}), 400

@main.route('/upload_file', methods=['POST'])
def upload_file():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400

    conversation_id = request.form.get('conversation_id')
    conversation_type = request.form.get('conversation_type')
    
    if not conversation_id or not conversation_type:
        return jsonify({'error': 'Missing conversation data'}), 400

    # Verify user has access to this conversation
    user_id = ObjectId(session['user_id'])
    if conversation_type == 'private':
        conv = conversations_col().find_one({'_id': ObjectId(conversation_id)})
        if not conv or str(user_id) not in conv['participants']:
            return jsonify({'error': 'Invalid conversation'}), 403
    else:  # group
        is_member = group_members_col().find_one({
            'group_id': ObjectId(conversation_id),
            'user_id': user_id
        })
        if not is_member:
            return jsonify({'error': 'Not a member of this group'}), 403

    if file and allowed_file(file.filename):
        # Xác định loại file chính xác
        filename_lower = file.filename.lower()
        content_type = file.content_type or ''
        
        # Phát hiện voice/audio message
        if filename_lower.endswith('.webm') and ('audio' in content_type or not content_type):
            file_type = 'audio'
        elif filename_lower.endswith(('.mp3', '.wav', '.ogg', '.m4a')):
            file_type = 'audio'
        elif filename_lower.endswith(('.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.m4v', '.3gp')):
            file_type = 'video'
        elif filename_lower.endswith('.pdf'):
            file_type = 'pdf'
        elif filename_lower.endswith(('.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp')):
            file_type = 'image'
        elif filename_lower.endswith(('.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.bz2', '.tbz2')):
            file_type = 'archive'
        else:
            file_type = 'file'
        
        try:
            # Xử lý ZIP archive - phân tích cấu trúc thư mục
            if file_type == 'archive':
                from app.zip_handler import analyze_archive, cleanup_extract_dir
                import tempfile
                
                # Lưu file tạm
                temp_dir = tempfile.mkdtemp()
                archive_path = os.path.join(temp_dir, secure_filename(file.filename))
                file.seek(0)
                file.save(archive_path)
                
                print(f"[ZIP Upload] Saved temp file: {archive_path}, size: {os.path.getsize(archive_path)}")
                
                # Phân tích archive
                extract_dir = os.path.join(temp_dir, 'extracted')
                archive_data = analyze_archive(archive_path, extract_dir)
                
                print(f"[ZIP Upload] Analysis result: success={archive_data.get('success')}, files={archive_data.get('stats', {}).get('total_files', 0)}")
                
                if archive_data['success']:
                    # Lưu archive vào uploads để có thể tải về
                    upload_folder = os.path.join(os.path.dirname(__file__), 'static', 'uploads')
                    os.makedirs(upload_folder, exist_ok=True)
                    
                    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                    archive_filename = f"{timestamp}_{secure_filename(file.filename)}"
                    final_archive_path = os.path.join(upload_folder, archive_filename)
                    
                    # Copy archive vào thư mục uploads
                    shutil.copy2(archive_path, final_archive_path)
                    
                    file_url = f'/static/uploads/{archive_filename}'
                    file_size = os.path.getsize(final_archive_path)
                    
                    # Cleanup temp
                    cleanup_extract_dir(temp_dir)
                    
                    print(f"[ZIP Upload] Success: {file_url}")
                    
                    return jsonify({
                        'success': True,
                        'file_url': file_url,
                        'file_name': file.filename,
                        'file_size': file_size,
                        'file_type': 'archive',
                        'is_archive': True,
                        'archive_data': archive_data
                    })
                else:
                    error_msg = archive_data.get('error', 'Unknown error')
                    print(f"[ZIP Upload] Analysis failed: {error_msg}")
                    cleanup_extract_dir(temp_dir)
                    return jsonify({'error': f'Failed to analyze archive: {error_msg}'}), 400
            
            # Sử dụng Cloudinary cho video và image, local cho các file khác
            from app.media_upload import upload_chat_media
            
            # Reset file pointer về đầu file
            file.seek(0)
            
            # Upload qua Cloudinary cho video và image
            if file_type in ['video', 'image']:
                upload_result = upload_chat_media(file, file_type)
                
                if upload_result['success']:
                    file_url = upload_result['url']
                    file_size = request.content_length or 0
                    
                    print(f"✅ Chat {file_type} uploaded to Cloudinary: {file_url}")
                    
                    return jsonify({
                        'success': True,
                        'file_url': file_url,
                        'file_name': file.filename,
                        'file_size': file_size,
                        'file_type': file.content_type or file_type,
                        'thumbnail_url': upload_result.get('thumbnail_url')
                    })
                else:
                    # Fallback to local storage
                    print(f"⚠️ Cloudinary upload failed, falling back to local")
                    raise Exception("Cloudinary upload failed")
            else:
                # Lưu local cho audio, pdf và các file khác
                filename = secure_filename(file.filename)
                base_dir = os.path.dirname(os.path.abspath(__file__))
                
                # Tạo thư mục con theo loại file
                if file_type == 'audio':
                    subfolder = 'voice'
                elif file_type == 'pdf':
                    subfolder = 'documents'
                else:
                    subfolder = 'files'
                
                upload_folder = os.path.join(base_dir, 'static', 'uploads', subfolder)
                os.makedirs(upload_folder, exist_ok=True)
                
                file_path = os.path.join(upload_folder, filename)
                file.save(file_path)
                file_size = os.path.getsize(file_path)
                
                # URL cho client
                file_url = f"/static/uploads/{subfolder}/{filename}"
                
                print(f"✅ Chat file saved locally: {file_url} (type: {file_type}, size: {file_size} bytes)")
                
                return jsonify({
                    'success': True,
                    'file_url': file_url,
                    'file_name': filename,
                    'file_size': file_size,
                    'file_type': file.content_type or file_type
                })
            
        except Exception as e:
            print(f"❌ File upload error: {str(e)}")
            return jsonify({'error': f'Upload failed: {str(e)}'}), 500
    
    return jsonify({'error': 'File type not allowed'}), 400

@main.route('/static/uploads/<path:filename>')
def serve_uploaded_files(filename):
    """Phục vụ file từ app/static/uploads/ - hỗ trợ subfolder"""
    try:
        # SỬA: Sử dụng đường dẫn tuyệt đối chính xác
        base_dir = os.path.dirname(os.path.abspath(__file__))  # Thư mục app/
        upload_folder = os.path.join(base_dir, 'static', 'uploads')
        
        # filename có thể chứa subfolder (ví dụ: voice/file.webm)
        file_path = os.path.join(upload_folder, filename)
        
        print(f"Serving file: {filename}")
        print(f"From folder: {upload_folder}")
        print(f"Full path: {file_path}")
        print(f"File exists: {os.path.exists(file_path)}")
        
        # Trích xuất thư mục và tên file
        if '/' in filename:
            subfolder, actual_filename = filename.rsplit('/', 1)
            target_folder = os.path.join(upload_folder, subfolder)
        else:
            target_folder = upload_folder
            actual_filename = filename
        
        return send_from_directory(target_folder, actual_filename)
    except Exception as e:
        print(f"Error serving file {filename}: {str(e)}")
        return "File not found", 404
    
@main.route('/app/static/uploads/<path:filename>')
def serve_app_static_files(filename):
    """Phục vụ file từ app/static/uploads/"""
    try:
        # Sử dụng send_from_directory với đường dẫn tương đối
        return send_from_directory('app/static/uploads', filename)
    except FileNotFoundError:
        return "File not found", 404
    
def get_message_preview(message_content, message_type='text'):
    """Hàm server-side để tạo preview message - PHIÊN BẢN ĐƠN GIẢN"""
    print(f"[SERVER PREVIEW] Input - type: {message_type}, content: {message_content}")
    
    # Nếu không có nội dung
    if not message_content:
        return 'Bắt đầu trò chuyện'
    
    # Giải mã nội dung nếu bị mã hóa
    if message_content.startswith('gAAAA'):
        try:
            message_content = decrypt_message(message_content)
            print(f"[SERVER PREVIEW] Decrypted content: {message_content}")
        except Exception as e:
            print(f"[SERVER PREVIEW] Decryption error: {e}")
            # Nếu giải mã thất bại, trả về placeholder
            return '🔒 Tin nhắn được mã hóa'
    
    # Xử lý theo message_type
    if message_type == 'file':
        return '📎 File'
    elif message_type == 'image':
        return '🖼️ Hình ảnh'
    elif message_type == 'sticker':
        return '😊 Sticker'
    else:
        # Text message
        text = str(message_content)
        
        # Nếu là JSON string, thử parse
        if text.strip().startswith('{') and text.strip().endswith('}'):
            try:
                data = json.loads(text)
                if isinstance(data, dict):
                    if data.get('type') == 'file':
                        file_name = data.get('name') or data.get('filename') or 'File'
                        return f'📎 {file_name}'
                    elif data.get('type') == 'image':
                        image_name = data.get('name') or data.get('filename') or 'Hình ảnh'
                        return f'🖼️ {image_name}'
            except (ValueError, TypeError):
                pass  # Không phải JSON hợp lệ, xử lý như text bình thường
        
        # Text thông thường
        text = text.replace('\r', ' ').replace('\n', ' ').strip()
        
        if not text:
            return 'Bắt đầu trò chuyện'
        
        # Giới hạn độ dài
        max_length = 35
        if len(text) > max_length:
            return text[:max_length] + '...'
        return text
    
@main.route('/update_message_status', methods=['POST'])
def update_message_status():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.get_json()
    message_id = data.get('message_id')
    status = data.get('status')  # 'sent', 'delivered', 'read'
    
    if not message_id or not status:
        return jsonify({'error': 'Missing message_id or status'}), 400

    try:
        message_oid = ObjectId(message_id)
        update_data = {'status': status}
        
        # Nếu là trạng thái 'read', thêm vào mảng read_by
        if status == 'read':
            update_data['$addToSet'] = {'read_by': session['user_id']}
        
        messages_col().update_one(
            {'_id': message_oid},
            {'$set': update_data}
        )
        
        return jsonify({'success': True})
    except Exception as e:
        print(f"Error updating message status: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

# Thêm trường status vào tin nhắn khi gửi
def create_message_data(conversation_id, sender_id, content, message_type='text'):
    return {
        'conversation_id': ObjectId(conversation_id),
        'sender_id': str(sender_id),
        'content': content,
        'message_type': message_type,
        'timestamp': get_vietnam_time(),
        'status': 'sent',  # Trạng thái mặc định
        'read_by': []  # Danh sách người đã đọc
    }

@main.route('/pin_message', methods=['POST'])
def pin_message():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    data = request.get_json()
    message_id = data.get('message_id')
    conversation_id = data.get('conversation_id')
    conversation_type = data.get('conversation_type', 'private')
    
    if not all([message_id, conversation_id, conversation_type]):
        return jsonify({'error': 'Missing parameters'}), 400
    
    try:
        user_id = ObjectId(session['user_id'])
        message_oid = ObjectId(message_id)
        conv_oid = ObjectId(conversation_id)

        if conversation_type == 'private':
            # Check quyền: 2 người trong cuộc chat
            conv = conversations_col().find_one({'_id': conv_oid})
            if not conv or str(user_id) not in conv['participants']:
                return jsonify({'error': 'No permission'}), 403

            # Đảm bảo tin nhắn thuộc conversation này
            message = messages_col().find_one({
                '_id': message_oid,
                'conversation_id': conv_oid
            })
            if not message:
                return jsonify({'error': 'Message not found'}), 404

            # Bỏ ghim cũ & ghim mới
            conversations_col().update_one(
                {'_id': conv_oid},
                {'$set': {'pinned_message': message_oid}}
            )

        else:
            # GROUP: bất kỳ thành viên nào cũng có thể ghim
            member = group_members_col().find_one({
                'group_id': conv_oid,
                'user_id': user_id
            })
            if not member:
                return jsonify({'error': 'Not a member'}), 403

            # Đảm bảo tin nhắn thuộc group này
            message = group_messages_col().find_one({
                '_id': message_oid,
                'group_id': conv_oid
            })
            if not message:
                return jsonify({'error': 'Message not found'}), 404

            # Bỏ ghim cũ & ghim mới
            groups_col().update_one(
                {'_id': conv_oid},
                {'$set': {'pinned_message': message_oid}}
            )
        
        return jsonify({'success': True, 'message': 'Message pinned successfully'})
        
    except Exception as e:
        print(f"Error pinning message: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500


@main.route('/unpin_message', methods=['POST'])
def unpin_message():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    data = request.get_json()
    conversation_id = data.get('conversation_id')
    conversation_type = data.get('conversation_type', 'private')
    
    if not all([conversation_id, conversation_type]):
        return jsonify({'error': 'Missing parameters'}), 400
    
    try:
        user_id = ObjectId(session['user_id'])
        conv_oid = ObjectId(conversation_id)
        
        if conversation_type == 'private':
            # Private: 2 người đều có thể bỏ ghim
            conv = conversations_col().find_one({'_id': conv_oid})
            if not conv or str(user_id) not in conv['participants']:
                return jsonify({'error': 'No permission'}), 403
            
            result = conversations_col().update_one(
                {'_id': conv_oid},
                {'$set': {'pinned_message': None}}
            )
        else:
            # GROUP: bất kỳ thành viên nào cũng có thể bỏ ghim
            member = group_members_col().find_one({
                'group_id': conv_oid,
                'user_id': user_id
            })
            if not member:
                return jsonify({'error': 'No permission to unpin'}), 403
            
            result = groups_col().update_one(
                {'_id': conv_oid},
                {'$set': {'pinned_message': None}}
            )
        
        if result.modified_count > 0:
            return jsonify({'success': True, 'message': 'Message unpinned successfully'})
        else:
            return jsonify({'success': False, 'error': 'No pinned message found'})
        
    except Exception as e:
        print(f"Error unpinning message: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500


@main.route('/edit_message', methods=['POST'])
def edit_message():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    data = request.get_json()
    message_id = data.get('message_id')
    new_content = data.get('new_content')
    conversation_type = data.get('conversation_type', 'private')
    
    if not all([message_id, new_content]):
        return jsonify({'error': 'Missing parameters'}), 400
    
    try:
        user_id = ObjectId(session['user_id'])
        message_oid = ObjectId(message_id)
        
        # Chọn collection theo loại hội thoại
        if conversation_type == 'private':
            messages_coll = messages_col()
        else:
            messages_coll = group_messages_col()
        
        # Tìm tin nhắn
        message = messages_coll.find_one({'_id': message_oid})
        if not message:
            return jsonify({'error': 'Message not found'}), 404
            
        # Chỉ người gửi mới được sửa
        if str(message.get('sender_id')) != str(user_id):
            return jsonify({'error': 'No permission to edit'}), 403
        
        # Cập nhật tin nhắn
        messages_coll.update_one(
            {'_id': message_oid},
            {
                '$set': {
                    'content': new_content,
                    'edited': True,
                    'edited_at': get_vietnam_time()
                }
            }
        )
        
        return jsonify({'success': True, 'message': 'Message edited successfully'})
        
    except Exception as e:
        print(f"Error editing message: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

    
@main.route('/delete_message', methods=['POST'])
def delete_message():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    data = request.get_json()
    message_id = data.get('message_id')
    conversation_type = data.get('conversation_type', 'private')
    
    if not message_id:
        return jsonify({'error': 'Missing message_id'}), 400
    
    try:
        user_id = ObjectId(session['user_id'])
        message_oid = ObjectId(message_id)
        
        # Chọn collection dựa trên conversation_type
        if conversation_type == 'private':
            messages_coll = messages_col()
        else:
            messages_coll = group_messages_col()
            
        # Tìm tin nhắn
        message = messages_coll.find_one({'_id': message_oid})
        if not message:
            return jsonify({'error': 'Message not found'}), 404
            
        # Kiểm tra quyền: người gửi hoặc admin (trong group)
        can_delete = False
        if str(message.get('sender_id')) == str(user_id):
            can_delete = True
        elif conversation_type == 'group':
            # Kiểm tra nếu là admin group
            member = group_members_col().find_one({
                'group_id': message.get('group_id'),
                'user_id': user_id,
                'role': 'admin'
            })
            if member:
                can_delete = True
        
        if not can_delete:
            return jsonify({'error': 'No permission to delete'}), 403
        
        # Xóa tin nhắn (soft delete)
        update_data = {
            'deleted': True,
            'deleted_at': get_vietnam_time(),
            'content': 'Tin nhắn đã được thu hồi'
        }
        
        # Thêm deleted_by để theo dõi ai đã xóa
        if conversation_type == 'group' and str(message.get('sender_id')) != str(user_id):
            update_data['deleted_by'] = user_id
        
        update_result = messages_coll.update_one(
            {'_id': message_oid},
            {'$set': update_data}
        )
        
        if update_result.modified_count > 0:
            return jsonify({
                'success': True, 
                'message': 'Message deleted successfully',
                'conversation_id': str(message.get('conversation_id') if conversation_type == 'private' else message.get('group_id'))
            })
        else:
            return jsonify({'success': False, 'error': 'Message deletion failed'})
        
    except Exception as e:
        print(f"Error deleting message: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500


@main.route('/delete_message_for_me', methods=['POST'])
def delete_message_for_me():
    """Xóa tin nhắn chỉ ở phía người dùng hiện tại (hide from my view only)"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    data = request.get_json()
    message_id = data.get('message_id')
    conversation_type = data.get('conversation_type', 'private')
    
    if not message_id:
        return jsonify({'error': 'Missing message_id'}), 400
    
    try:
        user_id = ObjectId(session['user_id'])
        message_oid = ObjectId(message_id)
        
        # Chọn collection dựa trên conversation_type
        if conversation_type == 'private':
            messages_coll = messages_col()
        else:
            messages_coll = group_messages_col()
            
        # Tìm tin nhắn
        message = messages_coll.find_one({'_id': message_oid})
        if not message:
            return jsonify({'error': 'Message not found'}), 404
        
        # Thêm user_id vào danh sách hidden_for (chỉ ẩn ở phía người dùng này)
        update_result = messages_coll.update_one(
            {'_id': message_oid},
            {'$addToSet': {'hidden_for': user_id}}
        )
        
        if update_result.modified_count > 0 or update_result.matched_count > 0:
            return jsonify({
                'success': True, 
                'message': 'Message hidden from your view'
            })
        else:
            return jsonify({'success': False, 'error': 'Failed to hide message'})
        
    except Exception as e:
        print(f"Error hiding message for me: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500


@main.route('/get_message/<message_id>')
def get_message(message_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    conversation_type = request.args.get('type', 'private')
    
    try:
        user_id = ObjectId(session['user_id'])
        message_oid = ObjectId(message_id)
        
        # Chọn collection dựa trên conversation_type
        if conversation_type == 'private':
            messages_coll = messages_col()
        else:
            messages_coll = group_messages_col()
            
        message = messages_coll.find_one({'_id': message_oid})
        if not message:
            return jsonify({'error': 'Message not found'}), 404
        
        # Kiểm tra quyền truy cập
        if conversation_type == 'private':
            conv = conversations_col().find_one({'_id': message.get('conversation_id')})
            if not conv or str(user_id) not in conv['participants']:
                return jsonify({'error': 'No access to this message'}), 403
        else:
            # Kiểm tra membership trong group
            is_member = group_members_col().find_one({
                'group_id': message.get('group_id'),
                'user_id': user_id
            })
            if not is_member:
                return jsonify({'error': 'Not a member of this group'}), 403
        
        # Lấy thông tin người gửi
        sender = users_col().find_one({'_id': ObjectId(message['sender_id'])}, {'username': 1, 'avatar': 1})
        sender_name = sender.get('username', 'Unknown') if sender else 'Unknown'
        
        # Xử lý avatar
        avatar = sender.get('avatar') if sender else None
        if avatar and not avatar.startswith(('http', 'data:image')):
            avatar = url_for('static', filename=avatar)
        sender_avatar = avatar or url_for('static', filename='img/default-avatar.png')
        
        return jsonify({
            'success': True,
            'message': {
                'message_id': str(message['_id']),
                'sender_id': str(message['sender_id']),
                'sender_name': sender_name,
                'sender_avatar': sender_avatar,
                'content': message['content'],
                'message_type': message.get('message_type', 'text'),
                'timestamp': message['timestamp'].isoformat() if hasattr(message['timestamp'], 'isoformat') else str(message['timestamp']),
                'conversation_id': str(message.get('conversation_id') if conversation_type == 'private' else message.get('group_id')),
                'conversation_type': conversation_type,
                # [MỚI] Thêm dòng này
                'reply_context': resolve_reply_context(message, conversation_type),
                # 🔥 [QUAN TRỌNG] Trả về gift_style
                'gift_style': message.get('gift_style')

            }
        })
        
    except Exception as e:
        print(f"Error getting message: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

@main.route('/get_pinned_message/<conversation_id>')
def get_pinned_message(conversation_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    conversation_type = request.args.get('type', 'private')
    
    try:
        conv_oid = ObjectId(conversation_id)
        user_id = ObjectId(session['user_id'])
        
        # Kiểm tra quyền truy cập
        if conversation_type == 'private':
            conv = conversations_col().find_one({'_id': conv_oid})
            if not conv or str(user_id) not in conv['participants']:
                return jsonify({'error': 'No access'}), 403
            
            pinned_message_id = conv.get('pinned_message')
            if not pinned_message_id:
                return jsonify({'pinned_message': None})
                
            message = messages_col().find_one({'_id': pinned_message_id})
        else:
            # Kiểm tra membership
            is_member = group_members_col().find_one({
                'group_id': conv_oid,
                'user_id': user_id
            })
            if not is_member:
                return jsonify({'error': 'Not a member'}), 403
            
            group = groups_col().find_one({'_id': conv_oid})
            pinned_message_id = group.get('pinned_message')
            if not pinned_message_id:
                return jsonify({'pinned_message': None})
                
            message = group_messages_col().find_one({'_id': pinned_message_id})
        
        if not message:
            return jsonify({'pinned_message': None})
        
        # Lấy thông tin người gửi
        sender = users_col().find_one({'_id': ObjectId(message['sender_id'])}, {'username': 1, 'full_name': 1, 'avatar': 1})
        sender_name = sender.get('full_name') or sender.get('username', 'Unknown') if sender else 'Unknown'
        
        # Xử lý avatar
        avatar = sender.get('avatar') if sender else None
        if avatar and not avatar.startswith(('http', 'data:image')):
            avatar = url_for('static', filename=avatar)
        sender_avatar = avatar or url_for('static', filename='img/default-avatar.png')
        
        return jsonify({
            'pinned_message': {
                'message_id': str(message['_id']),
                'sender_id': str(message['sender_id']),
                'sender_name': sender_name,
                'sender_avatar': sender_avatar,
                'content': message['content'],
                'message_type': message.get('message_type', 'text'),
                'timestamp': message['timestamp'].isoformat() if hasattr(message['timestamp'], 'isoformat') else str(message['timestamp']),
                # 🔥 [QUAN TRỌNG] Trả về gift_style cho tin nhắn ghim
                'gift_style': message.get('gift_style')
            }
        })
        
    except Exception as e:
        print(f"Error getting pinned message: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

# --- THÊM VÀO CUỐI FILE app/routes.py ---

@main.route('/call')
def call_view():
    if 'user_id' not in session:
        return redirect(url_for('main.login'))
    return render_template('call.html')


@main.route('/update_cover_photo', methods=['POST'])
def update_cover_photo():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    if 'cover_photo' not in request.files:
        return jsonify({'error': 'No cover photo file'}), 400

    file = request.files['cover_photo']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400

    try:
        # Use Cloudinary upload for cover photo
        from app.media_upload import upload_media
        
        upload_result = upload_media(file, "image")
        
        if upload_result['success']:
            cover_photo_url = upload_result['url']
            
            # Update user's cover photo in database
            user_id = ObjectId(session['user_id'])
            users_col().update_one(
                {'_id': user_id},
                {'$set': {'cover_photo': cover_photo_url}}
            )
            
            print(f"✅ Cover photo uploaded to Cloudinary: {cover_photo_url}")
            
            return jsonify({
                'success': True,
                'cover_photo_url': cover_photo_url
            })
        else:
            # Fallback to local storage
            print(f"⚠️ Cloudinary cover photo upload failed, falling back to local")
            raise Exception("Cloudinary upload failed")
            
    except Exception as e:
        print(f"Cover photo upload error: {str(e)}")
        # Fallback to local storage
        filename = secure_filename(file.filename)
        filename = f"{uuid.uuid4().hex}_{filename}"
        upload_folder = 'app/static/uploads/covers'
        os.makedirs(upload_folder, exist_ok=True)

        filepath = os.path.join(upload_folder, filename)

        try:
            img = Image.open(file)
            img.save(filepath)

            cover_photo_url = f"/static/uploads/covers/{filename}"

            user_id = ObjectId(session['user_id'])
            users_col().update_one(
                {'_id': user_id},
                {'$set': {'cover_photo': cover_photo_url}}
            )

            print(f"✅ Cover photo saved locally: {cover_photo_url}")

            return jsonify({
                'success': True,
                'cover_photo_url': cover_photo_url
            })
        except Exception as local_error:
            print(f"Local cover photo save error: {str(local_error)}")
            return jsonify({'error': f'Error processing cover photo: {str(local_error)}'}), 500

    return jsonify({'error': 'File type not allowed'}), 400

@main.route('/api/health')
def health_check():
    """Health check endpoint for connection monitoring"""
    try:
        # Test database connection
        db_status = 'connected'
        try:
            # Simple database ping
            users_col().find_one({'_id': ObjectId('000000000000000000000000')})
        except:
            db_status = 'disconnected'
        
        return jsonify({
            'status': 'healthy',
            'timestamp': get_vietnam_time().isoformat(),
            'database': db_status
        }), 200
    except Exception as e:
        return jsonify({
            'status': 'unhealthy',
            'timestamp': get_vietnam_time().isoformat(),
            'error': str(e)
        }), 500

@main.route('/create_post', methods=['POST'])
def create_post():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        data = request.get_json()
        print(f"[DEBUG] Create post received data: {data}")
        
        content = data.get('content', '')
        media_urls = data.get('media_urls', [])
        privacy = data.get('privacy', 'public')  # Add privacy field with default 'public'
        tagged_friends = data.get('tagged_friends', [])  # Add tagged friends
        
        print(f"[DEBUG] Tagged friends received: {tagged_friends}")
        print(f"[DEBUG] Tagged friends type: {type(tagged_friends)}")
        print(f"[DEBUG] Tagged friends length: {len(tagged_friends) if tagged_friends else 0}")

        if not content and not media_urls:
            return jsonify({'error': 'Nội dung hoặc media là bắt buộc'}), 400

        # Validate media URLs
        valid_media_urls = []
        for media in media_urls:
            if isinstance(media, dict) and media.get('url') and media.get('type') in ['image', 'video']:
                valid_media_urls.append(media)

        # Process tagged friends
        tagged_info = []
        valid_tagged_friend_ids = []
        if tagged_friends:
            # Get current user's friends list for validation
            current_user = users_col().find_one({'_id': ObjectId(session['user_id'])})
            friend_ids = current_user.get('friends', []) if current_user else []
            
            for friend in tagged_friends:
                friend_id = friend.get('id')
                if friend_id and friend_id in friend_ids:
                    # Get friend info for storage
                    friend_data = users_col().find_one({'_id': ObjectId(friend_id)})
                    if friend_data:
                        tagged_info.append({
                            'id': friend_id,
                            'username': friend_data.get('username', ''),
                            'display_name': friend.get('display_name') or friend_data.get('full_name') or friend_data.get('username', ''),
                            'avatar': friend_data.get('avatar', '/static/img/default-avatar.png')
                        })
                        valid_tagged_friend_ids.append(friend_id)

        # Handle privacy restrictions for tagged friends
        if privacy == 'private' and tagged_info:
            # For private posts, warn user that tagged friends won't see the post
            print(f"[DEBUG] Private post with tagged friends: {[f['display_name'] for f in tagged_info]}")
            # Still save tagged friends but they won't have access
            # Could add a warning to user here if needed
        
        # Send notifications to tagged friends (only if they can potentially see the post)
        if valid_tagged_friend_ids and privacy != 'private':
            # Only send notifications for non-private posts
            try:
                for friend_id in valid_tagged_friend_ids:
                    notification_data = {
                        'recipient_id': ObjectId(friend_id),
                        'sender_id': ObjectId(session['user_id']),
                        'type': 'tagged_in_post',
                        'message': f"{current_user.get('full_name') or current_user.get('username')} đã gắn thẻ bạn trong một bài viết",
                        'post_id': None,  # Will be set after post creation
                        'created_at': get_vietnam_time(),
                        'read': False
                    }
                    # Store notification temporarily, will update with post_id after creation
                    notifications_col().insert_one(notification_data)
                print(f"[DEBUG] Sent notifications to {len(valid_tagged_friend_ids)} tagged friends")
            except Exception as e:
                print(f"[DEBUG] Error sending tagged friend notifications: {e}")
        elif valid_tagged_friend_ids and privacy == 'private':
            print(f"[DEBUG] Skipped notifications for private post with {len(valid_tagged_friend_ids)} tagged friends")

        post_data = {
            'user_id': session['user_id'],
            'content': content,
            'media_urls': valid_media_urls,
            'privacy': privacy,  # Add privacy to post data
            'created_at': get_vietnam_time(),
            'likes': [],
            'comments': [],
            'shares': 0
        }
        
        # Add tagged friends if any
        if tagged_info:
            post_data['tagged_friends'] = tagged_info
            print(f"[DEBUG] Tagged info to save: {tagged_info}")
            print(f"[DEBUG] Final post data: {post_data}")

        post_id = posts_col().insert_one(post_data).inserted_id
        print(f"[DEBUG] Post created with ID: {post_id}")
        
        # Update notifications with post_id
        if valid_tagged_friend_ids and privacy != 'private':
            try:
                notifications_col().update_many(
                    {
                        'recipient_id': {'$in': [ObjectId(fid) for fid in valid_tagged_friend_ids]},
                        'sender_id': ObjectId(session['user_id']),
                        'type': 'tagged_in_post',
                        'post_id': None
                    },
                    {'$set': {'post_id': str(post_id)}}
                )
                print(f"[DEBUG] Updated notifications with post_id: {post_id}")
            except Exception as e:
                print(f"[DEBUG] Error updating notifications with post_id: {e}")

        return jsonify({
            'success': True,
            'post_id': str(post_id),
            'message': 'Đăng bài thành công'
        })

    except Exception as e:
        print(f"Error creating post: {str(e)}")
        return jsonify({'error': 'Lỗi khi đăng bài'}), 500
    
@main.route('/upload_post_media', methods=['POST'])
def upload_post_media():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    if 'media' not in request.files:
        return jsonify({'error': 'No media file'}), 400

    files = request.files.getlist('media')
    
    # Import media upload utilities (supports Cloudinary)
    from app.media_upload import process_media_files
    
    # Process all files using the new utility (supports Cloudinary)
    upload_dir = os.path.join(os.path.dirname(__file__), 'static', 'uploads', 'posts')
    media_urls = process_media_files(files, upload_dir=upload_dir)

    return jsonify({
        'success': True,
        'media_urls': media_urls
    })

@main.route('/like_post', methods=['POST'])
def like_post():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        data = request.get_json()
        post_id = data.get('post_id')

        # Kiểm tra post_id
        if not post_id:
            return jsonify({'error': 'Thiếu ID bài viết'}), 400

        try:
            post_oid = ObjectId(post_id)
        except:
            return jsonify({'error': 'ID bài viết không hợp lệ'}), 400

        # Tìm bài viết
        post = posts_col().find_one({'_id': post_oid})
        if not post:
            return jsonify({'error': 'Bài viết không tồn tại'}), 404

        user_id = session['user_id']
        likes = post.get('likes', [])

        if user_id in likes:
            # Bỏ like
            posts_col().update_one(
                {'_id': post_oid},
                {'$pull': {'likes': user_id}}
            )
            liked = False
            message = "Đã bỏ thích bài viết"
        else:
            # Thêm like
            posts_col().update_one(
                {'_id': post_oid},
                {'$addToSet': {'likes': user_id}}
            )
            liked = True
            message = "Đã thích bài viết"
            
            # TẠO THÔNG BÁO KHI LIKE (chỉ khi like mới và không phải chính mình)
            if liked and post.get('user_id') and str(post['user_id']) != user_id:
                try:
                    # Lấy thông tin người like
                    liker = users_col().find_one({'_id': ObjectId(user_id)})
                    liker_name = liker.get('full_name') or liker.get('username', 'Unknown')
                    liker_avatar = liker.get('avatar', '/static/img/default-avatar.png')
                    
                    # Tạo notification
                    notification = {
                        'recipient_id': ObjectId(post['user_id']),
                        'sender_id': ObjectId(user_id),
                        'sender_name': liker_name,
                        'sender_avatar': liker_avatar,
                        'type': 'like',
                        'data': {
                            'post_id': str(post_oid),
                            'post_preview': post.get('content', '')[:100] + ('...' if len(post.get('content', '')) > 100 else '')
                        },
                        'read': False,
                        'created_at': get_vietnam_time()
                    }
                    
                    result = notifications_col().insert_one(notification)
                    notification['_id'] = str(result.inserted_id)
                    
                    # Gửi real-time notification qua socket
                    notification_data = {
                        'id': notification['_id'],
                        'type': 'like',
                        'sender_name': liker_name,
                        'sender_avatar': liker_avatar,
                        'data': notification['data'],
                        'read': False,
                        'created_at': notification['created_at'].isoformat()
                    }
                    
                    socketio.emit('new_notification', notification_data, room=str(post['user_id']))
                    print(f"[DEBUG] Like notification created for user {post['user_id']}")
                    
                except Exception as notif_error:
                    print(f"Error creating like notification: {str(notif_error)}")

        # Lấy số like mới
        updated_post = posts_col().find_one({'_id': post_oid})
        like_count = len(updated_post.get('likes', []))

        return jsonify({
            'success': True,
            'liked': liked,
            'like_count': like_count,
            'message': message
        })

    except Exception as e:
        print(f"Error liking post: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Lỗi khi like bài viết: {str(e)}'}), 500

# 16/12
@main.route('/comment_post', methods=['POST'])
def comment_post():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        data = request.get_json()
        post_id = data.get('post_id')
        content = data.get('content')
        reply_to = data.get('reply_to')  # ID comment/reply được trả lời
        reply_type = data.get('reply_type', 'comment')

        if not content or not post_id:
            return jsonify({
                'error': 'Nội dung bình luận và ID bài viết không được để trống'
            }), 400

        if not ObjectId.is_valid(post_id):
            return jsonify({'error': 'ID bài viết không hợp lệ'}), 400

        # Lấy bài viết
        post = posts_col().find_one({'_id': ObjectId(post_id)})
        if not post:
            return jsonify({'error': 'Bài viết không tồn tại'}), 404

        # Lấy user
        user = users_col().find_one({'_id': ObjectId(session['user_id'])})
        if not user:
            return jsonify({'error': 'Người dùng không tồn tại'}), 404

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
            'user_id': session['user_id'],
            'username': user.get('full_name') or user.get('username', 'Unknown'),
            'full_name': user.get('full_name', user.get('username', 'Unknown')),
            'user_avatar': user_avatar,
            'content': content,
            'created_at': get_vietnam_time(),
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

                posts_col().update_one(
                    {
                        '_id': ObjectId(post_id),
                        'comments.id': parent_comment_id
                    },
                    {
                        '$push': {'comments.$.replies': comment_data},
                        '$inc': {'comment_count': 1}
                    }
                )

                # ==================== TẠO THÔNG BÁO CHO REPLY ====================
                # Tạo thông báo cho người được trả lời
                replied_user_id = None
                if reply_to and reply_to_username != user.get('username'):
                    try:
                        # Tìm user được trả lời
                        replied_user = users_col().find_one({'username': reply_to_username})
                        if replied_user:
                            replied_user_id = str(replied_user['_id'])
                            notification_data = {
                                'recipient_id': ObjectId(replied_user['_id']),
                                'sender_id': ObjectId(session['user_id']),
                                'sender_name': user.get('full_name') or user.get('username') or 'Người dùng',
                                'type': 'comment_reply',
                                'content': 'đã trả lời bình luận của bạn',
                                'data': {
                                    'post_id': post_id,
                                    'comment_id': parent_comment_id,
                                    'reply_id': comment_id,
                                    'post_preview': post.get('content', '')[:50] + '...' if post.get('content') else 'Bài viết',
                                    'comment_preview': content[:50] + '...' if len(content) > 50 else content
                                },
                                'read': False,
                                'created_at': get_vietnam_time()
                            }
                            
                            # Lưu notification vào database
                            notifications_col().insert_one(notification_data)
                            
                            # Gửi socket event real-time
                            socketio.emit('new_notification', notification_data, room=str(replied_user['_id']))
                            
                    except Exception as notif_error:
                        print(f"Error creating reply notification: {str(notif_error)}")

                # Tạo thông báo cho chủ bài viết (nếu khác người trả lời và người được trả lời)
                if post.get('user_id') != session['user_id'] and post.get('user_id') != replied_user_id:
                    try:
                        notification_data = {
                            'recipient_id': ObjectId(post['user_id']),
                            'sender_id': ObjectId(session['user_id']),
                            'sender_name': user.get('full_name') or user.get('username') or 'Người dùng',
                            'type': 'comment',
                            'content': 'đã bình luận về bài viết của bạn',
                            'data': {
                                'post_id': post_id,
                                'comment_id': comment_id,
                                'post_preview': post.get('content', '')[:50] + '...' if post.get('content') else 'Bài viết',
                                'comment_preview': content[:50] + '...' if len(content) > 50 else content
                            },
                            'read': False,
                            'created_at': get_vietnam_time()
                        }
                        
                        # Lưu notification vào database
                        notifications_col().insert_one(notification_data)
                        
                        # Gửi socket event real-time
                        socketio.emit('new_notification', notification_data, room=str(post['user_id']))
                        
                    except Exception as notif_error:
                        print(f"Error creating comment notification for post owner: {str(notif_error)}")

                # ==================== XỬ LÝ MENTION TRONG REPLY ====================
                # Tìm các @username trong nội dung reply
                mentioned_usernames = re.findall(r'@(\w+)', content)
                
                for mentioned_username in mentioned_usernames:
                    # Bỏ qua nếu tự mention chính mình
                    if mentioned_username == user.get('username'):
                        continue
                        
                    try:
                        # Tìm user được mention
                        mentioned_user = users_col().find_one({'username': mentioned_username})
                        if mentioned_user:
                            # Bỏ qua nếu đã tạo thông báo cho người được trả lời hoặc chủ bài viết
                            if (str(mentioned_user['_id']) == replied_user_id or 
                                str(mentioned_user['_id']) == str(post['user_id'])):
                                continue
                                
                            mention_notification = {
                                'recipient_id': ObjectId(mentioned_user['_id']),
                                'sender_id': ObjectId(session['user_id']),
                                'sender_name': user.get('full_name') or user.get('username') or 'Người dùng',
                                'type': 'mention',
                                'content': 'đã đề cập đến bạn trong một bình luận',
                                'data': {
                                    'post_id': post_id,
                                    'comment_id': parent_comment_id,
                                    'reply_id': comment_id,
                                    'post_preview': post.get('content', '')[:50] + '...' if post.get('content') else 'Bài viết',
                                    'comment_preview': content[:50] + '...' if len(content) > 50 else content
                                },
                                'read': False,
                                'created_at': get_vietnam_time()
                            }
                            
                            # Lưu notification vào database
                            notifications_col().insert_one(mention_notification)
                            
                            # Gửi socket event real-time
                            socketio.emit('new_notification', mention_notification, room=str(mentioned_user['_id']))
                            
                    except Exception as mention_error:
                        print(f"Error creating mention notification in reply: {str(mention_error)}")

                return jsonify({
                    'success': True,
                    'comment': comment_data,
                    'parent_id': parent_comment_id
                })

        # ==================== COMMENT GỐC ====================
        posts_col().update_one(
            {'_id': ObjectId(post_id)},
            {
                '$push': {'comments': comment_data},
                '$inc': {'comment_count': 1}
            }
        )

        # ==================== TẠO THÔNG BÁO ====================
        # Chỉ tạo thông báo nếu người bình luận không phải là chủ bài viết
        if post.get('user_id') != session['user_id']:
            try:
                notification_data = {
                    'recipient_id': ObjectId(post['user_id']),
                    'sender_id': ObjectId(session['user_id']),
                    'sender_name': user.get('full_name') or user.get('username') or 'Người dùng',
                    'type': 'comment',
                    'content': 'đã bình luận về bài viết của bạn',
                    'data': {
                        'post_id': post_id,
                        'comment_id': comment_id,
                        'post_preview': post.get('content', '')[:50] + '...' if post.get('content') else 'Bài viết',
                        'comment_preview': content[:50] + '...' if len(content) > 50 else content
                    },
                    'read': False,
                    'created_at': get_vietnam_time()
                }
                
                # Lưu notification vào database
                notifications_col().insert_one(notification_data)
                
                # Gửi socket event real-time
                socketio.emit('new_notification', notification_data, room=str(post['user_id']))
                
            except Exception as notif_error:
                print(f"Error creating comment notification: {str(notif_error)}")

        # ==================== XỬ LÝ MENTION ====================
        # Tìm các @username trong nội dung bình luận
        mentioned_usernames = re.findall(r'@(\w+)', content)
        
        for mentioned_username in mentioned_usernames:
            # Bỏ qua nếu tự mention chính mình
            if mentioned_username == user.get('username'):
                continue
                
            try:
                # Tìm user được mention
                mentioned_user = users_col().find_one({'username': mentioned_username})
                if mentioned_user:
                    # Bỏ qua nếu đã tạo thông báo cho chủ bài viết (trùng người)
                    if str(mentioned_user['_id']) == str(post['user_id']):
                        continue
                        
                    mention_notification = {
                        'recipient_id': ObjectId(mentioned_user['_id']),
                        'sender_id': ObjectId(session['user_id']),
                        'sender_name': user.get('full_name') or user.get('username') or 'Người dùng',
                        'type': 'mention',
                        'content': 'đã đề cập đến bạn trong một bình luận',
                        'data': {
                            'post_id': post_id,
                            'comment_id': comment_id,
                            'post_preview': post.get('content', '')[:50] + '...' if post.get('content') else 'Bài viết',
                            'comment_preview': content[:50] + '...' if len(content) > 50 else content
                        },
                        'read': False,
                        'created_at': get_vietnam_time()
                    }
                    
                    # Lưu notification vào database
                    notifications_col().insert_one(mention_notification)
                    
                    # Gửi socket event real-time
                    socketio.emit('new_notification', mention_notification, room=str(mentioned_user['_id']))
                    
            except Exception as mention_error:
                print(f"Error creating mention notification: {str(mention_error)}")

        return jsonify({'success': True, 'comment': comment_data})

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@main.route('/profile/<username>')
def user_profile(username):
    if 'user_id' not in session:
        return redirect(url_for('main.login'))

    try:
        # Kiểm tra nếu username là ObjectId (24 ký tự hex)
        if len(username) == 24 and all(c in '0123456789abcdefABCDEF' for c in username):
            # Nếu là ObjectId, chuyển hướng đến profile_by_id
            return redirect(url_for('main.profile_by_id', user_id=username))
        
        # ================= LẤY THÔNG TIN USER =================
        user = users_col().find_one(
            {'username': username},
            {'password': 0}
        )
        if not user:
            return "Người dùng không tồn tại", 404

        # Sử dụng helper function để render profile
        return render_profile_page(user)

    except Exception as e:
        print(f"Error loading profile: {str(e)}")
        import traceback
        traceback.print_exc()
        return "Lỗi khi tải trang cá nhân", 500


@main.route('/edit_post', methods=['POST'])
def edit_post():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        data = request.get_json()
        post_id = data.get('post_id')
        content = data.get('content')

        if not post_id or not content:
            return jsonify({'error': 'Thiếu thông tin bài viết'}), 400

        # Kiểm tra quyền sở hữu
        post = posts_col().find_one({'_id': ObjectId(post_id)})
        if not post:
            return jsonify({'error': 'Bài viết không tồn tại'}), 404

        if post['user_id'] != session['user_id']:
            return jsonify({'error': 'Không có quyền sửa bài viết này'}), 403

        # Cập nhật bài viết
        posts_col().update_one(
            {'_id': ObjectId(post_id)},
            {
                '$set': {
                    'content': content,
                    'updated_at': get_vietnam_time(),
                    'edited': True
                }
            }
        )

        return jsonify({
            'success': True,
            'message': 'Cập nhật bài viết thành công'
        })

    except Exception as e:
        print(f"Error editing post: {str(e)}")
        return jsonify({'error': 'Lỗi khi cập nhật bài viết'}), 500


@main.route('/delete_post', methods=['POST'])
def delete_post():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        data = request.get_json()
        post_id = data.get('post_id')

        if not post_id:
            return jsonify({'error': 'Thiếu ID bài viết'}), 400

        # Kiểm tra quyền sở hữu
        post = posts_col().find_one({'_id': ObjectId(post_id)})
        if not post:
            return jsonify({'error': 'Bài viết không tồn tại'}), 404

        if post['user_id'] != session['user_id']:
            return jsonify({'error': 'Không có quyền xóa bài viết này'}), 403

        # Xóa bài viết
        posts_col().delete_one({'_id': ObjectId(post_id)})

        return jsonify({
            'success': True,
            'message': 'Xóa bài viết thành công'
        })

    except Exception as e:
        print(f"Error deleting post: {str(e)}")
        return jsonify({'error': 'Lỗi khi xóa bài viết'}), 500

@main.route('/api/posts/<post_id>/hide', methods=['POST'])
def hide_post(post_id):
    """Ẩn bài viết khỏi timeline của người dùng"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        user_id = session['user_id']
        
        # Kiểm tra bài viết tồn tại
        post = posts_col().find_one({'_id': ObjectId(post_id)})
        if not post:
            return jsonify({'error': 'Bài viết không tồn tại'}), 404

        # Không thể ẩn bài viết của chính mình
        if post.get('user_id') == user_id:
            return jsonify({'error': 'Không thể ẩn bài viết của chính mình'}), 400

        # Thêm vào danh sách bài viết đã ẩn của user
        users_col().update_one(
            {'_id': ObjectId(user_id)},
            {'$addToSet': {'hidden_posts': post_id}},
            upsert=False
        )

        return jsonify({
            'success': True,
            'message': 'Đã ẩn bài đăng'
        })

    except Exception as e:
        print(f"Error hiding post: {str(e)}")
        return jsonify({'error': 'Lỗi khi ẩn bài đăng'}), 500


@main.route('/get_post/<post_id>')
def get_post(post_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        post = posts_col().find_one({'_id': ObjectId(post_id)})
        if not post:
            return jsonify({'error': 'Bài viết không tồn tại'}), 404

        # Kiểm tra quyền xem
        if post['user_id'] != session['user_id']:
            return jsonify({'error': 'Không có quyền xem bài viết này'}), 403

        post['_id'] = str(post['_id'])
        return jsonify({
            'success': True,
            'post': post
        })

    except Exception as e:
        print(f"Error getting post: {str(e)}")
        return jsonify({'error': 'Lỗi khi lấy thông tin bài viết'}), 500

@main.route('/get_user_friends/<user_id>')
def get_user_friends(user_id):
    """Lấy danh sách bạn bè THẬT SỰ của người dùng"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        target_user_id = ObjectId(user_id)
        user = users_col().find_one({'_id': target_user_id})
        
        if not user:
            return jsonify({'error': 'User not found'}), 404

        # LẤY DANH SÁCH BẠN BÈ THẬT SỰ - KIỂM TRA KỸ
        friend_ids = user.get('friends', [])
        # print(f"DEBUG: Raw friend_ids for user {user_id}: {friend_ids}")
        
        # Lọc các friend_id hợp lệ và KIỂM TRA TỒN TẠI
        valid_friend_ids = []
        for fid in friend_ids:
            if ObjectId.is_valid(fid):
                # KIỂM TRA NGƯỜI DÙNG CÓ TỒN TẠI KHÔNG
                friend_exists = users_col().find_one({'_id': ObjectId(fid)})
                if friend_exists:
                    valid_friend_ids.append(ObjectId(fid))
                else:
                    # print(f"DEBUG: Friend {fid} not found in database")
                    pass
        
        # print(f"DEBUG: Valid friend_ids: {[str(fid) for fid in valid_friend_ids]}")

        # Lấy thông tin bạn bè
        friends = list(users_col().find(
            {'_id': {'$in': valid_friend_ids}},
            {'username': 1, 'avatar': 1, 'online': 1}
        ))

        # print(f"DEBUG: Found {len(friends)} actual friends")

        # Format dữ liệu bạn bè
        friends_data = []
        for friend in friends:
            avatar = friend.get('avatar')
            # Xử lý avatar URL
            if not avatar:
                avatar = url_for('static', filename='img/default-avatar.png')
            elif avatar.startswith('data:image'):
                # Giữ nguyên base64
                pass
            elif not avatar.startswith(('http', '/static')):
                avatar = url_for('static', filename=avatar)
            
            friends_data.append({
                '_id': str(friend['_id']),
                'username': friend['username'],
                'avatar': avatar,
                'online': friend.get('online', False)
            })

        return jsonify({
            'success': True, 
            'friends': friends_data,
            'total_count': len(friends_data)
        })

    except Exception as e:
        print(f"Error getting user friends: {str(e)}")
        return jsonify({'success': False, 'error': 'Internal server error'}), 500

@main.route('/check_friendship/<target_user_id>')
def check_friendship(target_user_id):
    """Kiểm tra quan hệ bạn bè với người dùng hiện tại"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        current_user = users_col().find_one({'_id': ObjectId(session['user_id'])})
        if not current_user:
            return jsonify({'error': 'Current user not found'}), 404

        is_friend = target_user_id in current_user.get('friends', [])
        
        return jsonify({
            'success': True,
            'is_friend': is_friend,
            'current_user_id': session['user_id'],
            'target_user_id': target_user_id
        })

    except Exception as e:
        print(f"Error checking friendship: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

@main.route('/get_recent_photos/<user_id>')
def get_recent_photos(user_id):
    """Lấy ảnh gần đây từ các bài viết của người dùng"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        target_user_id = ObjectId(user_id)
        
        # Lấy tất cả bài viết của người dùng có media
        posts_with_media = list(posts_col().find({
            'user_id': str(target_user_id),
            'media_urls': {'$exists': True, '$ne': []}
        }, {'media_urls': 1, 'created_at': 1}).sort('created_at', -1).limit(20))

        # Lấy tất cả ảnh từ media_urls (chỉ lấy ảnh, bỏ qua video)
        recent_photos = []
        for post in posts_with_media:
            for media in post.get('media_urls', []):
                # Kiểm tra nếu media là dict (format mới) hoặc string (format cũ)
                if isinstance(media, dict):
                    # Format mới: media là object có type và url
                    if media.get('type') == 'image':
                        recent_photos.append({
                            'url': media['url'],
                            'post_id': str(post['_id']),
                            'created_at': post.get('created_at'),
                            'type': 'image'
                        })
                elif isinstance(media, str):
                    # Format cũ: media là string URL, mặc định là image
                    recent_photos.append({
                        'url': media,
                        'post_id': str(post['_id']),
                        'created_at': post.get('created_at'),
                        'type': 'image'
                    })
                
                # Giới hạn số lượng ảnh hiển thị
                if len(recent_photos) >= 12:  # Hiển thị tối đa 12 ảnh
                    break
            if len(recent_photos) >= 12:
                break

        return jsonify({'success': True, 'photos': recent_photos})  # THÊM 'success': True

    except Exception as e:
        print(f"Error getting recent photos: {str(e)}")
        return jsonify({'success': False, 'error': 'Internal server error'}), 500
    
@main.route('/get_friend_profile/<friend_id>')
def get_friend_profile(friend_id):
    """Lấy thông tin profile của bạn bè bằng ID"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        friend_oid = ObjectId(friend_id)
        friend = users_col().find_one({'_id': friend_oid}, {'password': 0})
        
        if not friend:
            return jsonify({'error': 'Friend not found'}), 404

        # Kiểm tra xem có phải là bạn bè không
        current_user = users_col().find_one({'_id': ObjectId(session['user_id'])})
        if not current_user or friend_id not in current_user.get('friends', []):
            return jsonify({'error': 'Not friends'}), 403

        # Format dữ liệu trả về
        friend_data = {
            '_id': str(friend['_id']),
            'username': friend.get('username'),
            'full_name': friend.get('full_name', ''),
            'avatar': friend.get('avatar', ''),
            'cover_photo': friend.get('cover_photo', ''),
            'email': friend.get('email', ''),
            'phone': friend.get('phone', ''),
            'date_of_birth': friend.get('date_of_birth', ''),
            'gender': friend.get('gender', ''),
            'friends': friend.get('friends', [])
        }

        # Xử lý avatar URL
        if friend_data['avatar'] and not friend_data['avatar'].startswith(('http', 'data:image')):
            friend_data['avatar'] = url_for('static', filename=friend_data['avatar'])
        elif not friend_data['avatar']:
            friend_data['avatar'] = url_for('static', filename='img/default-avatar.png')

        # Xử lý cover photo URL
        if friend_data['cover_photo'] and not friend_data['cover_photo'].startswith(('http', '/static')):
            friend_data['cover_photo'] = url_for('static', filename=friend_data['cover_photo'])

        return jsonify({'success': True, 'friend': friend_data})

    except Exception as e:
        print(f"Error getting friend profile: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

@main.route('/cleanup_friends', methods=['POST'])
def cleanup_friends():
    """Dọn dẹp bạn bè không tồn tại trong database"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        user_id = ObjectId(session['user_id'])
        user = users_col().find_one({'_id': user_id})
        
        if not user:
            return jsonify({'error': 'User not found'}), 404

        friend_ids = user.get('friends', [])
        clean_friend_ids = []
        removed_count = 0

        for fid in friend_ids:
            if ObjectId.is_valid(fid):
                friend_exists = users_col().find_one({'_id': ObjectId(fid)})
                if friend_exists:
                    clean_friend_ids.append(fid)
                else:
                    removed_count += 1
                    print(f"Removed non-existent friend: {fid}")

        # Cập nhật danh sách bạn bè đã làm sạch
        users_col().update_one(
            {'_id': user_id},
            {'$set': {'friends': clean_friend_ids}}
        )

        return jsonify({
            'success': True,
            'message': f'Đã dọn dẹp {removed_count} bạn bè không tồn tại',
            'remaining_friends': len(clean_friend_ids)
        })

    except Exception as e:
        print(f"Error cleaning up friends: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500
    
# =========================================================
# 🔥 [MỚI] API ĐÁNH DẤU ĐÃ MỞ HỘP QUÀ
# =========================================================
@main.route('/mark_gift_opened', methods=['POST'])
def mark_gift_opened():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    data = request.get_json()
    message_id = data.get('message_id')
    conversation_type = data.get('conversation_type', 'private')
    
    if not message_id:
        return jsonify({'error': 'Missing message_id'}), 400
        
    try:
        user_id = ObjectId(session['user_id'])
        msg_oid = ObjectId(message_id)
        
        # Chọn collection
        col = messages_col() if conversation_type == 'private' else group_messages_col()
        
        # Thêm user_id vào mảng opened_by (nếu chưa có)
        col.update_one(
            {'_id': msg_oid},
            {'$addToSet': {'opened_by': str(user_id)}}
        )
        
        return jsonify({'success': True})
        
    except Exception as e:
        print(f"Error marking gift opened: {e}")
        return jsonify({'error': 'Internal error'}), 500
    

# --- TRONG FILE app/routes.py ---

@main.route('/get_message_reactions/<message_id>')
def get_message_reactions(message_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    # Lấy loại hội thoại từ query string (quan trọng!)
    conversation_type = request.args.get('type', 'private')
    
    try:
        msg_oid = ObjectId(message_id)
        
        # 1. Chọn đúng Collection
        if conversation_type == 'group':
            col = group_messages_col() # Hoặc mongo.db.group_messages tùy cách bạn định nghĩa
        else:
            col = messages_col()       # Hoặc mongo.db.messages
        
        # 2. Tìm tin nhắn
        msg = col.find_one({'_id': msg_oid})
        
        # Nếu tin nhắn không tồn tại hoặc chưa có reaction nào
        if not msg or 'reactions' not in msg:
            return jsonify({'success': True, 'reactions': []})
            
        reactions_map = msg['reactions'] # {'uid_str': 'emoji', ...}
        
        # Lọc ra các ID hợp lệ
        user_ids = []
        for uid in reactions_map.keys():
            try:
                user_ids.append(ObjectId(uid))
            except:
                continue
        
        # 3. Lấy thông tin user (Avatar, Tên)
        users = list(users_col().find(
            {'_id': {'$in': user_ids}},
            {'username': 1, 'avatar': 1}
        ))
        
        # Tạo map để tra cứu nhanh
        user_info_map = {str(u['_id']): u for u in users}
        
        results = []
        for uid_str, emoji in reactions_map.items():
            user = user_info_map.get(uid_str)
            if user:
                # Xử lý avatar URL
                avatar = user.get('avatar')
                if avatar and not avatar.startswith(('http', 'data:image')):
                    avatar = url_for('static', filename=avatar)
                elif not avatar:
                    avatar = url_for('static', filename='img/default-avatar.png')
                    
                results.append({
                    'user_id': uid_str,
                    'username': user['username'],
                    'avatar': avatar,
                    'emoji': emoji
                })
            
        return jsonify({'success': True, 'reactions': results})
        
    except Exception as e:
        print(f"Error getting reaction details: {e}")
        return jsonify({'error': 'Internal error'}), 500

from bson import ObjectId
from flask import (
    request, session, jsonify, redirect, url_for, render_template
)

# Giả sử các hàm/biến này đã được định nghĩa ở nơi khác trong app:
# users_col, friend_requests_col, notifications_col,
# conversations_col, messages_col, socketio, get_vietnam_time
# Nếu chưa có thì bạn cần import/khai báo chúng.


@main.route('/send_friend_request', methods=['POST'])
def send_friend_request():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        data = request.get_json()
        target_user_id = data.get('target_user_id')

        if not target_user_id:
            return jsonify({'error': 'Missing target user ID'}), 400

        current_user_id = ObjectId(session['user_id'])
        
        # Check if target user exists
        target_user = users_col().find_one({'_id': ObjectId(target_user_id)})
        if not target_user:
            return jsonify({'error': 'Target user not found'}), 404
        
        # Check if already friends
        current_user = users_col().find_one({'_id': current_user_id})
        if target_user_id in current_user.get('friends', []):
            return jsonify({'error': 'Already friends'}), 400
        
        # Check if friend request already exists
        existing_request = friend_requests_col().find_one({
            'sender_id': current_user_id,
            'recipient_id': ObjectId(target_user_id),
            'status': 'pending'
        })
        
        if existing_request:
            return jsonify({'error': 'Friend request already sent'}), 400
        
        # Create friend request
        friend_request = {
            'sender_id': current_user_id,
            'recipient_id': ObjectId(target_user_id),
            'status': 'pending',
            'created_at': get_vietnam_time()
        }
        
        result = friend_requests_col().insert_one(friend_request)
        
        # Create notification for recipient
        # Get current user info for sender details
        current_user = users_col().find_one({'_id': current_user_id}, {'username': 1, 'full_name': 1, 'avatar': 1})
        sender_name = current_user.get('full_name') or current_user.get('username', 'Unknown') if current_user else session.get('username', 'Unknown')
        sender_avatar = current_user.get('avatar', '') if current_user else ''
        
        # Clean up avatar path
        if sender_avatar and not sender_avatar.startswith(('/', 'http')):
            sender_avatar = f"/static/{sender_avatar}"
        elif not sender_avatar:
            sender_avatar = '/static/img/default-avatar.png'
        
        notification_data = {
            'recipient_id': ObjectId(target_user_id),
            'sender_id': current_user_id,
            'sender_name': sender_name,
            'sender_avatar': sender_avatar,
            'type': 'friend_request',
            'content': 'Đã gửi lời mời kết bạn',
            'created_at': get_vietnam_time(),
            'read': False
        }
        
        notifications_col().insert_one(notification_data)
        
        # Emit socket event to recipient
        socketio.emit(
            'new_friend_request',
            {
                'sender_id': str(current_user_id),
                'sender_username': session['username'],
                'message': 'Đã gửi lời mời kết bạn'
            },
            room=target_user_id
        )
        
        return jsonify({
            'success': True,
            'message': 'Friend request sent successfully',
            'request_id': str(result.inserted_id)
        }), 200

    except Exception as e:
        print(f"Error sending friend request: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500


@main.route('/check_friendship_status/<target_user_id>')
def check_friendship_status(target_user_id):
    """Kiểm tra trạng thái quan hệ bạn bè"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        current_user_id = session['user_id']
        current_user = users_col().find_one({'_id': ObjectId(current_user_id)})

        if not current_user:
            return jsonify({'error': 'Current user not found'}), 404

        is_friend = target_user_id in current_user.get('friends', [])
        
        # Kiểm tra xem đã gửi lời mời chưa
        request_sent = friend_requests_col().find_one({
            'sender_id': ObjectId(current_user_id),
            'recipient_id': ObjectId(target_user_id),
            'status': 'pending'
        })
        
        # Kiểm tra xem có nhận được lời mời không
        request_received = friend_requests_col().find_one({
            'sender_id': ObjectId(target_user_id),
            'recipient_id': ObjectId(current_user_id),
            'status': 'pending'
        })

        # Xác định trạng thái
        status = 'friend' if is_friend else 'sent' if request_sent else 'received' if request_received else 'not_friend'

        return jsonify({
            'success': True,
            'status': status,
            'is_friend': is_friend,
            'request_sent': bool(request_sent),
            'request_received': bool(request_received),
            'current_user_id': current_user_id,
            'target_user_id': target_user_id
        }), 200

    except Exception as e:
        print(f"Error checking friendship status: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500


@main.route('/get_my_profile_url')
def get_my_profile_url():
    """Chuyển hướng đến profile của chính mình"""
    if 'user_id' not in session:
        return redirect(url_for('main.login'))

    user = users_col().find_one({'_id': ObjectId(session['user_id'])})
    if user and user.get('username'):
        return redirect(url_for('main.user_profile', username=user['username']))

    # Fallback: về trang chat
    return redirect(url_for('main.chat'))


# -------------------------------------------------------------------------
@main.route('/cancel_friend_request', methods=['POST'])
def cancel_friend_request():
    """Hủy lời mời kết bạn đã gửi"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        data = request.get_json()
        target_user_id = data.get('target_user_id')

        if not target_user_id:
            return jsonify({'error': 'Missing target user ID'}), 400

        current_user_id = ObjectId(session['user_id'])
        
        # Tìm và xóa lời mời kết bạn
        result = friend_requests_col().delete_one({
            'sender_id': current_user_id,
            'recipient_id': ObjectId(target_user_id),
            'status': 'pending'
        })
        
        if result.deleted_count == 0:
            return jsonify({'error': 'No pending friend request found'}), 404
        
        # Xóa thông báo liên quan
        notifications_col().delete_one({
            'recipient_id': ObjectId(target_user_id),
            'sender_id': current_user_id,
            'type': 'friend_request'
        })
        
        # Emit socket event để cập nhật real-time
        socketio.emit(
            'friend_request_cancelled',
            {
                'sender_id': str(current_user_id),
                'recipient_id': target_user_id
            },
            room=target_user_id
        )
        
        return jsonify({
            'success': True,
            'message': 'Friend request cancelled successfully'
        }), 200

    except Exception as e:
        print(f"Error cancelling friend request: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500


@main.route('/unfriend', methods=['POST'])
def unfriend():
    """Hủy kết bạn với người dùng"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        data = request.get_json()
        friend_id = data.get('friend_id')

        if not friend_id:
            return jsonify({'error': 'Friend ID is required'}), 400

        user_id = session['user_id']

        # Kiểm tra xem có phải là bạn bè không
        user = users_col().find_one({'_id': ObjectId(user_id)})
        if not user or friend_id not in user.get('friends', []):
            return jsonify({'error': 'Not friends with this user'}), 400

        # Xóa khỏi danh sách bạn bè của cả hai bên
        users_col().update_one(
            {'_id': ObjectId(user_id)},
            {'$pull': {'friends': friend_id}}
        )

        users_col().update_one(
            {'_id': ObjectId(friend_id)},
            {'$pull': {'friends': user_id}}
        )

        # TODO: Có thể thêm thông báo socket ở đây

        return jsonify({
            'success': True,
            'message': 'Đã hủy kết bạn thành công'
        }), 200

    except Exception as e:
        print(f"Error unfriending: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500


@main.route('/friend_requests_page')
def friend_requests_page():
    """Trang hiển thị lời mời kết bạn"""
    if 'user_id' not in session:
        return redirect(url_for('main.login'))

    user_id = ObjectId(session['user_id'])
    user = users_col().find_one({'_id': user_id})

    if not user:
        return redirect(url_for('main.login'))

    return render_template(
        'friend_requests.html',
        current_user=user,
        username=session['username']
    )


# app/routes.py (thêm route mới)
@main.route('/friend_requests')
def get_friend_requests():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    user_id = ObjectId(session['user_id'])
    requests = list(friend_requests_col().find({
        'recipient_id': user_id,
        'status': 'pending'
    }))

    results = []
    for req in requests:
        sender = users_col().find_one({'_id': req['sender_id']}, {'password': 0})
        if sender:
            avatar = sender.get('avatar')
            if avatar and not avatar.startswith(('http', 'data:image')):
                avatar = f"/static/{avatar}"

            results.append({
                '_id': str(req['_id']),
                'request_id': str(req['_id']),
                'sender_id': str(sender['_id']),
                'username': sender.get('username'),
                'email': sender.get('email'),
                'avatar': avatar or '/static/img/default-avatar.png',
                'status': req.get('status', 'pending')
            })

    return jsonify({'requests': results}), 200


@main.route('/get_request_sender/<request_id>')
def get_request_sender(request_id):
    """Lấy thông tin người gửi lời mời kết bạn"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        request_oid = ObjectId(request_id)
        friend_request = friend_requests_col().find_one({'_id': request_oid})

        if not friend_request:
            return jsonify({'error': 'Request not found'}), 404

        # Kiểm tra quyền truy cập
        if str(friend_request['recipient_id']) != session['user_id']:
            return jsonify({'error': 'Access denied'}), 403

        sender = users_col().find_one(
            {'_id': friend_request['sender_id']},
            {'password': 0}
        )
        if not sender:
            return jsonify({'error': 'Sender not found'}), 404

        avatar = sender.get('avatar')
        if avatar and not avatar.startswith(('http', 'data:image')):
            avatar = f"/static/{avatar}"

        return jsonify({
            'success': True,
            'sender': {
                '_id': str(sender['_id']),
                'username': sender.get('username'),
                'full_name': sender.get('full_name', ''),
                'avatar': avatar or '/static/img/default-avatar.png',
                'email': sender.get('email', '')
            }
        }), 200

    except Exception as e:
        print(f"Error getting request sender: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500


@main.route('/profile_by_id/<user_id>')
def profile_by_id(user_id):
    """Route mới: xem profile bằng user_id"""
    if 'user_id' not in session:
        return redirect(url_for('main.login'))

    try:
        target_user = users_col().find_one({'_id': ObjectId(user_id)}, {'password': 0})
        if not target_user:
            return "Người dùng không tồn tại", 404

        # Trả về trực tiếp profile thay vì redirect để tránh vòng lặp
        return render_profile_page(target_user)

    except Exception as e:
        print(f"Error loading profile by ID: {str(e)}")
        return "Lỗi khi tải trang cá nhân", 500


def render_profile_page(user):
    """Hàm helper để render trang profile - tránh trùng lặp code"""
    try:
        # ================= LẤY BÀI VIẾT =================
        current_user_id = session.get('user_id')
        target_user_id = str(user['_id'])
        
        # Xây dựng query với privacy filtering
        privacy_conditions = []
        
        # Nếu đang xem profile của chính mình - hiện tất cả bài viết
        if current_user_id == target_user_id:
            query = {'user_id': target_user_id}
        else:
            # Nếu đang xem profile của người khác - áp dụng privacy filter
            
            # Bài viết công khai - ai cũng có thể xem
            privacy_conditions.append({
                'user_id': target_user_id,
                'privacy': 'public'
            })
            
            # Bài viết bạn bè - chỉ xem được nếu là bạn bè
            current_user = users_col().find_one({'_id': ObjectId(current_user_id)})
            if current_user and target_user_id in current_user.get('friends', []):
                privacy_conditions.append({
                    'user_id': target_user_id,
                    'privacy': 'friends'
                })
            
            # Bài viết riêng tư - không ai xem được trừ chủ bài viết
            # (đã handled ở trên vì current_user_id != target_user_id)
            
            query = {'$or': privacy_conditions} if privacy_conditions else {'user_id': target_user_id, 'privacy': 'nonexistent'}
        
        posts = list(
            posts_col()
            .find(query)
            .sort('created_at', -1)
        )

        original_users_info = {}
        original_posts_info = {}
        final_posts = []

        for post in posts:
            # ================= DEBUG =================
            if post.get('post_type') == 'share':
                print(f"DEBUG: Found shared post {post['_id']}")

            # ================= COMMENTS =================
            if post.get('comments'):
                for comment in post['comments']:
                    comment.setdefault('replies', [])
                    for reply in comment['replies']:
                        reply.setdefault('id', str(uuid.uuid4()))
                        reply.setdefault(
                            'user_avatar',
                            url_for('static', filename='img/default-avatar.png')
                        )
                        reply.setdefault('username', 'Unknown')
                        reply.setdefault('content', '')

            # ================= BÀI VIẾT CHIA SẺ =================
            shared_id = post.get('shared_post_id') or post.get('original_post_id')

            if (
                (post.get('post_type') == 'share' or post.get('is_shared') is True)
                and shared_id
            ):
                try:
                    # FIX 1: Chuẩn hóa ObjectId
                    shared_oid = (
                        ObjectId(shared_id)
                        if isinstance(shared_id, str)
                        else shared_id
                    )

                    original_post = posts_col().find_one(
                        {'_id': shared_oid}
                    )

                    if original_post:
                        # FIX 2: Lấy user gốc
                        try:
                            orig_user_id = original_post.get('user_id')
                            if isinstance(orig_user_id, str):
                                orig_user_id = ObjectId(orig_user_id)

                            orig_owner = users_col().find_one(
                                {'_id': orig_user_id}
                            )
                        except Exception as e:
                            print(f"Error finding original owner: {e}")
                            orig_owner = None

                        # FIX 3: Avatar chuẩn
                        owner_avatar = '/static/img/default-avatar.png'
                        if orig_owner and orig_owner.get('avatar'):
                            avt = orig_owner['avatar']
                            if avt.startswith(('http', 'https', 'data:')):
                                owner_avatar = avt
                            else:
                                owner_avatar = url_for(
                                    'static',
                                    filename=avt
                                )

                        post['is_shared'] = True
                        post['original_post'] = {
                            'content': original_post.get('content', ''),
                            'media_urls': original_post.get('media_urls', []),
                            'created_at': original_post.get('created_at'),
                            'owner_username': (
                                orig_owner['username']
                                if orig_owner else 'Người dùng ẩn'
                            ),
                            'owner_full_name': (
                                orig_owner.get('full_name') or orig_owner['username']
                                if orig_owner else 'Người dùng ẩn'
                            ),
                            'owner_avatar': owner_avatar
                        }
                    else:
                        post['original_post'] = {
                            'content': '[Bài viết gốc đã bị xóa]',
                            'owner_username': 'Không xác định',
                            'owner_full_name': 'Không xác định',
                            'owner_avatar': '/static/img/default-avatar.png'
                        }

                except Exception as e:
                    print(f"DEBUG: Error loading shared post: {e}")
                    post['is_shared'] = False

            # ================= ĐẾM SHARE =================
            if 'shares' not in post:
                post['shares'] = posts_col().count_documents({
                    '$or': [
                        {'original_post_id': str(post['_id'])},
                        {'shared_post_id': str(post['_id'])},
                        {'shared_post_id': post['_id']}
                    ],
                    'post_type': 'share'
                })

            # ================= XỬ LÝ AVATAR & THỜI GIAN =================
            post['_id'] = str(post['_id'])
            post['user_avatar'] = user.get('avatar') or url_for('static', filename='img/default-avatar.png')
            post['username'] = user['username']
            # Sử dụng format_time_filter thay vì format_time
            post['created_at_formatted'] = format_time_filter(post.get('created_at'))

            final_posts.append(post)

        # ================= AVATAR PROFILE =================
        if user.get('avatar'):
            if user['avatar'].startswith(('http', 'data:image')):
                user_avatar = user['avatar']
            else:
                user_avatar = url_for(
                    'static',
                    filename=user['avatar']
                )
        else:
            user_avatar = url_for(
                'static',
                filename='img/default-avatar.png'
            )

        # ================= COVER PHOTO =================
        if user.get('cover_photo'):
            if not user['cover_photo'].startswith(('http', '/static')):
                user['cover_photo'] = url_for(
                    'static',
                    filename=user['cover_photo']
                )
        else:
            user['cover_photo'] = None

        # ================= BẠN BÈ =================
        is_friend = False
        current_user = users_col().find_one(
            {'_id': ObjectId(session['user_id'])}
        )

        if current_user:
            if (
                str(user['_id']) in current_user.get('friends', []) and
                session['user_id'] in user.get('friends', [])
            ):
                is_friend = True

        # print(f"DEBUG: is_friend = {is_friend}")

        # Lấy thông tin current user cho template
        logged_in_user = users_col().find_one({'_id': ObjectId(session['user_id'])}, {'password': 0})

        return render_template(
            'profile.html',
            profile_user=user,
            current_user=logged_in_user,  # Thêm current_user vào context
            user_avatar=user_avatar,
            posts=final_posts,
            current_user_id=session['user_id'],
            is_friend=is_friend,
            original_users_info=original_users_info,
            original_posts_info=original_posts_info,
            get_user_by_id=get_user_by_id
        )

    except Exception as e:
        print(f"Error rendering profile page: {e}")
        import traceback
        traceback.print_exc()
        return "Lỗi khi tải trang cá nhân", 500


@main.route('/get_user_profile/<user_id>')
def get_user_profile(user_id):
    """API lấy thông tin profile bằng user_id"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        target_user = users_col().find_one({'_id': ObjectId(user_id)}, {'password': 0})
        if not target_user:
            return jsonify({'error': 'User not found'}), 404

        avatar = target_user.get('avatar')
        if avatar and not avatar.startswith(('http', 'data:image')):
            avatar = url_for('static', filename=avatar)

        profile_data = {
            '_id': str(target_user['_id']),
            'username': target_user.get('username'),
            'full_name': target_user.get('full_name', ''),
            'avatar': avatar or url_for('static', filename='img/default-avatar.png'),
            'email': target_user.get('email', '')
        }

        return jsonify({'success': True, 'profile': profile_data}), 200

    except Exception as e:
        print(f"Error getting user profile: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500


@main.route('/friend_requests_count')
def friend_requests_count():
    """API trả về số lượng lời mời kết bạn chưa xử lý"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        user_id = ObjectId(session['user_id'])
        count = friend_requests_col().count_documents({
            'recipient_id': user_id,
            'status': 'pending'
        })

        return jsonify({'count': count}), 200

    except Exception as e:
        print(f"Error counting friend requests: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500


@main.route('/notifications')
def notifications_page():
    """Trang hiển thị thông báo"""
    if 'user_id' not in session:
        return redirect(url_for('main.login'))

    user_id = ObjectId(session['user_id'])
    user = users_col().find_one({'_id': user_id})

    if not user:
        return redirect(url_for('main.login'))

    return render_template(
        'notifications_page.html',
        current_user=user,
        username=session['username']
    )


@main.route('/api/notifications')
def get_notifications_api():
    """API lấy danh sách thông báo"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        user_id = ObjectId(session['user_id'])

        page = request.args.get('page', 1, type=int)
        per_page = 20
        filter_type = request.args.get('filter', 'all')
        sort_by = request.args.get('sort', 'newest')

        query = {'recipient_id': user_id}
        if filter_type != 'all':
            query['type'] = filter_type

        sort_order = -1 if sort_by == 'newest' else 1

        total_items = notifications_col().count_documents(query)
        total_pages = (total_items + per_page - 1) // per_page

        skip = (page - 1) * per_page

        notifications = list(
            notifications_col().find(query)
            .sort('created_at', sort_order)
            .skip(skip)
            .limit(per_page)
        )

        # SỬA LẠI: Chuyển đổi ObjectId sang string và format datetime
        # Get unique sender_ids to fetch user info
        sender_ids = list(set([n.get('sender_id') for n in notifications if n.get('sender_id')]))
        sender_info_map = {}
        for sid in sender_ids:
            try:
                sid_str = str(sid)
                sender = users_col().find_one({'_id': sid if isinstance(sid, ObjectId) else ObjectId(sid)}, 
                                              {'username': 1, 'full_name': 1, 'avatar': 1})
                if sender:
                    raw_avatar = sender.get('avatar', '')
                    sender_avatar = raw_avatar
                    
                    # Clean up avatar path
                    if sender_avatar:
                        # Remove any query parameters or fragments (but not for data URIs)
                        if 'data:image' not in sender_avatar:
                            sender_avatar = sender_avatar.split('?')[0].split('#')[0]
                            # Only check length for non-data URIs
                            if len(sender_avatar) > 200:
                                sender_avatar = ''
                    
                    # Build proper avatar URL
                    if sender_avatar:
                        # Check if it's a data URI (base64 image)
                        if 'data:image' in sender_avatar:
                            # Data URI - use as is (remove /static/ prefix if accidentally added)
                            if sender_avatar.startswith('/static/'):
                                sender_avatar = sender_avatar[8:]  # Remove /static/
                        # Check if it's external URL
                        elif sender_avatar.startswith(('http://', 'https://')):
                            pass  # Use as is
                        # Local file path
                        else:
                            if not sender_avatar.startswith('/'):
                                sender_avatar = f"/static/{sender_avatar}"
                    else:
                        # Default avatar
                        sender_avatar = '/static/img/default-avatar.png'
                    
                    sender_info_map[sid_str] = {
                        'name': sender.get('full_name') or sender.get('username', 'Unknown'),
                        'avatar': sender_avatar
                    }
                else:
                    pass
            except:
                pass
        
        formatted_notifications = []
        for n in notifications:
            formatted_n = {}
            for key, value in n.items():
                if isinstance(value, ObjectId):
                    formatted_n[key] = str(value)
                elif isinstance(value, datetime):
                    from app.utils.time_utils import format_timestamp_for_client
                    formatted_n[key] = format_timestamp_for_client(value)
                else:
                    formatted_n[key] = value
            
            # Add sender info
            sender_id_str = str(formatted_n.get('sender_id', ''))
            if sender_id_str in sender_info_map:
                formatted_n['sender_name'] = sender_info_map[sender_id_str]['name']
                formatted_n['sender_avatar'] = sender_info_map[sender_id_str]['avatar']
            else:
                # Fallback: try to get fresh user data if not in map
                try:
                    fallback_sender = users_col().find_one({'_id': ObjectId(sender_id_str)} if sender_id_str else None, 
                                                      {'full_name': 1, 'username': 1, 'avatar': 1})
                    if fallback_sender:
                        formatted_n['sender_name'] = fallback_sender.get('full_name') or fallback_sender.get('username', 'Unknown')
                        formatted_n['sender_avatar'] = fallback_sender.get('avatar', '/static/img/default-avatar.png')
                    else:
                        formatted_n['sender_name'] = n.get('sender_name', 'Unknown')
                        formatted_n['sender_avatar'] = n.get('sender_avatar', '/static/img/default-avatar.png')
                except:
                    formatted_n['sender_name'] = n.get('sender_name', 'Unknown')
                    formatted_n['sender_avatar'] = n.get('sender_avatar', '/static/img/default-avatar.png')
            
            formatted_notifications.append(formatted_n)

        return jsonify({
            'items': formatted_notifications,
            'page': page,
            'per_page': per_page,
            'total_items': total_items,
            'total_pages': total_pages
        }), 200

    except Exception as e:
        print("Error in get_notifications_api:", e)
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Internal Server Error', 'detail': str(e)}), 500


@main.route('/api/notifications/count')
def get_notification_count():
    """API lấy số lượng thông báo chưa đọc"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        user_id = ObjectId(session['user_id'])

        unread_count = notifications_col().count_documents({
            'recipient_id': user_id,
            'read': False
        })

        return jsonify({
            'success': True,
            'count': unread_count
        }), 200

    except Exception as e:
        print(f"Error getting notification count: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500


@main.route('/api/messages/unread_count')
def get_unread_message_count():
    """API lấy số tin nhắn chưa đọc"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        user_id = session['user_id']

        conversations = conversations_col().find({
            'participants': str(user_id)
        })

        total_unread = 0

        for conv in conversations:
            unread_count = messages_col().count_documents({
                'conversation_id': conv['_id'],
                'sender_id': {'$ne': user_id},
                'read_by': {'$nin': [user_id]}
            })
            total_unread += unread_count

        return jsonify({
            'success': True,
            'count': total_unread
        }), 200

    except Exception as e:
        print(f"Error getting unread message count: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500


@main.route('/api/notifications/<notification_id>/read', methods=['POST'])
def mark_notification_read(notification_id):
    """Đánh dấu một thông báo là đã đọc"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        user_id = ObjectId(session['user_id'])
        notification_oid = ObjectId(notification_id)

        notification = notifications_col().find_one({
            '_id': notification_oid,
            'recipient_id': user_id
        })

        if not notification:
            return jsonify({'error': 'Notification not found'}), 404

        notifications_col().update_one(
            {'_id': notification_oid},
            {'$set': {'read': True, 'read_at': get_vietnam_time()}}
        )

        socketio.emit('notification_read', {
            'notificationId': notification_id,
            'userId': str(user_id)
        }, room=str(user_id))

        return jsonify({'success': True}), 200

    except Exception as e:
        print(f"Error marking notification as read: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500


@main.route('/api/notifications/mark-all-read', methods=['POST'])
def mark_all_notifications_read():
    """Đánh dấu tất cả thông báo là đã đọc"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        user_id = ObjectId(session['user_id'])

        result = notifications_col().update_many(
            {
                'recipient_id': user_id,
                'read': False
            },
            {'$set': {'read': True, 'read_at': get_vietnam_time()}}
        )

        socketio.emit('notifications_read', {
            'all': True,
            'userId': str(user_id)
        }, room=str(user_id))

        return jsonify({
            'success': True,
            'message': f'Đã đánh dấu {result.modified_count} thông báo là đã đọc'
        }), 200

    except Exception as e:
        print(f"Error marking all notifications as read: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500


@main.route('/api/notifications/stats')
def get_notifications_stats():
    """API lấy thống kê thông báo (tổng, chưa đọc, đã đọc, theo loại)"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        user_id = ObjectId(session['user_id'])

        # Tổng số thông báo
        total = notifications_col().count_documents({'recipient_id': user_id})

        # Số thông báo chưa đọc
        unread = notifications_col().count_documents({
            'recipient_id': user_id,
            'read': False
        })

        # Số thông báo đã đọc
        read = notifications_col().count_documents({
            'recipient_id': user_id,
            'read': True
        })

        # Thống kê theo loại
        type_counts = {}
        notification_types = ['like', 'comment', 'friend_request', 'friend_accept', 'mention', 'share', 'message']

        for notif_type in notification_types:
            count = notifications_col().count_documents({
                'recipient_id': user_id,
                'type': notif_type
            })
            type_counts[notif_type] = count

        return jsonify({
            'success': True,
            'stats': {
                'total': total,
                'unread': unread,
                'read': read,
                'by_type': type_counts
            }
        }), 200

    except Exception as e:
        print(f"Error getting notification stats: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Internal server error'}), 500


@main.route('/api/notifications/activity')
def get_notifications_activity():
    """API lấy dữ liệu hoạt động 7 ngày và hoạt động gần đây"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        user_id = ObjectId(session['user_id'])

        # Tính toán dữ liệu 7 ngày gần nhất
        from datetime import datetime, timedelta
        vietnam_tz = get_vietnam_timezone()
        now = get_vietnam_time()

        # Dữ liệu cho biểu đồ 7 ngày
        chart_data = []
        day_names = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']

        for i in range(6, -1, -1):  # 6 ngày trước đến hôm nay
            date = now - timedelta(days=i)
            start_of_day = date.replace(hour=0, minute=0, second=0, microsecond=0)
            end_of_day = date.replace(hour=23, minute=59, second=59, microsecond=999999)

            # Đếm số thông báo trong ngày
            count = notifications_col().count_documents({
                'recipient_id': user_id,
                'created_at': {
                    '$gte': start_of_day,
                    '$lte': end_of_day
                }
            })

            day_index = date.weekday()  # 0=Monday, 6=Sunday
            day_label = day_names[(day_index + 1) % 7]  # Chuyển sang CN, T2, T3...

            chart_data.append({
                'day': day_label,
                'count': count,
                'is_today': i == 0
            })

        # Hoạt động gần đây (lấy từ posts, notifications, friend_requests)
        recent_activity = []

        # 1. Bài viết gần đây
        recent_posts = posts_col().find({
            'user_id': str(user_id)
        }).sort('created_at', -1).limit(5)

        for post in recent_posts:
            recent_activity.append({
                'type': 'post',
                'text': 'Đã đăng một bài viết mới',
                'time': post.get('created_at').isoformat() if post.get('created_at') else None,
                'link': f"/post/{post['_id']}"
            })

        # 2. Lời mời kết bạn gần đây
        recent_friend_requests = friend_requests_col().find({
            '$or': [
                {'sender_id': user_id},
                {'recipient_id': user_id}
            ],
            'status': 'accepted'
        }).sort('updated_at', -1).limit(5)

        for req in recent_friend_requests:
            other_user_id = req['sender_id'] if req['recipient_id'] == user_id else req['recipient_id']
            other_user = users_col().find_one({'_id': other_user_id}, {'username': 1})

            if other_user:
                recent_activity.append({
                    'type': 'friend',
                    'text': f"Đã kết bạn với {other_user.get('username', 'Unknown')}",
                    'time': req.get('updated_at').isoformat() if req.get('updated_at') else None,
                    'link': f"/profile/{other_user['username']}"
                })

        # 3. Cập nhật ảnh đại diện
        user = users_col().find_one({'_id': user_id}, {'avatar_updated_at': 1})
        if user and user.get('avatar_updated_at'):
            recent_activity.append({
                'type': 'avatar',
                'text': 'Đã cập nhật ảnh đại diện',
                'time': user['avatar_updated_at'].isoformat(),
                'link': None
            })

        # Sắp xếp theo thời gian mới nhất
        recent_activity = sorted(
            [a for a in recent_activity if a['time']],
            key=lambda x: x['time'],
            reverse=True
        )[:5]  # Chỉ lấy 5 hoạt động gần nhất

        # Format thời gian thân thiện
        for activity in recent_activity:
            try:
                activity_time = datetime.fromisoformat(activity['time'].replace('Z', '+00:00'))
                diff = now - activity_time

                if diff < timedelta(minutes=1):
                    activity['time_display'] = 'Vừa xong'
                elif diff < timedelta(hours=1):
                    activity['time_display'] = f"{int(diff.total_seconds() / 60)} phút trước"
                elif diff < timedelta(days=1):
                    activity['time_display'] = f"{int(diff.total_seconds() / 3600)} giờ trước"
                elif diff < timedelta(days=7):
                    activity['time_display'] = f"{int(diff.total_seconds() / 86400)} ngày trước"
                else:
                    activity['time_display'] = activity_time.strftime('%d/%m/%Y')
            except:
                activity['time_display'] = 'Không xác định'

        # Tính % thay đổi so với tuần trước
        last_week_start = now - timedelta(days=14)
        last_week_end = now - timedelta(days=7)
        this_week_start = now - timedelta(days=7)

        last_week_count = notifications_col().count_documents({
            'recipient_id': user_id,
            'created_at': {'$gte': last_week_start, '$lte': last_week_end}
        })

        this_week_count = notifications_col().count_documents({
            'recipient_id': user_id,
            'created_at': {'$gte': this_week_start, '$lte': now}
        })

        if last_week_count > 0:
            percent_change = round(((this_week_count - last_week_count) / last_week_count) * 100)
        else:
            percent_change = 0 if this_week_count == 0 else 100

        return jsonify({
            'success': True,
            'chart_data': chart_data,
            'recent_activity': recent_activity,
            'percent_change': percent_change,
            'this_week_count': this_week_count,
            'last_week_count': last_week_count
        }), 200

    except Exception as e:
        print(f"Error getting notification activity: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Internal server error'}), 500


@main.route('/api/friend_requests/<request_id>/<action>', methods=['POST'])
def handle_friend_request_action(request_id, action):
    """Xử lý lời mời kết bạn (chấp nhận/từ chối)"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    if action not in ['accept', 'decline']:
        return jsonify({'error': 'Invalid action'}), 400

    try:
        user_id = ObjectId(session['user_id'])
        request_oid = ObjectId(request_id)
        
        print(f"[HTTP Friend Request] {action} request {request_id} by user {session['user_id']}")

        # Tìm request và kiểm tra quyền
        friend_request = friend_requests_col().find_one({
            '_id': request_oid
        })
        
        if not friend_request:
            print(f"[HTTP Friend Request] Request not found: {request_id}")
            return jsonify({
                'error': 'Friend request not found'
            }), 404
            
        # Kiểm tra quyền - so sánh string để tránh lỗi ObjectId
        fr_recipient_id = str(friend_request.get('recipient_id'))
        current_user_id = str(session['user_id'])
        current_status = friend_request.get('status')
        
        print(f"[HTTP Friend Request] Check permission: fr_recipient={fr_recipient_id}, current_user={current_user_id}, status={current_status}")
        
        if fr_recipient_id != current_user_id or current_status != 'pending':
            print(f"[HTTP Friend Request] Permission denied")
            return jsonify({
                'error': 'Friend request not found or already processed'
            }), 404

        if action == 'accept':
            # Chấp nhận lời mời kết bạn
            users_col().update_one(
                {'_id': user_id},
                {'$addToSet': {'friends': str(friend_request['sender_id'])}}
            )

            users_col().update_one(
                {'_id': friend_request['sender_id']},
                {'$addToSet': {'friends': str(user_id)}}
            )

            notification_data = {
                'recipient_id': str(friend_request['sender_id']),
                'sender_id': str(user_id),
                'type': 'friend_accept',
                'content': 'Đã chấp nhận lời mời kết bạn',
                'data': {
                    'friend_id': str(user_id)
                },
                'read': False,
                'created_at': get_vietnam_time().isoformat()
            }

            notifications_col().insert_one(notification_data)

            # Create a clean copy for socket emit (remove any ObjectId that MongoDB might add)
            socket_notification = {
                'recipient_id': str(friend_request['sender_id']),
                'sender_id': str(user_id),
                'type': 'friend_accept',
                'content': 'Đã chấp nhận lời mời kết bạn',
                'data': {
                    'friend_id': str(user_id)
                },
                'read': False,
                'created_at': notification_data['created_at']
            }

            socketio.emit(
                'new_notification',
                socket_notification,
                room=str(friend_request['sender_id'])
            )

        # Cập nhật trạng thái lời mời (accepted/declined)
        friend_requests_col().update_one(
            {'_id': request_oid},
            {'$set': {'status': 'accepted' if action == 'accept' else 'declined'}}
        )

        # Xóa thông báo friend request cũ (nếu có)
        notifications_col().delete_one({
            'recipient_id': user_id,
            'sender_id': friend_request['sender_id'],
            'type': 'friend_request'
        })

        return jsonify({
            'success': True,
            'message': f'Đã {action} lời mời kết bạn'
        }), 200

    except Exception as e:
        print(f"Error handling friend request: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500


@main.route('/post/<post_id>')
def post_detail_page(post_id):
    """Trang chi tiết bài viết"""
    if 'user_id' not in session:
        return redirect(url_for('main.login'))
    
    try:
        # Kiểm tra ID hợp lệ
        if not ObjectId.is_valid(post_id):
            return "Bài viết không tồn tại", 404
        
        post_oid = ObjectId(post_id)
        
        # Lấy thông tin bài viết
        post = posts_col().find_one({'_id': post_oid})
        if not post:
            return "Bài viết không tồn tại", 404
        
        # Lấy thông tin người đăng bài
        post_owner = users_col().find_one({'_id': ObjectId(post['user_id'])}, {'password': 0})
        if not post_owner:
            return "Người dùng không tồn tại", 404
        
        # Lấy thông tin người dùng hiện tại
        current_user = users_col().find_one({'_id': ObjectId(session['user_id'])}, {'password': 0})
        
        # Kiểm tra quyền xem (chỉ bạn bè hoặc chính mình)
        can_view = False
        if post['user_id'] == session['user_id']:
            can_view = True  # Chính mình
        elif str(post['user_id']) in current_user.get('friends', []):
            can_view = True  # Là bạn bè
        else:
            # Kiểm tra ngược lại: người đăng có coi current_user là bạn không
            if session['user_id'] in post_owner.get('friends', []):
                can_view = True
        
        if not can_view:
            return "Bạn không có quyền xem bài viết này", 403
        
        # Xử lý avatar
        if post_owner.get('avatar'):
            if post_owner['avatar'].startswith(('http', 'data:image')):
                owner_avatar = post_owner['avatar']
            else:
                owner_avatar = url_for('static', filename=post_owner['avatar'])
        else:
            owner_avatar = url_for('static', filename='img/default-avatar.png')
        
        # Xử lý avatar người dùng hiện tại
        if current_user.get('avatar'):
            if current_user['avatar'].startswith(('http', 'data:image')):
                current_user_avatar = current_user['avatar']
            else:
                current_user_avatar = url_for('static', filename=current_user['avatar'])
        else:
            current_user_avatar = url_for('static', filename='img/default-avatar.png')
        
        # Format thời gian cho bài viết
        if 'created_at' in post:
            post['created_at_formatted'] = format_time_filter(post['created_at'])
        else:
            post['created_at_formatted'] = ''
        
        # Kiểm tra current user đã like bài viết chưa
        has_liked = False
        if 'likes' in post:
            has_liked = session['user_id'] in post['likes']
        
        # --- PHẦN ĐÃ SỬA LỖI ---
        likers_info = []
        liker_ids = []  # <--- KHỞI TẠO TRƯỚC ĐỂ TRÁNH LỖI UnboundLocalError
        
        if 'likes' in post and post['likes']:
             liker_ids = [ObjectId(uid) for uid in post['likes'] if ObjectId.is_valid(uid)]
        
        if liker_ids:
            likers = list(users_col().find(
                {'_id': {'$in': liker_ids}},
                {'username': 1, 'avatar': 1}
            ))
            for liker in likers:
                avatar = liker.get('avatar')
                if avatar and not avatar.startswith(('http', 'data:image')):
                    avatar = url_for('static', filename=avatar)
                likers_info.append({
                    'id': str(liker['_id']),
                    'username': liker['username'],
                    'avatar': avatar or url_for('static', filename='img/default-avatar.png')
                })
        # -----------------------

        # Xử lý comments (Đã chỉnh lại thụt đầu dòng cho đúng)
        for comment in post.get('comments', []):
            if 'created_at' in comment:
                comment['formatted_time'] = format_time_filter(comment['created_at'])
            else:
                comment['formatted_time'] = ''
        
        # Sắp xếp comment mới nhất lên đầu
        post['comments'] = sorted(post.get('comments', []), 
            key=lambda x: x.get('created_at', datetime.min), 
            reverse=True)
        
        return render_template(
            'post_detail.html',
            post=post,
            post_owner=post_owner,
            owner_avatar=owner_avatar,
            current_user=current_user,
            current_user_avatar=current_user_avatar,
            has_liked=has_liked,
            likers_info=likers_info,
            username=session['username'],
            user_id=session['user_id'],
            shares_count=post.get('shares', 0)
        )
        
    except Exception as e:
        print(f"Error loading post detail: {str(e)}")
        import traceback
        traceback.print_exc()
        return "Lỗi khi tải trang bài viết", 500


@main.route('/api/post/<post_id>', methods=['GET'])
def get_post_detail_api(post_id):
    """API lấy chi tiết bài viết"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        # Kiểm tra ID hợp lệ
        if not ObjectId.is_valid(post_id):
            return jsonify({'error': 'Invalid post ID'}), 400
        
        post_oid = ObjectId(post_id)
        
        # Lấy thông tin bài viết
        post = posts_col().find_one({'_id': post_oid})
        if not post:
            return jsonify({'error': 'Post not found'}), 404
        
        # Lấy thông tin người đăng bài
        post_owner = users_col().find_one(
            {'_id': ObjectId(post['user_id'])}, 
            {'username': 1, 'avatar': 1, 'full_name': 1}
        )
        
        # Kiểm tra quyền xem
        current_user = users_col().find_one({'_id': ObjectId(session['user_id'])}, {'friends': 1})
        can_view = False
        
        if post['user_id'] == session['user_id']:
            can_view = True
        elif current_user and str(post['user_id']) in current_user.get('friends', []):
            can_view = True
        
        if not can_view:
            return jsonify({'error': 'No permission to view this post'}), 403
        
        # Xử lý avatar
        if post_owner:
            avatar = post_owner.get('avatar')
            if avatar and not avatar.startswith(('http', 'data:image')):
                avatar = url_for('static', filename=avatar)
            owner_avatar = avatar or url_for('static', filename='img/default-avatar.png')
        else:
            owner_avatar = url_for('static', filename='img/default-avatar.png')
        
        # Format dữ liệu
        post_data = {
            '_id': str(post['_id']),
            'user_id': post['user_id'],
            'content': post.get('content', ''),
            'media_urls': post.get('media_urls', []),
            'created_at': post.get('created_at').isoformat() if post.get('created_at') else '',
            'likes': post.get('likes', []),
            'comments': post.get('comments', []),
            'owner_info': {
                'username': post_owner['username'] if post_owner else 'Unknown',
                'full_name': post_owner.get('full_name', post_owner['username'] if post_owner else 'Unknown'),
                'avatar': owner_avatar
            },
            'has_liked': session['user_id'] in post.get('likes', []),
            'like_count': len(post.get('likes', [])),
            'comment_count': len(post.get('comments', []))
        }
        
        return jsonify({'success': True, 'post': post_data}), 200
        
    except Exception as e:
        print(f"Error getting post detail: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500
    
# ============================================================
# XỬ LÝ BÌNH CHỌN (VOTE POLL)
# ============================================================
@socketio.on('vote_poll')
def handle_vote_poll(data):
    """
    Xử lý khi người dùng bấm vote
    Data nhận vào: { 'message_id': '...', 'option_id': 0, 'group_id': '...' }
    """
    if 'user_id' not in session:
        return
    
    user_id = session['user_id']
    message_id = data.get('message_id')
    option_id = int(data.get('option_id'))
    group_id = data.get('group_id')

    try:
        # 1. Kết nối tới Collection tin nhắn nhóm
        # (SỬA LẠI: dùng đúng tên biến collection của bạn, ví dụ: mongo.db.group_messages)
        group_messages = mongo.db.group_messages 
        
        # 2. Tìm tin nhắn
        msg = group_messages.find_one({'_id': ObjectId(message_id)})

        if not msg or msg.get('message_type') != 'poll':
            return

        # 3. Parse nội dung JSON (vì lưu trong DB có thể là string hoặc object)
        content = msg.get('content')
        if isinstance(content, str):
            poll_data = json.loads(content)
        else:
            poll_data = content

        options = poll_data.get('options', [])
        
        # 4. LOGIC VOTE (CHẾ ĐỘ 1 LỰA CHỌN)
        # - Nếu bấm vào cái đã chọn -> Bỏ chọn (Unvote)
        # - Nếu bấm vào cái mới -> Chọn cái mới & Bỏ chọn cái cũ
        
        updated = False
        
        for opt in options:
            # Đảm bảo có mảng voters
            if 'voters' not in opt:
                opt['voters'] = []
            
            # Nếu là option đang bấm
            if int(opt['id']) == option_id:
                if user_id in opt['voters']:
                    # Đã vote rồi -> Bỏ vote
                    opt['voters'].remove(user_id)
                else:
                    # Chưa vote -> Thêm vote
                    opt['voters'].append(user_id)
                updated = True
            else:
                # Nếu là option khác -> Xóa user khỏi đó (để đảm bảo chỉ chọn 1)
                # Nếu bạn muốn cho chọn nhiều, hãy xóa đoạn `else` này đi
                if user_id in opt['voters']:
                    opt['voters'].remove(user_id)
                    updated = True

        if updated:
            # 5. Lưu ngược lại vào Database
            # Chuyển lại thành string để đồng bộ format cũ
            new_content_str = json.dumps(poll_data, ensure_ascii=False)
            
            group_messages.update_one(
                {'_id': ObjectId(message_id)},
                {'$set': {'content': new_content_str}}
            )

            # 6. Gửi thông báo cập nhật cho tất cả mọi người trong nhóm (Realtime)
            # Client sẽ nhận cái này và vẽ lại thanh %
            socketio.emit('poll_updated', {
                'message_id': message_id,
                'new_content': poll_data # Gửi object qua luôn cho client dễ dùng
            }, room=group_id)
            
            print(f"[Poll] User {user_id} voted option {option_id} in msg {message_id}")

    except Exception as e:
        print(f"[Poll Error] {str(e)}")
        import traceback
        traceback.print_exc()


# --- Thêm vào app/routes.py tag ten group---

@main.route('/get_poll_voters/<message_id>')
def get_poll_voters(message_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        # Tìm tin nhắn poll
        # Lưu ý: Sửa lại tên collection cho đúng với dự án của bạn (group_messages hoặc messages)
        msg = group_messages_col().find_one({'_id': ObjectId(message_id)}) 
        
        if not msg:
            return jsonify({'success': False, 'error': 'Not found'})

        content = msg.get('content')
        if isinstance(content, str):
            poll_data = json.loads(content)
        else:
            poll_data = content
            
        options = poll_data.get('options', [])
        
        # Gom tất cả user_id đã vote
        all_voter_ids = set()
        for opt in options:
            all_voter_ids.update(opt.get('voters', []))
            
        # Lấy thông tin user từ DB (Avatar, Tên)
        users = list(users_col().find(
            {'_id': {'$in': [ObjectId(uid) for uid in all_voter_ids]}},
            {'username': 1, 'avatar': 1}
        ))
        
        # Map user_id -> user_info
        user_map = {str(u['_id']): u for u in users}
        
        # Tạo danh sách kết quả theo format để Frontend dễ hiển thị (giống Reaction)
        results = []
        for opt in options:
            opt_text = opt.get('text', 'Lựa chọn')
            for uid in opt.get('voters', []):
                user = user_map.get(uid)
                if user:
                    avatar = user.get('avatar')
                    if avatar and not avatar.startswith(('http', 'data:image')):
                        avatar = url_for('static', filename=avatar)
                    elif not avatar:
                        avatar = url_for('static', filename='img/default-avatar.png')
                        
                    results.append({
                        'user_id': uid,
                        'username': user['username'],
                        'avatar': avatar,
                        'emoji': opt_text # Mẹo: Dùng tên lựa chọn làm 'emoji' để tái sử dụng Modal cũ
                    })
                    
        return jsonify({'success': True, 'reactions': results})

    except Exception as e:
        print(f"Error getting poll voters: {e}")
        return jsonify({'error': 'Internal error'}), 500
    

# --- TRONG app/routes.py ---

@main.route('/get_group_members/<group_id>')
def get_group_members(group_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        # 1. Tìm các bản ghi trong group_members
        members_cursor = mongo.db.group_members.find({'group_id': ObjectId(group_id)})
        user_ids = [m['user_id'] for m in members_cursor]
        
        # 2. Lấy thông tin chi tiết từ collection users
        users = list(mongo.db.users.find(
            {'_id': {'$in': user_ids}},
            {'username': 1, 'avatar': 1} # Chỉ lấy tên và avatar
        ))
        
        # 3. Format dữ liệu trả về
        result = []
        for u in users:
            avatar = u.get('avatar', '/static/img/default-avatar.png')
            result.append({
                'id': str(u['_id']),
                'username': u.get('username', 'Unknown'),
                'avatar': avatar
            })
            
        return jsonify({'success': True, 'members': result})
        
    except Exception as e:
        print(f"Error fetching members: {e}")
        return jsonify({'error': 'Internal Error'}), 500
    

@main.route('/set_status', methods=['POST'])
def set_status():
    """10/12/2025 - Cập nhật custom status cho mini profile (tự xoá sau 24h)."""
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401

    data = request.get_json() or {}
    raw_status = data.get('status') or ''
    status_text = raw_status.strip()

    user_id = ObjectId(session['user_id'])
    update_data = {}

    if status_text:
        # 10/12/2025 - Lưu cảm nghĩ + thời gian đặt, reset reaction cho status mới
        update_data['status'] = status_text
        update_data['status_updated_at'] = get_vietnam_time()
        update_data['status_reactions'] = []
    else:
        # 10/12/2025 - Xoá cảm nghĩ + reaction khi để trống
        update_data['status'] = ''
        update_data['status_updated_at'] = None
        update_data['status_reactions'] = []

    try:
        users_col().update_one({'_id': user_id}, {'$set': update_data})
        if not status_text:
            # 10/12/2025 - Xoá hẳn trường thời gian và reaction nếu không còn status
            users_col().update_one(
                {'_id': user_id},
                {'$unset': {'status_updated_at': "", 'status_reactions': ""}}
            )
    except Exception as e:
        print(f"Error updating status: {e}")
        return jsonify({'success': False, 'error': 'Internal server error'}), 500

    return jsonify({'success': True, 'status': status_text})

@main.route('/status/react', methods=['POST'])
def react_status():
    """10/12/2025 - Thả cảm xúc cho cảm nghĩ (mini status) và trả về tổng số."""
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401

    data = request.get_json() or {}
    target_user_id = data.get('target_user_id')
    emoji = data.get('emoji', '❤️')

    if not target_user_id:
        return jsonify({'success': False, 'error': 'Missing target_user_id'}), 400

    try:
        current_user_id = ObjectId(session['user_id'])
        target_id = ObjectId(target_user_id)
    except Exception as e:
        return jsonify({'success': False, 'error': 'Invalid user id'}), 400

    try:
        user = users_col().find_one(
            {'_id': target_id},
            {'status': 1, 'status_reactions': 1}
        )
        if not user:
            return jsonify({'success': False, 'error': 'User not found'}), 404

        status_text = (user.get('status', '') or '').strip()
        if not status_text:
            return jsonify({'success': False, 'error': 'Status not available'}), 400

        reactions = user.get('status_reactions', []) or []

        # Loại bỏ reaction cũ của user (nếu có)
        filtered = []
        existing_emoji = None
        for r in reactions:
            uid = str(r.get('user_id'))
            if uid == str(current_user_id):
                existing_emoji = r.get('emoji')
            else:
                filtered.append(r)

        # Toggle: nếu react cùng emoji -> bỏ; nếu khác hoặc chưa có -> thêm/cập nhật
        if existing_emoji == emoji:
            updated_reactions = filtered
        else:
            updated_reactions = filtered + [{
                'user_id': current_user_id,
                'emoji': emoji
            }]

        users_col().update_one(
            {'_id': target_id},
            {'$set': {'status_reactions': updated_reactions}}
        )

        total = len(updated_reactions)
        reacted_by_me = any(
            str(r.get('user_id')) == str(current_user_id)
            for r in updated_reactions
        )

        emoji_counts = {}
        for r in updated_reactions:
            em = r.get('emoji', '❤️')
            emoji_counts[em] = emoji_counts.get(em, 0) + 1

        return jsonify({
            'success': True,
            'count': total,
            'reacted_by_me': reacted_by_me,
            'emoji_counts': emoji_counts
        })

    except Exception as e:
        print(f"Error reacting to status: {e}")
        return jsonify({'success': False, 'error': 'Internal server error'}), 500

# --- [THÊM MỚI] IMPORT CHO AI ---
import google.generativeai as genai
from flask import request, jsonify # Nhớ import dòng này
import os

# CẤU HÌNH AI - đọc từ environment variable
GENAI_API_KEY = os.environ.get('GENAI_API_KEY', '')
if GENAI_API_KEY:
    genai.configure(api_key=GENAI_API_KEY)

ai_model = None
if GENAI_API_KEY:
    ai_model = genai.GenerativeModel('gemini-2.5-flash')

@main.route('/api/summarize_chat', methods=['POST'])
def summarize_chat():
    try:
        # Kiểm tra AI model có được cấu hình không
        if not ai_model:
            return jsonify({'success': False, 'error': 'AI chưa được cấu hình. Vui lòng kiểm tra GENAI_API_KEY.'})
        
        data = request.json
        messages = data.get('messages', [])

        # Để số 2 để test
        if not messages or len(messages) < 2:
            return jsonify({'success': False, 'error': 'Cần ít nhất 2 tin nhắn để tóm tắt.'})

        # 1. Chuẩn bị dữ liệu text
        transcript = ""
        for msg in messages:
            sender = msg.get('sender_name') or msg.get('username') or 'Người dùng'
            content = msg.get('content') or msg.get('message_text') or ''
            
            if content and isinstance(content, str):
                transcript += f"- {sender}: {content}\n"

        if not transcript:
             return jsonify({'success': False, 'error': 'Không tìm thấy nội dung văn bản.'})

        # 2. Tạo Prompt
        prompt = f"""
        Bạn là thư ký AI. Hãy tóm tắt hội thoại sau bằng Tiếng Việt.
        Yêu cầu: Ngắn gọn (dưới 150 từ), gạch đầu dòng ý chính. In đậm lịch hẹn/địa điểm.
        Nội dung:
        {transcript}
        """

        # 3. Gọi Google Gemini
        response = ai_model.generate_content(prompt)
        
        if response.text:
            return jsonify({'success': True, 'summary': response.text})
        else:
             return jsonify({'success': False, 'error': 'AI không phản hồi.'})

    except Exception as e:
        print(f"[AI Error] {e}")
        return jsonify({'success': False, 'error': f'Lỗi server: {str(e)}'})
    
@main.route('/share_post', methods=['POST'])
def share_post():
    """Chia sẻ bài viết - VERSION IMPROVED"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        data = request.get_json()
        post_id = data.get('post_id')
        content = data.get('content', '')  # Nội dung kèm theo khi chia sẻ
        share_type = data.get('share_type', 'profile')  # 'profile', 'message', 'story'
        target_id = data.get('target_id')  # ID người nhận/nhóm nhận
        target_type = data.get('target_type', 'user')  # 'user' hoặc 'group'

        if not post_id:
            return jsonify({'error': 'Thiếu ID bài viết'}), 400

        # Kiểm tra post_id hợp lệ
        if not ObjectId.is_valid(post_id):
            return jsonify({'error': 'ID bài viết không hợp lệ'}), 400

        # Tìm bài viết gốc
        original_post = posts_col().find_one({'_id': ObjectId(post_id)})
        if not original_post:
            return jsonify({'error': 'Bài viết không tồn tại'}), 404

        user_id = session['user_id']
        user = users_col().find_one({'_id': ObjectId(user_id)})

        if not user:
            return jsonify({'error': 'Người dùng không tồn tại'}), 404

        # Kiểm tra quyền chia sẻ - CHỈ 3 loại chuẩn: public, friends, only_me
        # Nếu bài viết only_me/private, chỉ chủ mới được chia sẻ
        post_privacy = original_post.get('privacy', 'public')
        
        if post_privacy in ['only_me', 'private']:
            if str(original_post['user_id']) != user_id:
                return jsonify({'error': 'Không có quyền chia sẻ bài viết riêng tư'}), 403
        
        elif post_privacy == 'friends':
            if str(original_post['user_id']) != user_id:
                # Kiểm tra quan hệ bạn bè
                post_owner = users_col().find_one({'_id': ObjectId(original_post['user_id'])})
                if not post_owner or user_id not in post_owner.get('friends', []):
                    return jsonify({'error': 'Chỉ bạn bè mới có thể chia sẻ bài viết này'}), 403

        # Xử lý theo loại chia sẻ
        if share_type == 'profile':
            # Chia sẻ về trang cá nhân
            # Kế thừa privacy từ bài gốc hoặc dùng privacy từ request
            shared_privacy = data.get('privacy') or post_privacy or 'public'
            
            shared_post_data = {
                'user_id': user_id,
                'content': content,
                'original_post_id': post_id,
                'original_user_id': original_post['user_id'],
                'share_type': 'profile',
                'privacy': shared_privacy,  # Kế thừa privacy từ bài gốc
                'created_at': get_vietnam_time(),
                'likes': [],
                'comments': [],
                'shares': 0,
                'media_urls': original_post.get('media_urls', []),
                'is_shared': True
            }

            shared_post_id = posts_col().insert_one(shared_post_data).inserted_id

            # Tăng số lượt chia sẻ của bài viết gốc
            posts_col().update_one(
                {'_id': ObjectId(post_id)},
                {'$inc': {'shares': 1}}
            )

            # Tạo thông báo cho người đăng bài gốc (nếu không phải tự chia sẻ)
            if str(original_post['user_id']) != user_id:
                try:
                    notification_data = {
                        'recipient_id': ObjectId(original_post['user_id']),
                        'sender_id': ObjectId(user_id),
                        'sender_name': user.get('full_name') or user.get('username') or 'Người dùng',
                        'type': 'share',
                        'content': f'đã chia sẻ bài viết của bạn',
                        'data': {
                            'post_id': str(post_id),
                            'shared_post_id': str(shared_post_id),
                            'post_preview': original_post.get('content', '')[:50] + '...' if original_post.get('content') else 'Bài viết'
                        },
                        'read': False,
                        'created_at': get_vietnam_time()
                    }

                    notifications_col().insert_one(notification_data)
                    socketio.emit('new_notification', notification_data, room=str(original_post['user_id']))

                except Exception as notif_error:
                    print(f"Error creating share notification: {str(notif_error)}")

            # Lấy thông tin user để trả về
            user_info = {
                'full_name': user.get('full_name', user.get('username', 'Người dùng')),
                'username': user.get('username', ''),
                'avatar': user.get('avatar', '/static/img/default-avatar.png')
            }
            
            # Xử lý avatar
            avatar = user_info['avatar']
            if avatar and not avatar.startswith(('http', 'data:image', '/static')):
                if avatar.startswith('uploads/'):
                    avatar = f'/static/{avatar}'
                elif not avatar.startswith('/'):
                    avatar = f'/static/uploads/{avatar}'
            else:
                avatar = '/static/img/default-avatar.png'
            
            # Lấy thông tin bài viết gốc để hiển thị
            original_user = users_col().find_one({'_id': original_post['user_id']})
            original_user_info = {
                'username': original_user.get('username', '') if original_user else '',
                'full_name': original_user.get('full_name', original_user.get('username', 'Người dùng')) if original_user else 'Người dùng',
                'avatar': original_user.get('avatar', '/static/img/default-avatar.png') if original_user else '/static/img/default-avatar.png'
            }
            
            # Xử lý avatar của người đăng bài gốc
            original_avatar = original_user_info['avatar']
            if original_avatar and not original_avatar.startswith(('http', 'data:image', '/static')):
                if original_avatar.startswith('uploads/'):
                    original_avatar = f'/static/{original_avatar}'
                elif not original_avatar.startswith('/'):
                    original_avatar = f'/static/uploads/{original_avatar}'
            
            return jsonify({
                'success': True,
                'shared_post_id': str(shared_post_id),
                'message': 'Đã chia sẻ bài viết về trang cá nhân',
                'share_type': share_type,
                'post': {
                    '_id': str(shared_post_id),
                    'author_name': user_info['full_name'],  # Tên người CHIA SẺ
                    'author_username': user_info['username'],
                    'author_avatar': avatar,
                    'content': content,
                    'created_at': shared_post_data['created_at'].isoformat(),
                    'time_ago': 'Vừa xong',
                    'likes_count': 0,
                    'comments_count': 0,
                    'shares_count': 0,
                    'is_liked': False,
                    'privacy': 'public',
                    'post_type': 'shared',
                    'is_shared': True,
                    'original_post_id': post_id,
                    'original_post': {
                        '_id': str(original_post['_id']),
                        'content': original_post.get('content', ''),
                        'media_urls': original_post.get('media_urls', []),
                        'owner_username': original_user_info['username'],
                        'owner_full_name': original_user_info['full_name'],  # THÊM: Tên người ĐĂNG bài gốc
                        'owner_avatar': original_avatar,
                        'created_at': original_post.get('created_at').isoformat() if isinstance(original_post.get('created_at'), datetime) else str(original_post.get('created_at'))
                    }
                }
            })

        elif share_type == 'story':
            # Chia sẻ vào tin nổi bật (story)
            story_data = {
                'user_id': user_id,
                'post_id': post_id,
                'content': content or 'Đã chia sẻ một bài viết',
                'type': 'shared_post',
                'created_at': get_vietnam_time(),
                'expires_at': get_vietnam_time() + timedelta(hours=24),  # Tin nổi bật tồn tại 24h
                'views': 0,
                'reactions': []
            }

            story_id = mongo.db.stories.insert_one(story_data).inserted_id

            return jsonify({
                'success': True,
                'story_id': str(story_id),
                'message': 'Đã đăng bài viết vào tin nổi bật',
                'share_type': share_type
            })

        elif share_type == 'message':
            # Chia sẻ qua tin nhắn
            if not target_id:
                return jsonify({'error': 'Thiếu ID người nhận'}), 400

            # Chuẩn bị nội dung tin nhắn
            message_content = json.dumps({
                'type': 'shared_post',
                'post_id': post_id,
                'preview_content': original_post.get('content', '')[:100],
                'media_count': len(original_post.get('media_urls', [])),
                'shared_by': user.get('username', 'Unknown'),
                'custom_message': content
            })

            message_data = {
                'sender_id': user_id,
                'content': message_content,
                'message_type': 'shared_post',
                'timestamp': get_vietnam_time(),
                'status': 'sent'
            }

            if target_type == 'group':
                # Chia sẻ vào nhóm
                message_data['group_id'] = ObjectId(target_id)
                message_id = group_messages_col().insert_one(message_data).inserted_id
                
                # Cập nhật last_message của nhóm
                groups_col().update_one(
                    {'_id': ObjectId(target_id)},
                    {
                        '$set': {
                            'last_message': f"{user.get('username')} đã chia sẻ một bài viết",
                            'last_message_time': get_vietnam_time(),
                            'last_message_user': ObjectId(user_id),
                            'last_sender_name': user.get('username')
                        }
                    }
                )
                
                # Phát socket event
                socketio.emit('group_message', {
                    'group_id': target_id,
                    'message': {**message_data, '_id': str(message_id)}
                }, room=f"group_{target_id}")
                
            else:
                # Chia sẻ vào cuộc trò chuyện riêng
                # Tìm hoặc tạo conversation
                conversation = conversations_col().find_one({
                    'participants': {
                        '$all': [user_id, target_id],
                        '$size': 2
                    }
                })
                
                if not conversation:
                    conversation = {
                        'participants': [user_id, target_id],
                        'created_at': get_vietnam_time(),
                        'last_message': None,
                        'last_message_time': None
                    }
                    conversation_id = conversations_col().insert_one(conversation).inserted_id
                else:
                    conversation_id = conversation['_id']
                
                message_data['conversation_id'] = conversation_id
                message_id = messages_col().insert_one(message_data).inserted_id
                
                # Cập nhật last_message của conversation
                conversations_col().update_one(
                    {'_id': conversation_id},
                    {
                        '$set': {
                            'last_message': f"{user.get('username')} đã chia sẻ một bài viết",
                            'last_message_time': get_vietnam_time()
                        }
                    }
                )
                
                # Phát socket event
                socketio.emit('private_message', {
                    'conversation_id': str(conversation_id),
                    'message': {**message_data, '_id': str(message_id)}
                }, room=str(conversation_id))

            # Tăng số lượt chia sẻ của bài viết gốc
            posts_col().update_one(
                {'_id': ObjectId(post_id)},
                {'$inc': {'shares': 1}}
            )

            return jsonify({
                'success': True,
                'message': 'Đã chia sẻ bài viết qua tin nhắn',
                'share_type': share_type,
                'target_type': target_type
            })

        else:
            return jsonify({'error': 'Loại chia sẻ không hợp lệ'}), 400

    except Exception as e:
        print(f"Error sharing post: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Lỗi khi chia sẻ bài viết'}), 500
    

@main.route('/get_shared_post_info/<post_id>')
def get_shared_post_info(post_id):
    """Lấy thông tin bài viết được chia sẻ"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        if not ObjectId.is_valid(post_id):
            return jsonify({'error': 'ID bài viết không hợp lệ'}), 400

        post = posts_col().find_one({'_id': ObjectId(post_id)})
        if not post:
            return jsonify({'error': 'Bài viết không tồn tại'}), 404

        # Lấy thông tin người đăng
        post_owner = users_col().find_one({'_id': ObjectId(post['user_id'])}, {'username': 1, 'avatar': 1})
        
        # Xử lý avatar
        avatar = post_owner.get('avatar') if post_owner else None
        if avatar and not avatar.startswith(('http', 'data:image')):
            avatar = url_for('static', filename=avatar)
        owner_avatar = avatar or url_for('static', filename='img/default-avatar.png')

        # Lấy thông tin bài viết gốc (nếu là shared post)
        original_post_info = None
        if post.get('original_post_id'):
            original_post = posts_col().find_one({'_id': ObjectId(post['original_post_id'])})
            if original_post:
                original_owner = users_col().find_one({'_id': ObjectId(original_post['user_id'])}, {'username': 1})
                original_post_info = {
                    'id': str(original_post['_id']),
                    'content': original_post.get('content', ''),
                    'owner_name': original_owner.get('username', 'Unknown') if original_owner else 'Unknown',
                    'created_at': original_post.get('created_at')
                }

        return jsonify({
            'success': True,
            'post': {
                'id': str(post['_id']),
                'content': post.get('content', ''),
                'owner_id': post['user_id'],
                'owner_name': post_owner.get('username', 'Unknown') if post_owner else 'Unknown',
                'owner_avatar': owner_avatar,
                'created_at': post.get('created_at'),
                'media_urls': post.get('media_urls', []),
                'original_post': original_post_info,
                'is_shared': post.get('is_shared', False),
                'share_type': post.get('share_type', 'post')
            }
        })

    except Exception as e:
        print(f"Error getting shared post info: {str(e)}")
        return jsonify({'error': 'Lỗi khi lấy thông tin bài viết'}), 500

@main.route('/get_shared_posts/<post_id>')
def get_shared_posts(post_id):
    """Lấy danh sách các bài viết đã chia sẻ từ bài viết gốc"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        if not ObjectId.is_valid(post_id):
            return jsonify({'error': 'ID bài viết không hợp lệ'}), 400
# Lấy tất cả bài viết đã chia sẻ từ bài viết này
        shared_posts = list(posts_col().find({
            'original_post_id': post_id,
            'is_shared': True
        }, sort=[('created_at', -1)]))

        # Lấy thông tin người chia sẻ
        result = []
        for shared_post in shared_posts:
            sharer = users_col().find_one(
                {'_id': ObjectId(shared_post['user_id'])},
                {'username': 1, 'avatar': 1}
            )
            
            if sharer:
                avatar = sharer.get('avatar')
                if avatar and not avatar.startswith(('http', 'data:image')):
                    avatar = url_for('static', filename=avatar)
                
                result.append({
                    'post_id': str(shared_post['_id']),
                    'sharer_id': shared_post['user_id'],
                    'sharer_name': sharer['username'],
                    'sharer_avatar': avatar or url_for('static', filename='img/default-avatar.png'),
                    'content': shared_post.get('content', ''),
                    'share_type': shared_post.get('share_type', 'profile'),
                    'created_at': shared_post.get('created_at'),
                    'like_count': len(shared_post.get('likes', [])),
                    'comment_count': len(shared_post.get('comments', []))
                })

        return jsonify({
            'success': True,
            'shared_posts': result,
            'total': len(result)
        })

    except Exception as e:
        print(f"Error getting shared posts: {str(e)}")
        return jsonify({'error': 'Lỗi khi lấy danh sách chia sẻ'}), 500

@main.route('/undo_share/<shared_post_id>', methods=['POST'])
def undo_share(shared_post_id):
    """Hủy chia sẻ bài viết"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        if not ObjectId.is_valid(shared_post_id):
            return jsonify({'error': 'ID bài viết không hợp lệ'}), 400

        shared_post = posts_col().find_one({'_id': ObjectId(shared_post_id)})
        
        if not shared_post:
            return jsonify({'error': 'Bài viết chia sẻ không tồn tại'}), 404

        # Kiểm tra quyền (chỉ người chia sẻ mới được hủy)
        if shared_post['user_id'] != session['user_id']:
            return jsonify({'error': 'Không có quyền hủy chia sẻ bài viết này'}), 403

        # Xóa bài viết chia sẻ
        posts_col().delete_one({'_id': ObjectId(shared_post_id)})

        # Giảm số lượt chia sẻ của bài viết gốc
        if shared_post.get('original_post_id'):
            posts_col().update_one(
                {'_id': ObjectId(shared_post['original_post_id'])},
                {'$inc': {'shares': -1}}
            )

        return jsonify({
            'success': True,
            'message': 'Đã hủy chia sẻ bài viết'
        })
    except Exception as e:
        print(f"Error undoing share: {str(e)}")
        return jsonify({'error': 'Lỗi khi hủy chia sẻ'}), 500

@main.route('/check_shared_status/<post_id>')
def check_shared_status(post_id):
    """Kiểm tra xem người dùng đã chia sẻ bài viết này chưa"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        if not ObjectId.is_valid(post_id):
            return jsonify({'error': 'ID bài viết không hợp lệ'}), 400

        # Kiểm tra xem người dùng đã chia sẻ bài viết này chưa
        shared_post = posts_col().find_one({
            'original_post_id': post_id,
            'user_id': session['user_id'],
            'is_shared': True
        })

        if shared_post:
            return jsonify({
                'success': True,
                'has_shared': True,
                'shared_post_id': str(shared_post['_id']),
                'share_type': shared_post.get('share_type', 'profile')
            })
        else:
            return jsonify({
                'success': True,
                'has_shared': False
            })

    except Exception as e:
        print(f"Error checking shared status: {str(e)}")
        return jsonify({'error': 'Lỗi khi kiểm tra trạng thái chia sẻ'}), 500
    

def _process_comment_like_api(post_id, comment_id, reply_id, user_id):
    """Xử lý like/unlike comment cho API endpoint - VERSION SMART"""
    try:
        print(f"[DEBUG] _process_comment_like_api called with: post_id={post_id}, comment_id={comment_id}, reply_id={reply_id}, user_id={user_id}")
        
        if not ObjectId.is_valid(post_id):
            return {'success': False, 'error': 'ID bài viết không hợp lệ'}
        
        post_oid = ObjectId(post_id)
        post = posts_col().find_one({'_id': post_oid})
        
        if not post:
            return {'success': False, 'error': 'Bài viết không tồn tại'}
        
        user = users_col().find_one({'_id': ObjectId(user_id)}, {'username': 1})
        if not user:
            return {'success': False, 'error': 'Người dùng không tồn tại'}
        
        # PHÁT HIỆN VÀ SỬA LỖI FRONTEND: Nếu reply_id == comment_id, có thể frontend đang truyền sai
        # Tìm comment gốc cho reply này
        if reply_id and reply_id == comment_id:
            print(f"[DEBUG] Detected frontend bug: reply_id == comment_id, searching for parent comment...")
            
            # Tìm comment gốc chứa reply này
            parent_comment_id = None
            for comment in post.get('comments', []):
                for reply in comment.get('replies', []):
                    if reply.get('id') == reply_id:
                        parent_comment_id = comment.get('id')
                        break
                if parent_comment_id:
                    break
            
            if parent_comment_id:
                print(f"[DEBUG] Found parent comment: {parent_comment_id}")
                comment_id = parent_comment_id  # Sửa comment_id thành ID của comment gốc
            else:
                # Nếu không tìm thấy, có thể đây thực sự là comment, không phải reply
                print(f"[DEBUG] No parent found, treating as comment like")
                reply_id = None
        
        # Tìm comment trong bài viết
        comment_found = None
        comment_index = -1
        
        for i, comment in enumerate(post.get('comments', [])):
            if comment.get('id') == comment_id:
                comment_found = comment
                comment_index = i
                break
        
        if not comment_found:
            print(f"[DEBUG] Comment with id={comment_id} not found!")
            return {'success': False, 'error': 'Bình luận không tồn tại'}
        
        print(f"[DEBUG] Found comment at index {comment_index}")
        
        # Xác định target (comment hoặc reply)
        if reply_id:
            # Tìm reply trong comment
            print(f"[DEBUG] Looking for reply: {reply_id}")
            reply_found = None
            reply_index = -1
            
            for j, reply in enumerate(comment_found.get('replies', [])):
                print(f"[DEBUG] Checking reply {j}: id={reply.get('id')}")
                if reply.get('id') == reply_id:
                    reply_found = reply
                    reply_index = j
                    break
            
            if not reply_found:
                print(f"[DEBUG] Reply with id={reply_id} not found in comment!")
                return {'success': False, 'error': 'Phản hồi không tồn tại'}
            
            print(f"[DEBUG] Found reply at index {reply_index}")
            
            # Like/Unlike reply
            likes = reply_found.get('likes', [])
            print(f"[DEBUG] Current reply likes: {likes}")
            
            if user_id in likes:
                # Unlike: Xóa user khỏi danh sách likes
                print(f"[DEBUG] User already liked, unliking...")
                posts_col().update_one(
                    {'_id': post_oid},
                    {'$pull': {f'comments.{comment_index}.replies.{reply_index}.likes': user_id}}
                )
                liked = False
                action = 'unliked'
            else:
                # Like: Thêm user vào danh sách likes
                print(f"[DEBUG] User not liked yet, liking...")
                posts_col().update_one(
                    {'_id': post_oid},
                    {'$addToSet': {f'comments.{comment_index}.replies.{reply_index}.likes': user_id}}
                )
                liked = True
                action = 'liked'
            
            # Lấy số lượng like mới
            updated_post = posts_col().find_one({'_id': post_oid})
            if updated_post:
                comment = updated_post['comments'][comment_index]
                reply = comment['replies'][reply_index]
                like_count = len(reply.get('likes', []))
            else:
                like_count = 0
        else:
            # Like/Unlike comment chính
            print(f"[DEBUG] Processing comment like")
            likes = comment_found.get('likes', [])
            print(f"[DEBUG] Current comment likes: {likes}")
            
            if user_id in likes:
                # Unlike: Xóa user khỏi danh sách likes
                print(f"[DEBUG] User already liked comment, unliking...")
                posts_col().update_one(
                    {'_id': post_oid, 'comments.id': comment_id},
                    {'$pull': {'comments.$.likes': user_id}}
                )
                liked = False
                action = 'unliked'
            else:
                # Like: Thêm user vào danh sách likes
                print(f"[DEBUG] User not liked comment yet, liking...")
                posts_col().update_one(
                    {'_id': post_oid, 'comments.id': comment_id},
                    {'$addToSet': {'comments.$.likes': user_id}}
                )
                liked = True
                action = 'liked'
            
            # Lấy số lượng like mới
            updated_post = posts_col().find_one({'_id': post_oid})
            if updated_post:
                for comment in updated_post.get('comments', []):
                    if comment.get('id') == comment_id:
                        like_count = len(comment.get('likes', []))
                        break
                else:
                    like_count = 0
            else:
                like_count = 0
        
        print(f"[DEBUG] Result: liked={liked}, like_count={like_count}")
        
        # Tạo notification data cho người được like (nếu không phải tự like)
        notification_recipient = None
        if liked:
            # Xác định chủ sở hữu của comment/reply
            target_owner = None
            if reply_id and reply_id is not None: 
                # Lưu ý: biến reply_found chỉ tồn tại trong block if reply_id, 
                # cần cẩn thận logic ở đây. Tốt nhất check lại reply_id
                 if 'reply_found' in locals() and reply_found:
                    target_owner = reply_found.get('user_id')
            else:
                target_owner = comment_found.get('user_id')
            
            # Tạo thông báo nếu không phải tự like
            if target_owner and target_owner != user_id:
                notification_recipient = target_owner
        
        # Gửi notification nếu cần
        if notification_recipient:
            try:
                # Tạo và gửi notification
                notification_data = {
                    'recipient_id': ObjectId(notification_recipient),
                    'sender_id': ObjectId(user_id),
                    'sender_name': user.get('full_name') or user.get('username') or 'Người dùng',
                    'type': 'comment_like',
                    'content': 'đã thích bình luận của bạn',
                    'data': {
                        'post_id': str(post_id),
                        'comment_id': comment_id,
                        'reply_id': reply_id,
                        'post_preview': post.get('content', '')[:50] + '...' if post.get('content') else 'Bài viết'
                    },
                    'read': False,
                    'created_at': get_vietnam_time()
                }
                
                # Lưu notification vào database
                notifications_col().insert_one(notification_data)
                
                # Gửi socket event
                socketio.emit('new_notification', notification_data, room=notification_recipient)
                
            except Exception as notif_error:
                print(f"Error creating comment like notification: {str(notif_error)}")
        
        return {
            'success': True,
            'action': action,
            'liked': liked,
            'like_count': like_count,
            'user_id': user_id,
            'username': user.get('username', 'Unknown')
        }
        
    except Exception as e:
        print(f"[ERROR] Error in _process_comment_like_api: {str(e)}")
        import traceback
        traceback.print_exc()
        return {'success': False, 'error': f'Lỗi khi xử lý like bình luận: {str(e)}'}
    
@main.route('/like_comment', methods=['POST'])
def like_comment():
    """Like/Unlike bình luận - VERSION WITH REAL-TIME UPDATES"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        data = request.get_json()
        post_id = data.get('post_id')
        comment_id = data.get('comment_id')
        reply_id = data.get('reply_id')  # ID của reply (nếu like reply)

        if not post_id or not comment_id:
            return jsonify({'error': 'Thiếu thông tin'}), 400

        user_id = session['user_id']
        
        # SỬA LẠI: Gọi hàm xử lý trực tiếp thay vì import
        result = _process_comment_like_api(post_id, comment_id, reply_id, user_id)
        
        if result.get('success'):
            # Gửi socket event để cập nhật realtime
            socketio.emit('comment_liked_updated', {
                'post_id': post_id,
                'comment_id': comment_id,
                'reply_id': reply_id,
                'user_id': user_id,
                'liked': result['liked'],
                'like_count': result['like_count']
            }, room=f'post_{post_id}')
            
            return jsonify(result)
        else:
            return jsonify({'error': result.get('error', 'Lỗi khi thích bình luận')}), 500

    except Exception as e:
        print(f"[ERROR] Error liking comment: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Lỗi khi thích bình luận: {str(e)}'}), 500
    

def get_user_by_id(user_id):
    """Helper function để lấy user bằng ID"""
    try:
        user = users_col().find_one({'_id': ObjectId(user_id)}, {'username': 1, 'avatar': 1})
        return user
    except:
        return None

@main.app_template_filter('get_user_by_id')
def get_user_by_id_filter(user_id):
    """Template filter để lấy thông tin user"""
    return get_user_by_id(user_id)

@main.route('/get_original_post_info/<post_id>')
def get_original_post_info(post_id):
    """API lấy thông tin bài viết gốc"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        post = posts_col().find_one({'_id': ObjectId(post_id)})
        if not post:
            return jsonify({'error': 'Post not found'}), 404
        
        original_post_info = None
        if post.get('is_shared') and post.get('original_post_id'):
            original_post = posts_col().find_one(
                {'_id': ObjectId(post['original_post_id'])},
                {'content': 1, 'user_id': 1, 'created_at': 1}
            )
            
            if original_post:
                original_user = get_user_by_id(original_post['user_id'])
                original_post_info = {
                    'id': str(original_post['_id']),
                    'content': original_post.get('content', ''),
                    'user_id': original_post['user_id'],
                    'user_name': original_user['username'] if original_user else 'Unknown',
                    'created_at': original_post.get('created_at').isoformat() if original_post.get('created_at') else '',
                    'avatar': original_user.get('avatar', '') if original_user else ''
                }
        
        return jsonify({
            'success': True,
            'is_shared': post.get('is_shared', False),
            'original_post': original_post_info,
            'share_content': post.get('content', '') if post.get('is_shared') else None
        })
        
    except Exception as e:
        print(f"Error getting original post info: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

@main.app_template_filter('format_share_date')
def format_share_date(dt):
    """Format date for shared posts"""
    if isinstance(dt, datetime):
        return dt.strftime("Chia sẻ ngày %d/%m/%Y lúc %H:%M")
    return dt

# Thêm helper function
def get_original_user_info(original_user_id):
    """Lấy thông tin người dùng gốc"""
    try:
        user = users_col().find_one(
            {'_id': ObjectId(original_user_id)},
            {'username': 1, 'avatar': 1}
        )
        return user
    except:
        return None
    

def ensure_comment_structure(post):
    """Đảm bảo cấu trúc comments có đầy đủ các trường cần thiết"""
    if 'comments' not in post:
        post['comments'] = []
    
    for comment in post['comments']:
        # Đảm bảo mỗi comment có replies
        if 'replies' not in comment:
            comment['replies'] = []
        
        # Đảm bảo mỗi reply có đầy đủ trường
        for reply in comment['replies']:
            if not reply.get('id'):
                reply['id'] = str(uuid.uuid4())
            if not reply.get('user_avatar'):
                reply['user_avatar'] = '/static/img/default-avatar.png'
            if not reply.get('username'):
                reply['username'] = 'Unknown'
            if not reply.get('content'):
                reply['content'] = ''
            # KHÔNG tạo replies cho reply (không nested)
            if 'replies' in reply:
                del reply['replies']  # Xóa nếu có để đảm bảo cùng cấp
    
    return post
# 13/12/2025 - API đặt theme cho nhóm theo từng user (màu preset hoặc ảnh nền)
@main.route('/set_group_theme', methods=['POST'])
def set_group_theme():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401

    data = request.get_json() or {}
    group_id = data.get('group_id')
    theme_type = (data.get('theme_type') or 'color').strip().lower()

    if not group_id:
        return jsonify({'success': False, 'error': 'Missing group_id'}), 400

    try:
        group_oid = ObjectId(group_id)
    except Exception:
        return jsonify({'success': False, 'error': 'Invalid group ID'}), 400

    try:
        user_oid = ObjectId(session['user_id'])
    except Exception:
        return jsonify({'success': False, 'error': 'Invalid user ID in session'}), 400

    # 13/12/2025 - Chỉ cho phép thành viên nhóm thay đổi theme của chính mình
    is_member = group_members_col().find_one({
        'group_id': group_oid,
        'user_id': user_oid
    })
    if not is_member:
        return jsonify({'success': False, 'error': 'Not a member of this group'}), 403

    theme_doc = {}

    if theme_type == 'color':
        theme_name = (data.get('theme_name') or 'default').strip().lower()
        allowed_themes = {'default', 'blue', 'pink', 'dark'}
        if theme_name not in allowed_themes:
            theme_name = 'default'
        theme_doc = {
            'type': 'color',
            'name': theme_name
        }
    elif theme_type == 'image':
        image_url = (data.get('image_url') or '').strip()
        thumbnail_url = (data.get('thumbnail_url') or '').strip()
        if not image_url:
            return jsonify({'success': False, 'error': 'Missing image_url for image theme'}), 400
        theme_doc = {
            'type': 'image',
            'image_url': image_url
        }
        if thumbnail_url:
            theme_doc['thumbnail_url'] = thumbnail_url
    else:
        return jsonify({'success': False, 'error': 'Invalid theme_type'}), 400

    user_id_str = session['user_id']

    try:
        groups_col().update_one(
            {'_id': group_oid},
            {'$set': {f'themes.{user_id_str}': theme_doc}}
        )
    except Exception as e:
        print(f"Error setting group theme: {e}")
        return jsonify({'success': False, 'error': 'Internal server error'}), 500

    return jsonify({'success': True, 'theme': theme_doc})
# 13/12/2025 - API ẩn/xóa hội thoại nhóm cho riêng từng user (soft hide)
@main.route('/hide_group_conversation', methods=['POST'])
def hide_group_conversation():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401

    data = request.get_json() or {}
    group_id = data.get('group_id')

    if not group_id:
        return jsonify({'success': False, 'error': 'Missing group_id'}), 400

    try:
        group_oid = ObjectId(group_id)
        user_oid = ObjectId(session['user_id'])
    except Exception:
        return jsonify({'success': False, 'error': 'Invalid ID'}), 400

    membership = group_members_col().find_one({
        'group_id': group_oid,
        'user_id': user_oid
    })
    if not membership:
        return jsonify({'success': False, 'error': 'Not a member of this group'}), 404

    try:
        group_members_col().update_one(
            {'_id': membership['_id']},
            {'$set': {'hidden': True}}
        )
    except Exception as e:
        print(f"Error hiding group conversation: {e}")
        return jsonify({'success': False, 'error': 'Internal server error'}), 500

    return jsonify({'success': True})

# 13/12/2025 - API tắt/bật thông báo tạm thời cho hội thoại
@main.route('/mute_conversation', methods=['POST'])
def mute_conversation():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.get_json() or {}
    conversation_id = data.get('conversation_id')
    duration = (data.get('duration') or '').strip().lower()

    if not conversation_id:
        return jsonify({'error': 'Missing conversation_id'}), 400

    try:
        conv_oid = ObjectId(conversation_id)
    except Exception:
        return jsonify({'error': 'Invalid conversation ID'}), 400

    user_id = session['user_id']

    conv = conversations_col().find_one({'_id': conv_oid, 'participants': user_id})
    if not conv:
        return jsonify({'error': 'Conversation not found'}), 404

    updates = {}
    is_muted = False
    mute_until_value = None

    # 13/12/2025 - Parse thời gian mute tạm thời: 15m, 1h, 8h, 24h, 7d, forever, off
    if not duration or duration in ('off', '0', 'none'):
        updates['$unset'] = {f'mute_until.{user_id}': ""}
    else:
        base = get_vietnam_time()
        td = None

        if duration.endswith('m'):
            try:
                minutes = int(duration[:-1] or 0)
                td = timedelta(minutes=minutes)
            except Exception:
                td = None
        elif duration.endswith('h'):
            try:
                hours = int(duration[:-1] or 0)
                td = timedelta(hours=hours)
            except Exception:
                td = None
        elif duration.endswith('d'):
            try:
                days = int(duration[:-1] or 0)
                td = timedelta(days=days)
            except Exception:
                td = None
        elif duration in ('24h', '1d'):
            td = timedelta(hours=24)
        elif duration == 'forever':
            mute_until_value = 'forever'

        if td is not None and mute_until_value is None:
            mute_until_value = base + td

        if mute_until_value is None:
            # Nếu parse lỗi -> mặc định 8h
            mute_until_value = base + timedelta(hours=8)

        if isinstance(mute_until_value, str) and mute_until_value == 'forever':
            updates['$set'] = {f'mute_until.{user_id}': 'forever'}
        else:
            updates['$set'] = {f'mute_until.{user_id}': mute_until_value}

        is_muted = True

    conversations_col().update_one({'_id': conv_oid}, updates)

    if '$unset' in updates:
        is_muted = False
        mute_until_value = None

    return jsonify({
        'success': True,
        'is_muted': is_muted,
        'mute_until': mute_until_value.isoformat() if isinstance(mute_until_value, datetime) else (mute_until_value if mute_until_value else None)
    })
# 13/12/2025 - API tắt/bật thông báo tạm thời cho nhóm (per-user)
@main.route('/mute_group', methods=['POST'])
def mute_group():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401

    data = request.get_json() or {}
    group_id = data.get('group_id')
    duration = (data.get('duration') or '').strip().lower()

    if not group_id:
        return jsonify({'success': False, 'error': 'Missing group_id'}), 400

    try:
        group_oid = ObjectId(group_id)
    except Exception:
        return jsonify({'success': False, 'error': 'Invalid group ID'}), 400

    try:
        user_oid = ObjectId(session['user_id'])
    except Exception:
        return jsonify({'success': False, 'error': 'Invalid user ID in session'}), 400

    # Chỉ cho phép thành viên của nhóm mute nhóm đó
    is_member = group_members_col().find_one({
        'group_id': group_oid,
        'user_id': user_oid
    })
    if not is_member:
        return jsonify({'success': False, 'error': 'Not a member of this group'}), 403

    updates = {}
    is_muted = False
    mute_until_value = None

    user_id_str = session['user_id']

    # 13/12/2025 - Parse thời gian mute tạm thời: 15m, 1h, 8h, 24h, 7d, forever, off
    if not duration or duration in ('off', '0', 'none'):
        updates['$unset'] = {f'mute_until.{user_id_str}': ""}
    else:
        base = get_vietnam_time()
        td = None

        if duration.endswith('m'):
            try:
                minutes = int(duration[:-1] or 0)
                td = timedelta(minutes=minutes)
            except Exception:
                td = None
        elif duration.endswith('h'):
            try:
                hours = int(duration[:-1] or 0)
                td = timedelta(hours=hours)
            except Exception:
                td = None
        elif duration.endswith('d'):
            try:
                days = int(duration[:-1] or 0)
                td = timedelta(days=days)
            except Exception:
                td = None
        elif duration in ('24h', '1d'):
            td = timedelta(hours=24)
        elif duration == 'forever':
            mute_until_value = 'forever'

        if td is not None and mute_until_value is None:
            mute_until_value = base + td

        if mute_until_value is None:
            # Nếu parse lỗi -> mặc định 8h
            mute_until_value = base + timedelta(hours=8)

        if isinstance(mute_until_value, str) and mute_until_value == 'forever':
            updates['$set'] = {f'mute_until.{user_id_str}': 'forever'}
        else:
            updates['$set'] = {f'mute_until.{user_id_str}': mute_until_value}

        is_muted = True

    try:
        groups_col().update_one({'_id': group_oid}, updates)
    except Exception as e:
        print(f"Error updating mute_group: {e}")
        return jsonify({'success': False, 'error': 'Internal server error'}), 500

    if '$unset' in updates:
        is_muted = False
        mute_until_value = None

    return jsonify({
        'success': True,
        'is_muted': is_muted,
        'mute_until': mute_until_value.isoformat() if isinstance(mute_until_value, datetime) else (mute_until_value if mute_until_value else None)
    })

# 13/12/2025 - API xóa hội thoại (chỉ ẩn với user hiện tại, không xóa dữ liệu gốc)
@main.route('/delete_conversation', methods=['POST'])
def delete_conversation():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.get_json() or {}
    conversation_id = data.get('conversation_id')

    if not conversation_id:
        return jsonify({'error': 'Missing conversation_id'}), 400

    try:
        conv_oid = ObjectId(conversation_id)
    except Exception:
        return jsonify({'error': 'Invalid conversation ID'}), 400

    user_id = session['user_id']

    conv = conversations_col().find_one({'_id': conv_oid, 'participants': user_id})
    if not conv:
        return jsonify({'error': 'Conversation not found'}), 404

    # 13/12/2025 - Khi user xóa hội thoại:
    # - Thêm user vào deleted_for để ẩn khỏi danh sách hội thoại
    # - Lưu thời điểm xóa vào deleted_at_for.<user_id> để sau này không hiển thị
    #   các tin nhắn cũ trước thời điểm này cho riêng user đó
    now_utc = datetime.utcnow()

    result = conversations_col().update_one(
        {'_id': conv_oid},
        {
            '$addToSet': {'deleted_for': user_id},
            '$set': {f'deleted_at_for.{user_id}': now_utc}
        }
    )

    return jsonify({
        'success': result.modified_count > 0,
        'conversation_id': conversation_id
    })
# 13/12/2025 - API đặt theme riêng cho từng hội thoại theo từng user
@main.route('/set_conversation_theme', methods=['POST'])
def set_conversation_theme():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.get_json() or {}
    conversation_id = data.get('conversation_id')
    theme = (data.get('theme') or 'default').strip()

    if not conversation_id:
        return jsonify({'error': 'Missing conversation_id'}), 400

    try:
        conv_oid = ObjectId(conversation_id)
    except Exception:
        return jsonify({'error': 'Invalid conversation ID'}), 400

    user_id = session['user_id']

    conv = conversations_col().find_one({'_id': conv_oid, 'participants': user_id})
    if not conv:
        return jsonify({'error': 'Conversation not found'}), 404

    # Chỉ cho phép một số theme đơn giản để tránh lỗi CSS
    allowed_themes = {'default', 'blue', 'pink', 'dark'}
    if theme not in allowed_themes:
        theme = 'default'

    conversations_col().update_one(
        {'_id': conv_oid},
        {'$set': {f'themes.{user_id}': theme}}
    )

    return jsonify({'success': True, 'theme': theme})


# 13/12/2025 - API đặt theme ảnh nền cho hội thoại 1v1 theo từng user
@main.route('/set_conversation_image_theme', methods=['POST'])
def set_conversation_image_theme():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401

    data = request.get_json() or {}
    conversation_id = data.get('conversation_id')
    image_url = (data.get('image_url') or '').strip()

    if not conversation_id:
        return jsonify({'success': False, 'error': 'Missing conversation_id'}), 400

    if not image_url:
        return jsonify({'success': False, 'error': 'Missing image_url'}), 400

    try:
        conv_oid = ObjectId(conversation_id)
    except Exception:
        return jsonify({'success': False, 'error': 'Invalid conversation ID'}), 400

    user_id = session['user_id']

    # 13/12/2025 - Chỉ cho phép participant của hội thoại đặt theme ảnh
    conv = conversations_col().find_one({'_id': conv_oid, 'participants': user_id})
    if not conv:
        return jsonify({'success': False, 'error': 'Conversation not found'}), 404

    # 13/12/2025 - Lưu theme dạng chuỗi image:URL để frontend dễ parse
    stored_theme = f"image:{image_url}"

    conversations_col().update_one(
        {'_id': conv_oid},
        {'$set': {f'themes.{user_id}': stored_theme}}
    )

    return jsonify({'success': True, 'theme': stored_theme})
#17/12
# Thêm vào routes.py
@main.route('/api/timeline/friends/active')
def get_timeline_active_friends():
    """API endpoint để lấy danh sách bạn bè đang hoạt động cho timeline"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401

    try:
        user_id = session['user_id']
        user = mongo.db.users.find_one({'_id': ObjectId(user_id)})
        
        if not user:
            return jsonify({'success': False, 'error': 'User not found'}), 404

        # Lấy danh sách bạn bè và lọc những người online
        friend_ids = user.get('friends', [])
        valid_friend_ids = []
        
        for fid in friend_ids:
            if ObjectId.is_valid(fid):
                friend_exists = mongo.db.users.find_one({'_id': ObjectId(fid)})
                if friend_exists:
                    valid_friend_ids.append(ObjectId(fid))
        
        # Lấy thông tin bạn bè đang online CHỈ những người online = True
        online_friends = list(mongo.db.users.find(
            {'_id': {'$in': valid_friend_ids}, 'online': True},
            {'username': 1, 'avatar': 1}
        ))
        
        # Format dữ liệu
        friends_data = []
        for friend in online_friends:
            avatar = friend.get('avatar')
            if not avatar:
                avatar = '/static/img/default-avatar.png'
            elif avatar.startswith('data:image'):
                pass
            elif not avatar.startswith(('http', '/static')):
                avatar = f'/static/uploads/{avatar}'
            
            friends_data.append({
                '_id': str(friend['_id']),
                'username': friend['username'],
                'avatar': avatar,
                'name': friend['username']
            })
        
        # print(f"DEBUG: Found {len(friends_data)} online friends for timeline API")
        
        return jsonify({
            'success': True,
            'friends': friends_data,
            'count': len(friends_data)
        })
        
    except Exception as e:
        print(f"Error getting timeline active friends: {str(e)}")
        return jsonify({'success': False, 'error': 'Internal server error'}), 500

@main.route('/reset_mable_status', methods=['POST'])
def reset_mable_status():
    """Simple route to reset mable_siriwalee's online status"""
    try:
        # Reset mable_siriwalee to offline
        result = mongo.db.users.update_one(
            {'username': 'mable_siriwalee'},
            {'$set': {'online': False}}
        )
        
        # Remove from online users tracking if present
        from app.events import online_users, sid_to_user
        user_to_remove = None
        for user_id, sid in online_users.items():
            user = mongo.db.users.find_one({'_id': ObjectId(user_id)})
            if user and user.get('username') == 'mable_siriwalee':
                user_to_remove = user_id
                break
        
        if user_to_remove:
            online_users.pop(user_to_remove, None)
            # Find and remove from sid_to_user mapping
            sid_to_remove = None
            for sid, uid in sid_to_user.items():
                if uid == user_to_remove:
                    sid_to_remove = sid
                    break
            if sid_to_remove:
                sid_to_user.pop(sid_to_remove, None)
        
        print(f"Reset mable_siriwalee online status: {result.modified_count} documents modified")
        
        return jsonify({
            'success': True,
            'message': f'Reset mable_siriwalee online status',
            'modified': result.modified_count
        })
        
    except Exception as e:
        print(f"Error resetting mable_siriwalee online status: {str(e)}")
        return jsonify({'success': False, 'error': 'Internal server error'}), 500

# ==================== UPCOMING EVENTS API ====================

@main.route('/api/upcoming-events')
def get_upcoming_events():
    """API lấy sự kiện sắp tới: sinh nhật bạn bè + lễ hội"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    
    try:
        user_id = session['user_id']
        current_user = users_col().find_one({'_id': ObjectId(user_id)})
        
        if not current_user:
            return jsonify({'success': False, 'error': 'User not found'}), 404
        
        today = datetime.now()
        events = []
        
        # 1. Sinh nhật bạn bè (lấy từ date_of_birth)
        friend_ids = current_user.get('friends', [])
        if friend_ids:
            # Chỉ lấy friends có date_of_birth
            friends_with_dob = list(users_col().find({
                '_id': {'$in': [ObjectId(fid) for fid in friend_ids if ObjectId.is_valid(fid)]},
                'date_of_birth': {'$exists': True, '$ne': None, '$ne': ''}
            }, {'username': 1, 'full_name': 1, 'avatar': 1, 'date_of_birth': 1}))
            
            for friend in friends_with_dob:
                try:
                    # Parse date_of_birth (format: YYYY-MM-DD)
                    dob_str = friend.get('date_of_birth', '')
                    if not dob_str:
                        continue
                    
                    # Parse ngày sinh
                    if isinstance(dob_str, str):
                        dob = datetime.strptime(dob_str[:10], '%Y-%m-%d')
                    elif isinstance(dob_str, datetime):
                        dob = dob_str
                    else:
                        continue
                    
                    # Tính ngày sinh nhật năm nay
                    birthday_this_year = dob.replace(year=today.year)
                    
                    # Nếu đã qua, tính năm sau
                    if birthday_this_year.date() < today.date():
                        birthday_this_year = birthday_this_year.replace(year=today.year + 1)
                    
                    # Tính số ngày còn lại
                    days_until = (birthday_this_year.date() - today.date()).days
                    
                    # Chỉ lấy sinh nhật trong vòng 30 ngày tới
                    if days_until <= 30:
                        age = birthday_this_year.year - dob.year
                        
                        # Xử lý avatar
                        avatar = friend.get('avatar', '')
                        if avatar and not avatar.startswith(('http', 'data:image', '/static')):
                            avatar = f'/static/uploads/{avatar}'
                        elif not avatar:
                            avatar = '/static/img/default-avatar.png'
                        
                        events.append({
                            '_id': str(friend['_id']),
                            'title': f"Sinh nhật {friend.get('full_name', friend['username'])}",
                            'subtitle': f"Tròn {age} tuổi",
                            'date': birthday_this_year.isoformat(),
                            'days_until': days_until,
                            'type': 'birthday',
                            'avatar': avatar,
                            'friend_id': str(friend['_id']),
                            'friend_name': friend.get('full_name', friend['username'])
                        })
                except Exception as e:
                    print(f"Error processing birthday for {friend.get('username')}: {e}")
                    continue
        
        # 2. Lễ hội/lễ tết quan trọng (hardcoded cho Việt Nam)
        world_holidays = [
            {'month': 1, 'day': 1, 'title': 'Tết Dương Lịch', 'type': 'holiday'},
            {'month': 2, 'day': 14, 'title': 'Valentine', 'type': 'holiday'},
            {'month': 3, 'day': 8, 'title': 'Quốc tế Phụ nữ', 'type': 'holiday'},
            {'month': 4, 'day': 30, 'title': 'Giải phóng miền Nam', 'type': 'holiday'},
            {'month': 5, 'day': 1, 'title': 'Quốc tế Lao động', 'type': 'holiday'},
            {'month': 6, 'day': 1, 'title': 'Quốc tế Thiếu nhi', 'type': 'holiday'},
            {'month': 9, 'day': 2, 'title': 'Quốc khánh', 'type': 'holiday'},
            {'month': 11, 'day': 20, 'title': 'Nhà giáo Việt Nam', 'type': 'holiday'},
            {'month': 12, 'day': 25, 'title': 'Giáng sinh', 'type': 'holiday'},
        ]
        
        # Thêm Tết Nguyên Đán (cần tính theo năm, đơn giản hóa)
        current_year = today.year
        # Tết 2025: 29/01/2025, Tết 2026: 17/02/2026 (đơn giản hóa)
        tet_dates = {
            2025: (1, 29),
            2026: (2, 17),
            2027: (2, 6),
            2028: (1, 26),
        }
        
        if current_year in tet_dates or (current_year + 1) in tet_dates:
            for year in [current_year, current_year + 1]:
                if year in tet_dates:
                    month, day = tet_dates[year]
                    tet_date = datetime(year, month, day)
                    days_until = (tet_date.date() - today.date()).days
                    
                    # Chỉ lấy nếu trong vòng 60 ngày tới và chưa qua
                    if 0 <= days_until <= 60:
                        world_holidays.append({
                            'month': month,
                            'day': day,
                            'title': f'Tết Nguyên Đán {year}',
                            'type': 'holiday',
                            'is_lunar': True
                        })
        
        # Tính toán ngày cho các lễ hội còn lại
        for holiday in world_holidays:
            try:
                # Ngày lễ năm nay
                holiday_date = datetime(today.year, holiday['month'], holiday['day'])
                
                # Nếu đã qua, chuyển sang năm sau
                if holiday_date.date() < today.date():
                    holiday_date = datetime(today.year + 1, holiday['month'], holiday['day'])
                
                days_until = (holiday_date.date() - today.date()).days
                
                # Chỉ lấy lễ trong vòng 60 ngày tới
                if days_until <= 60:
                    events.append({
                        '_id': f"holiday_{holiday['month']}_{holiday['day']}",
                        'title': holiday['title'],
                        'subtitle': f"Còn {days_until} ngày",
                        'date': holiday_date.isoformat(),
                        'days_until': days_until,
                        'type': 'holiday',
                        'icon': '🎉'
                    })
            except:
                continue
        
        # Sắp xếp theo số ngày còn lại
        events.sort(key=lambda x: x['days_until'])
        
        # Giới hạn 10 sự kiện
        events = events[:10]
        
        return jsonify({
            'success': True,
            'events': events,
            'count': len(events)
        })
        
    except Exception as e:
        print(f"Error getting upcoming events: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ==================== FRIEND SUGGESTIONS API ====================

@main.route('/api/friend-suggestions')
def get_friend_suggestions():
    """API lấy gợi ý kết bạn dựa trên bạn chung - ĐÃ SỬA"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    
    try:
        user_id = session['user_id']
        current_user = users_col().find_one({'_id': ObjectId(user_id)})
        
        if not current_user:
            return jsonify({'success': False, 'error': 'User not found'}), 404
        
        # Lấy danh sách bạn bè hiện tại - CHUYỂN VỀ STRING
        my_friends_raw = current_user.get('friends', [])
        my_friends = set(str(fid) for fid in my_friends_raw if fid)
        my_friends.add(user_id)  # Thêm chính mình vào để loại trừ
        
        # Lấy danh sách người đã gửi/nhận lời mời kết bạn - CHUYỂN VỀ STRING
        pending_sent = set(str(fid) for fid in current_user.get('friend_requests_sent', []) if fid)
        pending_received = set(str(fid) for fid in current_user.get('friend_requests', []) if fid)
        
        # Tổng hợp tất cả ID cần loại trừ
        exclude_ids = my_friends.union(pending_sent).union(pending_received)
        
        # Lấy tất cả người dùng (trừ những người cần loại trừ)
        all_users = list(users_col().find({
            '_id': {'$nin': [ObjectId(fid) for fid in exclude_ids if ObjectId.is_valid(fid)]}
        }, {'username': 1, 'full_name': 1, 'avatar': 1, 'friends': 1}))
        
        # Tính số bạn chung cho mỗi người
        suggestions_with_mutual = []
        for user in all_users:
            user_friends = set(str(fid) for fid in user.get('friends', []) if fid)
            mutual_friends = my_friends.intersection(user_friends)
            mutual_count = len(mutual_friends)
            
            if mutual_count > 0:
                suggestions_with_mutual.append({
                    'user': user,
                    'mutual_count': mutual_count,
                    'mutual_friends': list(mutual_friends)[:3]  # Lưu 3 bạn chung để hiển thị
                })
        
        # Sắp xếp theo số bạn chung giảm dần
        suggestions_with_mutual.sort(key=lambda x: x['mutual_count'], reverse=True)
        
        # Format kết quả
        formatted_suggestions = []
        for item in suggestions_with_mutual[:10]:  # Lấy top 10
            user = item['user']
            
            # Xử lý avatar
            avatar = user.get('avatar', '')
            if avatar and not avatar.startswith(('http', 'data:image', '/static')):
                avatar = f'/static/uploads/{avatar}'
            elif not avatar:
                avatar = '/static/img/default-avatar.png'
            
            # Lấy tên người dùng
            display_name = user.get('full_name', user.get('username', 'Người dùng'))
            
            # Lấy tên 3 bạn chung để hiển thị
            mutual_names = []
            for mf_id in item['mutual_friends'][:3]:
                mf_user = users_col().find_one({'_id': ObjectId(mf_id)}, {'full_name': 1, 'username': 1})
                if mf_user:
                    mutual_names.append(mf_user.get('full_name', mf_user.get('username', '')))
            
            mutual_text = f"{item['mutual_count']} bạn chung"
            if mutual_names:
                mutual_text += f" ({', '.join(mutual_names)})"
            
            formatted_suggestions.append({
                '_id': str(user['_id']),
                'username': user['username'],
                'full_name': display_name,
                'avatar': avatar,
                'mutual_friends_count': item['mutual_count'],
                'mutual_friends_text': mutual_text
            })
        
        # Nếu không có đủ gợi ý, bổ sung thêm người ngẫu nhiên
        if len(formatted_suggestions) < 5:
            existing_ids = exclude_ids.union({str(u['_id']) for u in all_users if str(u['_id']) in [s['_id'] for s in formatted_suggestions]})
            
            additional = list(users_col().find({
                '_id': {'$nin': [ObjectId(fid) for fid in existing_ids if ObjectId.is_valid(fid)]}
            }, {'username': 1, 'full_name': 1, 'avatar': 1}).limit(5 - len(formatted_suggestions)))
            
            for user in additional:
                avatar = user.get('avatar', '')
                if avatar and not avatar.startswith(('http', 'data:image', '/static')):
                    avatar = f'/static/uploads/{avatar}'
                elif not avatar:
                    avatar = '/static/img/default-avatar.png'
                
                display_name = user.get('full_name', user.get('username', 'Người dùng'))
                
                formatted_suggestions.append({
                    '_id': str(user['_id']),
                    'username': user['username'],
                    'full_name': display_name,
                    'avatar': avatar,
                    'mutual_friends_count': 0,
                    'mutual_friends_text': 'Gợi ý cho bạn'
                })
        
        return jsonify({
            'success': True,
            'suggestions': formatted_suggestions,
            'count': len(formatted_suggestions)
        })
        
    except Exception as e:
        print(f"Error getting friend suggestions: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@main.route('/timeline')
def timeline():
    if 'user_id' not in session:
        return redirect(url_for('main.login'))
    
    from app import mongo
    user_id = session['user_id']
    
    # Lấy thông tin user
    current_user = mongo.db.users.find_one({'_id': ObjectId(user_id)})
    if not current_user:
        return redirect(url_for('main.logout'))
    
    # Xử lý avatar
    avatar = current_user.get('avatar')
    if avatar:
        if not avatar.startswith(('http', 'data:image', '/static')):
            avatar = f'/static/uploads/{avatar}'
    else:
        avatar = '/static/img/default-avatar.png'
    
    # Xử lý cover
    cover = current_user.get('cover_photo')
    if cover:
        if not cover.startswith(('http', 'data:image', '/static')):
            cover = f'/static/uploads/{cover}'
    else:
        cover = '/static/img/default-cover.jpg'
    
    # Thông tin thống kê
    friend_count = len(current_user.get('friends', []))
    
    # Đếm bài viết của user
    post_count = mongo.db.posts.count_documents({'user_id': user_id})
    
    # Lấy bạn bè đang hoạt động (API sẽ xử lý chi tiết)
    active_friends = []
    
    # Lấy gợi ý kết bạn - hiện tất cả người dùng (trừ bản thân và bạn bè)
    friend_suggestions = []
    my_friends = set(str(fid) for fid in current_user.get('friends', []))
    
    # Tìm tất cả người dùng (trừ bản thân và bạn bè hiện tại)
    exclude_ids = {user_id}.union(my_friends)
    all_users = list(mongo.db.users.find({
        '_id': {'$nin': [ObjectId(fid) for fid in exclude_ids if ObjectId.is_valid(fid)]}
    }, {'username': 1, 'full_name': 1, 'avatar': 1, 'friends': 1}))
    
    # Tính số bạn chung cho tất cả người dùng
    all_suggestions = []
    for user in all_users:
        user_friends = set(str(fid) for fid in user.get('friends', []) if fid)
        mutual_friends = my_friends.intersection(user_friends)
        mutual_count = len(mutual_friends)
        
        # Lấy tên của bạn chung (tối đa 2 người)
        mutual_friend_names = []
        if mutual_count > 0:
            for mf_id in list(mutual_friends)[:2]:
                mf_user = mongo.db.users.find_one({'_id': ObjectId(mf_id)}, {'full_name': 1, 'username': 1})
                if mf_user:
                    name = mf_user.get('full_name') or mf_user.get('username', 'Unknown')
                    mutual_friend_names.append(name)
        
        all_suggestions.append({
            'user': user,
            'mutual_count': mutual_count,
            'mutual_names': mutual_friend_names
        })
    
    # Sắp xếp: người có bạn chung trước, sau đó đến người không có bạn chung
    all_suggestions.sort(key=lambda x: (-x['mutual_count'], x['user'].get('full_name', '')))
    
    # Format kết quả - lấy top 10 thay vì 5
    for item in all_suggestions[:10]:
        user = item['user']
        
        # Xử lý avatar cho suggestion (dùng biến khác để không ghi đè avatar của current_user)
        suggestion_avatar = user.get('avatar', '')
        if suggestion_avatar and not suggestion_avatar.startswith(('http', 'data:image', '/static')):
            suggestion_avatar = f'/static/uploads/{suggestion_avatar}'
        elif not suggestion_avatar:
            suggestion_avatar = '/static/img/default-avatar.png'
        
        # Tạo text bạn chung
        mutual_count = item['mutual_count']
        mutual_names = item['mutual_names']
        
        if mutual_count == 0:
            mutual_text = "Gợi ý cho bạn"
        elif mutual_count == 1 and mutual_names:
            mutual_text = f"Bạn chung với {mutual_names[0]}"
        elif mutual_count == 2 and len(mutual_names) == 2:
            mutual_text = f"Bạn chung với {mutual_names[0]} và {mutual_names[1]}"
        elif mutual_names:
            mutual_text = f"Bạn chung với {mutual_names[0]} và {mutual_count - 1} người khác"
        else:
            mutual_text = f"{mutual_count} bạn chung"
        
        friend_suggestions.append({
            '_id': str(user['_id']),
            'username': user.get('username', ''),
            'full_name': user.get('full_name', user.get('username', 'Người dùng')),
            'avatar': suggestion_avatar,
            'mutual_friends': mutual_count,
            'mutual_text': mutual_text
        })
    
    # Lấy trending tags
    trending_tags = [
        {'tag': 'TechNews', 'count': 1250},
        {'tag': 'Music', 'count': 980},
        {'tag': 'Travel', 'count': 750},
        {'tag': 'Food', 'count': 620},
        {'tag': 'Sports', 'count': 540}
    ]
    
    # Lấy sự kiện sắp tới - sinh nhật bạn bè và ngày lễ trong tháng
    upcoming_events = []
    today = datetime.now()
    current_month = today.month
    current_year = today.year
    
    # 1. Sinh nhật bạn bè trong tháng này
    friend_ids = current_user.get('friends', [])
    if friend_ids:
        friends_with_dob = list(mongo.db.users.find({
            '_id': {'$in': [ObjectId(fid) for fid in friend_ids if ObjectId.is_valid(fid)]},
            'date_of_birth': {'$exists': True, '$ne': None, '$ne': ''}
        }, {'username': 1, 'full_name': 1, 'avatar': 1, 'date_of_birth': 1}))
        
        for friend in friends_with_dob:
            try:
                dob_str = friend.get('date_of_birth', '')
                if not dob_str:
                    continue
                
                # Parse ngày sinh
                if isinstance(dob_str, str):
                    dob = datetime.strptime(dob_str[:10], '%Y-%m-%d')
                elif isinstance(dob_str, datetime):
                    dob = dob_str
                else:
                    continue
                
                # Kiểm tra sinh nhật có trong tháng này không
                if dob.month == current_month:
                    birthday_this_year = dob.replace(year=current_year)
                    age = current_year - dob.year
                    
                    # Xử lý avatar
                    friend_avatar = friend.get('avatar', '')
                    if friend_avatar and not friend_avatar.startswith(('http', 'data:image', '/static')):
                        friend_avatar = f'/static/uploads/{friend_avatar}'
                    elif not friend_avatar:
                        friend_avatar = '/static/img/default-avatar.png'
                    
                    # Tính số ngày còn lại
                    days_until = (birthday_this_year.date() - today.date()).days
                    
                    upcoming_events.append({
                        '_id': str(friend['_id']),
                        'title': f"Sinh nhật {friend.get('full_name', friend['username'])}",
                        'subtitle': f"Tròn {age} tuổi" if age > 0 else "",
                        'date': birthday_this_year,
                        'days_until': days_until,
                        'type': 'birthday',
                        'avatar': friend_avatar,
                        'friend_id': str(friend['_id']),
                        'time': f"{days_until} ngày nữa" if days_until > 0 else "Hôm nay!"
                    })
            except Exception as e:
                print(f"Error processing birthday for {friend.get('username')}: {e}")
                continue
    
    # 2. Các ngày lễ trong tháng này
    vietnam_holidays = [
        {'month': 1, 'day': 1, 'title': 'Tết Dương Lịch', 'icon': '🎆'},
        {'month': 2, 'day': 14, 'title': 'Valentine', 'icon': '❤️'},
        {'month': 3, 'day': 8, 'title': 'Quốc tế Phụ nữ', 'icon': '💐'},
        {'month': 4, 'day': 30, 'title': 'Giải phóng miền Nam', 'icon': '🇻🇳'},
        {'month': 5, 'day': 1, 'title': 'Quốc tế Lao động', 'icon': '🔧'},
        {'month': 6, 'day': 1, 'title': 'Quốc tế Thiếu nhi', 'icon': '🎈'},
        {'month': 9, 'day': 2, 'title': 'Quốc khánh', 'icon': '🎉'},
        {'month': 11, 'day': 20, 'title': 'Nhà giáo Việt Nam', 'icon': '📚'},
        {'month': 12, 'day': 25, 'title': 'Giáng sinh', 'icon': '🎄'},
    ]
    
    # Tết Nguyên Đán (cập nhật theo năm)
    tet_dates = {
        2025: (1, 29),
        2026: (2, 17),
        2027: (2, 6),
        2028: (1, 26),
        2029: (2, 13),
        2030: (2, 3),
    }
    
    if current_year in tet_dates:
        month, day = tet_dates[current_year]
        vietnam_holidays.append({'month': month, 'day': day, 'title': f'Tết Nguyên Đán {current_year}', 'icon': '🧧', 'is_lunar': True})
    
    # Thêm ngày giỗ Tổ Hùng Vương (10/3 âm lịch - rơi vào khoảng tháng 4 dương lịch)
    hung_king_dates = {
        2025: (4, 7),
        2026: (3, 26),
        2027: (4, 15),
        2028: (4, 4),
    }
    if current_year in hung_king_dates:
        month, day = hung_king_dates[current_year]
        vietnam_holidays.append({'month': month, 'day': day, 'title': 'Giỗ Tổ Hùng Vương', 'icon': '🏛️'})
    
    for holiday in vietnam_holidays:
        if holiday['month'] == current_month:
            holiday_date = datetime(current_year, holiday['month'], holiday['day'])
            days_until = (holiday_date.date() - today.date()).days
            
            upcoming_events.append({
                '_id': f"holiday_{holiday['month']}_{holiday['day']}",
                'title': holiday['title'],
                'subtitle': holiday.get('icon', '🎉'),
                'date': holiday_date,
                'days_until': days_until,
                'type': 'holiday',
                'time': f"{days_until} ngày nữa" if days_until > 0 else "Hôm nay!"
            })
    
    # Sắp xếp theo số ngày còn lại (sự kiện sắp đến trước)
    upcoming_events.sort(key=lambda x: x['days_until'])
    
    # Giới hạn 8 sự kiện
    upcoming_events = upcoming_events[:8]
    
    # Lấy stories của bạn bè
    stories_friends = []
    
    return render_template('timeline.html',
                         current_user=current_user,
                         user_avatar=avatar,
                         user_cover=cover,
                         friend_count=friend_count,
                         post_count=post_count,
                         active_friends=active_friends,
                         friend_suggestions=friend_suggestions,
                         trending_tags=trending_tags,
                         upcoming_events=upcoming_events,
                         stories_friends=stories_friends)

@main.route('/post/<post_id>')
def view_post(post_id):
    post = mongo.db.posts.find_one({'_id': ObjectId(post_id)})
    if not post:
        return "Bài viết không tồn tại", 404
    return render_template('post_detail.html', post=post)

@main.route('/events/<event_id>')
def view_event(event_id):
    # Tương tự cho event
    return f"Chi tiết sự kiện {event_id}"

# ==================== HASHTAG SEARCH ====================

@main.route('/search')
def search_hashtags():
    """Tìm kiếm bài viết theo hashtag"""
    if 'user_id' not in session:
        return redirect(url_for('main.login'))
    
    query = request.args.get('q', '')
    
    # Remove # if present
    if query.startswith('#'):
        query = query[1:]
    
    if not query:
        return render_template('search_results.html', 
                             query='',
                             posts=[],
                             user=users_col().find_one({'_id': ObjectId(session['user_id'])}))
    
    # Find posts containing the hashtag
    posts = list(posts_col().find({
        '$or': [
            {'content': {'$regex': f'#{query}', '$options': 'i'}},
            {'tags': {'$regex': query, '$options': 'i'}}
        ]
    }).sort('created_at', -1))
    
    # Enrich posts with user info
    for post in posts:
        post['_id'] = str(post['_id'])
        post['user_id'] = str(post['user_id'])
        
        # Get author info
        author = users_col().find_one({'_id': ObjectId(post['user_id'])})
        if author:
            post['author_name'] = author.get('full_name') or author.get('username')
            post['author_avatar'] = author.get('avatar') or url_for('static', filename='img/default-avatar.png')
    
    return render_template('search_results.html',
                         query=query,
                         posts=posts,
                         user=users_col().find_one({'_id': ObjectId(session['user_id'])}))

# ==================== API FOR HASHTAG POSTS ====================

@main.route('/api/posts/hashtag/<tag>')
def get_posts_by_hashtag(tag):
    """API endpoint để lấy bài viết theo hashtag"""
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    
    try:
        # Decode URL-encoded characters
        from urllib.parse import unquote
        tag = unquote(tag)
        
        # Remove # if present in tag
        if tag.startswith('#'):
            tag = tag[1:]
        
        # Find posts containing the hashtag
        posts = list(posts_col().find({
            '$or': [
                {'content': {'$regex': f'#{tag}', '$options': 'i'}},
                {'tags': {'$regex': tag, '$options': 'i'}}
            ]
        }).sort('created_at', -1).limit(50))
        
        # Format posts for response
        formatted_posts = []
        current_user_id = str(session.get('user_id'))

        for post in posts:
            # Get author info
            author = users_col().find_one({'_id': ObjectId(post['user_id'])})

            # Determine like information
            likes_list = post.get('likes', [])
            is_liked = False
            if current_user_id and likes_list:
                try:
                    is_liked = any(str(like) == current_user_id for like in likes_list)
                except Exception:
                    is_liked = False
            
            # Tính tổng số bình luận (gốc + replies)
                comments_data = post.get('comments', [])
                total_comments = len(comments_data)
                for comment in comments_data:
                    if isinstance(comment, dict) and 'replies' in comment:
                        total_comments += len(comment.get('replies', []))
                
                formatted_posts.append({
                    '_id': str(post['_id']),
                    'content': post.get('content', ''),
                    'author_name': author.get('full_name') or author.get('username', 'Unknown') if author else 'Unknown',
                    'author_username': author.get('username') if author else None,
                    'author_avatar': author.get('avatar') if author else None,
                    'time_ago': format_timestamp_for_client(post.get('created_at')),
                    'created_at': post.get('created_at').isoformat() if post.get('created_at') else None,
                    'media_urls': post.get('media_urls', []),
                    'likes': len(likes_list),
                    'comments': total_comments,
                    'shares': post.get('shares', 0),
                    'is_liked': is_liked,
                    'privacy': post.get('privacy', 'public')
                })
        
        return jsonify({
            'success': True,
            'posts': formatted_posts,
            'count': len(formatted_posts)
        })
        
    except Exception as e:
        print(f"[ERROR] Error fetching hashtag posts: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@main.route('/hashtag/<tag>')
def hashtag_posts_page(tag):
    """Render trang hiển thị bài viết theo hashtag"""
    if 'user_id' not in session:
        return redirect(url_for('main.login'))
    
    # Decode URL-encoded characters
    from urllib.parse import unquote
    tag = unquote(tag)
    
    # Remove # if present in tag
    if tag.startswith('#'):
        tag = tag[1:]
    
    # Get current user info
    current_user = users_col().find_one({'_id': ObjectId(session['user_id'])})
    
    return render_template('hashtag_posts.html', 
                          tag=tag,
                          current_user=current_user,
                          user_id=session['user_id'])

@main.route('/api/notifications/delete-all-read', methods=['POST'])
def delete_all_read_notifications():
    """Xóa tất cả thông báo đã đọc"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        user_id = ObjectId(session['user_id'])

        result = notifications_col().delete_many({
            'recipient_id': user_id,
            'read': True
        })

        return jsonify({
            'success': True,
            'message': f'Đã xóa {result.deleted_count} thông báo đã đọc'
        }), 200

    except Exception as e:
        print(f"Error deleting all read notifications: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

@main.route('/api/notifications/<notification_id>', methods=['DELETE'])
def delete_notification(notification_id):
    """Xóa một thông báo riêng lẻ"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        user_id = ObjectId(session['user_id'])
        
        # Xóa notification chỉ nếu thuộc về user hiện tại
        result = notifications_col().delete_one({
            '_id': ObjectId(notification_id),
            'recipient_id': user_id
        })
        
        if result.deleted_count == 0:
            return jsonify({'error': 'Notification not found'}), 404
        
        return jsonify({
            'success': True,
            'message': 'Đã xóa thông báo'
        }), 200
        
    except Exception as e:
        print(f"Error deleting notification: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

@main.route('/api/notifications/delete-all', methods=['POST'])
def delete_all_notifications():
    """Xóa tất cả thông báo (đã đọc và chưa đọc)"""
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        user_id = ObjectId(session['user_id'])
        
        # Xóa tất cả notifications của user
        result = notifications_col().delete_many({
            'recipient_id': user_id
        })
        
        return jsonify({
            'success': True,
            'message': f'Đã xóa {result.deleted_count} thông báo'
        }), 200
        
    except Exception as e:
        print(f"Error deleting all notifications: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500




# =========================
# COLLABORATIVE DRAWING API  
# =========================

@main.route('/api/save_drawing', methods=['POST'])
def save_drawing():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        data = request.get_json()
        conversation_id = data.get('conversation_id')
        conversation_type = data.get('conversation_type', 'private')
        canvas_data = data.get('canvas_data')
        if not conversation_id or not canvas_data:
            return jsonify({'error': 'Missing data'}), 400
        from app.db import db
        db.drawings.update_one(
            {'conversation_id': conversation_id, 'conversation_type': conversation_type},
            {'$set': {'canvas_data': canvas_data, 'updated_at': datetime.utcnow(), 'updated_by': session['user_id']}},
            upsert=True)
        return jsonify({'success': True}), 200
    except Exception as e:
        print(f"Error saving drawing: {e}")
        return jsonify({'error': 'Internal server error'}), 500

@main.route('/api/get_drawing', methods=['GET'])
def get_drawing():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        conversation_id = request.args.get('conversation_id')
        conversation_type = request.args.get('type', 'private')
        if not conversation_id:
            return jsonify({'error': 'Missing conversation_id'}), 400
        from app.db import db
        drawing = db.drawings.find_one(
            {'conversation_id': conversation_id, 'conversation_type': conversation_type},
            {'canvas_data': 1})
        if drawing and drawing.get('canvas_data'):
            return jsonify({'success': True, 'canvas_data': drawing['canvas_data']}), 200
        return jsonify({'success': True, 'canvas_data': None}), 200
    except Exception as e:
        print(f"Error getting drawing: {e}")
        return jsonify({'error': 'Internal server error'}), 500

@main.route('/api/clear_drawing', methods=['POST'])
def clear_drawing():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        data = request.get_json()
        conversation_id = data.get('conversation_id')
        conversation_type = data.get('conversation_type', 'private')
        if not conversation_id:
            return jsonify({'error': 'Missing conversation_id'}), 400
        from app.db import db
        db.drawings.delete_one({'conversation_id': conversation_id, 'conversation_type': conversation_type})
        return jsonify({'success': True}), 200
    except Exception as e:
        print(f"Error clearing drawing: {e}")
        return jsonify({'error': 'Internal server error'}), 500
