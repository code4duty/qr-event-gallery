import os
import io
import shutil
import sqlite3
from datetime import datetime
from PIL import Image, ImageDraw
from unittest.mock import patch

# Import app configuration and init_db helper
from app import app, init_db

# Store reference to original getsize for fallback in mock
original_getsize = os.path.getsize

# Global state to specify mock size for dynamic sizing tests
CURRENT_MOCK_SIZE = None

def setup_clean_environment():
    print("Setting up clean test environment...")
    current_dir = os.path.dirname(os.path.abspath(__file__))
    
    # 1. Delete database if exists
    db_path = app.config['DATABASE']
    if os.path.exists(db_path):
        os.remove(db_path)
        print("Deleted database gallery.db")
        
    # 2. Re-initialize database
    init_db()
    
    # 3. Clean uploads and previews folders
    for folder in [app.config['UPLOAD_FOLDER'], app.config['PREVIEW_FOLDER']]:
        if os.path.exists(folder):
            shutil.rmtree(folder)
        os.makedirs(folder, exist_ok=True)
    print("Cleaned uploads and previews folders")

    # 4. Generate test JPEGs
    create_test_jpeg('test_blue.jpg', "Event Welcome Reception", (24, 20, 80), "2026:07:07 18:00:00")
    create_test_jpeg('test_magenta.jpg', "Main Concert Performance", (150, 10, 80), "2026:07:07 21:00:00")
    create_test_jpeg('test_cyan.jpg', "Late Night Afterparty", (10, 120, 140), None)

def create_test_jpeg(filename, text, color, timestamp_str):
    current_dir = os.path.dirname(os.path.abspath(__file__))
    filepath = os.path.join(current_dir, filename)
    
    img = Image.new('RGB', (800, 800), color=color)
    draw = ImageDraw.Draw(img)
    draw.text((100, 360), text, fill=(255, 255, 255), size=60)
    
    if timestamp_str:
        exif = img.getexif()
        exif[36867] = timestamp_str
        exif[306] = timestamp_str
        img.save(filepath, 'JPEG', exif=exif)
    else:
        img.save(filepath, 'JPEG')
    print(f"Created {filename} on disk (EXIF: {timestamp_str})")

def mock_getsize_side_effect(path):
    if CURRENT_MOCK_SIZE is not None:
        return CURRENT_MOCK_SIZE
    return original_getsize(path)

@patch('os.path.getsize', side_effect=mock_getsize_side_effect)
def test_app(mock_getsize_func):
    global CURRENT_MOCK_SIZE
    setup_clean_environment()
    print("\n=== STARTING BACKEND INTEGRATION TESTS ===")
    
    client = app.test_client()
    
    # 1. Test standard file uploads
    current_dir = os.path.dirname(os.path.abspath(__file__))
    test_files = [
        ('test_blue.jpg', '1719770400000'), # EXIF: 2026-07-07 18:00:00
        ('test_magenta.jpg', '1719770400000'), # EXIF: 2026-07-07 21:00:00
        ('test_cyan.jpg', '1780777920000') # No EXIF. Client ms fallback (2026-06-08)
    ]
    
    print("\nTesting POST /api/upload (Valid files)...")
    for filename, last_mod in test_files:
        filepath = os.path.join(current_dir, filename)
        with open(filepath, 'rb') as f:
            file_data = f.read()
            
        res = client.post('/api/upload', data={
            'file': (io.BytesIO(file_data), filename),
            'lastModified': last_mod
        })
        
        assert res.status_code == 200
        upload_res = res.get_json()
        assert upload_res['success'] is True
        print(f"Uploaded {filename}. Extracted click time: {upload_res['click_time']}")

    # 2. Assert Chronological Sorting order (Newest first)
    print("\nTesting GET /api/media...")
    res = client.get('/api/media')
    assert res.status_code == 200
    data = res.get_json()
    assert data['success'] is True
    
    media_list = data['media']
    print(f"Found {len(media_list)} items in feed:")
    for idx, item in enumerate(media_list):
        print(f"  {idx + 1}. Original: {item['original_name']} | Click Time: {item['click_time']}")
        
    assert len(media_list) == 3
    assert media_list[0]['original_name'] == 'test_magenta.jpg', "First element should be test_magenta"
    assert media_list[1]['original_name'] == 'test_blue.jpg', "Second element should be test_blue"
    assert media_list[2]['original_name'] == 'test_cyan.jpg', "Third element should be test_cyan"
    print("Sorting order validation passed!")

    # 3. Test File Size Constraints (Rejections)
    print("\nTesting POST /api/upload (Oversized Image - 11MB)...")
    filepath = os.path.join(current_dir, 'test_blue.jpg')
    with open(filepath, 'rb') as f:
        file_data = f.read()
        
    # Inject mock file size = 11MB
    CURRENT_MOCK_SIZE = 11 * 1024 * 1024
    res = client.post('/api/upload', data={
        'file': (io.BytesIO(file_data), 'large_image.jpg'),
        'lastModified': '1719770400000'
    })
    CURRENT_MOCK_SIZE = None # Reset mock size
    
    assert res.status_code == 400
    res_data = res.get_json()
    assert res_data['success'] is False
    assert 'exceeds 10MB' in res_data['error']
    print("Oversized Image rejection passed successfully!")

    print("\nTesting POST /api/upload (Oversized Video - 201MB)...")
    # Inject mock file size = 201MB
    CURRENT_MOCK_SIZE = 201 * 1024 * 1024
    res = client.post('/api/upload', data={
        'file': (io.BytesIO(file_data), 'large_video.mp4'),
        'lastModified': '1719770400000'
    })
    CURRENT_MOCK_SIZE = None # Reset mock size
    
    assert res.status_code == 400
    res_data = res.get_json()
    assert res_data['success'] is False
    assert 'exceeds 200MB' in res_data['error']
    print("Oversized Video rejection passed successfully!")

    # 4. Admin Auth
    print("\nTesting Admin login authentication...")
    res = client.post('/api/admin/login', json={'password': 'wrong_password'})
    assert res.status_code == 401
    
    res = client.post('/api/admin/login', json={'password': 'admin123'})
    assert res.status_code == 200
    
    # Clean up test files created on disk
    for filename, _ in test_files:
        filepath = os.path.join(current_dir, filename)
        if os.path.exists(filepath):
            os.remove(filepath)
            
    print("\n=== ALL TESTS PASSED SUCCESSFULLY! ===")

if __name__ == '__main__':
    test_app()
