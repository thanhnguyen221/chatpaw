from datetime import datetime, timezone
import pytz

def get_vietnam_timezone():
    """Trả về timezone Việt Nam (UTC+7)"""
    return pytz.timezone('Asia/Ho_Chi_Minh')

def get_vietnam_time():
    """Lấy thời gian hiện tại theo múi giờ Việt Nam (UTC+7) - trả về datetime có timezone để lưu vào MongoDB"""
    vietnam_tz = pytz.timezone('Asia/Ho_Chi_Minh')
    return datetime.now(vietnam_tz)

def format_timestamp_for_client(dt):
    """Format timestamp để gửi cho client - chuyển từ UTC sang giờ VN"""
    if not dt:
        return None
    if isinstance(dt, datetime):
        print(f"[DEBUG] format_timestamp_for_client input: {dt} (tzinfo={dt.tzinfo})")
        # Nếu có timezone, chuyển sang giờ VN rồi bỏ timezone
        if dt.tzinfo is not None:
            vn_dt = dt.astimezone(pytz.timezone('Asia/Ho_Chi_Minh'))
            result = vn_dt.replace(tzinfo=None).isoformat()
        else:
            # Nếu không có timezone, coi là UTC và chuyển sang VN
            utc_dt = pytz.utc.localize(dt)
            vn_dt = utc_dt.astimezone(pytz.timezone('Asia/Ho_Chi_Minh'))
            result = vn_dt.replace(tzinfo=None).isoformat()
        print(f"[DEBUG] format_timestamp_for_client output: {result}")
        return result
    return str(dt)