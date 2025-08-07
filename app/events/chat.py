from flask import session
from bson import ObjectId
from datetime import datetime
from flask_socketio import emit, join_room, leave_room

def register_chat_events(socketio, mongo):
    messages_col = mongo.db.messages
    conversations_col = mongo.db.conversations

    # Gửi tin nhắn
    @socketio.on('send_message')
    def handle_send_message(data):
        sender_id = session.get('user_id')
        conversation_id = data.get('conversation_id')
        content = data.get('content')

        if not all([sender_id, conversation_id, content]):
            print("Missing data for message")
            return

        try:
            # Kiểm tra conversation tồn tại
            conversation = conversations_col.find_one({'_id': ObjectId(conversation_id)})
            if not conversation:
                print(f"Conversation {conversation_id} not found")
                return

            # Kiểm tra người gửi có trong participants
            if str(sender_id) not in conversation['participants']:
                print(f"User {sender_id} not in conversation")
                return

            # Tạo message mới
            now = datetime.utcnow()
            message = {
                'conversation_id': ObjectId(conversation_id),
                'sender_id': ObjectId(sender_id),
                'content': content,
                'timestamp': now,
                'read_by': [ObjectId(sender_id)]
            }
            message_id = messages_col.insert_one(message).inserted_id

            # Cập nhật last message cho conversation
            conversations_col.update_one(
                {'_id': ObjectId(conversation_id)},
                {'$set': {
                    'last_message': content,
                    'last_message_time': now
                }}
            )

            # Gửi tin nhắn đến room tương ứng
            emit('receive_message', {
                'conversation_id': str(conversation_id),
                'message_id': str(message_id),
                'sender_id': str(sender_id),
                'content': content,
                'timestamp': now.isoformat()
            }, room=str(conversation_id))

        except Exception as e:
            print(f"Error sending message: {str(e)}")

    # Đánh dấu đã đọc tin nhắn
    @socketio.on('mark_as_read')
    def handle_mark_as_read(data):
        message_ids = data.get('message_ids', [])
        user_id = session.get('user_id')

        if not user_id or not message_ids:
            return

        for mid in message_ids:
            try:
                messages_col.update_one(
                    {'_id': ObjectId(mid)},
                    {'$addToSet': {'read_by': ObjectId(user_id)}}
                )
            except Exception as e:
                print(f"Error marking message {mid} as read: {str(e)}")

    # Tham gia phòng trò chuyện
    @socketio.on('join_conversation')
    def handle_join_conversation(data):
        conversation_id = data.get('conversation_id')
        if conversation_id:
            join_room(str(conversation_id))
            print(f"User joined conversation: {conversation_id}")

    # Rời khỏi phòng trò chuyện
    @socketio.on('leave_conversation')
    def handle_leave_conversation(data):
        conversation_id = data.get('conversation_id')
        if conversation_id:
            leave_room(str(conversation_id))
            print(f"User left conversation: {conversation_id}")
