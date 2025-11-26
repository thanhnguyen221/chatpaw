import os
import uuid
from flask import Blueprint, current_app, render_template, request, redirect, url_for, session, jsonify
from bson import InvalidDocument, ObjectId
import pytz
from app import mongo, socketio
from app.auth import login_user, register_user
from datetime import datetime,timedelta
from app.utils.time_utils import get_vietnam_time
from werkzeug.utils import secure_filename
from PIL import Image
from flask import send_from_directory
import json

main = Blueprint('main', __name__)

UPLOAD_FOLDER = 'app/static/uploads'
ALLOWED_EXTENSIONS = {'txt', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'doc', 'docx'}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB

users_col = lambda: mongo.db['users']
conversations_col = lambda: mongo.db['conversations']
messages_col = lambda: mongo.db['messages']
friend_requests_col = lambda: mongo.db['friend_requests']
groups_col = lambda: mongo.db['groups']
group_members_col = lambda: mongo.db['group_members']
posts_col = lambda: mongo.db['posts']

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
            return "Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu!"

        if login_user(username, password):
            return redirect(url_for('main.chat'))
        return "Tên đăng nhập hoặc mật khẩu không đúng!"

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

        success = register_user(
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
            return redirect(url_for('main.chat'))
        return "Đăng ký thất bại! Kiểm tra thông tin hoặc tên người dùng/email đã tồn tại."

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
    conv_cursor = conversations_db.find({'participants': str(user_id)})

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

        # Thêm vào danh sách
        conversations.append({
            '_id': conv['_id'],
            'friend_id': friend_id,
            'friend_name': friend['username'] if friend else 'Unknown',
            'friend_avatar': friend_avatar,
            'last_message': last_message_content,
            'last_message_sender': last_message_sender,
            'last_message_preview': last_message_preview,
            'last_message_time': last_message_time,
            'last_message_type': last_message_type,
            'unread_count': unread_count,
            'is_online': is_online,
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

    messages = list(messages_col().find({'conversation_id': conv_id}).sort('timestamp', 1))

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

        message_data = {
            'message_id': str(msg['_id']),
            'conversation_id': conversation_id,
            'sender_id': str(msg['sender_id']),
            'sender_name': sender_info['username'],
            'sender_avatar': sender_info['avatar'],
            'content': msg['content'],
            'timestamp': timestamp_str,
            'status': msg.get('status', 'sent'),  
            'read_by': [str(uid) for uid in msg.get('read_by', [])],
            
            # [MỚI] Thêm thông tin Reply
            'reply_context': resolve_reply_context(msg, 'private')
        }

        # Logic message_type cũ của bạn
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


@main.route('/get_friends', methods=['GET'])
def get_friends():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    user_id = session['user_id']
    user = users_col().find_one({'_id': ObjectId(user_id)})
    
    if not user or 'friends' not in user:
        return jsonify({'friends': []})

    friend_ids = [ObjectId(fid) for fid in user['friends']]
    friends = list(users_col().find({'_id': {'$in': friend_ids}}, {'password': 0}))

    # Thêm trạng thái online
    for friend in friends:
        friend['_id'] = str(friend['_id'])
        friend['online'] = online_users.get(friend['_id'], False)  # ✅ ĐÃ ĐÓNG NGOẶC ĐÚNG

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
    user_id = session.get('user_id')
    if user_id:
        try:
            # Cập nhật trạng thái offline khi logout
            users_col = mongo.db.users
            users_col.update_one(
                {'_id': ObjectId(user_id)},
                {'$set': {'online': False}}
            )
            print(f"[Logout] User {user_id} set offline")
        except Exception as e:
            print(f"Error setting user offline on logout: {str(e)}")
    
    session.clear()
    return redirect(url_for('main.login'))

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
            results.append({
                'request_id': str(req['_id']),
                'sender_id': str(sender['_id']),
                'username': sender.get('username'),
                'email': sender.get('email')
            })

    return jsonify({'requests': results})

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
main.add_app_template_filter(format_time_filter, 'format_time')


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

    data = request.get_json()
    user_id = ObjectId(session['user_id'])

    update_data = {
        'full_name': data.get('full_name'),
        'username': data.get('username'),
        'email': data.get('email'),
        'phone': data.get('phone'),
        'date_of_birth': data.get('dob'),
        'gender': data.get('gender')
    }

    # QUAN TRỌNG: Sửa phần xử lý avatar
    if data.get('avatar'):
        # Kiểm tra kích thước base64
        if len(data['avatar']) > 2 * 1024 * 1024:
            return jsonify({'error': 'Ảnh quá lớn! Tối đa 2MB'}), 400
        
        # LUÔN lưu base64 data URL, không chuyển thành đường dẫn
        update_data['avatar'] = data['avatar']

    users_col().update_one(
        {'_id': user_id},
        {'$set': update_data}
    )

    # Cập nhật session
    session['username'] = data.get('username')
    
    return jsonify({'message': 'Profile updated successfully'})

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


# Lấy danh sách nhóm của người dùng
@main.route('/user_groups', methods=['GET'])
def get_user_groups():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        user_oid = ObjectId(session['user_id'])
        
        # Lấy tất cả nhóm mà user tham gia
        user_groups = list(group_members_col().find({'user_id': user_oid}))
        group_ids = [g['group_id'] for g in user_groups]
        
        # Lấy thông tin chi tiết các nhóm
        groups = list(groups_col().find({'_id': {'$in': group_ids}}))
        
        # Định dạng kết quả
        result = []
        for group in groups:
            # Lấy số lượng thành viên
            member_count = group_members_col().count_documents({'group_id': group['_id']})
            
            result.append({
            '_id': str(group['_id']),
            'name': group.get('name', 'Unnamed Group'),
            'avatar': group.get('avatar', ''),  # Make sure this line exists
            'created_by': str(group.get('created_by', '')),
            'created_at': group.get('created_at', datetime.utcnow()).isoformat(),
            'member_count': member_count
            })

        return jsonify({'groups': result})
    
    except Exception as e:
        print(f"Error getting user groups: {str(e)}")
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

    messages_cursor = group_messages_col().find({'group_id': group_oid}, sort=[('timestamp', 1)])

    message_list = []
    for msg in messages_cursor:
        # Lấy thông tin sender
        sender_oid = msg.get('sender_id')
        sender = users_col().find_one({'_id': sender_oid}, {'username': 1, 'avatar': 1}) if sender_oid else None
        sender_name = sender.get('username') if sender else 'Unknown'
        
        avatar = sender.get('avatar') if sender else None
        if avatar and not avatar.startswith(('http', 'data:image')):
            sender_avatar = url_for('static', filename=avatar)
        else:
            sender_avatar = url_for('static', filename='img/default-avatar.png')
        
        ts = msg.get('timestamp')
        ts_iso = ts.isoformat() if hasattr(ts, 'isoformat') else str(ts)
            
        message_data = {
            'group_id': str(msg.get('group_id', group_id)),
            'message_id': str(msg.get('_id')),
            'sender_id': str(msg.get('sender_id')),
            'sender_name': sender_name,
            'content': msg.get('content', ''),
            'sender_avatar': sender_avatar,
            'timestamp': ts_iso,
            
            # [MỚI] Thêm thông tin Reply cho Group
            'reply_context': resolve_reply_context(msg, 'group')
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
    
    if conversation:
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

    conv = conversations_col().find_one({'_id': conv_id})
    if not conv or session['user_id'] not in conv['participants']:
        return jsonify({'error': 'Conversation not found'}), 404

    # Lấy thông tin người chat cùng
    friend_id = next((pid for pid in conv['participants'] if pid != session['user_id']), None)
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
        'sender_id': {'$ne': session['user_id']},
        'read_by': {'$nin': [session['user_id']]}
    })

    return jsonify({
        'friend_id': friend_id,
        'friend_name': friend['username'] if friend else 'Unknown',
        'friend_avatar': friend.get('avatar', url_for('static', filename='img/default-avatar.png')),
        'last_message': last_message_content,
        'last_message_preview': last_message_preview,
        'last_message_type': last_message_type,
        'last_message_sender': last_message_sender,
        'last_message_time': last_message['timestamp'] if last_message else conv['created_at'],
        'unread_count': unread_count
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
        'friend_name': friend['username'] if friend else 'Unknown',
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

    # Gộp dữ liệu trả về
    result = {
        '_id': str(group['_id']),
        'name': group.get('name', 'Unnamed Group'),
        'created_by': str(group.get('created_by', '')),
        'created_at': group.get('created_at', datetime.utcnow()).isoformat(),
        'avatar': group.get('avatar', ''),
        'current_user_role': current_user_role,
        'members': []
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
        filename = f"{uuid.uuid4().hex}_{secure_filename(image.filename)}"
        
        # SỬA: Lưu file vào app/static/uploads/ (vị trí hiện tại)
        upload_folder = 'app/static/uploads'
        os.makedirs(upload_folder, exist_ok=True)
        
        filepath = os.path.join(upload_folder, filename)
        print(f"Saving image to: {filepath}")

        try:
            img = Image.open(image)
            img.save(filepath)
            print(f"Original image saved: {filepath}")

            # Tạo thumbnail
            thumbnail_size = (200, 200)
            thumb_img = img.copy()
            thumb_img.thumbnail(thumbnail_size)
            thumbnail_filename = f"thumb_{filename}"
            thumbnail_path = os.path.join(upload_folder, thumbnail_filename)
            thumb_img.save(thumbnail_path)
            print(f"Thumbnail saved: {thumbnail_path}")

            # SỬA QUAN TRỌNG: Tạo URL trực tiếp không dùng url_for
            # Vì Flask static_folder là '../static' nhưng file thực tế ở 'app/static'
            image_url = f"/static/uploads/{filename}"
            thumbnail_url = f"/static/uploads/{thumbnail_filename}"
            
            print(f"Image URL: {image_url}")
            print(f"Thumbnail URL: {thumbnail_url}")

            return jsonify({
                'success': True,
                'image_url': image_url,
                'thumbnail_url': thumbnail_url,
                'image_name': secure_filename(image.filename)
            })
        except Exception as e:
            print(f"Image processing error: {str(e)}")
            return jsonify({'error': f'Error processing image: {str(e)}'}), 500

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
        filename = secure_filename(file.filename)
        
        # SỬA: Lưu file vào app/static/uploads/ (vị trí hiện tại)
        upload_folder = 'app/static/uploads'
        os.makedirs(upload_folder, exist_ok=True)
        
        file_path = os.path.join(upload_folder, filename)
        print(f"Saving file to: {file_path}")
        
        file.save(file_path)

        # SỬA QUAN TRỌNG: Tạo URL trực tiếp
        file_url = f"/static/uploads/{filename}"
        file_size = os.path.getsize(file_path)
        
        print(f"File URL: {file_url}")
        
        return jsonify({
            'success': True,
            'file_url': file_url,
            'file_name': filename,
            'file_size': file_size
        })
    
    return jsonify({'error': 'File type not allowed'}), 400

@main.route('/static/uploads/<path:filename>')
def serve_uploaded_files(filename):
    """Phục vụ file từ app/static/uploads/"""
    try:
        # SỬA: Sử dụng đường dẫn tuyệt đối chính xác
        base_dir = os.path.dirname(os.path.abspath(__file__))  # Thư mục app/
        upload_folder = os.path.join(base_dir, 'static', 'uploads')
        
        print(f"Serving file: {filename}")
        print(f"From folder: {upload_folder}")
        print(f"File exists: {os.path.exists(os.path.join(upload_folder, filename))}")
        
        return send_from_directory(upload_folder, filename)
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
                'reply_context': resolve_reply_context(message, conversation_type)

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
        sender = users_col().find_one({'_id': ObjectId(message['sender_id'])}, {'username': 1, 'avatar': 1})
        sender_name = sender.get('username', 'Unknown') if sender else 'Unknown'
        
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
                'timestamp': message['timestamp'].isoformat() if hasattr(message['timestamp'], 'isoformat') else str(message['timestamp'])
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

    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        # Create unique filename
        filename = f"{uuid.uuid4().hex}_{filename}"
        upload_folder = 'app/static/uploads/covers'
        os.makedirs(upload_folder, exist_ok=True)

        filepath = os.path.join(upload_folder, filename)

        try:
            # Save the image
            img = Image.open(file)
            img.save(filepath)

            # Create URL path
            cover_photo_url = f"/static/uploads/covers/{filename}"

            # Update user's cover photo in database
            user_id = ObjectId(session['user_id'])
            users_col().update_one(
                {'_id': user_id},
                {'$set': {'cover_photo': cover_photo_url}}
            )

            return jsonify({
                'success': True,
                'cover_photo_url': cover_photo_url
            })
        except Exception as e:
            print(f"Cover photo processing error: {str(e)}")
            return jsonify({'error': f'Error processing cover photo: {str(e)}'}), 500

    return jsonify({'error': 'File type not allowed'}), 400

@main.route('/create_post', methods=['POST'])
def create_post():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        data = request.get_json()
        content = data.get('content', '')
        media_urls = data.get('media_urls', [])

        if not content and not media_urls:
            return jsonify({'error': 'Nội dung hoặc media là bắt buộc'}), 400

        # Validate media URLs
        valid_media_urls = []
        for media in media_urls:
            if isinstance(media, dict) and media.get('url') and media.get('type') in ['image', 'video']:
                valid_media_urls.append(media)

        post_data = {
            'user_id': session['user_id'],
            'content': content,
            'media_urls': valid_media_urls,
            'created_at': get_vietnam_time(),
            'likes': [],
            'comments': [],
            'shares': 0
        }

        post_id = posts_col().insert_one(post_data).inserted_id

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
    media_urls = []

    for file in files:
        if file and file.filename != '':
            # Kiểm tra loại file
            file_type = 'image'
            filename_lower = file.filename.lower()
            
            # Xác định loại file dựa trên extension và MIME type
            if filename_lower.endswith(('.mp4', '.avi', '.mov', '.mkv', '.webm')):
                file_type = 'video'
            elif filename_lower.endswith(('.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp')):
                file_type = 'image'
            else:
                # Nếu không xác định được qua extension, dùng MIME type
                if file.content_type.startswith('video/'):
                    file_type = 'video'
                elif file.content_type.startswith('image/'):
                    file_type = 'image'
                else:
                    # Bỏ qua file không hợp lệ
                    continue

            # Kiểm tra kích thước file
            max_size = 50 * 1024 * 1024  # 50MB cho video, 10MB cho ảnh
            if file_type == 'image':
                max_size = 10 * 1024 * 1024
                
            if len(file.read()) > max_size:
                file.seek(0)  # Reset file pointer
                continue
            file.seek(0)  # Reset file pointer sau khi kiểm tra

            # Tạo tên file duy nhất
            filename = f"{uuid.uuid4().hex}_{secure_filename(file.filename)}"
            upload_folder = 'app/static/uploads/posts'
            os.makedirs(upload_folder, exist_ok=True)

            filepath = os.path.join(upload_folder, filename)
            file.save(filepath)

            media_url = f"/static/uploads/posts/{filename}"
            media_urls.append({
                'url': media_url,
                'type': file_type,
                'filename': file.filename
            })

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

        post = posts_col().find_one({'_id': ObjectId(post_id)})
        if not post:
            return jsonify({'error': 'Bài viết không tồn tại'}), 404

        user_id = session['user_id']
        likes = post.get('likes', [])

        if user_id in likes:
            # Bỏ like
            posts_col().update_one(
                {'_id': ObjectId(post_id)},
                {'$pull': {'likes': user_id}}
            )
            liked = False
        else:
            # Thêm like
            posts_col().update_one(
                {'_id': ObjectId(post_id)},
                {'$addToSet': {'likes': user_id}}
            )
            liked = True

        # Lấy số like mới
        updated_post = posts_col().find_one({'_id': ObjectId(post_id)})
        like_count = len(updated_post.get('likes', []))

        return jsonify({
            'success': True,
            'liked': liked,
            'like_count': like_count
        })

    except Exception as e:
        print(f"Error liking post: {str(e)}")
        return jsonify({'error': 'Lỗi khi like bài viết'}), 500


@main.route('/comment_post', methods=['POST'])
def comment_post():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        data = request.get_json()
        post_id = data.get('post_id')
        content = data.get('content')

        if not content:
            return jsonify({'error': 'Nội dung bình luận không được để trống'}), 400

        user = users_col().find_one({'_id': ObjectId(session['user_id'])})
        if not user:
            return jsonify({'error': 'Người dùng không tồn tại'}), 404

        # Xử lý avatar URL trước khi lưu
        user_avatar = user.get('avatar', '')
        if user_avatar:
            if user_avatar.startswith('data:image'):
                # Giữ nguyên base64
                pass
            elif not user_avatar.startswith(('http', '/static')):
                user_avatar = url_for('static', filename=user_avatar)
        else:
            user_avatar = url_for('static', filename='img/default-avatar.png')

        comment = {
            'id': str(uuid.uuid4()),
            'user_id': session['user_id'],
            'username': user.get('username', 'Unknown'),
            'user_avatar': user_avatar,  # Đã xử lý URL
            'content': content,
            'created_at': get_vietnam_time()
        }

        posts_col().update_one(
            {'_id': ObjectId(post_id)},
            {'$push': {'comments': comment}}
        )

        return jsonify({
            'success': True,
            'comment': comment  # Avatar đã được xử lý
        })

    except Exception as e:
        print(f"Error commenting post: {str(e)}")
        return jsonify({'error': 'Lỗi khi bình luận'}), 500

@main.route('/profile/<username>')
def user_profile(username):
    if 'user_id' not in session:
        return redirect(url_for('main.login'))

    try:
        # Lấy thông tin người dùng
        user = users_col().find_one({'username': username}, {'password': 0})
        if not user:
            return "Người dùng không tồn tại", 404

        # Lấy các bài viết của người dùng
        posts = list(posts_col().find(
            {'user_id': str(user['_id'])},
            sort=[('created_at', -1)]
        ))

        # Xử lý avatar
        if user.get('avatar'):
            if user['avatar'].startswith(('http', 'data:image')):
                user_avatar = user['avatar']
            else:
                user_avatar = url_for('static', filename=user['avatar'])
        else:
            user_avatar = url_for('static', filename='img/default-avatar.png')

        # Xử lý cover photo
        if user.get('cover_photo'):
            if not user['cover_photo'].startswith(('http', '/static')):
                user['cover_photo'] = url_for('static', filename=user['cover_photo'])
        else:
            user['cover_photo'] = None

        # KIỂM TRA QUAN HỆ BẠN BÈ CHÍNH XÁC
        is_friend = False
        current_user = users_col().find_one({'_id': ObjectId(session['user_id'])})
        if current_user and str(user['_id']) in current_user.get('friends', []):
            # KIỂM TRA NGƯỢC LẠI (friendship thường là 2 chiều)
            if session['user_id'] in user.get('friends', []):
                is_friend = True
                print(f"DEBUG: {session['user_id']} and {user['_id']} are mutual friends")
            else:
                print(f"DEBUG: Friendship not mutual - only one side")

        print(f"DEBUG: is_friend result: {is_friend}")

        return render_template(
            'profile.html',
            profile_user=user,
            user_avatar=user_avatar,
            posts=posts,
            current_user_id=session['user_id'],
            is_friend=is_friend
        )

    except Exception as e:
        print(f"Error loading profile: {str(e)}")
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
        print(f"DEBUG: Raw friend_ids for user {user_id}: {friend_ids}")
        
        # Lọc các friend_id hợp lệ và KIỂM TRA TỒN TẠI
        valid_friend_ids = []
        for fid in friend_ids:
            if ObjectId.is_valid(fid):
                # KIỂM TRA NGƯỜI DÙNG CÓ TỒN TẠI KHÔNG
                friend_exists = users_col().find_one({'_id': ObjectId(fid)})
                if friend_exists:
                    valid_friend_ids.append(ObjectId(fid))
                else:
                    print(f"DEBUG: Friend {fid} not found in database")
        
        print(f"DEBUG: Valid friend_ids: {[str(fid) for fid in valid_friend_ids]}")

        # Lấy thông tin bạn bè
        friends = list(users_col().find(
            {'_id': {'$in': valid_friend_ids}},
            {'username': 1, 'avatar': 1, 'online': 1}
        ))

        print(f"DEBUG: Found {len(friends)} actual friends")

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

        # Lấy tất cả ảnh từ media_urls
        recent_photos = []
        for post in posts_with_media:
            for media in post.get('media_urls', []):
                if media.get('type') == 'image':
                    recent_photos.append({
                        'url': media['url'],
                        'post_id': str(post['_id']),
                        'created_at': post.get('created_at')
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