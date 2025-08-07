from flask import request, session
from bson import ObjectId
from datetime import datetime
from flask_socketio import join_room, leave_room, emit
import pytz

def register_group_events(socketio, mongo):
    group_members_col = mongo.db.group_members
    groups_col = mongo.db.groups
    messages_col = mongo.db.group_messages
    users_col = mongo.db.users

    def get_username(user_id):
        user = users_col.find_one({'_id': ObjectId(user_id)})
        return user['username'] if user else 'Unknown'

    def get_vietnam_time():
        vietnam_tz = pytz.timezone('Asia/Ho_Chi_Minh')
        return datetime.now(vietnam_tz)

    @socketio.on('join_group')
    def handle_join_group(data):
        group_id = data.get('group_id')
        user_id = session.get('user_id')
        if not group_id or not user_id:
            return

        room = f"group_{group_id}"
        join_room(room)
        print(f"User {user_id} joined group {group_id}")

        messages = list(messages_col.find(
            {'group_id': ObjectId(group_id)},
            sort=[('timestamp', -1)],
            limit=50
        ))

        messages.reverse()  # Hiển thị từ cũ đến mới

        emit('group_history', {
            'group_id': group_id,
            'messages': [
                {
                    'message_id': str(msg['_id']),
                    'sender_id': str(msg['sender_id']),
                    'sender_name': get_username(msg['sender_id']),
                    'content': msg['content'],
                    'timestamp': msg['timestamp'].isoformat()
                } for msg in messages
            ]
        }, room=request.sid)

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

    @socketio.on('send_group_message')
    def handle_send_group_message(data):
        group_id = data.get('group_id')
        content = data.get('content')
        user_id = session.get('user_id')
        now = get_vietnam_time()

        if not all([group_id, content, user_id]):
            return

        is_member = group_members_col.find_one({
            'group_id': ObjectId(group_id),
            'user_id': ObjectId(user_id)
        })
        if not is_member:
            return

        message = {
            'group_id': ObjectId(group_id),
            'sender_id': ObjectId(user_id),
            'content': content,
            'timestamp': now,
            'read_by': [ObjectId(user_id)]
        }
        message_id = messages_col.insert_one(message).inserted_id

        emit('group_message', {
            'group_id': group_id,
            'message_id': str(message_id),
            'sender_id': user_id,
            'sender_name': session.get('username'),
            'content': content,
            'timestamp': now.isoformat()
        }, room=f"group_{group_id}")

    @socketio.on('update_group_name')
    def handle_update_group_name(data):
        group_id = data.get('group_id')
        new_name = data.get('new_name')
        user_id = session.get('user_id')

        if not group_id or not new_name or not user_id:
            return

        member = group_members_col.find_one({
            'group_id': ObjectId(group_id),
            'user_id': ObjectId(user_id)
        })

        if not member or member.get('role') != 'admin':
            emit('error', {'message': 'Permission denied'}, room=request.sid)
            return

        groups_col.update_one(
            {'_id': ObjectId(group_id)},
            {'$set': {'name': new_name}}
        )

        emit('group_name_updated', {
            'group_id': group_id,
            'new_name': new_name
        }, room=f"group_{group_id}")

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
        
