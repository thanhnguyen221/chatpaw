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
    ping_timeout=60,
    ping_interval=25,
    max_http_buffer_size=100 * 1024 * 1024,  # 100MB
    engineio_logger=False,
    logger=False
)
mongo = PyMongo()

def format_time(value):
    try:
        if isinstance(value, str):
            value = datetime.fromisoformat(value)
        return value.strftime('%Y-%m-%dT%H:%M:%S')
    except Exception:
        return value

def create_app():
    app = Flask(__name__, static_folder=static_dir, template_folder=templates_dir)
    app.config['SECRET_KEY'] = 'Thy'
    app.config["MONGO_URI"] = "mongodb://localhost:27017/NCKH"

    socketio.init_app(app, async_mode='threading')
    mongo.init_app(app)

    from .routes import main
    app.register_blueprint(main)

    # ✅ Đăng ký filter Jinja2
    app.jinja_env.filters['format_time'] = format_time

    register_all_events(socketio, mongo)

    return app
