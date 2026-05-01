"""
Media Upload Utilities - Handles uploading to local storage or Cloudinary
"""
import os
import tempfile
from typing import Optional, Dict, Any, List
from werkzeug.datastructures import FileStorage
from werkzeug.utils import secure_filename
import uuid


# Lazy imports to avoid circular import issues
def get_cloudinary_config():
    from app import cloudinary_config
    return cloudinary_config


def get_cloudinary_storage():
    from app.cloudinary_storage import upload_file
    return upload_file


def save_uploaded_file(file: FileStorage, upload_dir: str) -> str:
    """Save uploaded file to local directory"""
    filename = secure_filename(f"{uuid.uuid4().hex}_{file.filename}")
    os.makedirs(upload_dir, exist_ok=True)
    filepath = os.path.join(upload_dir, filename)
    file.save(filepath)
    return filepath


def upload_media(file: FileStorage, file_type: str = "image",
                 upload_dir: str = None, use_cloudinary: bool = None) -> Dict[str, Any]:
    """
    Upload media to either local storage or Cloudinary
    
    Args:
        file: The uploaded file
        file_type: 'image' or 'video'
        upload_dir: Local upload directory (if using local storage)
        use_cloudinary: Force using Cloudinary (None = auto-detect from config)
    
    Returns:
        Dict with 'success', 'url', 'type', 'filename', 'source' keys
    """
    if use_cloudinary is None:
        cloudinary_config = get_cloudinary_config()
        use_cloudinary = cloudinary_config.CLOUDINARY_ENABLED
    else:
        cloudinary_config = get_cloudinary_config()
    
    result = {
        'success': False,
        'url': None,
        'type': file_type,
        'filename': file.filename,
        'source': 'cloudinary' if use_cloudinary else 'local',
        'thumbnail': None
    }
    
    try:
        if use_cloudinary and cloudinary_config.CLOUDINARY_ENABLED:
            # Save to temp file first
            temp_dir = tempfile.gettempdir()
            temp_path = os.path.join(temp_dir, secure_filename(file.filename))
            file.save(temp_path)
            
            try:
                # Determine folder based on file type
                if file_type == "video":
                    folder = cloudinary_config.CLOUDINARY_POSTS_FOLDER
                else:
                    folder = cloudinary_config.CLOUDINARY_POSTS_FOLDER
                
                # Upload to Cloudinary
                upload_func = get_cloudinary_storage()
                upload_result = upload_func(temp_path, file_type, folder)
                
                if upload_result and upload_result.get('success'):
                    result['success'] = True
                    result['url'] = upload_result['url']
                    result['public_id'] = upload_result.get('public_id')
                    if upload_result.get('thumbnail'):
                        result['thumbnail'] = upload_result['thumbnail']
                    print(f"✅ Uploaded to Cloudinary: {upload_result['url']}")
                else:
                    # Fallback to local storage
                    print("⚠️ Cloudinary upload failed, falling back to local storage")
                    return upload_media(file, file_type, upload_dir, use_cloudinary=False)
            finally:
                # Clean up temp file
                if os.path.exists(temp_path):
                    os.remove(temp_path)
        else:
            # Use local storage
            if not upload_dir:
                from flask import current_app
                upload_dir = os.path.join(current_app.root_path, 'static/uploads/posts')
            
            filepath = save_uploaded_file(file, upload_dir)
            filename = os.path.basename(filepath)
            
            result['success'] = True
            result['url'] = f"/static/uploads/posts/{filename}"
            result['filename'] = filename
            
            # Create thumbnail for video
            if file_type == "video":
                thumbnail_url = create_video_thumbnail(filepath, upload_dir)
                result['thumbnail'] = thumbnail_url
            
            print(f"✅ Saved locally: {result['url']}")
    
    except Exception as e:
        print(f"❌ Upload error: {e}")
        result['error'] = str(e)
    
    return result


def create_video_thumbnail(video_path: str, upload_dir: str) -> Optional[str]:
    """Create thumbnail for video file"""
    try:
        import cv2
        cap = cv2.VideoCapture(video_path)
        ret, frame = cap.read()
        if ret:
            thumbnail_filename = os.path.basename(video_path).rsplit('.', 1)[0] + '_thumb.jpg'
            thumbnail_path = os.path.join(upload_dir, thumbnail_filename)
            cv2.imwrite(thumbnail_path, frame)
            cap.release()
            return f"/static/uploads/posts/{thumbnail_filename}"
        cap.release()
    except Exception as e:
        print(f"Error creating thumbnail: {e}")
    return None


def upload_avatar(file: FileStorage, upload_dir: str = None) -> Dict[str, Any]:
    """Upload avatar to Cloudinary or local storage"""
    cloudinary_config = get_cloudinary_config()
    if cloudinary_config.CLOUDINARY_ENABLED:
        return upload_media(file, "image", upload_dir=upload_dir, use_cloudinary=True)
    else:
        return upload_media(file, "image", upload_dir=upload_dir, use_cloudinary=False)


def upload_story(file: FileStorage, file_type: str = "image", upload_dir: str = None) -> Dict[str, Any]:
    """Upload story to Cloudinary or local storage"""
    cloudinary_config = get_cloudinary_config()
    if cloudinary_config.CLOUDINARY_ENABLED:
        # Save to temp file first
        temp_dir = tempfile.gettempdir()
        temp_path = os.path.join(temp_dir, secure_filename(file.filename))
        file.save(temp_path)
        
        try:
            from app.cloudinary_storage import upload_file
            upload_result = upload_file(temp_path, file_type, cloudinary_config.CLOUDINARY_STORIES_FOLDER)
            
            if upload_result and upload_result.get('success'):
                return {
                    'success': True,
                    'url': upload_result['url'],
                    'public_id': upload_result.get('public_id'),
                    'thumbnail': upload_result.get('thumbnail'),
                    'filename': file.filename,
                    'type': file_type
                }
            else:
                # Fallback to local
                return upload_media(file, file_type, upload_dir, use_cloudinary=False)
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)
    else:
        return upload_media(file, file_type, upload_dir, use_cloudinary=False)


def upload_chat_media(file: FileStorage, file_type: str = "image", upload_dir: str = None) -> Dict[str, Any]:
    """Upload chat media (image/file) to Cloudinary or local storage"""
    cloudinary_config = get_cloudinary_config()
    if cloudinary_config.CLOUDINARY_ENABLED:
        # Save to temp file first
        temp_dir = tempfile.gettempdir()
        temp_path = os.path.join(temp_dir, secure_filename(file.filename))
        file.save(temp_path)
        
        try:
            from app.cloudinary_storage import upload_file
            # Use posts folder for chat media or create a separate one
            folder = cloudinary_config.CLOUDINARY_POSTS_FOLDER  # Can change to separate folder if needed
            upload_result = upload_file(temp_path, file_type, folder)
            
            if upload_result and upload_result.get('success'):
                return {
                    'success': True,
                    'url': upload_result['url'],
                    'thumbnail_url': upload_result.get('thumbnail'),  # For video thumbnail
                    'public_id': upload_result.get('public_id'),
                    'filename': file.filename,
                    'type': file_type
                }
            else:
                # Fallback to local
                return upload_media(file, file_type, upload_dir, use_cloudinary=False)
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)
    else:
        return upload_media(file, file_type, upload_dir, use_cloudinary=False)


def process_chat_file(file: FileStorage, upload_dir: str = None) -> Dict[str, Any]:
    """Process chat file (image or video) and return media info"""
    if not file or not file.filename:
        return {'success': False, 'error': 'No file'}
    
    # Determine file type
    file_ext = file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else ''
    
    if file_ext in ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']:
        file_type = 'image'
    elif file_ext in ['mp4', 'mov', 'avi', 'mkv', 'webm']:
        file_type = 'video'
    else:
        if file.content_type and file.content_type.startswith('video/'):
            file_type = 'video'
        elif file.content_type and file.content_type.startswith('image/'):
            file_type = 'image'
        else:
            return {'success': False, 'error': 'Unknown file type'}
    
    # Check file size - unlimited for video, 10MB for images
    if file_type == 'image':
        max_size = 10 * 1024 * 1024  # 10MB limit for images
        file_content = file.read()
        if len(file_content) > max_size:
            file.seek(0)
            return {'success': False, 'error': 'File too large'}
        file.seek(0)
    
    # Upload
    return upload_chat_media(file, file_type, upload_dir)


def process_media_files(files: List[FileStorage], upload_dir: str = None,
                        use_cloudinary: bool = None) -> List[Dict]:
    """
    Process multiple media files
    
    Args:
        files: List of FileStorage objects
        upload_dir: Local upload directory
        use_cloudinary: Force using Cloudinary
    
    Returns:
        List of media info dicts
    """
    media_urls = []
    
    for file in files:
        if file and file.filename:
            # Determine file type
            file_ext = file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else ''
            
            if file_ext in ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']:
                file_type = 'image'
            elif file_ext in ['mp4', 'mov', 'avi', 'mkv', 'webm']:
                file_type = 'video'
            else:
                # Check MIME type
                if file.content_type and file.content_type.startswith('video/'):
                    file_type = 'video'
                elif file.content_type and file.content_type.startswith('image/'):
                    file_type = 'image'
                else:
                    print(f"⚠️ Unknown file type: {file_ext}")
                    continue
            
            # Check file size - unlimited for video, 10MB for images
            if file_type == 'image':
                max_size = 10 * 1024 * 1024  # 10MB limit for images only
                file_content = file.read()
                if len(file_content) > max_size:
                    print(f"⚠️ File too large: {file.filename}")
                    file.seek(0)
                    continue
                file.seek(0)
            
            # Upload file
            result = upload_media(file, file_type, upload_dir=upload_dir, use_cloudinary=use_cloudinary)
            
            if result['success']:
                media_info = {
                    'url': result['url'],
                    'type': result['type'],
                    'filename': result['filename']
                }
                
                if result.get('thumbnail'):
                    media_info['thumbnail'] = result['thumbnail']
                
                if result.get('public_id'):
                    media_info['public_id'] = result['public_id']
                
                media_urls.append(media_info)
            else:
                print(f"❌ Failed to upload: {file.filename}")
    
    return media_urls
