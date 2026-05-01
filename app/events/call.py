from flask import session, request
from bson import ObjectId
from flask_socketio import emit, join_room, leave_room
from datetime import datetime


def register_call_events(socketio, mongo):
    conversations_col = mongo.db.conversations
    group_members_col = mongo.db.group_members
    users_col = mongo.db.users
    groups_col = mongo.db.groups
    calls_col = mongo.db.calls
    messages_col = mongo.db.messages
    group_messages_col = mongo.db.group_messages

    # Lưu danh sách user (sid) trong từng phòng call
    # call_rooms = { "call_<conversation_id>": {"sids": [...]} }
    call_rooms = {}

    @socketio.on('join_user_room')
    def handle_join_user_room(data):
        print(f"[Call Debug] join_user_room called with data: {data}")
        user_id = data.get('user_id')
        print(f"[Call Debug] user_id from data: {user_id}")
        if user_id:
            join_room(f"user_{user_id}")
            print(f"[Call Debug] User {user_id} joined room user_{user_id}")
        else:
            print(f"[Call Debug] No user_id provided!")

    @socketio.on('call:invite_private')
    def handle_invite_private(data):
        recipient_id = data.get('recipient_id')
        conversation_id = data.get('conversation_id')
        sender_id = session.get('user_id')
        call_mode = data.get('call_mode', 'video')

        print(f"[Call Debug] invite_private called: sender={sender_id}, recipient={recipient_id}, conv={conversation_id}")

        if not sender_id or not recipient_id or not conversation_id:
            print(f"[Call Debug] Missing data: sender={sender_id}, recipient={recipient_id}, conv={conversation_id}")
            return

        # Validate access (conversation must be private and include sender)
        has_access, detected_type = _can_access(conversation_id, sender_id)
        print(f"[Call Debug] Access check: has_access={has_access}, type={detected_type}")
        if not has_access or detected_type != 'private':
            print(f"[Call Debug] Access denied for sender {sender_id} on conv {conversation_id}")
            return

        # Create call record
        call_id = calls_col.insert_one({
            'conversation_id': ObjectId(conversation_id),
            'conversation_type': 'private',
            'caller_id': ObjectId(sender_id),
            'start_time': datetime.utcnow(),
            'end_time': None,
            'status': 'ringing',
            'participants': [ObjectId(sender_id)],
            'call_mode': call_mode
        }).inserted_id

        sender = users_col.find_one({'_id': ObjectId(sender_id)}, {'username': 1, 'avatar': 1})

        payload = {
            'conversation_id': conversation_id,
            'conversation_type': 'private',
            'caller': {
                'id': str(sender_id),
                'username': sender.get('username', 'Ai đó') if sender else 'Ai đó',
                'avatar': sender.get('avatar', '/static/img/default-avatar.png') if sender else '/static/img/default-avatar.png'
            },
            'room_name': conversation_id,
            'call_id': str(call_id),
            'call_mode': call_mode
        }

        print(f"[Call Debug] Emitting to room user_{recipient_id}: {payload}")

        # New event name used by call.js
        emit('call:incoming_notification', payload, room=f"user_{recipient_id}")
        # Backward compatibility (older clients)
        emit('call:incoming', payload, room=f"user_{recipient_id}")

        print(f"[Call Debug] Invitation sent successfully")

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
        call_id = None
        if room_id in call_rooms:
            call_id = call_rooms[room_id].get('call_id')
            if sid in call_rooms[room_id]['sids']:
                call_rooms[room_id]['sids'].remove(sid)
            if not call_rooms[room_id]['sids']:
                room_empty = True
                del call_rooms[room_id]

        # Thông báo cho các peer khác trong call
        emit('call:user_left', {'sid': sid}, room=room_id)

        # Nếu phòng call trống -> báo là call đã tắt
        if room_empty and room_id.startswith("call_"):
            conv_id = room_id.replace("call_", "", 1)
            _broadcast_call_status(conv_id, False)

            if call_id:
                try:
                    call = calls_col.find_one_and_update(
                        {'_id': ObjectId(call_id)},
                        {'$set': {'end_time': datetime.utcnow()}},
                        return_document=True
                    )
                    if call:
                        duration = (call['end_time'] - call['start_time']).total_seconds()
                        status = 'missed' if len(call.get('participants', [])) <= 1 else 'ended'
                        
                        calls_col.update_one(
                            {'_id': ObjectId(call_id)},
                            {'$set': {'status': status, 'duration': duration}}
                        )


                except Exception as e:
                    print(f"Error finalizing call record: {e}")

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
        call_id = data.get('call_id')

        if not user_id or not conversation_id:
            return

        has_access, _ = _can_access(conversation_id, user_id)
        if not has_access:
            return

        # Update call document
        if call_id:
            try:
                call_oid = ObjectId(call_id)
                user_oid = ObjectId(user_id)
                
                # Add user to participants
                calls_col.update_one(
                    {'_id': call_oid},
                    {'$addToSet': {'participants': user_oid}}
                )

                # Check if call is now ongoing
                call = calls_col.find_one({'_id': call_oid})
                if call and len(call.get('participants', [])) > 1:
                    calls_col.update_one(
                        {'_id': call_oid},
                        {'$set': {'status': 'ongoing'}}
                    )
            except Exception as e:
                print(f"Error updating call record: {e}")

        room_id = f"call_{conversation_id}"
        join_room(room_id)

        current_sid = request.sid
        if room_id not in call_rooms:
            call_rooms[room_id] = {'sids': [], 'call_id': call_id}
        
        if current_sid not in call_rooms[room_id]['sids']:
            call_rooms[room_id]['sids'].append(current_sid)

        print(f"📞 User {user_id} joined {room_id}")

        # Gửi danh sách user hiện có trong phòng cho client mới
        others = [sid for sid in call_rooms[room_id]['sids'] if sid != current_sid]
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

    # 3. XỬ LÝ NGẮT KẾT NỐI (ĐỂ RESET NÚT GROUP CALL)
# 7. NGẮT KẾT NỐI (DISCONNECT) - [ĐÃ CẬP NHẬT LOGIC GROUP]
    @socketio.on('disconnect')
    def handle_disconnect():
        sid = request.sid
        # Tìm xem sid này ở phòng nào và xóa đi
        # Dùng list(call_rooms.items()) để copy dictionary, tránh lỗi runtime error khi delete
        for room_id, info in list(call_rooms.items()): 
            if sid in info['sids']:
                info['sids'].remove(sid)
                
                # Nếu phòng trống -> Xóa phòng & Báo tắt đèn
                if not info['sids']:
                    del call_rooms[room_id]
                    
                    # Nếu là phòng call group -> Báo tắt đèn
                    if room_id.startswith("call_"):
                        # room_id dạng "call_123abc" -> lấy "123abc"
                        conv_id = room_id.replace("call_", "", 1)
                        
                        # Gửi sự kiện tắt đèn xanh (is_active=False)
                        _broadcast_call_status(conv_id, False)
                        
                        # Gửi sự kiện call ended để client reset giao diện nút bấm
                        emit('call:ended', {
                            'conversation_id': conv_id,
                            'conversation_type': 'group' # Mặc định báo group để reset nút
                        }, room=f"group_{conv_id}")
                else:
                    # Nếu phòng chưa trống -> Báo người rời đi cho những người còn lại
                    emit('call:user_left', {'sid': sid}, room=room_id)
                break

    # --- 5. INVITE (GỬI LỜI MỜI GỌI: PRIVATE / GROUP) ---
    @socketio.on('call:invite_group')
    def handle_invite(data):
        conv_id = data.get('conversation_id')
        user_id = session.get('user_id')
        call_mode = data.get('call_mode', 'video')  # 'video' | 'audio'

        if not conv_id or not user_id:
            return

        has_access, detected_type = _can_access(conv_id, user_id)
        if not has_access:
            return

        # Create a new call record
        call_id = calls_col.insert_one({
            'conversation_id': ObjectId(conv_id),
            'conversation_type': detected_type,
            'caller_id': ObjectId(user_id),
            'start_time': datetime.utcnow(),
            'end_time': None,
            'status': 'ringing',
            'participants': [ObjectId(user_id)],
            'call_mode': call_mode  # Lưu chế độ gọi
        }).inserted_id

        # Cho phép FE override loại nếu gửi kèm conversation_type
        ctype = data.get('conversation_type', detected_type)

        # Emit back to the caller with the call_id
        emit('call:initiated', {'call_id': str(call_id)}, room=request.sid)

        sender_info = get_user_info(user_id)
        payload = {
            'caller': sender_info,
            'conversation_id': conv_id,
            'conversation_type': ctype,
            'room_name': '',
            'call_id': str(call_id),
            'call_mode': call_mode  # Truyền chế độ gọi cho người nhận
        }

        if ctype == 'group':
            # Lấy tên nhóm để hiển thị
            try:
                grp = groups_col.find_one({'_id': ObjectId(conv_id)})
            except Exception:
                grp = None

            if grp:
                payload['room_name'] = grp.get('name', 'Nhóm')

            # 🔥 FIX: Gửi thông báo đến TẤT CẢ thành viên trong nhóm (từng người một)
            try:
                group_members = group_members_col.find({'group_id': ObjectId(conv_id)})
                for member in group_members:
                    member_id = str(member['user_id'])
                    # Không gửi cho chính người gọi
                    if member_id != str(user_id):
                        emit(
                            'call:incoming_notification',
                            payload,
                            room=f"user_{member_id}"
                        )
                        print(f"[Call Debug] Sent group call invite to member: {member_id}")
            except Exception as e:
                print(f"[Call Debug] Error sending group invites: {e}")
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
                    room=f"user_{other_id}"
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
                    emit('call:declined', payload, room=f"user_{other_id}")

    # --- 6.5 ACCEPT (CHẤP NHẬN CUỘC GỌI) ---
    @socketio.on('call:accept')
    def handle_accept(data):
        """
        Người nhận báo là đã accept cuộc gọi.
        Server sẽ thông báo cho caller để họ tự động join.
        """
        user_id = session.get('user_id')
        conv_id = data.get('conversation_id')
        call_id = data.get('call_id')
        call_mode = data.get('call_mode', 'video')

        if not user_id or not conv_id:
            return

        has_access, detected_type = _can_access(conv_id, user_id)
        if not has_access:
            return

        ctype = data.get('conversation_type', detected_type)
        accepter_info = get_user_info(user_id)

        payload = {
            'conversation_id': conv_id,
            'conversation_type': ctype,
            'call_id': call_id,
            'call_mode': call_mode,
            'accepter': accepter_info
        }

        if ctype == 'group':
            # 🔥 BÙNG NỔ: Gửi cho tất cả thành viên trong nhóm (trừ người accept)
            try:
                group_members = group_members_col.find({'group_id': ObjectId(conv_id)})
                for member in group_members:
                    member_id = str(member['user_id'])
                    if member_id != str(user_id):
                        emit('call:accepted', payload, room=f"user_{member_id}")
            except Exception as e:
                print(f"[Call Debug] Error sending accept: {e}")
        else:
            # Private call: gửi cho người còn lại (caller)
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
                    emit('call:accepted', payload, room=f"user_{other_id}")

    
    
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
                {'username': 1, 'full_name': 1, 'avatar': 1}
            )
        except Exception:
            u = None

        if u:
            return {
                'id': str(u['_id']),
                'username': u.get('full_name') or u.get('username', 'Unknown'),
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
        call_id = None
        if room_id in call_rooms:
            call_id = call_rooms[room_id].get('call_id')
            if sid in call_rooms[room_id]['sids']:
                call_rooms[room_id]['sids'].remove(sid)
            if not call_rooms[room_id]['sids']:
                room_empty = True
                del call_rooms[room_id]

        # Thông báo cho các peer khác trong call
        emit('call:user_left', {'sid': sid}, room=room_id)

        # Nếu phòng call trống -> báo là call đã tắt
        if room_empty and room_id.startswith("call_"):
            conv_id = room_id.replace("call_", "", 1)
            _broadcast_call_status(conv_id, False)

            if call_id:
                try:
                    call = calls_col.find_one_and_update(
                        {'_id': ObjectId(call_id)},
                        {'$set': {'end_time': datetime.utcnow()}},
                        return_document=True
                    )
                    if call:
                        duration = (call['end_time'] - call['start_time']).total_seconds()
                        status = 'missed' if len(call.get('participants', [])) <= 1 else 'ended'
                        
                        calls_col.update_one(
                            {'_id': ObjectId(call_id)},
                            {'$set': {'status': status, 'duration': duration}}
                        )


                except Exception as e:
                    print(f"Error finalizing call record: {e}")

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
        call_id = data.get('call_id')

        if not user_id or not conversation_id:
            return

        has_access, _ = _can_access(conversation_id, user_id)
        if not has_access:
            return

        # Update call document
        if call_id:
            try:
                call_oid = ObjectId(call_id)
                user_oid = ObjectId(user_id)
                
                # Add user to participants
                calls_col.update_one(
                    {'_id': call_oid},
                    {'$addToSet': {'participants': user_oid}}
                )

                # Check if call is now ongoing
                call = calls_col.find_one({'_id': call_oid})
                if call and len(call.get('participants', [])) > 1:
                    calls_col.update_one(
                        {'_id': call_oid},
                        {'$set': {'status': 'ongoing'}}
                    )
            except Exception as e:
                print(f"Error updating call record: {e}")

        room_id = f"call_{conversation_id}"
        join_room(room_id)

        current_sid = request.sid
        if room_id not in call_rooms:
            call_rooms[room_id] = {'sids': [], 'call_id': call_id}
        
        if current_sid not in call_rooms[room_id]['sids']:
            call_rooms[room_id]['sids'].append(current_sid)

        print(f"📞 User {user_id} joined {room_id}")

        # Gửi danh sách user hiện có trong phòng cho client mới
        others = [sid for sid in call_rooms[room_id]['sids'] if sid != current_sid]
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

    # 3. XỬ LÝ NGẮT KẾT NỐI (ĐỂ RESET NÚT GROUP CALL)
# 7. NGẮT KẾT NỐI (DISCONNECT) - [ĐÃ CẬP NHẬT LOGIC GROUP]
    @socketio.on('disconnect')
    def handle_disconnect():
        sid = request.sid
        # Tìm xem sid này ở phòng nào và xóa đi
        # Dùng list(call_rooms.items()) để copy dictionary, tránh lỗi runtime error khi delete
        for room_id, info in list(call_rooms.items()): 
            if sid in info['sids']:
                info['sids'].remove(sid)
                
                # Nếu phòng trống -> Xóa phòng & Báo tắt đèn
                if not info['sids']:
                    del call_rooms[room_id]
                    
                    # Nếu là phòng call group -> Báo tắt đèn
                    if room_id.startswith("call_"):
                        # room_id dạng "call_123abc" -> lấy "123abc"
                        conv_id = room_id.replace("call_", "", 1)
                        
                        # Gửi sự kiện tắt đèn xanh (is_active=False)
                        _broadcast_call_status(conv_id, False)
                        
                        # Gửi sự kiện call ended để client reset giao diện nút bấm
                        emit('call:ended', {
                            'conversation_id': conv_id,
                            'conversation_type': 'group' # Mặc định báo group để reset nút
                        }, room=f"group_{conv_id}")
                else:
                    # Nếu phòng chưa trống -> Báo người rời đi cho những người còn lại
                    emit('call:user_left', {'sid': sid}, room=room_id)
                break

    # --- 5. INVITE (GỬI LỜI MỜI GỌI: PRIVATE / GROUP) ---
    @socketio.on('call:invite_group')
    def handle_invite(data):
        conv_id = data.get('conversation_id')
        user_id = session.get('user_id')
        call_mode = data.get('call_mode', 'video')  # 'video' | 'audio'

        if not conv_id or not user_id:
            return

        has_access, detected_type = _can_access(conv_id, user_id)
        if not has_access:
            return

        # Create a new call record
        call_id = calls_col.insert_one({
            'conversation_id': ObjectId(conv_id),
            'conversation_type': detected_type,
            'caller_id': ObjectId(user_id),
            'start_time': datetime.utcnow(),
            'end_time': None,
            'status': 'ringing',
            'participants': [ObjectId(user_id)],
            'call_mode': call_mode  # Lưu chế độ gọi
        }).inserted_id

        # Cho phép FE override loại nếu gửi kèm conversation_type
        ctype = data.get('conversation_type', detected_type)

        # Emit back to the caller with the call_id
        emit('call:initiated', {'call_id': str(call_id)}, room=request.sid)

        sender_info = get_user_info(user_id)
        payload = {
            'caller': sender_info,
            'conversation_id': conv_id,
            'conversation_type': ctype,
            'room_name': '',
            'call_id': str(call_id),
            'call_mode': call_mode  # Truyền chế độ gọi cho người nhận
        }

        if ctype == 'group':
            # Lấy tên nhóm để hiển thị
            try:
                grp = groups_col.find_one({'_id': ObjectId(conv_id)})
            except Exception:
                grp = None

            if grp:
                payload['room_name'] = grp.get('name', 'Nhóm')

            # 🔥 BÙNG NỔ: Gửi thông báo đến TẤT CẢ thành viên trong nhóm (từng người một)
            try:
                group_members = group_members_col.find({'group_id': ObjectId(conv_id)})
                for member in group_members:
                    member_id = str(member['user_id'])
                    # Không gửi cho chính người gọi
                    if member_id != str(user_id):
                        emit(
                            'call:incoming_notification',
                            payload,
                            room=f"user_{member_id}"  # 🔥 FIX: Thêm prefix user_ đúng với room người dùng join
                        )
                        print(f"[Call Debug] Sent group call invite to member: user_{member_id}")
            except Exception as e:
                print(f"[Call Debug] Error sending group invites: {e}")
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
                    room=f"user_{other_id}"
                )

    # --- 5.5 CANCEL (HỦY LỜI MỜI KHI NGƯỜI GỌI NGẮT) ---
    @socketio.on('call:cancel')
    def handle_cancel(data):
        """
        Người gọi hủy lời mời trước khi người nhận accept/decline.
        Server sẽ thông báo cho tất cả người nhận để đóng popup.
        """
        user_id = session.get('user_id')
        conv_id = data.get('conversation_id')
        call_id = data.get('call_id')

        if not user_id or not conv_id:
            return

        has_access, detected_type = _can_access(conv_id, user_id)
        if not has_access:
            return

        ctype = data.get('conversation_type', detected_type)

        payload = {
            'conversation_id': conv_id,
            'conversation_type': ctype,
            'call_id': call_id,
            'cancelled_by': user_id
        }

        if ctype == 'group':
            # 🔥 BÙNG NỔ: Gửi cho tất cả thành viên trong nhóm (trừ người hủy)
            try:
                group_members = group_members_col.find({'group_id': ObjectId(conv_id)})
                for member in group_members:
                    member_id = str(member['user_id'])
                    if member_id != str(user_id):
                        emit('call:cancelled', payload, room=f"user_{member_id}")
            except Exception as e:
                print(f"[Call Debug] Error sending cancel: {e}")
        else:
            # Private: gửi cho người còn lại
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
                    emit('call:cancelled', payload, room=f"user_{other_id}")

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
            # 🔥 BÙNG NỔ: Gửi cho tất cả thành viên trong nhóm (trừ người từ chối)
            try:
                group_members = group_members_col.find({'group_id': ObjectId(conv_id)})
                for member in group_members:
                    member_id = str(member['user_id'])
                    if member_id != str(user_id):
                        emit('call:declined', payload, room=f"user_{member_id}")
            except Exception as e:
                print(f"[Call Debug] Error sending decline: {e}")
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
                    emit('call:declined', payload, room=f"user_{other_id}")  # 🔥 FIX: Emit đúng room

    # --- 6.5 ACCEPT (CHẤP NHẬN CUỘC GỌI) ---
    @socketio.on('call:accept')
    def handle_accept(data):
        user_id = session.get('user_id')
        conv_id = data.get('conversation_id')

        if not user_id or not conv_id:
            return

        has_access, detected_type = _can_access(conv_id, user_id)
        if not has_access:
            return

        ctype = data.get('conversation_type', detected_type)

        # Thông tin người chấp nhận
        accepter_info = get_user_info(user_id)

        payload = {
            'conversation_id': conv_id,
            'conversation_type': ctype,
            'recipient_id': user_id,
            'call_id': data.get('call_id'),
            'call_mode': data.get('call_mode', 'video')
        }

        if ctype == 'group':
            # 🔥 BÙNG NỔ: Gửi cho tất cả thành viên trong nhóm (trừ người chấp nhận)
            try:
                group_members = group_members_col.find({'group_id': ObjectId(conv_id)})
                for member in group_members:
                    member_id = str(member['user_id'])
                    if member_id != str(user_id):
                        emit('call:accepted', payload, room=f"user_{member_id}")
            except Exception as e:
                print(f"[Call Debug] Error sending accept: {e}")
        else:
            # Private call: gửi cho người còn lại trong cuộc trò chuyện (người gọi)
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
                    emit('call:accepted', payload, room=f"user_{other_id}")  # 🔥 FIX: Emit đúng room

    
    
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
    # --- 8. SCREEN SHARING (TRÌNH CHIẾU MÀN HÌNH) ---
    @socketio.on('screen_share:started')
    def handle_screen_share_started(data):
        """
        Xử lý khi có người bắt đầu trình chiếu màn hình.
        Broadcast cho tất cả người trong cuộc gọi biết.
        """
        conversation_id = data.get('conversation_id')
        presenter_sid = data.get('presenter_sid')
        presenter_name = data.get('presenter_name', 'Người dùng')
        
        if not conversation_id or not presenter_sid:
            return
        
        room_id = f"call_{conversation_id}"
        
        # Broadcast cho tất cả người trong phòng (kể cả người gửi để đồng bộ)
        emit(
            'screen_share:started',
            {
                'conversation_id': conversation_id,
                'presenter_sid': presenter_sid,
                'presenter_name': presenter_name
            },
            room=room_id
        )
        print(f"[ScreenShare] {presenter_name} started screen sharing in {room_id}")

    @socketio.on('screen_share:stopped')
    def handle_screen_share_stopped(data):
        """
        Xử lý khi có người dừng trình chiếu màn hình.
        Broadcast cho tất cả người trong cuộc gọi biết.
        """
        conversation_id = data.get('conversation_id')
        presenter_sid = data.get('presenter_sid')
        
        if not conversation_id or not presenter_sid:
            return
        
        room_id = f"call_{conversation_id}"
        
        # Broadcast cho tất cả người trong phòng
        emit(
            'screen_share:stopped',
            {
                'conversation_id': conversation_id,
                'presenter_sid': presenter_sid
            },
            room=room_id
        )
        print(f"[ScreenShare] {presenter_sid} stopped screen sharing in {room_id}")
