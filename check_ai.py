import google.generativeai as genai

# Dán Key của bạn vào đây
GENAI_API_KEY = ""
genai.configure(api_key=GENAI_API_KEY)

print("--- ĐANG KIỂM TRA DANH SÁCH MODEL ---")
try:
    available_models = []
    for m in genai.list_models():
        # Chỉ lấy những model hỗ trợ tạo văn bản (generateContent)
        if 'generateContent' in m.supported_generation_methods:
            print(f"✅ Tìm thấy: {m.name}")
            available_models.append(m.name)
    
    if not available_models:
        print("❌ Không tìm thấy model nào! Có thể do Key hoặc Mạng.")
    else:
        print(f"\n👉 Bạn hãy copy dòng này vào code: ai_model = genai.GenerativeModel('{available_models[0].replace('models/', '')}')")

except Exception as e:
    print(f"❌ LỖI NGHIÊM TRỌNG: {e}")
