import sys
import os
import cloudscraper
from bs4 import BeautifulSoup

# Nhận tham số truyền vào từ GitHub Actions
link = sys.argv[1]
code = sys.argv[2]
request_id = sys.argv[3] # ID định danh cho lần request này để lưu lên Firebase

# Trích xuất username từ link
username = link.rstrip('/').split('/')[-1]

# Cấu hình Firebase Realtime Database của dự án vex-e3600
FIREBASE_URL = f"https://vex-e3600-default-rtdb.asia-southeast1.firebasedatabase.app/verifications/{request_id}.json"

def update_firebase(data):
    try:
        # Sử dụng cloudscraper để PUT dữ liệu lên Firebase luôn cho đồng bộ
        response = cloudscraper.create_scraper().put(FIREBASE_URL, json=data)
        print("Firebase response:", response.status_code, response.text)
    except Exception as e:
        print("Lỗi ghi Firebase:", e)

# Ghép toàn bộ Cookie thật vào chuỗi để vượt mặt Cloudflare
cookie_string = (
    "g_csrf_token=da253fd399879d1a; "
    "g_state={\"i_l\":1,\"i_ll\":1794318967538,\"i_e\":{\"enable_itp_optimization\":24},\"i_et\":1794318967538}; "
    "list_chat_box=0; "
    "lazi_user_code=N7H299hGtvlFvUIIoXmQuVkVBRsu1AtBf6T6vJZ2MFstg8V6lTjhJrVyTM1eiubDaDFXhrj4n06xmv8l0%2B%2FEsg%3D%3D; "
    "PHPSESSID=qnpqs3qjgesm279smdfmojavn1; "
    "lazi_mdusermember=de2dfd62e8f232b744f03aa95a6ba2e2; "
    "status_updown=1; "
    "lazi_user_info=%7B%22username%22%3A%22tien-nam.nguyen20%22%2C%22full_name%22%3A%22Nguy%5Cu1ec5n+Ti%5Cu1ebfn+Nam%22%2C%22image%22%3A%221794147550_lazi_287766.png%22%2C%22hash%22%3A%22QkyVv9t6WeH5FX7O9jD%5C%2FR%2B4YghxJmnDWBP6oBC3L8WnfUIAGrGMyiikDcDfJolfwriTPz1kiCdn1tbStM7bMrw%3D%3D%22%7D; "
    "_ga=GA1.1.459000768.1792677885; "
    "lazi_cms=DTr%2B6JpcUsSVdV363oaPin5VBuJ3C98apWcVspK2vllY12jRL6H9tc85TTHzha2Y6%2BHNSdthypWoEKg1U93cfbpuQklKy3S%2BXsaaMc0OPa1l1Tp%2BXHa5qfiGMHdpjmBfCnsLV0myx%2B0sfibilXkNX9OaZKFWgNu1WDrZ4OxZM5KxQzkodvZUqNMAFQLLBzM6oztJgp231Je7QHKBb67yXRLZB84VhBJQ5h1sJcE1r%2BsCPQwhSbJ15L%2FfaczRadLUkegf02v7t1TwRteuGehtbJYVBwxAXzLOwoasdJHt8r67JXIdJND5jl5oPiwDu8wxc3uP76oMZbZtYgIFoBdkTejHuYVxgM7bT6S1%2Fegia7yutVUYXAxmwOPe1xc5JTm%2FlGsv9c%2ByKiWHk3UKA%2F3Ejh6dWq0mHSivVk0muXHBncF%2FofHoSPQuvvvgegAohxCubRWB4Ri4Ff%2BarJdq5BqO9kSeb7yl1PF9z1e2UR6gWYexxKsK8XoNPQffYepgkACniqGH2zBr4xwMlGv3jFUN7N7rJBlzVy1AY3T6ke3qelU%3D; "
    "arrMsgNotAnswer=; "
    "_ga_V2GPBEHMJW=GS2.1.s1793967466$o5$g1$t1793967486$j40$l0$h0; "
    "_ga_YDNG899J2F=GS2.1.s1794487184$o46$g1$t1794494682$j60$l0$h0; "
    "FCCDCF=%5Bnull%2Cnull%2Cnull%2Cnull%2Cnull%2Cnull%2C%5B%5B32%2C%22%5B%5C%22fcea348a-d04f-47a9-9664-bba2b7923426%5C%22%2C%5B1792677887%2C189000000%5D%5D%22%5D%5D%5D; "
    "FCNEC=%5B%5B%22AKsRol_wnsvkJV7IXnu_7l_zLuGrU0VzEmb72i6r1mxhvfRotG6e5-MKGc3a7cvpHIF4Ty4Muo2_w4JRzakeqXEsCxYyBoK2bQ%3D%3D%22%5D%5D; "
    "lazi_aff_referral_code=ikcri7wndu; "
    "lazi_identity=4253820; "
    "lazi_identity_code=4253820; "
    "lazi_remember_code=068bd3f8faa65f0a4910a841c81a1bcea1a8eb73; "
    "lazi_vldu=dsfky6gjHwtk10ZoAHM1PXLF97FFmKQZEwzBv8tPs%2BHMIwckNDkKbhIUw2ATcA5iuyrXwqeq7eUsOKrJUsDlibV5oNXCVQ%3D%3D2kft7ofoqn; "
    "lzc_first_visit=1"
)

# Khởi tạo cloudscraper chuyên dụng vượt Cloudflare 403
scraper = cloudscraper.create_scraper()
scraper.headers.update({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': 'https://lazi.vn/',
    'Cookie': cookie_string,
    'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="8", "Google Chrome";v="122"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1'
})

verify_post_url = 'https://lazi.vn/p/d/926260'

try:
    response = scraper.get(verify_post_url, timeout=15)
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
        
    # Cào tiếp trang cá nhân lấy tên và avatar
    profile_url = f"https://lazi.vn/user/{username}"
    prof_res = scraper.get(profile_url, timeout=15)
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
        
    # Thành công -> Đẩy data lên Firebase
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
