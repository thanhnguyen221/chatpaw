import bcrypt
from flask import session
from datetime import datetime
from app import mongo  # Sử dụng biến mongo được khởi tạo trong __init__.py


def login_user(username, password):
    user = mongo.db['users'].find_one({'username': username})
    if user and bcrypt.checkpw(password.encode('utf-8'), user['password']):
        session['username'] = username
        session['user_id'] = str(user['_id'])
        return True
    return False

def register_user(full_name, username, email, phone, password, confirm_password, date_of_birth, gender):
    # Kiểm tra trùng username hoặc email
    if mongo.db['users'].find_one({'username': username}) or mongo.db['users'].find_one({'email': email}):
        return False

    if password != confirm_password:
        return False

    hashed_password = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt())

    user_data = {
        'full_name': full_name,
        'username': username,
        'email': email,
        'phone': phone,
        'password': hashed_password,
        'date_of_birth': date_of_birth, 
        'gender': gender,
        'created_at': datetime.now()
    }

    user_id = mongo.db['users'].insert_one(user_data).inserted_id

    session['username'] = username
    session['user_id'] = str(user_id)
    return True
