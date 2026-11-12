import sys
import os
import requests
from bs4 import BeautifulSoup

# Nhận tham số truyền vào từ GitHub Actions
link = sys.argv[1]
code = sys.argv[2]
request_id = sys.argv[3]

# Trích xuất username từ link
username = link.rstrip('/').split('/')[-1]

# Cấu hình Firebase Realtime Database
FIREBASE_URL = "https://PROJECT_ID-default-rtdb.firebaseio.com/verifications/" + request_id + ".json"

def update_firebase(data):
    try:
        requests.put(FIREBASE_URL, json=data)
    except Exception as e:
        print("Lỗi ghi Firebase:", e)

verify_post_url = 'https://lazi.vn/p/d/926260'
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://lazi.vn/'
}

try:
    response = requests.get(verify_post_url, headers=headers, timeout=10)
    if response.status_code != 200:
        update_firebase({"status": "error", "message": "Lazi từ chối kết nối (Mã lỗi: " + str(response.status_code) + ")"})
        sys.exit(1)
        
    soup = BeautifulSoup(response.text, 'html.parser')
    comment_nodes = soup.select(".feed_block_comment_zone .comment_zone")
    
    is_verified = False
    for node in comment_nodes:
        comment_text = node.get_text()
        if code in comment_text:
            user_link = node.select_one(f'a[href*="/user/{username}"]')
            if user_link:
                is_verified = True
                break
                
    if not is_verified:
        update_firebase({"status": "error", "message": "Không tìm thấy bình luận chứa mã xác thực từ tài khoản của bạn!"})
        sys.exit(0)
        
    profile_url = f"https://lazi.vn/user/{username}"
    prof_res = requests.get(profile_url, headers=headers, timeout=10)
    prof_soup = BeautifulSoup(prof_res.text, 'html.parser')
    
    name_node = prof_soup.select_one("h1.h1_bold")
    name = name_node.get_text().strip() if name_node else username
    
    avatar_node = prof_soup.select_one(".hinh_anh_thanh_vien img")
    if avatar_node:
        avatar = avatar_node.get('src')
        if not avatar.startswith('http'):
            avatar = 'https://lazi.vn/' + avatar.lstrip('/')
    else:
        avatar = 'https://cdn.lazi.vn/system/cms/themes/mytheme/images/default_avatar.png'
        
    result_data = {
        "status": "success",
        "message": "Xác thực thành công!",
        "name": name,
        "avatar": avatar,
        "profile_link": profile_url,
        "username": username
    }
    update_firebase(result_data)

except Exception as e:
    update_firebase({"status": "error", "message": "Lỗi hệ thống: " + str(e)})
