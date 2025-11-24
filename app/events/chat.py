from flask import session, url_for
from bson import ObjectId
from datetime import datetime
from flask_socketio import emit, join_room, leave_room

from app.utils.time_utils import get_vietnam_time, format_timestamp_for_client


def register_chat_events(socketio, mongo):
    messages_col = mongo.db.messages
    conversations_col = mongo.db.conversations
    groups_col = mongo.db.groups
    group_members_col = mongo.db.group_members
    users_col = mongo.db.users

    # =========================
    # 1. QUẢN LÝ TRẠNG THÁI ONLINE
    # =========================

    def get_online_users():
        """Lấy danh sách user online từ database"""
        try:
            online_users_docs = users_col.find(
                {'online': True},
                {'_id': 1}
            )
            online_users = [str(user['_id']) for user in online_users_docs]
            print(f"[Online Users] Current online users: {online_users}")
            return online_users
        except Exception as e:
            print(f"Error getting online users: {str(e)}")
            return []

    def set_user_online(user_id):
        """Đặt trạng thái online cho user"""
        try:
            result = users_col.update_one(
                {'_id': ObjectId(user_id)},
                {'$set': {'online': True}}
            )
            if result.modified_count > 0:
                print(f"[Online] User {user_id} is now online")
                notify_friends_online_status(user_id, True)
        except Exception as e:
            print(f"Error setting user online: {str(e)}")

    def set_user_offline(user_id):
        """Đặt trạng thái offline cho user"""
        try:
            result = users_col.update_one(
                {'_id': ObjectId(user_id)},
                {'$set': {'online': False}}
            )
            if result.modified_count > 0:
                print(f"[Offline] User {user_id} is now offline")
                notify_friends_online_status(user_id, False)
        except Exception as e:
            print(f"Error setting user offline: {str(e)}")

    def notify_friends_online_status(user_id, is_online):
        """Thông báo trạng thái online/offline cho bạn bè"""
        try:
            user = users_col.find_one(
                {'_id': ObjectId(user_id)},
                {'friends': 1, 'username': 1}
            )

            if user and 'friends' in user:
                friends = user['friends']
                for friend_id in friends:
                    emit('friend_online_status', {
                        'user_id': user_id,
                        'username': user.get('username', 'Unknown'),
                        'is_online': is_online
                    }, room=str(friend_id))
        except Exception as e:
            print(f"Error notifying friends about online status: {str(e)}")

    # =========================
    # 2. SỰ KIỆN CONNECT / DISCONNECT
    # =========================

    @socketio.on('connect')
    def handle_connect():
        """Khi client kết nối đến server"""
        user_id = session.get('user_id')
        if user_id:
            set_user_online(user_id)
            # Join room riêng cho user để nhận notification
            join_room(str(user_id))
            print(f"✅ User {user_id} connected and set online")

    @socketio.on('disconnect')
    def handle_disconnect():
        """Khi client ngắt kết nối"""
        user_id = session.get('user_id')
        if user_id:
            set_user_offline(user_id)
            print(f"❌ User {user_id} disconnected and set offline")

    # =========================
    # 3. TRẠNG THÁI TIN NHẮN (DELIVERED / READ)
    # =========================

    @socketio.on('message_delivered')
    def handle_message_delivered(data):
        """Xử lý khi tin nhắn đã được giao đến người nhận"""
        try:
            message_id = data.get('message_id')
            user_id = session.get('user_id')

            if not message_id or not user_id:
                return

            result = messages_col.update_one(
                {'_id': ObjectId(message_id)},
                {'$set': {'status': 'delivered'}}
            )

            if result.modified_count > 0:
                message = messages_col.find_one({'_id': ObjectId(message_id)})
                if message:
                    emit('message_status_updated', {
                        'message_id': message_id,
                        'status': 'delivered'
                    }, room=str(message['sender_id']))

        except Exception as e:
            print(f"Error updating message delivery: {str(e)}")

    @socketio.on('message_read')
    def handle_message_read(data):
        """Xử lý khi tin nhắn đã được đọc"""
        try:
            message_id = data.get('message_id')
            user_id = session.get('user_id')

            if not message_id or not user_id:
                return

            result = messages_col.update_one(
                {'_id': ObjectId(message_id)},
                {
                    '$set': {'status': 'read'},
                    '$addToSet': {'read_by': ObjectId(user_id)}
                }
            )

            if result.modified_count > 0:
                message = messages_col.find_one({'_id': ObjectId(message_id)})
                if message:
                    emit('message_status_updated', {
                        'message_id': message_id,
                        'status': 'read'
                    }, room=str(message['sender_id']))

        except Exception as e:
            print(f"Error updating message read status: {str(e)}")

    # =========================
    # 4. SEND_MESSAGE (PRIVATE + GROUP, CÓ REPLY)
    # =========================

    @socketio.on('send_message')
    def handle_send_message(data):
        try:
            # --- Sender ---
            sender_id = session.get('user_id')
            if not sender_id:
                print("No user_id in session")
                return

            # --- Input từ client ---
            conversation_id = data.get('conversation_id')
            content = data.get('content')
            message_type = data.get('message_type', 'text')
            conversation_type = data.get('conversation_type', 'private')  # 'private' hoặc 'group'

            # [MỚI] ID tin nhắn được reply
            reply_to_id = data.get('reply_to_id')

            if not all([conversation_id, content]):
                print("Missing conversation_id or content")
                return

            if conversation_type not in ['private', 'group']:
                print(f"Invalid conversation_type: {conversation_type}")
                return

            # --- Kiểm tra quyền + lấy participants ---
            recipient_ids = []
            participants = []

            if conversation_type == 'private':
                conversation = conversations_col.find_one({'_id': ObjectId(conversation_id)})
                if not conversation:
                    print(f"Private conversation {conversation_id} not found")
                    return

                if str(sender_id) not in conversation['participants']:
                    print(f"User {sender_id} not in conversation")
                    return

                participants = [p for p in conversation['participants'] if p != str(sender_id)]
                recipient_ids = [ObjectId(pid) for pid in participants]

            else:  # group
                is_member = group_members_col.find_one({
                    'group_id': ObjectId(conversation_id),
                    'user_id': ObjectId(sender_id)
                })
                if not is_member:
                    print(f"User {sender_id} not in group {conversation_id}")
                    return

                members = list(group_members_col.find({
                    'group_id': ObjectId(conversation_id),
                    'user_id': {'$ne': ObjectId(sender_id)}
                }))
                participants = [str(member['user_id']) for member in members]
                recipient_ids = [member['user_id'] for member in members]

            # --- Thông tin sender ---
            sender = users_col.find_one({'_id': ObjectId(sender_id)}, {'username': 1, 'avatar': 1})
            sender_name = sender.get('username', 'Unknown') if sender else 'Unknown'

            avatar = sender.get('avatar') if sender else None
            if avatar and not avatar.startswith(('http', 'data:image')):
                avatar = url_for('static', filename=avatar)
            sender_avatar = avatar or url_for('static', filename='img/default-avatar.png')

            # --- Tạo message ---
            now = get_vietnam_time()
            timestamp_str = format_timestamp_for_client(now)

            initial_status = 'sent'
            read_by = [ObjectId(sender_id)]

            message = {
                'conversation_id': ObjectId(conversation_id),
                'conversation_type': conversation_type,
                'sender_id': ObjectId(sender_id),
                'content': content,
                'message_type': message_type,
                'timestamp': timestamp_str,
                'read_by': read_by,
                'status': initial_status,
                'recipients': recipient_ids,
                'reply_to': ObjectId(reply_to_id) if reply_to_id else None
            }

            inserted = messages_col.insert_one(message)
            message_id = inserted.inserted_id

            # --- Lấy reply_context nếu có ---
            reply_context = None
            if reply_to_id:
                try:
                    original_msg = messages_col.find_one({'_id': ObjectId(reply_to_id)})
                    if original_msg:
                        orig_sender = users_col.find_one({'_id': original_msg['sender_id']})
                        orig_name = orig_sender['username'] if orig_sender else "Unknown"

                        reply_context = {
                            'message_id': str(original_msg['_id']),
                            'sender_id': str(original_msg['sender_id']),
                            'sender_name': orig_name,
                            'content': original_msg['content']
                        }
                except Exception as e:
                    print(f"Error getting reply context: {e}")

            # --- Cập nhật last_message ---
            update_data = {
                'last_message': content if message_type == 'text' else f'[{message_type}]',
                'last_message_time': now
            }
            if conversation_type == 'private':
                conversations_col.update_one(
                    {'_id': ObjectId(conversation_id)},
                    {'$set': update_data}
                )
            else:
                update_data['last_message_user'] = ObjectId(sender_id)
                groups_col.update_one(
                    {'_id': ObjectId(conversation_id)},
                    {'$set': update_data}
                )

            # --- Payload gửi về client ---
            message_payload = {
                'conversation_id': str(conversation_id),
                'message_id': str(message_id),
                'sender_id': str(sender_id),
                'sender_name': sender_name,
                'sender_avatar': sender_avatar,
                'content': content,
                'message_type': message_type,
                'timestamp': now.strftime('%Y-%m-%dT%H:%M:%S+07:00'),
                'status': initial_status,
                'read_by': [str(sender_id)],
                'reply_context': reply_context
            }

            # Emit tới room (1v1 & group đều join cùng id này)
            emit('receive_message', message_payload, room=str(conversation_id))

            # --- Auto gửi yêu cầu delivered cho user đang online ---
            online_users = get_online_users()
            for participant in participants:
                if participant in online_users:
                    emit('message_delivered_request', {
                        'message_id': str(message_id),
                        'conversation_id': str(conversation_id)
                    }, room=str(participant))

        except Exception as e:
            print(f"Error sending message: {str(e)}")

    # =========================
    # 5. JOIN / LEAVE CONVERSATION
    # =========================

    @socketio.on('join_conversation')
    def handle_join_conversation(data):
        conversation_id = data.get('conversation_id')
        if conversation_id:
            join_room(str(conversation_id))
            print(f"User joined conversation: {conversation_id}")

    @socketio.on('leave_conversation')
    def handle_leave_conversation(data):
        conversation_id = data.get('conversation_id')
        if conversation_id:
            leave_room(str(conversation_id))
            print(f"User left conversation: {conversation_id}")

    # =========================
    # 6. USER ONLINE / OFFLINE (DỰ PHÒNG)
    # =========================

    @socketio.on('user_online')
    def handle_user_online(data=None):
        user_id = session.get('user_id')
        if user_id:
            set_user_online(user_id)

    @socketio.on('user_offline')
    def handle_user_offline(data=None):
        user_id = session.get('user_id')
        if user_id:
            set_user_offline(user_id)

    # =========================
    # 7. LẤY TRẠNG THÁI ONLINE CỦA BẠN BÈ
    # =========================

    @socketio.on('get_online_status')
    def handle_get_online_status(data=None):
        user_id = session.get('user_id')
        if not user_id:
            return

        try:
            user = users_col.find_one(
                {'_id': ObjectId(user_id)},
                {'friends': 1}
            )

            if user and 'friends' in user:
                friends = user['friends']
                online_status = {}

                for friend_id in friends:
                    friend = users_col.find_one(
                        {'_id': ObjectId(friend_id)},
                        {'online': 1, 'username': 1}
                    )
                    if friend:
                        online_status[str(friend_id)] = {
                            'username': friend.get('username', 'Unknown'),
                            'online': friend.get('online', False)
                        }

                emit('online_status_update', online_status, room=str(user_id))

        except Exception as e:
            print(f"Error getting online status: {str(e)}")

    # =========================
    # 8. PIN / UNPIN / EDIT / DELETE MESSAGE
    # =========================

    @socketio.on('pin_message')
    def handle_pin_message(data):
        """Xử lý ghim tin nhắn"""
        try:
            message_id = data.get('message_id')
            conversation_id = data.get('conversation_id')
            conversation_type = data.get('conversation_type', 'private')
            user_id = session.get('user_id')

            if not all([message_id, conversation_id, user_id]):
                return

            emit('message_pinned', {
                'message_id': message_id,
                'conversation_id': conversation_id,
                'conversation_type': conversation_type,
                'pinned_by': user_id
            }, room=str(conversation_id))

        except Exception as e:
            print(f"Error handling pin message: {str(e)}")

    @socketio.on('unpin_message')
    def handle_unpin_message(data):
        """Xử lý bỏ ghim tin nhắn"""
        try:
            conversation_id = data.get('conversation_id')
            conversation_type = data.get('conversation_type', 'private')
            user_id = session.get('user_id')

            if not all([conversation_id, user_id]):
                return

            emit('message_unpinned', {
                'conversation_id': conversation_id,
                'conversation_type': conversation_type,
                'unpinned_by': user_id
            }, room=str(conversation_id))

        except Exception as e:
            print(f"Error handling unpin message: {str(e)}")

    @socketio.on('message_edited')
    def handle_message_edited(data):
        """Thông báo tin nhắn đã được sửa"""
        try:
            message_id = data.get('message_id')
            conversation_id = data.get('conversation_id')
            conversation_type = data.get('conversation_type', 'private')
            new_content = data.get('new_content')

            if not all([message_id, conversation_id, new_content]):
                return

            emit('message_updated', {
                'message_id': message_id,
                'conversation_id': conversation_id,
                'conversation_type': conversation_type,
                'new_content': new_content,
                'edited_at': get_vietnam_time().isoformat()
            }, room=str(conversation_id))

        except Exception as e:
            print(f"Error handling message edited: {str(e)}")

    @socketio.on('message_deleted')
    def handle_message_deleted(data):
        """Thông báo tin nhắn đã bị xóa"""
        try:
            message_id = data.get('message_id')
            conversation_id = data.get('conversation_id')
            conversation_type = data.get('conversation_type', 'private')

            if not all([message_id, conversation_id]):
                return

            emit('message_removed', {
                'message_id': message_id,
                'conversation_id': conversation_id,
                'conversation_type': conversation_type
            }, room=str(conversation_id))

        except Exception as e:
            print(f"Error handling message deleted: {str(e)}")

    # =========================
    # 9. TYPING INDICATOR (ĐANG NHẬP...)
    # =========================

    @socketio.on('typing')
    def handle_typing(data):
        """
        Client báo đang nhập.
        Dùng cho cả 1v1 (private) và group.
        """
        try:
            conversation_id = data.get('conversation_id')
            conversation_type = data.get('conversation_type', 'private')
            user_id = session.get('user_id')

            if not conversation_id or not user_id:
                return

            if conversation_type == 'group':
                room = f"group_{conversation_id}"   # group.py join_group dùng room này
            else:
                room = str(conversation_id)         # 1v1 dùng join_conversation -> room=conversation_id

            emit('typing', {
                'conversation_id': conversation_id,
                'conversation_type': conversation_type,
                'user_id': user_id
            }, room=room, include_self=False)

        except Exception as e:
            print(f"Error handling typing: {str(e)}")

    @socketio.on('stop_typing')
    def handle_stop_typing(data):
        """
        Client báo đã dừng nhập.
        Dùng cho cả 1v1 (private) và group.
        """
        try:
            conversation_id = data.get('conversation_id')
            conversation_type = data.get('conversation_type', 'private')
            user_id = session.get('user_id')

            if not conversation_id or not user_id:
                return

            if conversation_type == 'group':
                room = f"group_{conversation_id}"
            else:
                room = str(conversation_id)

            emit('stop_typing', {
                'conversation_id': conversation_id,
                'conversation_type': conversation_type,
                'user_id': user_id
            }, room=room, include_self=False)

        except Exception as e:
            print(f"Error handling stop_typing: {str(e)}")
