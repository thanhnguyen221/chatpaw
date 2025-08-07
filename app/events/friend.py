from flask import session, request
from bson import ObjectId
from datetime import datetime
from flask_socketio import emit

def register_friend_events(socketio, mongo, online_users, sid_to_user):
    users_col = lambda: mongo.db['users']
    friend_requests_col = lambda: mongo.db['friend_requests']

    @socketio.on('send_friend_request')
    def handle_send_friend_request(data):
        sender_id = session.get('user_id')
        recipient_id = data.get('recipient_id')
        if not sender_id or not recipient_id:
            return

        # Insert request into MongoDB
        result = friend_requests_col().insert_one({
            'sender_id': ObjectId(sender_id),
            'recipient_id': ObjectId(recipient_id),
            'created_at': datetime.now(),
            'status': 'pending'
        })
        request_id = str(result.inserted_id)

        # Notify recipient if online
        if recipient_id in online_users:
            emit('new_friend_request', {
                'sender_id': sender_id,
                'sender_name': session.get('username'),
                'request_id': request_id
            }, to=online_users[recipient_id])

        # Acknowledge sender
        emit('friend_request_sent', {
            'recipient_id': recipient_id,
            'request_id': request_id
        }, to=request.sid)

    @socketio.on('accept_friend_request')
    def handle_accept_friend_request(data):
        recipient_id = session.get('user_id')
        request_id = data.get('request_id')
        sender_id = data.get('sender_id')

        if not recipient_id or not request_id or not sender_id:
            return

        # Update request status
        friend_requests_col().update_one(
            {'_id': ObjectId(request_id)},
            {'$set': {'status': 'accepted'}}
        )

        # Make both users friends
        users_col().update_one(
            {'_id': ObjectId(sender_id)},
            {'$addToSet': {'friends': recipient_id}}
        )
        users_col().update_one(
            {'_id': ObjectId(recipient_id)},
            {'$addToSet': {'friends': sender_id}}
        )

        # Notify both users
        if sender_id in online_users:
            emit('friend_added', {'friend_id': recipient_id}, to=online_users[sender_id])
        if recipient_id in online_users:
            emit('friend_added', {'friend_id': sender_id}, to=online_users[recipient_id])

    @socketio.on('decline_friend_request')
    def handle_decline_friend_request(data):
        request_id = data.get('request_id')
        if not request_id:
            return

        friend_requests_col().update_one(
            {'_id': ObjectId(request_id)},
            {'$set': {'status': 'declined'}}
        )

