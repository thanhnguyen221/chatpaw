import bcrypt
import re
import uuid
import hashlib
from flask import session
from datetime import datetime, timedelta
from app import mongo  # Sử dụng biến mongo được khởi tạo trong __init__.py


def validate_password(password):
    """Kiểm tra độ mạnh của password"""
    if len(password) < 8:
        return False, "Mật khẩu phải có ít nhất 8 ký tự!"
    
    if not re.search(r'[A-Z]', password):
        return False, "Mật khẩu phải có ít nhất 1 chữ hoa!"
    
    if not re.search(r'[a-z]', password):
        return False, "Mật khẩu phải có ít nhất 1 chữ thường!"
    
    if not re.search(r'\d', password):
        return False, "Mật khẩu phải có ít nhất 1 số!"
    
    if not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
        return False, "Mật khẩu phải có ít nhất 1 ký tự đặc biệt!"
    
    return True, "Password hợp lệ!"


def validate_email(email):
    """Kiểm tra email có hợp lệ không"""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    if not re.match(pattern, email):
        return False, "Email không hợp lệ!"
    return True, "Email hợp lệ!"


def validate_phone(phone):
    """Kiểm tra số điện thoại có hợp lệ không"""
    if not phone:
        return True, "Không bắt buộc số điện thoại!"
    
    # Kiểm tra số điện thoại Việt Nam (10-11 số, bắt đầu bằng 0)
    pattern = r'^0\d{9,10}$'
    if not re.match(pattern, phone.replace(' ', '').replace('-', '')):
        return False, "Số điện thoại không hợp lệ!"
    return True, "Số điện thoại hợp lệ!"


def generate_session_fingerprint():
    """Tạo fingerprint cho session dựa trên user agent và IP"""
    from flask import request
    user_agent = str(request.user_agent)
    ip_address = request.environ.get('HTTP_X_FORWARDED_FOR', request.environ.get('REMOTE_ADDR', 'unknown'))
    
    # Tạo hash từ user agent và IP
    fingerprint_data = f"{user_agent}|{ip_address}"
    return hashlib.sha256(fingerprint_data.encode()).hexdigest()[:32]


def login_user(username, password):
    """Đăng nhập với single session token và fingerprint"""
    from flask import request
    
    user = mongo.db['users'].find_one({'username': username})
    if user and bcrypt.checkpw(password.encode('utf-8'), user['password']):
        # Tạo session token mới
        session_token = str(uuid.uuid4())
        session_fingerprint = generate_session_fingerprint()
        current_time = datetime.now()
        user_agent = str(request.user_agent)
        ip_address = request.environ.get('HTTP_X_FORWARDED_FOR', request.environ.get('REMOTE_ADDR', 'unknown'))
        
        # Kiểm tra nếu user đã đăng nhập ở nơi khác
        existing_session = user.get('session_token')
        if existing_session:
            # Force logout session cũ
            mongo.db['users'].update_one(
                {'_id': user['_id']},
                {'$set': {
                    'session_token': session_token,
                    'session_fingerprint': session_fingerprint,
                    'last_login': current_time,
                    'login_device': user_agent,
                    'login_ip': ip_address,
                    'previous_session_forced_out': True,
                    'forced_out_at': current_time
                }}
            )
        else:
            # Login bình thường
            mongo.db['users'].update_one(
                {'_id': user['_id']},
                {'$set': {
                    'session_token': session_token,
                    'session_fingerprint': session_fingerprint,
                    'last_login': current_time,
                    'login_device': user_agent,
                    'login_ip': ip_address
                }}
            )
        
        # Lưu vào session
        session['username'] = username
        session['user_id'] = str(user['_id'])
        session['session_token'] = session_token
        session['session_fingerprint'] = session_fingerprint
        session['login_time'] = current_time.isoformat()
        
        return True, "success"
    return False, "Tên đăng nhập hoặc mật khẩu không đúng!"


def check_session_valid(user_id, session_token):
    """Kiểm tra session token có hợp lệ không (single session với fingerprint)"""
    if not user_id or not session_token:
        return False, "No session"
    
    try:
        from bson import ObjectId
        user = mongo.db['users'].find_one({
            '_id': ObjectId(user_id),
            'session_token': session_token
        })
        
        if not user:
            return False, "Invalid session"
        
        # Kiểm tra fingerprint
        current_fingerprint = session.get('session_fingerprint')
        stored_fingerprint = user.get('session_fingerprint')
        
        if not current_fingerprint or not stored_fingerprint or current_fingerprint != stored_fingerprint:
            # Clear session nếu fingerprint không khớp
            session.clear()
            return False, "Session fingerprint mismatch"
        
        # Kiểm tra session timeout (24 giờ)
        login_time = user.get('last_login')
        if login_time:
            if isinstance(login_time, str):
                login_time = datetime.fromisoformat(login_time.replace('Z', '+00:00'))
            
            if datetime.now() - login_time > timedelta(hours=24):
                session.clear()
                return False, "Session expired"
        
        return True, "Valid session"
    except Exception as e:
        print(f"Session validation error: {e}")
        return False, "Session validation error"


def logout_user(user_id):
    """Xóa session token khi logout và ghi lại lịch sử"""
    if user_id:
        try:
            from bson import ObjectId
            from flask import request
            
            # Ghi lại lịch sử logout
            user = mongo.db['users'].find_one({'_id': ObjectId(user_id)})
            if user:
                logout_history = {
                    'logout_time': datetime.now(),
                    'session_token': user.get('session_token'),
                    'fingerprint': user.get('session_fingerprint'),
                    'ip_address': request.environ.get('HTTP_X_FORWARDED_FOR', request.environ.get('REMOTE_ADDR', 'unknown'))
                }
                
                # Thêm vào lịch sử đăng nhập
                mongo.db['users'].update_one(
                    {'_id': ObjectId(user_id)},
                    {
                        '$unset': {'session_token': '', 'session_fingerprint': ''},
                        '$push': {'login_history': logout_history}
                    }
                )
        except Exception as e:
            print(f"Error on logout: {str(e)}")
    
    session.clear()
    return True


def force_logout_user(user_id, reason="Security policy"):
    """Force logout user từ nơi khác (dùng cho admin hoặc security)"""
    try:
        from bson import ObjectId
        
        result = mongo.db['users'].update_one(
            {'_id': ObjectId(user_id)},
            {
                '$unset': {'session_token': '', 'session_fingerprint': ''},
                '$set': {'force_logout_reason': reason, 'force_logout_time': datetime.now()}
            }
        )
        
        return result.modified_count > 0
    except Exception as e:
        print(f"Error force logout: {str(e)}")
        return False


def get_active_sessions(user_id):
    """Lấy thông tin các session đang hoạt động (cho admin)"""
    try:
        from bson import ObjectId
        user = mongo.db['users'].find_one({'_id': ObjectId(user_id)})
        
        if not user:
            return None
        
        return {
            'current_session': {
                'token': user.get('session_token'),
                'fingerprint': user.get('session_fingerprint'),
                'login_time': user.get('last_login'),
                'device': user.get('login_device'),
                'ip': user.get('login_ip')
            },
            'login_history': user.get('login_history', [])[-10:]  # 10 lần gần nhất
        }
    except Exception as e:
        print(f"Error getting sessions: {str(e)}")
        return None


def register_user(full_name, username, email, phone, password, confirm_password, date_of_birth, gender):
    # Kiểm tra các trường bắt buộc
    if not full_name or not username or not email or not password:
        return False, "Vui lòng điền đầy đủ thông tin bắt buộc!"
    
    # Kiểm tra trùng username hoặc email
    if mongo.db['users'].find_one({'username': username}) or mongo.db['users'].find_one({'email': email}):
        return False, "Tên người dùng hoặc email đã tồn tại!"
    
    # Kiểm tra password có khớp không
    if password != confirm_password:
        return False, "Mật khẩu xác nhận không khớp!"
    
    # Validate password
    is_valid, message = validate_password(password)
    if not is_valid:
        return False, message
    
    # Validate email
    is_valid, message = validate_email(email)
    if not is_valid:
        return False, message
    
    # Validate phone
    is_valid, message = validate_phone(phone)
    if not is_valid:
        return False, message
    
    # Validate username (tối thiểu 3 ký tự, chỉ chứa chữ số và gạch dưới)
    if len(username) < 3:
        return False, "Tên người dùng phải có ít nhất 3 ký tự!"
    
    if not re.match(r'^[a-zA-Z0-9_]+$', username):
        return False, "Tên người dùng chỉ được chứa chữ, số và gạch dưới!"
    
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
    return True, "Đăng ký thành công!"
