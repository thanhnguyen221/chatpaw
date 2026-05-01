# app/events/friend.py
from flask import session, request
from bson import ObjectId
from datetime import datetime
from flask_socketio import emit
from pymongo.errors import DuplicateKeyError

def register_friend_events(socketio, mongo, online_users, sid_to_user):
    users = mongo.db.users
    friend_requests = mongo.db.friend_requests

    # --- Indexes (idempotent) ---
    # Không bắt buộc, nhưng khuyến nghị: ngăn spam lời mời pending trùng
    try:
        friend_requests.create_index(
            [("sender_id", 1), ("recipient_id", 1), ("status", 1)],
            name="uniq_pending_pair",
            unique=True,
            partialFilterExpression={"status": "pending"}
        )
    except Exception:
        pass

    @socketio.on('send_friend_request')
    def handle_send_friend_request(data):
        sender_id = session.get('user_id')
        recipient_id = (data or {}).get('recipient_id')

        if not sender_id or not recipient_id:
            return

        # Không cho tự mời chính mình
        if str(sender_id) == str(recipient_id):
            emit('friend_error', {'message': 'Không thể gửi lời mời cho chính bạn.'}, to=request.sid)
            return

        # Đã là bạn bè?
        sender_doc = users.find_one({'_id': ObjectId(sender_id)}, {'friends': 1, 'username': 1, 'full_name': 1})
        if not sender_doc:
            emit('friend_error', {'message': 'Tài khoản gửi không hợp lệ.'}, to=request.sid)
            return

        sender_friends = sender_doc.get('friends', [])
        if str(recipient_id) in [str(fid) for fid in sender_friends]:
            emit('friend_error', {'message': 'Hai bạn đã là bạn bè.'}, to=request.sid)
            return
        
        # Lấy tên hiển thị (full_name ưu tiên)
        sender_display_name = sender_doc.get('full_name') or sender_doc.get('username', 'Unknown')

        # Đã có pending request ngược chiều?
        existing = friend_requests.find_one({
            'sender_id': ObjectId(recipient_id),
            'recipient_id': ObjectId(sender_id),
            'status': 'pending'
        })
        if existing:
            emit('friend_error', {'message': 'Đã có lời mời từ người này, hãy chấp nhận.'}, to=request.sid)
            return

        # Tạo lời mời mới nếu chưa tồn tại pending (nhờ unique index bảo vệ)
        try:
            result = friend_requests.insert_one({
                'sender_id': ObjectId(sender_id),
                'recipient_id': ObjectId(recipient_id),
                'created_at': datetime.utcnow(),
                'status': 'pending'
            })
        except DuplicateKeyError:
            emit('friend_error', {'message': 'Bạn đã gửi lời mời rồi.'}, to=request.sid)
            return

        request_id = str(result.inserted_id)

        # Notify recipient nếu online
        if recipient_id in online_users:
            emit('new_friend_request', {
                'sender_id': str(sender_id),
                'sender_name': sender_display_name,
                'request_id': request_id
            }, to=online_users[recipient_id])

        # Ack cho sender
        emit('friend_request_sent', {
            'recipient_id': str(recipient_id),
            'request_id': request_id
        }, to=request.sid)

    @socketio.on('accept_friend_request')
    def handle_accept_friend_request(data):
        recipient_id = session.get('user_id')
        request_id = (data or {}).get('request_id')

        if not recipient_id or not request_id:
            return

        # Lấy request và xác thực quyền
        fr = friend_requests.find_one({'_id': ObjectId(request_id)})
        if not fr:
            emit('friend_error', {'message': 'Yêu cầu không tồn tại.'}, to=request.sid)
            return

        # Chỉ người nhận hợp lệ và trạng thái pending mới được chấp nhận
        if str(fr.get('recipient_id')) != str(ObjectId(recipient_id)) or fr.get('status') != 'pending':
            emit('friend_error', {'message': 'Không có quyền chấp nhận yêu cầu này.'}, to=request.sid)
            return

        sender_id = str(fr['sender_id'])
        recipient_id_str = str(recipient_id)

        # Cập nhật trạng thái
        friend_requests.update_one(
            {'_id': fr['_id']},
            {'$set': {'status': 'accepted', 'updated_at': datetime.utcnow()}}
        )

        # Kết bạn hai chiều (lưu string id để đồng bộ với phần còn lại của app)
        users.update_one(
            {'_id': ObjectId(sender_id)},
            {'$addToSet': {'friends': recipient_id_str}}
        )
        users.update_one(
            {'_id': ObjectId(recipient_id_str)},
            {'$addToSet': {'friends': sender_id}}
        )

        # Thông báo cả hai phía
        if sender_id in online_users:
            emit('friend_added', {'friend_id': recipient_id_str}, to=online_users[sender_id])
        if recipient_id_str in online_users:
            emit('friend_added', {'friend_id': sender_id}, to=online_users[recipient_id_str])

        # Ack cho người nhận
        emit('friend_request_accepted', {
            'sender_id': sender_id,
            'request_id': request_id
        }, to=request.sid)

    @socketio.on('decline_friend_request')
    def handle_decline_friend_request(data):
        recipient_id = session.get('user_id')
        request_id = (data or {}).get('request_id')

        if not recipient_id or not request_id:
            return

        fr = friend_requests.find_one({'_id': ObjectId(request_id)})
        if not fr:
            emit('friend_error', {'message': 'Yêu cầu không tồn tại.'}, to=request.sid)
            return

        # Chỉ người nhận hợp lệ và trạng thái pending mới được từ chối
        # So sánh trực tiếp string để tránh lỗi ObjectId conversion
        fr_recipient_id = str(fr.get('recipient_id'))
        current_user_id = str(recipient_id)
        
        if fr_recipient_id != current_user_id or fr.get('status') != 'pending':
            print(f"[Decline Friend Request] Permission denied: fr_recipient={fr_recipient_id}, current_user={current_user_id}, status={fr.get('status')}")
            emit('friend_error', {'message': 'Không có quyền từ chối yêu cầu này.'}, to=request.sid)
            return

        result = friend_requests.update_one(
            {'_id': fr['_id']},
            {'$set': {'status': 'declined', 'updated_at': datetime.utcnow()}}
        )
        
        print(f"[Decline Friend Request] Updated request {request_id}, matched={result.matched_count}, modified={result.modified_count}")

        emit('friend_request_declined', {'request_id': request_id}, to=request.sid)
