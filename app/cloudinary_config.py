"""
Cloudinary Configuration
Lấy từ: https://cloudinary.com/console
Các giá trị được đọc từ environment variables (.env file)
"""
import os

# Cloudinary API Credentials - đọc từ environment variables
CLOUDINARY_CLOUD_NAME = os.environ.get('CLOUDINARY_CLOUD_NAME', '')
CLOUDINARY_API_KEY = os.environ.get('CLOUDINARY_API_KEY', '')
CLOUDINARY_API_SECRET = os.environ.get('CLOUDINARY_API_SECRET', '')

# Các cài đặt khác
CLOUDINARY_ENABLED = os.environ.get('CLOUDINARY_ENABLED', 'False').lower() == 'true'  # Bật Cloudinary để tối ưu tốc độ upload video/hình ảnh

# Folder trong Cloudinary để lưu trữ
CLOUDINARY_FOLDER = "pawtalk"  # Thư mục chính
CLOUDINARY_POSTS_FOLDER = "pawtalk/posts"  # Bài viết
CLOUDINARY_STORIES_FOLDER = "pawtalk/stories"  # Stories
CLOUDINARY_AVATARS_FOLDER = "pawtalk/avatars"  # Avatar
CLOUDINARY_COVERS_FOLDER = "pawtalk/covers"  # Cover photos
