from flask import session, request
from bson import ObjectId
from flask_socketio import emit, join_room
from datetime import datetime
import flask

from .chat import register_chat_events
from .friend import register_friend_events
from .group import register_group_events
from .call import register_call_events

online_users = {}
sid_to_user = {}

def register_all_events(socketio, mongo):
    register_chat_events(socketio, mongo)           
    register_friend_events(socketio, mongo, online_users, sid_to_user)
    register_group_events(socketio, mongo)
    register_call_events(socketio, mongo)

    @socketio.on('connect')
    def handle_connect():
        # Sử dụng flask.session thay vì session trực tiếp để tránh lỗi Flask 3.x
        user_id = flask.session.get('user_id') if hasattr(flask, 'session') else None
        if not user_id:
            # Thử lấy từ request.environ
            environ = getattr(request, 'environ', {})
            cookie = environ.get('HTTP_COOKIE', '')
            print(f"🍪 Cookie received: {cookie[:100]}...")
        
        if user_id:
            print(f"✅ User {user_id} connected via socket")
            sid_to_user[request.sid] = user_id
            online_users[user_id] = request.sid

            users_col = mongo.db.users
            conversations_col = mongo.db.conversations

            users_col.update_one({'_id': ObjectId(user_id)}, {'$set': {'online': True, 'last_active': datetime.utcnow()}})

            conversations = conversations_col.find({'participants': user_id})
            for conv in conversations:
                join_room(str(conv['_id']))

            emit('user_status', {'userId': user_id, 'online': True}, broadcast=True)
        else:
            print(f"⚠️ Socket connect without user_id - sid: {request.sid}")

    @socketio.on('disconnect')
    def handle_disconnect():
        sid = request.sid
        user_id = sid_to_user.pop(sid, None)
        if user_id:
            print(f"❌ User {user_id} disconnected")
            online_users.pop(user_id, None)

            users_col = mongo.db.users
            users_col.update_one({'_id': ObjectId(user_id)}, {'$set': {'online': False, 'last_active': datetime.utcnow()}})

            emit('user_status', {'userId': user_id, 'online': False, 'last_active': datetime.utcnow().isoformat()}, broadcast=True)
