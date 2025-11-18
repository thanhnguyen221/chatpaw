# app/events/call.py
from flask import session
from bson import ObjectId
from flask_socketio import emit, join_room

def register_call_events(socketio, mongo):
    """
    Signaling đơn giản theo room = conversation_id.
    Cả hai client join vào cùng room, rồi phát sự kiện qua room.
    Client sẽ tự lọc bằng conversation_id hiện hành.
    """

    conversations_col = mongo.db.conversations
    group_members_col = mongo.db.group_members  # nếu sau này muốn gọi trong group

    def _can_access(conversation_id, user_id, conversation_type='private'):
        """Kiểm tra user có quyền vào cuộc gọi của room này không."""
        try:
            if conversation_type == 'private':
                conv = conversations_col.find_one({'_id': ObjectId(conversation_id)})
                if not conv:
                    return False
                return str(user_id) in conv.get('participants', [])
            else:
                # group call (nếu cần về sau)
                return group_members_col.find_one({
                    'group_id': ObjectId(conversation_id),
                    'user_id': ObjectId(user_id)
                }) is not None
        except Exception:
            return False

    @socketio.on('call:invite')
    def handle_call_invite(data):
        user_id = session.get('user_id')
        conversation_id = data.get('conversation_id')
        conversation_type = data.get('conversation_type', 'private')

        if not user_id or not conversation_id:
            return

        if not _can_access(conversation_id, user_id, conversation_type):
            return

        # đảm bảo caller đã join vào room này
        join_room(str(conversation_id))

        # Báo cho room có lời mời (phía callee sẽ nhận)
        emit('call:incoming', {
            'conversation_id': conversation_id,
            'caller_id': str(user_id)
        }, room=str(conversation_id), include_self=False)

    @socketio.on('call:accept')
    def handle_call_accept(data):
        user_id = session.get('user_id')
        conversation_id = data.get('conversation_id')
        if not user_id or not conversation_id:
            return

        join_room(str(conversation_id))
        emit('call:accepted', {
            'conversation_id': conversation_id,
            'callee_id': str(user_id)
        }, room=str(conversation_id), include_self=False)

    # [THÊM MỚI] Xử lý khi người nhận từ chối cuộc gọi
    @socketio.on('call:decline')
    def handle_call_decline(data):
        user_id = session.get('user_id')
        conversation_id = data.get('conversation_id')
        if not user_id or not conversation_id:
            return
        
        # Báo cho người gọi (caller) biết là đã bị từ chối
        emit('call:declined', {
            'conversation_id': conversation_id,
            'callee_id': str(user_id)
        }, room=str(conversation_id), include_self=False)

    @socketio.on('webrtc:offer')
    def handle_offer(data):
        user_id = session.get('user_id')
        conversation_id = data.get('conversation_id')
        sdp = data.get('sdp')
        if not user_id or not conversation_id or not sdp:
            return

        emit('webrtc:offer', {
            'conversation_id': conversation_id,
            'from': str(user_id),
            'sdp': sdp
        }, room=str(conversation_id), include_self=False)

    @socketio.on('webrtc:answer')
    def handle_answer(data):
        user_id = session.get('user_id')
        conversation_id = data.get('conversation_id')
        sdp = data.get('sdp')
        if not user_id or not conversation_id or not sdp:
            return

        emit('webrtc:answer', {
            'conversation_id': conversation_id,
            'from': str(user_id),
            'sdp': sdp
        }, room=str(conversation_id), include_self=False)

    @socketio.on('webrtc:candidate')
    def handle_candidate(data):
        user_id = session.get('user_id')
        conversation_id = data.get('conversation_id')
        candidate = data.get('candidate')
        if not user_id or not conversation_id or not candidate:
            return

        emit('webrtc:candidate', {
            'conversation_id': conversation_id,
            'from': str(user_id),
            'candidate': candidate
        }, room=str(conversation_id), include_self=False)

    @socketio.on('call:end')
    def handle_call_end(data):
        conversation_id = data.get('conversation_id')
        if not conversation_id:
            return
        emit('call:ended', {'conversation_id': conversation_id}, room=str(conversation_id))