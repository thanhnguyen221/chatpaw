from flask import request, session, url_for
from bson import ObjectId
from datetime import datetime
from app.utils.time_utils import get_vietnam_time, format_timestamp_for_client
from flask_socketio import join_room, leave_room, emit
import pytz


def register_group_events(socketio, mongo):
    group_members_col = mongo.db.group_members
    groups_col = mongo.db.groups
    messages_col = mongo.db.group_messages
    users_col = mongo.db.users

    # ------------------ HÀM HỖ TRỢ ------------------
    def get_user_info(user_id):
        try:
            # Cho phép truyền vào cả str lẫn ObjectId
            if isinstance(user_id, ObjectId):
                query_id = user_id
            else:
                query_id = ObjectId(user_id)

            user = users_col.find_one({'_id': query_id})
            if user:
                avatar = user.get('avatar')
                if not avatar:
                    avatar = url_for('static', filename='img/default-avatar.png')
                return {
                    'username': user.get('username', 'Unknown'),
                    'avatar': avatar
                }
        except Exception as e:
            print(f"Error getting user info for {user_id}: {e}")

        return {
            'username': 'Unknown',
            'avatar': url_for('static', filename='img/default-avatar.png')
        }

    def get_vietnam_time():
        vietnam_tz = pytz.timezone('Asia/Ho_Chi_Minh')
        return datetime.now(vietnam_tz)

    @socketio.on('reset_group_unread')
    def handle_reset_group_unread(data):
        group_id = data.get('group_id')
        user_id = session.get('user_id')

        if not group_id or not user_id:
            return

        try:
            group_oid = ObjectId(group_id)
        except Exception as e:
            print(f"Error converting group ID: {e}")
            return

        groups_col.update_one(
            {'_id': group_oid},
            {'$set': {f'unread_counts.{user_id}': 0}}
        )

    @socketio.on('mark_group_message_as_read')
    def handle_mark_group_message_as_read(data):
        message_id = data.get('message_id')
        group_id = data.get('group_id')
        user_id = session.get('user_id')

        if not all([message_id, group_id, user_id]):
            return

        try:
            msg_oid = ObjectId(message_id)
            user_oid = ObjectId(user_id)
        except Exception as e:
            print(f"Error converting IDs: {e}")
            return

        # Add user to the read_by array if not already present
        update_result = messages_col.update_one(
            {'_id': msg_oid},
            {'$addToSet': {'read_by': user_oid}}
        )

        print(f"Mark as read result for message {message_id}: matched={update_result.matched_count}, modified={update_result.modified_count}")

        # Get the updated list of users who have read the message
        message = messages_col.find_one({'_id': msg_oid})
        if message and 'read_by' in message:
            seen_by_users = []
            for reader_id in message['read_by']:
                user_info = get_user_info(reader_id)
                if user_info:
                    seen_by_users.append({
                        'user_id': str(reader_id),
                        'username': user_info['username'],
                        'avatar': user_info['avatar']
                    })
            
            # Emit an event to the group with the list of users who have seen the message
            emit('group_message_seen_by', {
                'message_id': message_id,
                'group_id': group_id,
                'seen_by': seen_by_users
            }, room=f"group_{group_id}")

    # ------------------ JOIN GROUP ------------------
    @socketio.on('join_group')
    def handle_join_group(data):
        group_id = data.get('group_id')
        user_id = session.get('user_id')
        if not group_id or not user_id:
            return

        room = f"group_{group_id}"
        join_room(room)
        print(f"User {user_id} joined group {group_id}")

        # Lấy 50 tin nhắn gần nhất
        messages = list(messages_col.find(
            {'group_id': ObjectId(group_id)},
            sort=[('timestamp', -1)],
            limit=50
        ))
        messages.reverse()  # Hiển thị từ cũ đến mới

        payload_messages = []
        for msg in messages:
            sender_info = get_user_info(msg['sender_id'])

            # ----- Build reply_context nếu có reply_to -----
            reply_context = None

            # Ưu tiên field mới 'reply_to', fallback 'reply_to_id' (dữ liệu cũ)
            reply_ref = msg.get('reply_to') or msg.get('reply_to_id')

            if reply_ref:
                try:
                    reply_oid = reply_ref if isinstance(reply_ref, ObjectId) else ObjectId(reply_ref)
                    original_msg = messages_col.find_one({'_id': reply_oid})
                    if original_msg:
                        ori_sender_info = get_user_info(original_msg['sender_id'])
                        reply_context = {
                            'message_id': str(original_msg['_id']),
                            'sender_id': str(original_msg['sender_id']),
                            'sender_name': ori_sender_info['username'],
                            'content': original_msg.get('content', ''),
                            'message_type': original_msg.get('message_type', 'text')
                        }
                except Exception as e:
                    print(f"[DEBUG] Error building reply_context for history: {e}")
                    reply_context = None
            # ---------------------------------------------------------

            ts = msg.get('timestamp')
            if isinstance(ts, datetime):
                ts_str = ts.isoformat()
            else:
                ts_str = str(ts)

            payload_messages.append({
                'message_id': str(msg['_id']),
                'sender_id': str(msg['sender_id']),
                'sender_name': sender_info['username'],
                'sender_avatar': sender_info['avatar'],
                'content': msg.get('content', ''),
                'message_type': msg.get('message_type', 'text'),
                'timestamp': ts_str,
                'reply_context': reply_context,  # cho FE vẽ quote
                'gift_style': msg.get('gift_style')  # 👈 THÊM DÒNG NÀY
            })

        emit('group_history', {
            'group_id': group_id,
            'messages': payload_messages
        }, room=request.sid)

    # ------------------ LEAVE GROUP ------------------
    @socketio.on('leave_group')
    def handle_leave_group(data):
        group_id = data.get('group_id')
        user_id = session.get('user_id')

        if not group_id or not user_id:
            return  # Thiếu thông tin

        try:
            group_oid = ObjectId(group_id)
            user_oid = ObjectId(user_id)
        except:
            return  # ID không hợp lệ

        # Xoá khỏi bảng group_members
        result = group_members_col.delete_one({
            'group_id': group_oid,
            'user_id': user_oid
        })

        if result.deleted_count == 0:
            return  # Không phải thành viên hoặc đã rời

        # Rời room socket
        room = f"group_{group_id}"
        leave_room(room)

        # Gửi thông báo cho các thành viên khác trong nhóm
        emit('user_left_group', {
            'user_id': user_id,
            'group_id': group_id
        }, room=room)

        # Gửi về client người dùng để cập nhật UI (nếu cần)
        emit('you_left_group', {
            'group_id': group_id
        }, room=request.sid)

        # ------------------ SEND MESSAGE (GROUP + GIFT + UNREAD + SUMMARY) ------------------
    @socketio.on('send_group_message')
    def handle_send_group_message(data):
        group_id = data.get('group_id')
        content = data.get('content')
        message_type = data.get('message_type', 'text')
        user_id = session.get('user_id')
        reply_to_id = data.get('reply_to_id')  # ID tin nhắn đang reply (nếu có)
        
        # [MỚI] Kiểu hộp quà
        gift_style = data.get('gift_style') 
        
        print(
            f"[DEBUG] Received group message: group_id={group_id}, "
            f"content={content}, message_type={message_type}, "
            f"user_id={user_id}, reply_to_id={reply_to_id}, gift_style={gift_style}"
        )
        
        if not all([group_id, content, user_id]):
            print("[DEBUG] Missing required fields")
            return

        try:
            group_oid = ObjectId(group_id)
            user_oid = ObjectId(user_id)
        except Exception as e:
            print(f"[DEBUG] Invalid ID: {e}")
            return

        # Kiểm tra user có phải thành viên
        is_member = group_members_col.find_one({
            'group_id': group_oid,
            'user_id': user_oid
        })
        if not is_member:
            print(f"[DEBUG] User {user_id} is not a member of group {group_id}")
            return

        # Sử dụng giờ Việt Nam
        now = get_vietnam_time()

        sender = users_col.find_one({'_id': user_oid})
        sender_name = sender.get('username', 'Unknown') if sender else 'Unknown'
        sender_avatar = sender.get('avatar') if sender and sender.get('avatar') else url_for('static', filename='img/default-avatar.png')

        # Build reply_context nếu có reply_to_id
        reply_context = None
        reply_to_oid = None
        if reply_to_id:
            try:
                reply_to_oid = ObjectId(reply_to_id)
                original_msg = messages_col.find_one({'_id': reply_to_oid})
                if original_msg:
                    ori_sender_info = get_user_info(original_msg['sender_id'])
                    reply_context = {
                        'message_id': str(original_msg['_id']),
                        'sender_id': str(original_msg['sender_id']),
                        'sender_name': ori_sender_info['username'],
                        'content': original_msg.get('content', ''),
                        'message_type': original_msg.get('message_type', 'text')
                    }
            except Exception as e:
                print(f"[DEBUG] Cannot build reply_context: {e}")
                reply_to_oid = None
                reply_context = None

        # Tạo message object
        message = {
            'group_id': group_oid,
            'sender_id': user_oid,
            'content': content,
            'message_type': message_type,
            'timestamp': now,
            'read_by': [user_oid],
            # [MỚI] Lưu gift_style vào DB
            'gift_style': gift_style 
        }

        if reply_to_oid:
            message['reply_to'] = reply_to_oid

        print(f"[DEBUG] Inserting message: {message}")
        inserted = messages_col.insert_one(message)
        message_id = inserted.inserted_id
        print(f"[DEBUG] Message inserted with ID: {message_id}")

        # ================== [MỚI] CẬP NHẬT LAST_MESSAGE + UNREAD_COUNTS ==================
        try:
            # Preview đẹp cho sidebar nhóm
            if gift_style:
                preview = "🎁 Đã gửi một hộp quà"
            elif message_type == 'location':
                preview = "📍 Đã chia sẻ vị trí"
            elif message_type == 'audio':
                preview = "🎤 Tin nhắn thoại"
            elif message_type == 'text':
                preview = content
            else:
                preview = f'[{message_type}]'  # image, file, sticker...

            # Lấy toàn bộ member group (kể cả người gửi)
            members = list(group_members_col.find(
                {'group_id': group_oid},
                {'user_id': 1}
            ))

            inc_fields = {}
            set_fields = {
                'last_message': preview,
                'last_message_time': now,
                'last_message_user': user_oid,
                'last_sender_name': sender_name,
                f'unread_counts.{user_id}': 0  # Người gửi: reset về 0
            }

            for m in members:
                uid_str = str(m['user_id'])
                if uid_str != str(user_id):
                    # Các thành viên khác: +1 tin chưa đọc
                    inc_fields[f'unread_counts.{uid_str}'] = 1

            update_doc = {'$set': set_fields}
            if inc_fields:
                update_doc['$inc'] = inc_fields

            groups_col.update_one(
                {'_id': group_oid},
                update_doc
            )

            # Đọc lại unread_counts để bắn socket cho từng user
            group_doc = groups_col.find_one(
                {'_id': group_oid},
                {'unread_counts': 1}
            )
            unread_counts = group_doc.get('unread_counts', {}) if group_doc else {}

            for m in members:
                uid_str = str(m['user_id'])
                emit('conversation_summary_updated', {
                    'conversation_id': group_id,
                    'conversation_type': 'group',
                    'last_message': preview,
                    'last_message_time': format_timestamp_for_client(now),
                    'last_sender_id': user_id,
                    'last_sender_name': sender_name,
                    'unread_count': unread_counts.get(uid_str, 0)
                }, room=uid_str)

        except Exception as e:
            print(f"[DEBUG] Cannot update group last_message/unread_counts: {e}")
        # =====================================================================

        # Emit tới room để hiển thị tin nhắn trong khung chat
        emit_data = {
            'group_id': group_id,
            'message_id': str(message_id),
            'sender_id': str(user_id),
            'sender_name': sender_name,
            'content': content,
            'message_type': message_type,
            'timestamp': format_timestamp_for_client(now),
            'sender_avatar': sender_avatar,

            # dữ liệu reply
            'reply_to_id': reply_to_id,
            'reply_context': reply_context,
            
            # [MỚI] Gửi gift_style về client
            'gift_style': gift_style
        }
        
        print(f"[DEBUG] Emitting group_message: {emit_data}")
        emit('group_message', emit_data, room=f"group_{group_id}")


    # ------------------ UPDATE GROUP NAME ------------------
    @socketio.on('update_group_name')
    def handle_update_group_name(data):
        try:
            group_id = data.get('group_id')
            new_name = data.get('new_name')
            user_id = session.get('user_id')

            if not group_id or not new_name or not user_id:
                return {'ok': False, 'error': 'Thiếu thông tin'}

            member = group_members_col.find_one({
                'group_id': ObjectId(group_id),
                'user_id': ObjectId(user_id)
            })

            if not member or member.get('role') != 'admin':
                return {'ok': False, 'error': 'Permission denied'}

            result = groups_col.update_one(
                {'_id': ObjectId(group_id)},
                {'$set': {'name': new_name}}
            )

            if result.modified_count > 0:
                emit('group_name_updated', {
                    'group_id': group_id,
                    'new_name': new_name
                }, room=f"group_{group_id}")
                return {'ok': True}
            else:
                return {'ok': False, 'error': 'Không có thay đổi hoặc cập nhật thất bại'}
        except Exception as e:
            print('Error in update_group_name:', e)
            return {'ok': False, 'error': 'Lỗi server'}

    # ------------------ ADD MEMBER ------------------
    @socketio.on('add_group_member')
    def handle_add_group_member(data):
        group_id = data.get('group_id')
        user_id_to_add = data.get('user_id')
        user_id = session.get('user_id')

        if not group_id or not user_id_to_add or not user_id:
            return

        member = group_members_col.find_one({
            'group_id': ObjectId(group_id),
            'user_id': ObjectId(user_id)
        })

        if not member or member.get('role') != 'admin':
            emit('error', {'message': 'Permission denied'}, room=request.sid)
            return

        group_members_col.insert_one({
            'group_id': ObjectId(group_id),
            'user_id': ObjectId(user_id_to_add),
            'joined_at': datetime.utcnow()
        })

        emit('group_member_added', {
            'group_id': group_id,
            'user_id': user_id_to_add
        }, room=f"group_{group_id}")

    # ------------------ REMOVE MEMBER ------------------
    @socketio.on('remove_group_member')
    def handle_remove_group_member(data):
        group_id = data.get('group_id')
        user_id_to_remove = data.get('user_id')
        user_id = session.get('user_id')

        if not group_id or not user_id_to_remove or not user_id:
            return

        member = group_members_col.find_one({
            'group_id': ObjectId(group_id),
            'user_id': ObjectId(user_id)
        })

        if not member or member.get('role') != 'admin':
            emit('error', {'message': 'Permission denied'}, room=request.sid)
            return

        group_members_col.delete_one({
            'group_id': ObjectId(group_id),
            'user_id': ObjectId(user_id_to_remove)
        })

        emit('group_member_removed', {
            'group_id': group_id,
            'user_id': user_id_to_remove
        }, room=f"group_{group_id}")

        # Gửi đến socket riêng của user bị xoá
        emit('you_were_removed', {
            'group_id': group_id
        }, room=user_id_to_remove)

    # ------------------ UPDATE GROUP AVATAR ------------------
    @socketio.on('update_group_avatar')
    def handle_update_group_avatar(data):
        try:
            group_id = data.get('group_id')
            new_avatar = data.get('new_avatar')
            user_id = session.get('user_id')

            # Kiểm tra kích thước base64
            if new_avatar and new_avatar.startswith('data:image'):
                data_size = len(new_avatar) - 30 if len(new_avatar) > 30 else 0
                if data_size > 2 * 1024 * 1024:  # 2MB
                    return {'ok': False, 'error': 'Ảnh quá lớn! Tối đa 2MB'}

            # Kiểm tra quyền
            member = group_members_col.find_one({
                'group_id': ObjectId(group_id),
                'user_id': ObjectId(user_id),
                '$or': [{'role': 'admin'}, {'is_creator': True}]
            })

            if not member:
                return {'ok': False, 'error': 'Permission denied'}

            # Cập nhật avatar
            result = groups_col.update_one(
                {'_id': ObjectId(group_id)},
                {'$set': {'avatar': new_avatar}}
            )

            if result.modified_count > 0:
                emit('group_avatar_updated', {
                    'group_id': group_id,
                    'new_avatar': new_avatar
                }, room=f"group_{group_id}")
                return {'ok': True}

            return {'ok': False, 'error': 'Update failed'}

        except Exception as e:
            print(f'Error updating group avatar: {str(e)}')
            return {'ok': False, 'error': 'Internal server error'}

    # ------------------ LEAVE CONVERSATION ROOM (PRIVATE + GROUP) ------------------
    @socketio.on('leave_conversation')
    def handle_leave_conversation_room(data):
        """Xử lý rời khỏi room conversation (dùng cho cả group và individual chat)"""
        conversation_id = data.get('conversation_id')
        user_id = session.get('user_id')
        
        if conversation_id:
            leave_room(str(conversation_id))
            leave_room(f"group_{conversation_id}")  # Thử cả 2 format
            print(f"User {user_id} left room: {conversation_id}")

    # ------------------ PIN / UNPIN / EDIT / DELETE MESSAGE (PRIVATE + GROUP) ------------------
    @socketio.on('pin_message')
    def handle_pin_message(data):
        """Xử lý ghim tin nhắn (cả private & group)"""
        try:
            message_id = data.get('message_id')
            conversation_id = data.get('conversation_id')
            conversation_type = data.get('conversation_type', 'group')
            user_id = session.get('user_id')
            
            if not all([message_id, conversation_id, user_id]):
                return

            room_name = f"group_{conversation_id}" if conversation_type == 'group' else str(conversation_id)

            emit('message_pinned', {
                'message_id': message_id,
                'conversation_id': conversation_id,
                'conversation_type': conversation_type,
                'pinned_by': user_id
            }, room=room_name)
            
        except Exception as e:
            print(f"Error handling pin message: {str(e)}")

    @socketio.on('unpin_message')
    def handle_unpin_message(data):
        """Xử lý bỏ ghim tin nhắn (cả private & group)"""
        try:
            conversation_id = data.get('conversation_id')
            conversation_type = data.get('conversation_type', 'group')
            user_id = session.get('user_id')
            
            if not all([conversation_id, user_id]):
                return

            room_name = f"group_{conversation_id}" if conversation_type == 'group' else str(conversation_id)

            emit('message_unpinned', {
                'conversation_id': conversation_id,
                'conversation_type': conversation_type,
                'unpinned_by': user_id
            }, room=room_name)
            
        except Exception as e:
            print(f"Error handling unpin message: {str(e)}")

    @socketio.on('message_edited')
    def handle_message_edited(data):
        """Thông báo tin nhắn đã được sửa (cả private & group)"""
        try:
            message_id = data.get('message_id')
            conversation_id = data.get('conversation_id')
            conversation_type = data.get('conversation_type', 'group')
            new_content = data.get('new_content')
            
            if not all([message_id, conversation_id, new_content]):
                return

            room_name = f"group_{conversation_id}" if conversation_type == 'group' else str(conversation_id)

            emit('message_updated', {
                'message_id': message_id,
                'conversation_id': conversation_id,
                'conversation_type': conversation_type,
                'new_content': new_content,
                'edited_at': get_vietnam_time().isoformat()
            }, room=room_name)
            
        except Exception as e:
            print(f"Error handling message edited: {str(e)}")

    @socketio.on('message_deleted')
    def handle_message_deleted(data):
        """Thông báo tin nhắn đã bị xóa (cả private & group)"""
        try:
            message_id = data.get('message_id')
            conversation_id = data.get('conversation_id')
            conversation_type = data.get('conversation_type', 'group')
            
            if not all([message_id, conversation_id]):
                return

            room_name = f"group_{conversation_id}" if conversation_type == 'group' else str(conversation_id)

            emit('message_removed', {
                'message_id': message_id,
                'conversation_id': conversation_id,
                'conversation_type': conversation_type
            }, room=room_name)
            
        except Exception as e:
            print(f"Error handling message deleted: {str(e)}")

    @socketio.on('group_typing')
    def handle_group_typing(data):
        group_id = data.get('group_id') or data.get('conversation_id')
        user_id = session.get('user_id')
        if not group_id or not user_id:
            return

        user_info = get_user_info(user_id)
        emit('group_typing', {
            'group_id': group_id,
            'conversation_id': group_id,  # [MỚI] cho đồng bộ với FE nếu cần
            'user_id': user_id,
            'username': user_info['username']
        }, room=f"group_{group_id}", include_self=False)

    @socketio.on('group_stop_typing')
    def handle_group_stop_typing(data):
        group_id = data.get('group_id') or data.get('conversation_id')
        user_id = session.get('user_id')
        if not group_id or not user_id:
            return

        emit('group_stop_typing', {
            'group_id': group_id,
            'conversation_id': group_id,  # [MỚI]
            'user_id': user_id
        }, room=f"group_{group_id}", include_self=False)
