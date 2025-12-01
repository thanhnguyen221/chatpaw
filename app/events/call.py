# app/events/call.py

from flask import session, request
from bson import ObjectId
from flask_socketio import emit, join_room, leave_room


def register_call_events(socketio, mongo):
    conversations_col = mongo.db.conversations
    group_members_col = mongo.db.group_members
    users_col = mongo.db.users
    groups_col = mongo.db.groups

    # Lưu danh sách user (sid) trong từng phòng call
    # call_rooms = { "call_<conversation_id>": [sid1, sid2, ...] }
    call_rooms = {}

    # ================== HELPER FUNCTIONS ================== #

    def _can_access(conversation_id, user_id):
        """
        Kiểm tra user có quyền tham gia cuộc gọi của conversation_id không.
        Trả về: (True/False, 'group' hoặc 'private' hoặc None)
        """
        try:
            user_oid = ObjectId(user_id)
            conv_oid = ObjectId(conversation_id)

            # 1. Check group: nếu conversation_id là group_id
            is_group_member = group_members_col.find_one({
                'group_id': conv_oid,
                'user_id': user_oid
            })
            if is_group_member:
                return True, 'group'

            # 2. Check private (1vs1): nếu conversation_id là _id của conversations
            conv = conversations_col.find_one({'_id': conv_oid})
            if conv and str(user_id) in conv.get('participants', []):
                return True, 'private'

            return False, None
        except Exception:
            return False, None

    def get_user_info(user_id):
        """
        Lấy thông tin cơ bản của user để gửi qua socket cho FE.
        """
        try:
            u = users_col.find_one(
                {'_id': ObjectId(user_id)},
                {'username': 1, 'avatar': 1}
            )
        except Exception:
            u = None

        if u:
            return {
                'id': str(u['_id']),
                'username': u.get('username', 'Unknown'),
                'avatar': u.get('avatar') or '/static/img/default-avatar.png'
            }

        return {
            'id': str(user_id) if user_id else None,
            'username': 'Unknown',
            'avatar': '/static/img/default-avatar.png'
        }

    def _broadcast_call_status(conversation_id, is_active: bool):
        """
        Gửi trạng thái cuộc gọi (đang active / đã tắt) cho tất cả client liên quan:
        - Room group_<group_id> (nếu là nhóm)
        - Từng user trong participants (nếu là private)
        FE có thể dùng event 'call:status_update' để bật/tắt icon cuộc gọi.
        """
        payload = {
            'conversation_id': conversation_id,
            'is_active': is_active
        }

        # Gửi cho room group (nếu là nhóm thì room này sẽ tồn tại)
        emit('call:status_update', payload, room=f"group_{conversation_id}")

        # Gửi cho các participant của conversation 1-1 (nếu có)
        try:
            conv = conversations_col.find_one({'_id': ObjectId(conversation_id)})
        except Exception:
            conv = None

        if conv:
            for pid in conv.get('participants', []):
                emit('call:status_update', payload, room=str(pid))

    def _remove_user(room_id, sid):
        """
        Xử lý khi một user rời call room:
        - leave_room
        - xóa sid khỏi call_rooms
        - emit 'call:user_left'
        - nếu phòng call trống -> phát 'call:status_update' is_active = False
          và emit 'call:ended' để FE reset nút Tham gia -> Gọi video
        """
        leave_room(room_id)

        room_empty = False
        if room_id in call_rooms and sid in call_rooms[room_id]:
            call_rooms[room_id].remove(sid)
            if not call_rooms[room_id]:
                room_empty = True
                del call_rooms[room_id]

        # Thông báo cho các peer khác trong call
        emit('call:user_left', {'sid': sid}, room=room_id)

        # Nếu phòng call trống -> báo là call đã tắt
        if room_empty and room_id.startswith("call_"):
            conv_id = room_id.replace("call_", "", 1)
            _broadcast_call_status(conv_id, False)

            # --- NEW: Bắn event call:ended để FE đổi nút ---
            payload = {
                'conversation_id': conv_id,
                # Nếu conv_id là group_id -> group, còn lại coi như private
                'conversation_type': 'group'
            }

            try:
                # Nếu không tìm thấy group với id này -> coi là private
                grp = groups_col.find_one({'_id': ObjectId(conv_id)})
                if not grp:
                    payload['conversation_type'] = 'private'
            except Exception:
                payload['conversation_type'] = 'private'

            # Gửi cho room group_<group_id> (nếu là group)
            if payload['conversation_type'] == 'group':
                emit('call:ended', payload, room=f"group_{conv_id}")

            # Gửi cho các participant của conversation 1-1 (nếu là private)
            try:
                conv = conversations_col.find_one({'_id': ObjectId(conv_id)})
            except Exception:
                conv = None

            if conv:
                for pid in conv.get('participants', []):
                    emit('call:ended', payload, room=str(pid))

    @socketio.on('call:get_status')
    def handle_get_status(data):
        """
        Client hỏi: cuộc gọi của conversation_id hiện đang ACTIVE không?
        Trả về qua ack của Socket.IO
        """
        user_id = session.get('user_id')
        conv_id = data.get('conversation_id')

        if not user_id or not conv_id:
            return {'ok': False, 'error': 'missing_params'}

        has_access, _ = _can_access(conv_id, user_id)
        if not has_access:
            return {'ok': False, 'error': 'no_access'}

        room_id = f"call_{conv_id}"
        is_active = room_id in call_rooms and bool(call_rooms[room_id])

        # Trả lời bằng ACK
        return {'ok': True, 'is_active': is_active}


    # ================== SOCKET EVENTS ================== #

    # --- 1. JOIN ROOM (VÀO CUỘC GỌI) ---
    @socketio.on('call:join')
    def handle_join_call(data):
        user_id = session.get('user_id')
        conversation_id = data.get('conversation_id')

        if not user_id or not conversation_id:
            return

        has_access, _ = _can_access(conversation_id, user_id)
        if not has_access:
            return

        room_id = f"call_{conversation_id}"
        join_room(room_id)

        current_sid = request.sid
        if room_id not in call_rooms:
            call_rooms[room_id] = []
        if current_sid not in call_rooms[room_id]:
            call_rooms[room_id].append(current_sid)

        print(f"📞 User {user_id} joined {room_id}")

        # Gửi danh sách user hiện có trong phòng cho client mới
        others = [sid for sid in call_rooms[room_id] if sid != current_sid]
        emit('call:all_users', {'users': others}, to=current_sid)

        # Thông báo cho các user khác trong phòng rằng có người mới join
        emit(
            'call:user_joined',
            {
                'signal_initiator_sid': current_sid,
                'user_info': get_user_info(user_id)
            },
            room=room_id,
            include_self=False
        )

        # Cập nhật trạng thái "cuộc gọi đang active"
        _broadcast_call_status(conversation_id, True)

    # --- 2. SIGNALING (WebRTC: offer/answer/candidate) ---
    @socketio.on('webrtc:offer')
    def handle_offer(data):
        emit(
            'webrtc:offer',
            {
                'sdp': data.get('sdp'),
                'from': request.sid,
                'user_info': get_user_info(session.get('user_id'))
            },
            to=data.get('to')
        )

    @socketio.on('webrtc:answer')
    def handle_answer(data):
        emit(
            'webrtc:answer',
            {
                'sdp': data.get('sdp'),
                'from': request.sid
            },
            to=data.get('to')
        )

    @socketio.on('webrtc:candidate')
    def handle_candidate(data):
        emit(
            'webrtc:candidate',
            {
                'candidate': data.get('candidate'),
                'from': request.sid
            },
            to=data.get('to')
        )

    # --- 3. REACTION (Thả tim, icon trong lúc call) ---
    @socketio.on('call:send_reaction')
    def handle_reaction(data):
        conversation_id = data.get('conversation_id')
        emoji = data.get('emoji')

        if not conversation_id or not emoji:
            return

        room_id = f"call_{conversation_id}"
        # Gửi cho tất cả người trong cuộc gọi (kể cả người gửi, để hiển thị effect)
        emit(
            'call:receive_reaction',
            {
                'from_sid': request.sid,
                'emoji': emoji
            },
            room=room_id
        )

    # --- 4. LEAVE / DISCONNECT ---
    @socketio.on('call:leave')
    def handle_leave(data):
        conv_id = data.get('conversation_id')
        if conv_id:
            _remove_user(f"call_{conv_id}", request.sid)

    @socketio.on('disconnect')
    def handle_disconnect():
        sid = request.sid
        # User có thể ở nhiều room call (hiếm, nhưng cứ cho chắc)
        for room_id in list(call_rooms.keys()):
            if sid in call_rooms[room_id]:
                _remove_user(room_id, sid)

    # --- 5. INVITE (GỬI LỜI MỜI GỌI: PRIVATE / GROUP) ---
    @socketio.on('call:invite_group')
    def handle_invite(data):
        conv_id = data.get('conversation_id')
        user_id = session.get('user_id')

        if not conv_id or not user_id:
            return

        has_access, detected_type = _can_access(conv_id, user_id)
        if not has_access:
            return

        # Cho phép FE override loại nếu gửi kèm conversation_type
        ctype = data.get('conversation_type', detected_type)

        sender_info = get_user_info(user_id)
        payload = {
            'caller': sender_info,
            'conversation_id': conv_id,
            'conversation_type': ctype,
            'room_name': ''
        }

        if ctype == 'group':
            # Lấy tên nhóm để hiển thị
            try:
                grp = groups_col.find_one({'_id': ObjectId(conv_id)})
            except Exception:
                grp = None

            if grp:
                payload['room_name'] = grp.get('name', 'Nhóm')

            # Gửi thông báo đến tất cả thành viên đang ở room group_<group_id>
            emit(
                'call:incoming_notification',
                payload,
                room=f"group_{conv_id}",
                include_self=False
            )
        else:
            # PRIVATE: gửi cho participant còn lại (other_id)
            try:
                conv = conversations_col.find_one({'_id': ObjectId(conv_id)})
            except Exception:
                conv = None

            if not conv:
                return

            other_id = next(
                (p for p in conv.get('participants', []) if str(p) != str(user_id)),
                None
            )
            if other_id:
                emit(
                    'call:incoming_notification',
                    payload,
                    room=str(other_id)
                )

    # --- 6. DECLINE (TỪ CHỐI CUỘC GỌI) ---
    @socketio.on('call:decline')
    def handle_decline(data):
        user_id = session.get('user_id')
        conv_id = data.get('conversation_id')

        if not user_id or not conv_id:
            return

        has_access, detected_type = _can_access(conv_id, user_id)
        if not has_access:
            return

        ctype = data.get('conversation_type', detected_type)

        # Thông tin người từ chối
        decliner_info = get_user_info(user_id)

        payload = {
            'conversation_id': conv_id,
            'conversation_type': ctype,
            'decliner': decliner_info
        }

        if ctype == 'group':
            # Gửi cho tất cả mọi người trong nhóm (trừ người từ chối)
            emit(
                'call:declined',
                payload,
                room=f"group_{conv_id}",
                include_self=False
            )
        else:
            # Private call: gửi cho người còn lại trong cuộc trò chuyện
            try:
                conv = conversations_col.find_one({'_id': ObjectId(conv_id)})
            except Exception:
                conv = None

            if conv:
                other_id = next(
                    (p for p in conv.get('participants', []) if str(p) != str(user_id)),
                    None
                )
                if other_id:
                    emit('call:declined', payload, room=str(other_id))

    
    
        # --- 7. DRAWING (ĐỒNG BỘ NÉT VẼ GIỮA CÁC CLIENT) ---
    @socketio.on('call:draw')
    def handle_call_draw(data):
        user_id = session.get('user_id')
        conversation_id = data.get('conversation_id')
        if not user_id or not conversation_id:
            return

        room_id = f"call_{conversation_id}"

        emit(
            'call:draw',
            {
                'conversation_id': conversation_id,
                'from_sid': request.sid,
                'x0': data.get('x0'),
                'y0': data.get('y0'),
                'x1': data.get('x1'),
                'y1': data.get('y1'),
                'color': data.get('color'),
                'width': data.get('width'),
                'brush': data.get('brush'),
            },
            room=room_id,
            include_self=False
        )


    @socketio.on('call:clear_board')
    def handle_clear_board(data):
        """
        Xóa toàn bộ nét vẽ trên màn hình của mọi người
        """
        conversation_id = data.get('conversation_id')
        if conversation_id:
            room_id = f"call_{conversation_id}"
            emit('call:clear_board', {'from_sid': request.sid}, room=room_id)

    @socketio.on('call:toggle_drawing_mode')
    def handle_toggle_drawing(data):
        """
        (Tuỳ chọn) Báo cho người khác biết mình đang bật/tắt chế độ vẽ 
        """
        conversation_id = data.get('conversation_id')
        is_drawing = data.get('is_drawing', False)
        
        if conversation_id:
            room_id = f"call_{conversation_id}"
            emit(
                'call:drawing_mode_status', 
                {
                    'from_sid': request.sid,
                    'is_drawing': is_drawing,
                    'user_info': get_user_info(session.get('user_id'))
                }, 
                room=room_id,
                include_self=False
            )