# --- Thêm import json vào dòng đầu tiên ---
import re
import json
from flask import request, session, url_for
from bson import ObjectId
from datetime import datetime
from app.utils.time_utils import get_vietnam_time, format_timestamp_for_client
from flask_socketio import join_room, leave_room, emit
import pytz
from app.message_encryption import encrypt_message, decrypt_message


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
                # Dùng format_timestamp_for_client để xử lý timezone đúng
                ts_str = format_timestamp_for_client(ts)
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

        sender = users_col.find_one({'_id': user_oid}, {'username': 1, 'full_name': 1, 'avatar': 1})
        sender_name = sender.get('full_name') or sender.get('username', 'Unknown') if sender else 'Unknown'
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
                    # Lấy full_name nếu có, fallback về username
                    ori_sender_full = users_col.find_one({'_id': original_msg['sender_id']}, {'username': 1, 'full_name': 1})
                    ori_sender_name = ori_sender_full.get('full_name') or ori_sender_full.get('username', 'Unknown') if ori_sender_full else ori_sender_info.get('username', 'Unknown')
                    
                    # Decrypt original message content if encrypted
                    orig_content = original_msg.get('content', '')
                    if original_msg.get('encrypted') or original_msg.get('message_type') == 'text':
                        orig_content = decrypt_message(orig_content)
                    
                    reply_context = {
                        'message_id': str(original_msg['_id']),
                        'sender_id': str(original_msg['sender_id']),
                        'sender_name': ori_sender_name,
                        'content': orig_content,
                        'message_type': original_msg.get('message_type', 'text')
                    }
            except Exception as e:
                print(f"[DEBUG] Cannot build reply_context: {e}")
                reply_to_oid = None
                reply_context = None

        # Encrypt message content before saving
        encrypted_content = encrypt_message(content) if message_type == 'text' else content

        # Tạo message object
        message = {
            'group_id': group_oid,
            'sender_id': user_oid,
            'content': encrypted_content,
            'message_type': message_type,
            'timestamp': now,
            'read_by': [user_oid],
            # [MỚI] Lưu gift_style vào DB
            'gift_style': gift_style,
            'encrypted': message_type == 'text'  # Đánh dấu tin nhắn đã mã hóa
        }

        if reply_to_oid:
            message['reply_to'] = reply_to_oid

        print(f"[DEBUG] Inserting message: {message}")
        inserted = messages_col.insert_one(message)
        message_id = inserted.inserted_id
        print(f"[DEBUG] Message inserted with ID: {message_id}")
        
       # ============================================================
        # 3. XỬ LÝ TAG TÊN (@MENTION) - DÁN VÀO SAU KHI LƯU DB
        # ============================================================
        try:
            if message_type == 'text':
                content_text = content
                # Tìm tất cả các từ bắt đầu bằng @
                mentioned_usernames = re.findall(r'@(\w+)', content_text)
                
                if mentioned_usernames:
                    unique_names = list(set(mentioned_usernames))
                    notifications_col = mongo.db.notifications
                    
                    # Lấy thông tin nhóm và người gửi
                    group_info = groups_col.find_one({'_id': group_oid})
                    group_name = group_info.get('name', 'Nhóm') if group_info else 'Nhóm'
                    
                    sender = users_col.find_one({'_id': user_oid}, {'username': 1, 'full_name': 1})
                    sender_name = sender.get('full_name') or sender.get('username', 'Ai đó') if sender else 'Ai đó'

                    # === TRƯỜNG HỢP 1: CÓ TAG @all ===
                    if 'all' in unique_names:
                        print(f"[Group] Detected @all tag in group {group_id}")
                        # Lấy tất cả thành viên trong nhóm
                        all_members = group_members_col.find({'group_id': group_oid})
                        
                        for member in all_members:
                            recipient_id = str(member['user_id'])
                            # Không gửi thông báo cho chính người gửi
                            if recipient_id != str(user_id):
                                create_and_emit_notification(
                                    recipient_id, user_id, sender_name,
                                    f"đã nhắc đến mọi người trong nhóm {group_name}: \"{content_text[:40]}...\"",
                                    group_id, str(message_id), notifications_col
                                )

                    # === TRƯỜNG HỢP 2: TAG CÁ NHÂN (Khi không dùng @all) ===
                    else:
                        for username in unique_names:
                            target_user = users_col.find_one({'username': username})
                            # Nếu tìm thấy user và không phải tự tag mình
                            if target_user and str(target_user['_id']) != str(user_id):
                                recipient_id = str(target_user['_id'])
                                create_and_emit_notification(
                                    recipient_id, user_id, sender_name,
                                    f"đã nhắc đến bạn trong nhóm {group_name}: \"{content_text[:40]}...\"",
                                    group_id, str(message_id), notifications_col
                                )
                                print(f"[Group] Tagged user: {username}")

        except Exception as e_mention:
            print(f"[Group] Mention Error: {e_mention}")




            
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
        
        # [MỚI] Emit đến từng thành viên để họ nhận thông báo dù không mở group
        for m in members:
            uid_str = str(m['user_id'])
            emit('group_message', emit_data, room=uid_str)
        


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
        # Lấy full_name cho typing indicator
        user_full = users_col.find_one({'_id': ObjectId(user_id)}, {'username': 1, 'full_name': 1})
        display_name = user_full.get('full_name') or user_full.get('username', 'Unknown') if user_full else user_info.get('username', 'Unknown')
        emit('group_typing', {
            'group_id': group_id,
            'conversation_id': group_id,
            'user_id': user_id,
            'username': display_name
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


# ============================================================
    # XỬ LÝ BÌNH CHỌN (CÓ THÔNG BÁO & LƯU DB)
    # ============================================================
    @socketio.on('vote_poll')
    def handle_vote_poll(data):
        if 'user_id' not in session:
            return
        
        user_id = session['user_id']
        message_id = data.get('message_id')
        option_id = int(data.get('option_id'))
        group_id = data.get('group_id')

        try:
            # 1. Tìm tin nhắn
            msg = messages_col.find_one({'_id': ObjectId(message_id)})
            if not msg or msg.get('message_type') != 'poll':
                return

            # 2. Parse nội dung
            content = msg.get('content')
            if isinstance(content, str):
                poll_data = json.loads(content)
            else:
                poll_data = content

            options = poll_data.get('options', [])
            
            # 3. Logic Vote (Single Choice)
            updated = False
            voted_option_text = "" # Lưu lại tên lựa chọn để thông báo
            
            for opt in options:
                if 'voters' not in opt: opt['voters'] = []
                
                # Nếu chọn đúng option này
                if int(opt['id']) == option_id:
                    if user_id in opt['voters']:
                        opt['voters'].remove(user_id) # Unvote
                    else:
                        opt['voters'].append(user_id) # Vote
                        voted_option_text = opt['text'] # Ghi nhớ text
                    updated = True
                else:
                    # Xóa vote ở các option khác (để đảm bảo chỉ chọn 1)
                    if user_id in opt['voters']:
                        opt['voters'].remove(user_id)
                        updated = True

            if updated:
                # 4. Lưu DB
                if isinstance(msg.get('content'), str):
                    new_content = json.dumps(poll_data, ensure_ascii=False)
                else:
                    new_content = poll_data
                
                messages_col.update_one({'_id': ObjectId(message_id)}, {'$set': {'content': new_content}})

                # 5. Gửi cập nhật UI Poll
                emit('poll_updated', {'message_id': message_id, 'new_content': poll_data}, room=f"group_{group_id}")
                
                # 6. [MỚI] TẠO THÔNG BÁO (Notification)
                # Chỉ thông báo khi người khác vote (không phải chính mình tự vote)
                # Và phải là hành động Vote (có text), không phải Unvote
                sender_id = msg.get('sender_id')
                if voted_option_text and str(sender_id) != user_id:
                    try:
                        # Lấy tên người vote
                        voter = users_col.find_one({'_id': ObjectId(user_id)}, {'username': 1, 'full_name': 1})
                        voter_name = voter.get('full_name') or voter.get('username', 'Ai đó') if voter else 'Ai đó'
                        
                        # Nội dung thông báo
                        notif_content = f"đã bình chọn '{voted_option_text}' trong cuộc thăm dò của bạn"
                        
                        # Tạo data thông báo
                        notif_data = {
                            'recipient_id': ObjectId(sender_id),
                            'sender_id': ObjectId(user_id),
                            'sender_name': voter_name,
                            'type': 'poll_vote',
                            'content': notif_content,
                            'data': {
                                'group_id': group_id,
                                'message_id': str(message_id)
                            },
                            'read': False,
                            'created_at': get_vietnam_time()
                        }
                        
                        # Lưu vào DB notification (Nếu bạn có collection này)
                        mongo.db.notifications.insert_one(notif_data)
                        
                        # Gửi socket cho người tạo poll (để hiện chuông thông báo)
                        # Convert ObjectId sang string trước khi emit
                        socket_notif = notif_data.copy()
                        socket_notif['recipient_id'] = str(socket_notif['recipient_id'])
                        socket_notif['sender_id'] = str(socket_notif['sender_id'])
                        socket_notif['_id'] = str(socket_notif.get('_id', ''))
                        if hasattr(socket_notif['created_at'], 'isoformat'):
                            socket_notif['created_at'] = socket_notif['created_at'].isoformat()

                        emit('new_notification', socket_notif, room=str(sender_id))
                        
                    except Exception as ex:
                        print(f"Lỗi tạo thông báo poll: {ex}")

        except Exception as e:
            print(f"[Poll Error] {str(e)}")



def create_and_emit_notification(recipient_id, sender_id, sender_name, content, group_id, message_id, notif_col):
    try:
        # 1. Tạo dữ liệu thông báo
        notif_data = {
            'recipient_id': ObjectId(recipient_id),
            'sender_id': ObjectId(sender_id),
            'sender_name': sender_name,
            'type': 'mention',  # Loại: nhắc tên
            'content': content,
            'data': {
                'group_id': str(group_id),
                'message_id': str(message_id)
            },
            'read': False,
            'created_at': datetime.now()
        }
        
        # 2. Lưu vào Database
        notif_col.insert_one(notif_data)
        
        # 3. Chuẩn bị dữ liệu gửi qua Socket (Convert sang String)
        socket_data = notif_data.copy()
        socket_data['_id'] = str(socket_data['_id'])
        socket_data['recipient_id'] = str(socket_data['recipient_id'])
        socket_data['sender_id'] = str(socket_data['sender_id'])
        
        if isinstance(socket_data['created_at'], datetime):
            socket_data['created_at'] = socket_data['created_at'].isoformat()

        # 4. Gửi realtime đến người nhận
        emit('new_notification', socket_data, room=str(recipient_id))
        
    except Exception as e:
        print(f"Error creating notification: {e}")