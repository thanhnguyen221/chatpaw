from datetime import datetime, timezone, timedelta
import pytz

def get_vietnam_timezone():
    """Trả về timezone Việt Nam (UTC+7)"""
    return pytz.timezone('Asia/Ho_Chi_Minh')

def get_vietnam_time():
    """Lấy thời gian hiện tại theo múi giờ Việt Nam (UTC+7) - trả về datetime có timezone để lưu vào MongoDB"""
    vietnam_tz = pytz.timezone('Asia/Ho_Chi_Minh')
    return datetime.now(vietnam_tz)

def format_time_friendly(dt):
    """Format thời gian thân thiện cho timeline - giống như format_time trong __init__.py"""
    if not dt:
        return None
    
    try:
        if isinstance(dt, str):
            dt = datetime.fromisoformat(dt.replace('Z', '+00:00'))
        
        # Chuyển về UTC nếu chưa có timezone
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        
        # Chuyển về giờ Việt Nam
        vietnam_tz = pytz.timezone('Asia/Ho_Chi_Minh')
        now = datetime.now(vietnam_tz)
        dt_vn = dt.astimezone(vietnam_tz)
        
        diff = now - dt_vn
        
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
            return dt_vn.strftime('%H:%M - %d/%m/%Y')
    except Exception as e:
        print(f"Format time friendly error: {e}")
        return str(dt)

def format_timestamp_for_client(dt):
    """Format timestamp để gửi cho client - xử lý timezone đúng"""
    if not dt:
        return None
    if isinstance(dt, datetime):
        # print(f"[DEBUG] format_timestamp_for_client input: {dt} (tzinfo={dt.tzinfo})")
        # Nếu có timezone, chuyển sang giờ VN rồi bỏ timezone
        if dt.tzinfo is not None:
            vn_dt = dt.astimezone(pytz.timezone('Asia/Ho_Chi_Minh'))
            result = vn_dt.replace(tzinfo=None).isoformat()
        else:
            # Không có timezone - coi là UTC và chuyển sang VN
            utc_dt = pytz.utc.localize(dt)
            vn_dt = utc_dt.astimezone(pytz.timezone('Asia/Ho_Chi_Minh'))
            result = vn_dt.replace(tzinfo=None).isoformat()
        # print(f"[DEBUG] format_timestamp_for_client output: {result}")
        return result
    return str(dt)