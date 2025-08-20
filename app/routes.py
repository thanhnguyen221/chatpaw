from flask import Blueprint, render_template, request, redirect, url_for, session, jsonify
from flask_socketio import emit, join_room
from bson import ObjectId
import pytz
from app import mongo, socketio
from app.auth import login_user, register_user
from datetime import datetime,timedelta,timezone

main = Blueprint('main', __name__)

users_col = lambda: mongo.db['users']
conversations_col = lambda: mongo.db['conversations']
messages_col = lambda: mongo.db['messages']
friend_requests_col = lambda: mongo.db['friend_requests']
groups_col = lambda: mongo.db['groups']
group_members_col = lambda: mongo.db['group_members']

online_users = {}

def messages_col():
    return mongo.db.messages

def conversations_col():
    return mongo.db.conversations

def users_col():
    return mongo.db.users

def get_vietnam_time():
    vietnam_tz = pytz.timezone('Asia/Ho_Chi_Minh')
    return datetime.now(vietnam_tz)

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

        # Lấy tin nhắn cuối
        last_message = messages.find_one(
            {'conversation_id': str(conv['_id'])},
            sort=[('timestamp', -1)]
        )

        last_message_content = last_message['content'] if last_message else 'Bắt đầu trò chuyện'
        last_message_sender = str(last_message['sender_id']) if last_message else None
        last_message_time = last_message['timestamp'] if last_message else conv.get('created_at')

        # Đếm số tin chưa đọc
        unread_count = messages.count_documents({
            'conversation_id': str(conv['_id']),
            'sender_id': {'$ne': str(user_id)},
            'read_by': {'$nin': [str(user_id)]}
        })

        is_online = friend.get('online', False) if friend else False

        # Thêm vào danh sách
        conversations.append({
            '_id': conv['_id'],
            'friend_id': friend_id,
            'friend_name': friend['username'] if friend else 'Unknown',
            'friend_avatar': friend_avatar,
            'last_message': last_message_content,
            'last_message_sender': last_message_sender,
            'last_message_time': last_message_time,
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
    print(f"Fetching messages for conversation: {conversation_id}")

    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        conv_id = ObjectId(conversation_id)
    except Exception:
        return jsonify({'error': 'Invalid conversation ID'}), 400

    conv = conversations_col().find_one({'_id': conv_id})
    if not conv or session['user_id'] not in conv['participants']:
        return jsonify({'error': 'Conversation not found or access denied'}), 404

    # Lấy tin nhắn liên quan đến cuộc trò chuyện
    messages = list(messages_col().find(
        {'conversation_id': conv_id}
    ).sort('timestamp', 1))

    print(f"Found {len(messages)} messages")

    # Lấy tất cả sender_id duy nhất
    sender_ids = list(set(msg['sender_id'] for msg in messages))
    senders = list(users_col().find({'_id': {'$in': sender_ids}}, {'username': 1}))
    sender_map = {str(sender['_id']): sender['username'] for sender in senders}

    # Xử lý danh sách tin nhắn trả về
    message_list = []
    for msg in messages:
        message_list.append({
            'message_id': str(msg['_id']),
            'conversation_id': conversation_id,
            'sender_id': str(msg['sender_id']),
            'sender_name': sender_map.get(str(msg['sender_id']), 'Unknown'),
            'content': msg['content'],
            'timestamp': msg['timestamp'].isoformat() if msg.get('timestamp') else None
        })

    return jsonify({
        'conversation_id': conversation_id,
        'messages': message_list
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
            # Chuyển đổi sang múi giờ Việt Nam
            dt = datetime.fromisoformat(dt).astimezone(timezone(timedelta(hours=7)))
        except:
            return dt

    # Phần còn lại giữ nguyên
    now = datetime.now(timezone(timedelta(hours=7)))
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

@main.route('/update_profile', methods=['POST'])
def update_profile():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.get_json()
    user_id = ObjectId(session['user_id'])

    if data.get('avatar'):
        # Kiểm tra kích thước base64
        if len(data['avatar']) > 2 * 1024 * 1024:  # 2MB
            return jsonify({'error': 'Ảnh quá lớn! Tối đa 2MB'}), 400
        
        # Kiểm tra nếu là base64 quá dài thì lưu avatar mặc định
        if len(data['avatar']) > 100000:
            update_data['avatar'] = 'img/default-avatar.png'
        else:
            update_data['avatar'] = data['avatar']

    update_data = {
        'full_name': data.get('full_name'),
        'username': data.get('username'),
        'email': data.get('email'),
        'phone': data.get('phone'),
        'date_of_birth': data.get('dob'),
        'gender': data.get('gender')
    }
    
    # Thêm xử lý avatar nếu có
    if data.get('avatar'):
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
    except:
        return jsonify({'error': 'Invalid group ID'}), 400

    # Kiểm tra user có trong nhóm không
    user_oid = ObjectId(session['user_id'])
    is_member = group_members_col().find_one({
        'group_id': group_oid,
        'user_id': user_oid
    })
    if not is_member:
        return jsonify({'error': 'Not a member of this group'}), 403
    
    messages = list(messages_col().find(
        {'group_id': group_oid},
        sort=[('timestamp', 1)]   
    ))

    message_list = []
    for msg in messages:
        sender = users_col().find_one({'_id': ObjectId(msg['sender_id'])}, {'username': 1})
        sender_name = sender['username'] if sender else 'Unknown'
        vietnam_time = msg['timestamp'].astimezone(timezone(timedelta(hours=7)))

        message_list.append({
            'group_id': group_id,
            'sender_id': str(msg['sender_id']),
            'sender_name': sender_name,
            'content': msg['content'],
            'timestamp': vietnam_time.isoformat()
        })

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
