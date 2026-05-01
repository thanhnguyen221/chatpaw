import os
from flask import Flask
from flask_socketio import SocketIO
from flask_pymongo import PyMongo
from datetime import datetime
from app.events import register_all_events 

base_dir = os.path.abspath(os.path.dirname(__file__))
static_dir = os.path.join(base_dir, '../static')
templates_dir = os.path.join(base_dir, '../templates')

socketio = SocketIO(
    cors_allowed_origins="*",
    ping_timeout=120,  # Tăng từ 60s lên 120s cho ngrok kết nối chậm
    ping_interval=30,  # Tăng từ 25s lên 30s
    max_http_buffer_size=200 * 1024 * 1024,  # Tăng từ 100MB lên 200MB cho video
    engineio_logger=False,
    logger=False,
    async_mode='threading',
    cors_credentials=True,
    always_connect=True,  # Luôn cho phép kết nối ngay cả khi origin khác
    transports=['websocket', 'polling']  # Cho phép cả 2 phương thức
)
mongo = PyMongo()

def format_time(value):
    try:
        from datetime import datetime, timezone
        import pytz
        
        if isinstance(value, str):
            value = datetime.fromisoformat(value.replace('Z', '+00:00'))
        
        # Chuyển về UTC nếu chưa có timezone
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        
        # Chuyển về giờ Việt Nam
        vietnam_tz = pytz.timezone('Asia/Ho_Chi_Minh')
        now = datetime.now(vietnam_tz)
        value_vn = value.astimezone(vietnam_tz)
        
        diff = now - value_vn
        
        # Hiển thị dạng tương đối
        if diff.total_seconds() < 60:
            return "Vừa xong"
        elif diff.total_seconds() < 3600:
            return f"{int(diff.total_seconds() // 60)} phút trước"
        elif diff.total_seconds() < 86400:
            return f"{int(diff.total_seconds() // 3600)} giờ trước"
        elif diff.days < 7:
            return f"{diff.days} ngày trước"
        else:
            # Hiển thị dạng tuyệt đối cho thời gian cũ
            return value_vn.strftime('%H:%M - %d/%m/%Y')
    except Exception as e:
        print(f"Format time error: {e}")
        return value

# Filter to convert datetime to Unix timestamp (milliseconds)
def timestamp_filter(value):
    """Convert datetime to Unix timestamp in milliseconds for JavaScript"""
    try:
        from datetime import datetime, timezone
        import pytz
        
        if isinstance(value, str):
            value = datetime.fromisoformat(value.replace('Z', '+00:00'))
        
        # Chuyển về UTC nếu chưa có timezone
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        
        # Convert to milliseconds timestamp
        return int(value.timestamp() * 1000)
    except Exception as e:
        print(f"Timestamp filter error: {e}")
        return 0

def create_app():
    app = Flask(__name__, static_folder=static_dir, template_folder=templates_dir)
    # Sửa: Dùng SECRET_KEY mạnh hơn để tránh mất session
    app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY')
    app.config["MONGO_URI"] = os.environ.get('MONGO_URI', 'mongodb://localhost:27017/NCKH')
    
    # Thêm cấu hình session để đảm bảo session được lưu đúng cách
    app.config['SESSION_TYPE'] = 'filesystem'
    app.config['PERMANENT_SESSION_LIFETIME'] = 86400  # 24 giờ
    app.config['SESSION_COOKIE_SECURE'] = False  # Cho phép HTTP (không cần HTTPS)
    app.config['SESSION_COOKIE_HTTPONLY'] = True
    app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

    socketio.init_app(app, async_mode='threading')
    mongo.init_app(app)

    from .routes import main
    from .profile_likes import profile_likes_bp
    
    app.register_blueprint(main)
    app.register_blueprint(profile_likes_bp)

    # THÊM SAU KHI KHỞI TẠO APP - tránh circular import
    with app.app_context():
        try:
            from app.timeline_blueprint import timeline_api
            # QUAN TRỌNG: THÊM url_prefix='/api/timeline'
            app.register_blueprint(timeline_api, url_prefix='/api/timeline')
            print("✅ Registered timeline_api blueprint with prefix /api/timeline")
        except ImportError as e:
            print(f"❌ Failed to import timeline_api: {e}")
        except Exception as e:
            print(f"❌ Error registering timeline_api: {e}")

        # Khởi tạo Cloudinary nếu được cấu hình
        try:
            from app.cloudinary_storage import init_cloudinary
            from app import cloudinary_config
            
            if cloudinary_config.CLOUDINARY_ENABLED:
                init_cloudinary()
            else:
                print("⚠️ Cloudinary disabled (check cloudinary_config.py)")
        except Exception as e:
            print(f"❌ Error initializing Cloudinary: {e}")

    # ✅ Đăng ký filter Jinja2
    app.jinja_env.filters['format_time'] = format_time
    app.jinja_env.filters['timestamp'] = timestamp_filter

    register_all_events(socketio, mongo)

    return app