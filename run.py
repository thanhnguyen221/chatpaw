from dotenv import load_dotenv
import os

# Load environment variables from .env file
# Tìm .env file từ thư mục hiện tại
env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
if os.path.exists(env_path):
    load_dotenv(env_path)
    print(f"✅ Loaded environment variables from {env_path}")
else:
    print(f"⚠️ .env file not found at {env_path}, using system environment variables")

from app import create_app, socketio

app = create_app()

if __name__ == '__main__':
    app.config['UPLOAD_FOLDER'] = 'app/static/uploads'
    socketio.run(app, host="0.0.0.0", port=5001, debug=True, allow_unsafe_werkzeug=True)