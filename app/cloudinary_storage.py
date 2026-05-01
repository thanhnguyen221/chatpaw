"""
Cloudinary Storage Module - Handles uploading images and videos to Cloudinary
"""
import cloudinary
import cloudinary.uploader
import cloudinary.api
from typing import Optional, Dict, Any
import os

from app import cloudinary_config


def init_cloudinary():
    """Initialize Cloudinary configuration"""
    if not cloudinary_config.CLOUDINARY_ENABLED:
        return False
    
    try:
        cloudinary.config(
            cloud_name=cloudinary_config.CLOUDINARY_CLOUD_NAME,
            api_key=cloudinary_config.CLOUDINARY_API_KEY,
            api_secret=cloudinary_config.CLOUDINARY_API_SECRET,
            secure=True
        )
        print("✅ Cloudinary initialized")
        return True
    except Exception as e:
        print(f"❌ Error initializing Cloudinary: {e}")
        return False


def upload_image(file_path: str, folder: str = None, public_id: str = None) -> Optional[Dict]:
    """
    Upload an image to Cloudinary
    
    Args:
        file_path: Path to the image file
        folder: Folder in Cloudinary (e.g., 'pawtalk/posts')
        public_id: Optional custom public ID
    
    Returns:
        Dict with upload result or None if failed
    """
    try:
        upload_options = {
            "resource_type": "image",
            "folder": folder or cloudinary_config.CLOUDINARY_POSTS_FOLDER
        }
        
        if public_id:
            upload_options["public_id"] = public_id
        
        # Upload to Cloudinary
        result = cloudinary.uploader.upload(file_path, **upload_options)
        
        return {
            'success': True,
            'url': result.get('secure_url'),
            'public_id': result.get('public_id'),
            'format': result.get('format'),
            'width': result.get('width'),
            'height': result.get('height'),
            'bytes': result.get('bytes')
        }
    except Exception as e:
        print(f"❌ Cloudinary image upload error: {e}")
        return None


def upload_video(file_path: str, folder: str = None, public_id: str = None) -> Optional[Dict]:
    """
    Upload a video to Cloudinary
    
    Args:
        file_path: Path to the video file
        folder: Folder in Cloudinary
        public_id: Optional custom public ID
    
    Returns:
        Dict with upload result or None if failed
    """
    try:
        upload_options = {
            "resource_type": "video",
            "folder": folder or cloudinary_config.CLOUDINARY_POSTS_FOLDER,
            "eager": [
                {"width": 300, "height": 300, "crop": "pad", "audio_codec": "none"}  # Thumbnail
            ]
        }
        
        if public_id:
            upload_options["public_id"] = public_id
        
        # Upload to Cloudinary
        result = cloudinary.uploader.upload(file_path, **upload_options)
        
        # Get thumbnail URL from eager transformations
        thumbnail_url = None
        eager = result.get('eager', [])
        if eager:
            thumbnail_url = eager[0].get('secure_url')
        
        return {
            'success': True,
            'url': result.get('secure_url'),
            'public_id': result.get('public_id'),
            'format': result.get('format'),
            'thumbnail': thumbnail_url,
            'duration': result.get('duration'),
            'bytes': result.get('bytes')
        }
    except Exception as e:
        print(f"❌ Cloudinary video upload error: {e}")
        return None


def upload_file(file_path: str, file_type: str = "image", folder: str = None) -> Optional[Dict]:
    """
    Upload a file to Cloudinary (image or video)
    
    Args:
        file_path: Path to the file
        file_type: 'image' or 'video'
        folder: Folder in Cloudinary
    
    Returns:
        Dict with upload result or None if failed
    """
    if file_type == "image":
        return upload_image(file_path, folder)
    elif file_type == "video":
        return upload_video(file_path, folder)
    else:
        print(f"⚠️ Unsupported file type: {file_type}")
        return None


def delete_file(public_id: str, resource_type: str = "image") -> bool:
    """
    Delete a file from Cloudinary
    
    Args:
        public_id: Public ID of the file
        resource_type: 'image' or 'video'
    
    Returns:
        True if deleted successfully
    """
    try:
        result = cloudinary.uploader.destroy(public_id, resource_type=resource_type)
        return result.get('result') == 'ok'
    except Exception as e:
        print(f"❌ Cloudinary delete error: {e}")
        return False


def get_file_info(public_id: str) -> Optional[Dict]:
    """Get file information from Cloudinary"""
    try:
        result = cloudinary.api.resource(public_id)
        return result
    except Exception as e:
        print(f"❌ Cloudinary info error: {e}")
        return None
