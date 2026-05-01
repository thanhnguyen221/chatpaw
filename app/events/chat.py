from flask import session, url_for
from bson import ObjectId
from datetime import datetime
from flask_socketio import emit, join_room, leave_room
from flask import request # Đảm bảo đã có request
from deep_translator import GoogleTranslator
from langdetect import detect

from app.utils.time_utils import get_vietnam_time, format_timestamp_for_client
from app.message_encryption import encrypt_message, decrypt_message


def register_chat_events(socketio, mongo):
    messages_col = mongo.db.messages
    conversations_col = mongo.db.conversations
    groups_col = mongo.db.groups
    group_members_col = mongo.db.group_members
    users_col = mongo.db.users

    # Track which users are currently in which conversation (actively viewing)
    # Format: {user_id: conversation_id}
    user_current_conversations = {}

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
        """Xử lý khi tin nhắn đã được đọc - cả 1v1 và group"""
        try:
            message_id = data.get('message_id')
            user_id = session.get('user_id')
            conversation_type = data.get('conversation_type', 'private')

            if not message_id or not user_id:
                return

            # Chọn collection phù hợp
            if conversation_type == 'group':
                col = mongo.db.group_messages
            else:
                col = messages_col

            # Cập nhật read_by và status
            result = col.update_one(
                {'_id': ObjectId(message_id)},
                {
                    '$set': {'status': 'read'},
                    '$addToSet': {'read_by': ObjectId(user_id)}
                }
            )

            if result.modified_count > 0:
                message = col.find_one({'_id': ObjectId(message_id)})
                if message:
                    sender_id = str(message['sender_id'])
                    
                    # Lấy thông tin người đọc
                    reader = users_col.find_one(
                        {'_id': ObjectId(user_id)},
                        {'avatar': 1, 'full_name': 1, 'username': 1}
                    )
                    reader_info = {
                        'user_id': str(user_id),
                        'avatar': reader.get('avatar') if reader else None,
                        'name': reader.get('full_name') or reader.get('username', 'Unknown') if reader else 'Unknown'
                    }
                    
                    # Get all readers for group
                    read_by_list = message.get('read_by', [])
                    readers_info = []
                    if conversation_type == 'group':
                        for rid in read_by_list:
                            r = users_col.find_one(
                                {'_id': rid},
                                {'avatar': 1, 'full_name': 1, 'username': 1}
                            )
                            if r:
                                readers_info.append({
                                    'user_id': str(rid),
                                    'avatar': r.get('avatar'),
                                    'name': r.get('full_name') or r.get('username', 'Unknown')
                                })
                    
                    # Emit cho sender
                    emit('message_status_updated', {
                        'message_id': message_id,
                        'status': 'read',
                        'conversation_type': conversation_type,
                        'read_by': readers_info if conversation_type == 'group' else [reader_info]
                    }, room=sender_id)
                    
                    # Nếu là group, emit cho tất cả members để cập nhật seen avatars
                    if conversation_type == 'group':
                        conversation_id = str(message.get('conversation_id'))
                        emit('group_message_read', {
                            'message_id': message_id,
                            'reader': reader_info,
                            'read_by': readers_info
                        }, room=conversation_id)

        except Exception as e:
            print(f"Error updating message read status: {str(e)}")

    # =========================
    # 4. SEND_MESSAGE (PRIVATE + GROUP, CÓ REPLY + GIFT + LAST_MESSAGE + UNREAD)
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
            
            # [MỚI] Kiểu hộp quà (gift_classic, gift_love, gift_mystery, gift_fire)
            gift_style = data.get('gift_style')

            if not all([conversation_id, content]):
                print("Missing conversation_id or content")
                return

            if conversation_type not in ['private', 'group']:
                print(f"Invalid conversation_type: {conversation_type}")
                return

            # --- Chuẩn hóa ObjectId ---
            try:
                conv_oid = ObjectId(conversation_id)
                sender_oid = ObjectId(sender_id)
            except Exception as e:
                print("Invalid ObjectId:", e)
                return

            # --- Kiểm tra quyền + lấy participants ---
            recipient_ids = []
            participants = []   # list[str user_id]

            if conversation_type == 'private':
                conversation = conversations_col.find_one({'_id': conv_oid})
                if not conversation:
                    print(f"Private conversation {conversation_id} not found")
                    return

                if str(sender_id) not in conversation.get('participants', []):
                    print(f"User {sender_id} not in conversation")
                    return

                participants = [p for p in conversation['participants'] if p != str(sender_id)]
                recipient_ids = [ObjectId(pid) for pid in participants]

            else:  # group
                is_member = group_members_col.find_one({
                    'group_id': conv_oid,
                    'user_id': sender_oid
                })
                if not is_member:
                    print(f"User {sender_id} not in group {conversation_id}")
                    return

                members = list(group_members_col.find({
                    'group_id': conv_oid,
                    'user_id': {'$ne': sender_oid}
                }))
                participants = [str(member['user_id']) for member in members]
                recipient_ids = [member['user_id'] for member in members]

            # --- Thông tin sender ---
            sender = users_col.find_one({'_id': sender_oid}, {'username': 1, 'full_name': 1, 'avatar': 1})
            sender_name = sender.get('full_name') or sender.get('username', 'Unknown') if sender else 'Unknown'

            avatar = sender.get('avatar') if sender else None
            if avatar and not avatar.startswith(('http', 'data:image')):
                avatar = url_for('static', filename=avatar)
            sender_avatar = avatar or url_for('static', filename='img/default-avatar.png')

            # --- Tạo message ---
            now = get_vietnam_time()
            timestamp_str = format_timestamp_for_client(now)

            initial_status = 'sent'
            read_by = [sender_oid]

            # Encrypt message content before saving
            encrypted_content = encrypt_message(content) if message_type == 'text' else content

            message = {
                'conversation_id': conv_oid,
                'conversation_type': conversation_type,
                'sender_id': sender_oid,
                'content': encrypted_content,
                'message_type': message_type,
                'timestamp': timestamp_str,
                'read_by': read_by,
                'status': initial_status,
                'recipients': recipient_ids,
                'reply_to': ObjectId(reply_to_id) if reply_to_id else None,
                'gift_style': gift_style,  # [MỚI] Lưu trường này vào DB
                'encrypted': message_type == 'text'  # Đánh dấu tin nhắn đã mã hóa
            }

            inserted = messages_col.insert_one(message)
            message_id = inserted.inserted_id

            # --- Lấy reply_context nếu có ---
            reply_context = None
            if reply_to_id:
                try:
                    original_msg = messages_col.find_one({'_id': ObjectId(reply_to_id)})
                    if original_msg:
                        orig_sender = users_col.find_one({'_id': original_msg['sender_id']}, {'username': 1, 'full_name': 1})
                        orig_name = orig_sender.get('full_name') or orig_sender.get('username', 'Unknown') if orig_sender else 'Unknown'

                        # Decrypt original message content if encrypted
                        orig_content = original_msg.get('content', '')
                        if original_msg.get('encrypted') or original_msg.get('message_type') == 'text':
                            orig_content = decrypt_message(orig_content)

                        reply_context = {
                            'message_id': str(original_msg['_id']),
                            'sender_id': str(original_msg['sender_id']),
                            'sender_name': orig_name,
                            'content': orig_content
                        }
                except Exception as e:
                    print(f"Error getting reply context: {e}")

            # --- Cập nhật last_message + unread_counts ---
            # Tùy theo loại message mà hiển thị preview cho đẹp
            preview_content = content

            if gift_style:
                preview_content = "🎁 Đã gửi một hộp quà"
            elif message_type == 'location':
                preview_content = "📍 Đã chia sẻ vị trí"
            elif message_type == 'audio':
                preview_content = "🎤 Tin nhắn thoại"
            elif message_type != 'text':
                # fallback cho các loại khác: image, file, sticker...
                preview_content = f'[{message_type}]'

            # --- Build update cho last_message & unread ---
            if conversation_type == 'private':
                # unread_counts: tăng +1 cho các participant, set về 0 cho sender
                inc_fields = {}
                for pid in participants:   # các user còn lại
                    inc_fields[f'unread_counts.{pid}'] = 1

                set_fields = {
                    'last_message': preview_content,
                    'last_message_time': now,
                    'last_sender_id': sender_oid,
                    'last_sender_name': sender_name,
                    f'unread_counts.{sender_id}': 0
                }

                update_doc = {'$set': set_fields}
                if inc_fields:
                    update_doc['$inc'] = inc_fields

                conversations_col.update_one(
                    {'_id': conv_oid},
                    update_doc
                )

            else:
                # group: last_message + last_message_user + unread_counts
                inc_fields = {}
                for pid in participants:   # các member khác
                    inc_fields[f'unread_counts.{pid}'] = 1

                set_fields = {
                    'last_message': preview_content,
                    'last_message_time': now,
                    'last_message_user': sender_oid,
                    'last_sender_name': sender_name,
                    f'unread_counts.{sender_id}': 0
                }

                update_doc = {'$set': set_fields}
                if inc_fields:
                    update_doc['$inc'] = inc_fields

                groups_col.update_one(
                    {'_id': conv_oid},
                    update_doc
                )

            # --- Payload gửi về client (tin nhắn) ---
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
                'reply_context': reply_context,
                'gift_style': gift_style  # [MỚI] Gửi về client để render hiệu ứng
            }

            # Emit tới room (1v1 & group đều join cùng id này)
            emit('receive_message', message_payload, room=str(conversation_id))

            # [FIX] Emit tới từng người nhận để đảm bảo nhận được ở mọi nơi
            for p_id in participants:
                emit('receive_message', message_payload, room=str(p_id))

            # --- [OPTIONAL] Emit cập nhật summary cho sidebar (nếu FE có dùng) ---
            try:
                # Đọc lại unread_counts để gửi riêng cho từng user
                if conversation_type == 'private':
                    conv_doc = conversations_col.find_one(
                        {'_id': conv_oid},
                        {'unread_counts': 1, 'participants': 1}
                    )
                    if conv_doc:
                        unread_counts = conv_doc.get('unread_counts', {})
                        # Gửi cho tất cả participants trong cuộc trò chuyện (bao gồm cả sender)
                        all_participants = conv_doc.get('participants', [])
                        for uid in all_participants:
                            emit('conversation_summary_updated', {
                                'conversation_id': str(conversation_id),
                                'conversation_type': 'private',
                                'last_message': preview_content,
                                'last_message_time': format_timestamp_for_client(now),
                                'last_sender_id': str(sender_id),
                                'last_sender_name': sender_name,
                                'unread_count': unread_counts.get(uid, 0)
                            }, room=str(uid))
                else:
                    conv_doc = groups_col.find_one(
                        {'_id': conv_oid},
                        {'unread_counts': 1}
                    )
                    if conv_doc:
                        unread_counts = conv_doc.get('unread_counts', {})
                        # Lấy toàn bộ member group (cả sender)
                        members_all = list(group_members_col.find(
                            {'group_id': conv_oid},
                            {'user_id': 1}
                        ))
                        for m in members_all:
                            uid = str(m['user_id'])
                            emit('conversation_summary_updated', {
                                'conversation_id': str(conversation_id),
                                'conversation_type': 'group',
                                'last_message': preview_content,
                                'last_message_time': format_timestamp_for_client(now),
                                'last_sender_id': str(sender_id),
                                'last_sender_name': sender_name,
                                'unread_count': unread_counts.get(uid, 0)
                            }, room=uid)
            except Exception as e:
                print(f"Error emitting conversation_summary_updated: {e}")

            # --- Auto gửi yêu cầu delivered/read cho user đang online ---
            online_users = get_online_users()
            for participant in participants:
                participant_str = str(participant)
                if participant_str in online_users:
                    # Check if user is actively viewing this conversation
                    is_viewing = user_current_conversations.get(participant_str) == str(conversation_id)
                    
                    if is_viewing:
                        # User is online AND viewing the conversation -> mark as read immediately
                        emit('message_read_request', {
                            'message_id': str(message_id),
                            'conversation_id': str(conversation_id)
                        }, room=participant_str)
                        print(f"[Message Status] Sent read request to {participant_str} (viewing conversation)")
                    else:
                        # User is online but NOT viewing -> mark as delivered
                        emit('message_delivered_request', {
                            'message_id': str(message_id),
                            'conversation_id': str(conversation_id)
                        }, room=participant_str)
                        print(f"[Message Status] Sent delivered request to {participant_str} (online but not viewing)")
                else:
                    # User is offline -> status stays as 'sent'
                    print(f"[Message Status] User {participant_str} is offline, status remains 'sent'")

        except Exception as e:
            print(f"Error sending message: {str(e)}")


    # =========================
    # 5. JOIN / LEAVE CONVERSATION
    # =========================

    @socketio.on('join_conversation')
    def handle_join_conversation(data):
        conversation_id = data.get('conversation_id')
        user_id = session.get('user_id')
        if conversation_id:
            join_room(str(conversation_id))
            # Track that user is now viewing this conversation
            if user_id:
                user_current_conversations[str(user_id)] = str(conversation_id)
                print(f"[Join] User {user_id} joined conversation {conversation_id}")
                
                # 🔥 [NEW] Mark all unread messages as read immediately when joining
                try:
                    from bson.objectid import ObjectId
                    result = messages_col.update_many(
                        {
                            'conversation_id': ObjectId(conversation_id),
                            'sender_id': {'$ne': ObjectId(user_id)},
                            'status': {'$ne': 'read'}
                        },
                        {
                            '$set': {'status': 'read', 'read_at': get_vietnam_time()}
                        }
                    )
                    if result.modified_count > 0:
                        print(f"[Join] Marked {result.modified_count} messages as read for user {user_id}")
                        
                        # Notify senders that their messages were read
                        updated_messages = messages_col.find({
                            'conversation_id': ObjectId(conversation_id),
                            'sender_id': {'$ne': ObjectId(user_id)},
                            'status': 'read'
                        })
                        
                        for msg in updated_messages:
                            emit('message_status_updated', {
                                'message_id': str(msg['_id']),
                                'status': 'read'
                            }, room=str(msg['sender_id']))
                except Exception as e:
                    print(f"[Join] Error marking messages as read: {e}")

    @socketio.on('leave_conversation')
    def handle_leave_conversation(data):
        conversation_id = data.get('conversation_id')
        user_id = session.get('user_id')
        if conversation_id:
            leave_room(str(conversation_id))
            # Remove user from tracking if they were viewing this conversation
            if user_id and user_current_conversations.get(str(user_id)) == str(conversation_id):
                del user_current_conversations[str(user_id)]
                print(f"[Leave] User {user_id} left conversation {conversation_id}")

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
                        {'online': 1, 'username': 1, 'full_name': 1}
                    )
                    if friend:
                        online_status[str(friend_id)] = {
                            'username': friend.get('full_name') or friend.get('username', 'Unknown'),
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

            # Lấy username để client hiển thị "A đang nhập..."
            user_doc = users_col.find_one(
                {'_id': ObjectId(user_id)},
                {'username': 1, 'full_name': 1}
            )
            username = user_doc.get('full_name') or user_doc.get('username', 'Unknown') if user_doc else 'Unknown'

            if conversation_type == 'group':
                room = f"group_{conversation_id}"   # group.py join_group dùng room này
            else:
                room = str(conversation_id)         # 1v1 dùng join_conversation -> room=conversation_id

            emit('typing', {
                'conversation_id': conversation_id,
                'conversation_type': conversation_type,
                'user_id': user_id,
                'username': username
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

# ==================================================================
    # 10. MESSAGE REACTION (THẢ CẢM XÚC - CẬP NHẬT PREVIEW & SIDEBAR)
    # ==================================================================
    @socketio.on('react_message')
    def handle_react_message(data):
        try:
            user_id = session.get('user_id')
            if not user_id: return

            message_id = data.get('message_id')
            emoji = data.get('emoji') 
            conversation_type = data.get('conversation_type', 'private')
            conversation_id = data.get('conversation_id')

            if not message_id: return

            try:
                msg_oid = ObjectId(message_id)
                conv_oid = ObjectId(conversation_id) if conversation_id else None
                user_oid = ObjectId(user_id)
            except:
                return # ID không hợp lệ

            # 1. Chọn đúng bảng dữ liệu (Direct Access để tránh lỗi)
            if conversation_type == 'private':
                col = mongo.db.messages 
            else:
                col = mongo.db.group_messages

            # 2. Tìm tin nhắn
            msg = col.find_one({'_id': msg_oid})
            if not msg: return

            # 3. Xử lý Logic Thả/Gỡ
            current_reactions = msg.get('reactions', {})
            current_user_emoji = current_reactions.get(str(user_id))
            action = 'added'
            
            if current_user_emoji == emoji:
                # Bấm lại icon cũ -> Gỡ (Remove)
                col.update_one({'_id': msg_oid}, {'$unset': {f'reactions.{user_id}': ""}})
                action = 'removed'
                emoji = None 
            else:
                # Icon mới hoặc thay đổi -> Cập nhật (Set)
                col.update_one({'_id': msg_oid}, {'$set': {f'reactions.{user_id}': emoji}})
                action = 'updated'

            # 4. [QUAN TRỌNG] Cập nhật Preview hội thoại (Sidebar)
            # Chỉ cập nhật khi Thêm hoặc Đổi (không cập nhật khi Xóa để tránh spam)
            if action in ['added', 'updated'] and conv_oid:
                try:
                    # Lấy tên người thả
                    sender_info = mongo.db.users.find_one({'_id': user_oid}, {'username': 1, 'full_name': 1})
                    sender_name = sender_info.get('full_name') or sender_info.get('username', 'Ai đó') if sender_info else 'Ai đó'
                    
                    # Nội dung lưu vào DB (Dùng chung cho cả 2 bên thấy)
                    preview_text = f"{sender_name} đã thả cảm xúc {emoji}"

                    now = get_vietnam_time()
                    
                    # Cập nhật bảng Conversations hoặc Groups
                    if conversation_type == 'private':
                        mongo.db.conversations.update_one(
                            {'_id': conv_oid},
                            {'$set': {
                                'last_message': preview_text,
                                'last_message_time': now
                            }}
                        )
                    else:
                        mongo.db.groups.update_one(
                            {'_id': conv_oid},
                            {'$set': {
                                'last_message': preview_text,
                                'last_message_time': now,
                                'last_message_user': user_oid
                            }}
                        )
                except Exception as ex:
                    print(f"Error updating preview: {ex}")

            # 5. Thông báo Socket cho mọi người
            if conversation_type == 'group':
                room = f"group_{conversation_id}"
            else:
                room = str(conversation_id)
            
            emit('message_reaction_updated', {
                'message_id': message_id,
                'user_id': str(user_id),
                'conversation_id': conversation_id,
                'conversation_type': conversation_type,
                'emoji': emoji,
                'action': action,
                # Gửi kèm timestamp để sort lại list bên frontend nếu cần
                'timestamp': get_vietnam_time().isoformat()
            }, room=room)

        except Exception as e:
            print(f"Error reacting message: {e}")
    

    # ============================================================
    # XỬ LÝ DỊCH THUẬT (Dùng chung cho cả 1v1 và Group)
    # ============================================================
    @socketio.on('translate_message')
    def handle_translate_message(data):
        message_id = data.get('message_id')
        content = data.get('content', '').strip()
        
        if not content:
            return

        try:
            # 1. Phát hiện ngôn ngữ (Detect)
            try:
                # detect trả về mã ngôn ngữ: 'vi', 'en', 'fr',...
                detected_lang = detect(content)
            except:
                detected_lang = 'unknown'

            # 2. Logic thông minh: Đảo chiều ngôn ngữ
            # Nếu phát hiện là Tiếng Việt -> Dịch sang Anh
            if detected_lang == 'vi':
                target = 'en'
                label_target = 'English'
            # Ngược lại (Tiếng Anh hoặc ngôn ngữ lạ) -> Dịch sang Việt
            else:
                target = 'vi'
                label_target = 'Tiếng Việt'

            # 3. Dịch bằng Google Translate (Free)
            translator = GoogleTranslator(source='auto', target=target)
            translated_text = translator.translate(content)

            # 4. Gửi kết quả về CHỈ cho người yêu cầu (request.sid)
            emit('message_translated', {
                'message_id': message_id,
                'original': content,
                'translated': translated_text,
                'lang_label': label_target,
                'success': True
            }, room=request.sid)
            
        except Exception as e:
            print(f"Translate error: {e}")
            emit('message_translated', {
                'message_id': message_id,
                'success': False,
                'error': 'Không thể dịch tin nhắn này'
            }, room=request.sid)