from datetime import datetime, timezone
import pytz

def get_vietnam_time():
    """Lấy thời gian hiện tại theo múi giờ Việt Nam (UTC+7)"""
    vietnam_tz = pytz.timezone('Asia/Ho_Chi_Minh')
    # Đảm bảo trả về datetime với timezone
    return datetime.now(vietnam_tz)

def format_timestamp_for_client(dt):
    """Format timestamp để gửi cho client - đảm bảo có timezone"""
    if not dt:
        return None
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            # Nếu không có timezone, thêm timezone VN
            vietnam_tz = pytz.timezone('Asia/Ho_Chi_Minh')
            dt = vietnam_tz.localize(dt)
        return dt.isoformat()
    return str(dt)