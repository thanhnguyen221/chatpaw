from flask import session, request
from bson import ObjectId
from flask_socketio import emit, join_room

from .chat import register_chat_events
from .friend import register_friend_events
from .group import register_group_events

online_users = {}
sid_to_user = {}

def register_all_events(socketio, mongo):
    register_chat_events(socketio, mongo)           
    register_friend_events(socketio, mongo, online_users, sid_to_user)
    register_group_events(socketio, mongo)

    @socketio.on('connect')
    def handle_connect():
        user_id = session.get('user_id')
        if user_id:
            print(f"✅ User {user_id} connected")
            sid_to_user[request.sid] = user_id
            online_users[user_id] = request.sid

            users_col = mongo.db.users
            conversations_col = mongo.db.conversations

            users_col.update_one({'_id': ObjectId(user_id)}, {'$set': {'online': True}})

            conversations = conversations_col.find({'participants': user_id})
            for conv in conversations:
                join_room(str(conv['_id']))

            emit('user_status', {'userId': user_id, 'online': True}, broadcast=True)

    @socketio.on('disconnect')
    def handle_disconnect():
        sid = request.sid
        user_id = sid_to_user.pop(sid, None)
        if user_id:
            print(f"❌ User {user_id} disconnected")
            online_users.pop(user_id, None)

            users_col = mongo.db.users
            users_col.update_one({'_id': ObjectId(user_id)}, {'$set': {'online': False}})

            emit('user_status', {'userId': user_id, 'online': False}, broadcast=True)
