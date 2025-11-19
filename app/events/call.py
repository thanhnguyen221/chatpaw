from flask import session, request
from bson import ObjectId
from flask_socketio import emit, join_room, leave_room

def register_call_events(socketio, mongo):
    conversations_col = mongo.db.conversations
    group_members_col = mongo.db.group_members
    users_col = mongo.db.users

    # Lưu danh sách user trong phòng gọi: { 'call_room_id': [sid1, sid2, ...] }
    call_rooms = {}

    # --- HÀM KIỂM TRA QUYỀN (HỖ TRỢ CẢ 1vs1 VÀ GROUP) ---
    def _can_access(conversation_id, user_id):
        try:
            user_oid = ObjectId(user_id)
            conv_oid = ObjectId(conversation_id)

            # 1. Check Group
            is_group_member = group_members_col.find_one({
                'group_id': conv_oid, 'user_id': user_oid
            })
            if is_group_member: return True, 'group'

            # 2. Check Private (1vs1)
            conv = conversations_col.find_one({'_id': conv_oid})
            if conv and str(user_id) in conv.get('participants', []):
                return True, 'private'

            return False, None
        except:
            return False, None

    def get_user_info(user_id):
        u = users_col.find_one({'_id': ObjectId(user_id)}, {'username': 1, 'avatar': 1})
        if u:
            return {
                'id': str(u['_id']),
                'username': u.get('username', 'Unknown'),
                'avatar': u.get('avatar') or '/static/img/default-avatar.png'
            }
        return {'username': 'Unknown', 'avatar': '/static/img/default-avatar.png'}

    # --- 1. JOIN ROOM ---
    @socketio.on('call:join')
    def handle_join_call(data):
        user_id = session.get('user_id')
        conversation_id = data.get('conversation_id')
        
        if not user_id or not conversation_id: return

        has_access, _ = _can_access(conversation_id, user_id)
        if not has_access: return

        room_id = f"call_{conversation_id}"
        join_room(room_id)
        
        current_sid = request.sid
        if room_id not in call_rooms: call_rooms[room_id] = []
        if current_sid not in call_rooms[room_id]: call_rooms[room_id].append(current_sid)
        
        print(f"📞 User {user_id} joined {room_id}")

        # Gửi danh sách người cũ cho người mới
        others = [sid for sid in call_rooms[room_id] if sid != current_sid]
        emit('call:all_users', {'users': others}, to=current_sid)

        # Báo cho người cũ biết
        emit('call:user_joined', {
            'signal_initiator_sid': current_sid,
            'user_info': get_user_info(user_id)
        }, room=room_id, include_self=False)

    # --- 2. SIGNALING (MESH) ---
    @socketio.on('webrtc:offer')
    def handle_offer(data):
        emit('webrtc:offer', {
            'sdp': data.get('sdp'),
            'from': request.sid,
            'user_info': get_user_info(session.get('user_id'))
        }, to=data.get('to'))

    @socketio.on('webrtc:answer')
    def handle_answer(data):
        emit('webrtc:answer', {
            'sdp': data.get('sdp'), 'from': request.sid
        }, to=data.get('to'))

    @socketio.on('webrtc:candidate')
    def handle_candidate(data):
        emit('webrtc:candidate', {
            'candidate': data.get('candidate'), 'from': request.sid
        }, to=data.get('to'))

    # --- 3. RỜI / DISCONNECT ---
    @socketio.on('call:leave')
    def handle_leave(data):
        if data.get('conversation_id'):
            _remove_user(f"call_{data['conversation_id']}", request.sid)

    @socketio.on('disconnect')
    def handle_disconnect():
        sid = request.sid
        for room_id in list(call_rooms.keys()):
            if sid in call_rooms[room_id]:
                _remove_user(room_id, sid)

    def _remove_user(room_id, sid):
        leave_room(room_id)
        if room_id in call_rooms and sid in call_rooms[room_id]:
            call_rooms[room_id].remove(sid)
            if not call_rooms[room_id]: del call_rooms[room_id]
        emit('call:user_left', {'sid': sid}, room=room_id)

    # --- 4. THÔNG BÁO MỜI GỌI ---
    @socketio.on('call:invite_group')
    def handle_invite(data):
        conv_id = data.get('conversation_id')
        user_id = session.get('user_id')
        
        has_access, detected_type = _can_access(conv_id, user_id)
        if not has_access: return

        ctype = data.get('conversation_type', detected_type)
        # Nếu là group thì gửi vào phòng group_ID, nếu private thì gửi vào phòng ID
        target = f"group_{conv_id}" if ctype == 'group' else conv_id
        
        emit('call:incoming_notification', {
            'caller': get_user_info(user_id),
            'conversation_id': conv_id,
            'conversation_type': ctype
        }, room=target, include_self=False)