# Thêm vào app/models.py hoặc tạo mới
from mongoengine import Document, StringField, ListField, DateTimeField, IntField, BooleanField, ReferenceField

class Post(Document):
    user_id = StringField(required=True)
    content = StringField()
    media_urls = ListField(DictField())  # Danh sách media: [{"url": "...", "type": "image/video"}]
    likes = ListField(StringField())  # Danh sách user_id đã like
    comments = ListField(DictField())  # Danh sách bình luận
    shares_count = IntField(default=0)
    created_at = DateTimeField(default=datetime.utcnow)
    updated_at = DateTimeField()
    is_shared = BooleanField(default=False)
    original_post_id = StringField()  # ID bài viết gốc nếu là shared post
    post_type = StringField(default='post')  # 'post' hoặc 'share'
    
    meta = {
        'collection': 'posts',
        'indexes': [
            'user_id',
            'created_at',
            {'fields': ['created_at'], 'expireAfterSeconds': 30*24*3600}  # Tự động xóa sau 30 ngày (tùy chọn)
        ]
    }