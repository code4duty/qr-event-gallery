import os
import io
import uuid
import sqlite3
import zipfile
import shutil
from datetime import datetime
from flask import Flask, request, jsonify, render_template, send_from_directory, session, redirect, url_for
from PIL import Image
import pillow_heif

# Cloud library imports
import cloudinary
import cloudinary.uploader
import cloudinary.utils
import psycopg2
import psycopg2.extras
import requests

# Register HEIF opener with Pillow to automatically support HEIC/HEIF images
pillow_heif.register_heif_opener()

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'event-gallery-secret-key-12984')
app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
app.config['PREVIEW_FOLDER'] = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'previews')
app.config['DATABASE'] = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'gallery.db')
app.config['ADMIN_PASSWORD'] = os.environ.get('ADMIN_PASSWORD', 'admin123')

# Enforce Request Payload Limit to slightly above the maximum video size (200MB)
app.config['MAX_CONTENT_LENGTH'] = 205 * 1024 * 1024 # 205 Megabytes

# Ensure folders exist
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(app.config['PREVIEW_FOLDER'], exist_ok=True)

# --------------------------------------------------------------------------
# Cloud Integrations Detection
# --------------------------------------------------------------------------

# Database url configuration
DATABASE_URL = os.environ.get('DATABASE_URL')

# Cloudinary configuration
CLOUDINARY_ENABLED = False
cloudinary_url = os.environ.get('CLOUDINARY_URL')
if cloudinary_url:
    try:
        # cloudinary config parses CLOUDINARY_URL automatically
        cloudinary.config()
        CLOUDINARY_ENABLED = True
        print("[INFO] Cloudinary integration enabled.")
    except Exception as e:
        print(f"[WARNING] Failed to initialize Cloudinary: {e}")

# --------------------------------------------------------------------------
# Unified Database Query Interface
# --------------------------------------------------------------------------

def query_db(query, params=(), fetchall=False, fetchone=False, commit=False):
    """
    Executes a query against either PostgreSQL (if DATABASE_URL is set)
    or the local SQLite database. Normalizes parameter placeholders
    from standard ? to PostgreSQL %s.
    """
    if DATABASE_URL:
        # Translate placeholder ? to %s for PostgreSQL
        if '?' in query:
            query = query.replace('?', '%s')
            
        conn = psycopg2.connect(DATABASE_URL)
        result = None
        try:
            with conn:
                with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                    cur.execute(query, params)
                    if fetchall:
                        result = cur.fetchall()
                    elif fetchone:
                        result = cur.fetchone()
        finally:
            conn.close()
        return result
    else:
        conn = sqlite3.connect(app.config['DATABASE'])
        conn.row_factory = sqlite3.Row
        result = None
        try:
            with conn:
                cur = conn.execute(query, params)
                if fetchall:
                    result = cur.fetchall()
                elif fetchone:
                    result = cur.fetchone()
        finally:
            conn.close()
        return result

def init_db():
    query = '''
        CREATE TABLE IF NOT EXISTS media (
            id VARCHAR(50) PRIMARY KEY,
            filename VARCHAR(255) NOT NULL,
            original_name VARCHAR(255) NOT NULL,
            file_path TEXT NOT NULL,
            preview_path TEXT,
            media_type VARCHAR(20) NOT NULL,
            click_time VARCHAR(30) NOT NULL,
            upload_time VARCHAR(30) NOT NULL
        )
    '''
    query_db(query, commit=True)
    print("[INFO] Database tables initialized.")

# Initialize database
init_db()

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def get_exif_click_time(filepath):
    try:
        with Image.open(filepath) as img:
            exif = img.getexif()
            if not exif:
                return None
            for tag_id in (36867, 36868, 306):
                if tag_id in exif:
                    val = exif[tag_id]
                    if val and isinstance(val, str):
                        try:
                            # Standard EXIF format: "YYYY:MM:DD HH:MM:SS"
                            dt = datetime.strptime(val.strip(), "%Y:%m:%d %H:%M:%S")
                            return dt.strftime("%Y-%m-%d %H:%M:%S")
                        except ValueError:
                            continue
    except Exception as e:
        print(f"[WARNING] Error reading EXIF metadata: {e}")
    return None

def is_video(filename):
    video_extensions = ('.mp4', '.mov', '.avi', '.mkv', '.webm', '.3gp', '.hevc')
    return os.path.splitext(filename.lower())[1] in video_extensions

def is_heic(filename):
    heic_extensions = ('.heic', '.heif')
    return os.path.splitext(filename.lower())[1] in heic_extensions

# --------------------------------------------------------------------------
# Routes & API Endpoints
# --------------------------------------------------------------------------

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/media', methods=['GET'])
def get_media_list():
    try:
        rows = query_db('SELECT * FROM media ORDER BY click_time DESC, upload_time DESC', fetchall=True)
        
        media_list = []
        for row in rows:
            # Check preview URL
            url = None
            if row['preview_path']:
                # If preview_path is a full cloud URL, use it, else make dynamic local preview path
                url = row['preview_path'] if row['preview_path'].startswith('http') else f"/static/previews/{os.path.basename(row['preview_path'])}"
            else:
                # If file_path is cloud URL, use it, else serve via media endpoint
                url = row['file_path'] if row['file_path'].startswith('http') else f"/media/{row['id']}"

            media_list.append({
                'id': row['id'],
                'filename': row['filename'],
                'original_name': row['original_name'],
                'media_type': row['media_type'],
                'click_time': row['click_time'],
                'upload_time': row['upload_time'],
                'has_preview': bool(row['preview_path']),
                'url': url
            })
        
        return jsonify({'success': True, 'media': media_list})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/media/<media_id>', methods=['GET'])
def serve_media(media_id):
    row = query_db('SELECT * FROM media WHERE id = ?', (media_id,), fetchone=True)
    if not row:
        return "File not found", 404
    
    # If the file path is a cloud URL, redirect to it
    if row['file_path'].startswith('http'):
        return redirect(row['file_path'])
        
    filename = os.path.basename(row['file_path'])
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@app.route('/api/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': 'No file part in request'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'success': False, 'error': 'No file selected'}), 400
        
    client_last_modified_ms = request.form.get('lastModified')
    file_id = str(uuid.uuid4())
    _, file_ext = os.path.splitext(file.filename)
    unique_filename = f"{file_id}{file_ext}"
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
    
    try:
        # Save file locally temporarily to parse size and metadata
        file.save(filepath)
        print("=" * 60)
        print("NEW UPLOAD")
        print("Filename :", file.filename)
        print("Content-Type :", file.content_type)
        print("User-Agent :", request.headers.get("User-Agent"))
        print("File Size :", os.path.getsize(filepath))
        print("=" * 60)
        # Enforce size limits on the backend
        file_size = os.path.getsize(filepath)
        media_type = 'video' if is_video(file.filename) else 'image'
        
        if media_type == 'image' and file_size > 10 * 1024 * 1024:
            os.remove(filepath)
            return jsonify({'success': False, 'error': 'Image size exceeds 10MB limit'}), 400
            
        if media_type == 'video' and file_size > 200 * 1024 * 1024:
            os.remove(filepath)
            return jsonify({'success': False, 'error': 'Video size exceeds 200MB limit'}), 400

        # Processing and Timestamps
        click_time = None
        preview_path = None
        upload_time_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        # Extract Exif click time
        if media_type == 'image':
            click_time = get_exif_click_time(filepath)

        # Fallback timestamps
        if not click_time:
            if client_last_modified_ms:
                try:
                    ts = int(client_last_modified_ms) / 1000.0
                    click_time = datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")
                except (ValueError, TypeError):
                    pass
            if not click_time:
                click_time = upload_time_str

        # Final Storage Destination (Cloud or Local)
        db_file_path = filepath
        db_preview_path = None
        
        if CLOUDINARY_ENABLED:
            print(f"[INFO] Uploading {file.filename} to Cloudinary...")
            # Upload to Cloudinary
        if media_type == 'video' and file_size > 100 * 1024 * 1024:
            upload_result = cloudinary.uploader.upload_large(
               filepath,
               resource_type="video",
               folder="event_gallery",
               public_id=file_id,
               chunk_size=6_000_000
            )
       else:
           upload_result = cloudinary.uploader.upload(
              filepath,
              resource_type=media_type,
              folder="event_gallery",
              public_id=file_id
            )
            
            db_file_path = upload_result.get('secure_url')
            
            # If HEIC, Cloudinary auto-converts to JPEG preview with URL configuration
            if media_type == 'image' and is_heic(file.filename):
                db_preview_path, _ = cloudinary.utils.cloudinary_url(
                    f"event_gallery/{file_id}",
                    format="jpg",
                    secure=True
                )
            
            # Clean up the local temp file
            os.remove(filepath)
        else:
            # Local Storage Mode
            if media_type == 'image' and is_heic(file.filename):
                preview_filename = f"{file_id}.jpg"
                preview_filepath = os.path.join(app.config['PREVIEW_FOLDER'], preview_filename)
                try:
                    with Image.open(filepath) as img:
                        if img.mode != 'RGB':
                            img_rgb = img.convert('RGB')
                            img_rgb.save(preview_filepath, 'JPEG', quality=85)
                        else:
                            img.save(preview_filepath, 'JPEG', quality=85)
                        db_preview_path = preview_filepath
                except Exception as ex:
                    print(f"[WARNING] Error generating local HEIC preview: {ex}")

        # Insert metadata into Database
        query_db('''
            INSERT INTO media (id, filename, original_name, file_path, preview_path, media_type, click_time, upload_time)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            file_id,
            unique_filename,
            file.filename,
            db_file_path,
            db_preview_path,
            media_type,
            click_time,
            upload_time_str
        ), commit=True)
            
        return jsonify({
            'success': True,
            'id': file_id,
            'filename': unique_filename,
            'original_name': file.filename,
            'media_type': media_type,
            'click_time': click_time
        })
        
    except Exception as e:
        if not CLOUDINARY_ENABLED and os.path.exists(filepath):
            try:
                os.remove(filepath)
            except Exception:
                pass
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/admin/login', methods=['POST'])
def admin_login():
    data = request.get_json() or {}
    password = data.get('password')
    if password == app.config['ADMIN_PASSWORD']:
        session['is_admin'] = True
        return jsonify({'success': True, 'message': 'Logged in successfully'})
    return jsonify({'success': False, 'error': 'Invalid password'}), 401

@app.route('/api/admin/logout', methods=['POST'])
def admin_logout():
    session.pop('is_admin', None)
    return jsonify({'success': True, 'message': 'Logged out successfully'})

@app.route('/api/admin/check', methods=['GET'])
def admin_check():
    is_admin = session.get('is_admin', False)
    return jsonify({'success': True, 'isAdmin': is_admin})
@app.route('/download/<media_id>', methods=['GET'])
def public_download(media_id):
    row = query_db('SELECT * FROM media WHERE id = ?', (media_id,), fetchone=True)

    if not row:
        return "File not found", 404

    file_path = row['file_path']

    # Cloudinary
    if file_path.startswith('http'):
        r = requests.get(file_path, stream=True)
        response = app.response_class(
            r.iter_content(chunk_size=10240),
            headers=dict(r.headers)
        )
        response.headers['Content-Disposition'] = (
            f'attachment; filename="{row["original_name"]}"'
        )
        return response

    # Local storage
    filename = os.path.basename(file_path)

    return send_from_directory(
        app.config['UPLOAD_FOLDER'],
        filename,
        as_attachment=True,
        download_name=row['original_name']
    )
@app.route('/api/admin/download/<media_id>', methods=['GET'])
def admin_download(media_id):
    if not session.get('is_admin', False):
        return jsonify({'success': False, 'error': 'Unauthorized'}), 403
        
    row = query_db('SELECT * FROM media WHERE id = ?', (media_id,), fetchone=True)
    if not row:
        return "File not found", 404
        
    file_path = row['file_path']
    
    # If the file is in Cloudinary, download and stream it
    if file_path.startswith('http'):
        r = requests.get(file_path, stream=True)
        response = app.response_class(r.iter_content(chunk_size=10240), headers=dict(r.headers))
        response.headers['Content-Disposition'] = f'attachment; filename="{row["original_name"]}"'
        return response
    else:
        # Local download
        filename = os.path.basename(file_path)
        return send_from_directory(
            app.config['UPLOAD_FOLDER'],
            filename,
            as_attachment=True,
            download_name=row['original_name']
        )

@app.route('/api/admin/download-all', methods=['GET'])
def admin_download_all():
    if not session.get('is_admin', False):
        return jsonify({'success': False, 'error': 'Unauthorized'}), 403
        
    try:
        rows = query_db('SELECT * FROM media', fetchall=True)
        if not rows:
            return jsonify({'success': False, 'error': 'No media uploaded yet'}), 400
            
        zip_path = os.path.join(os.path.dirname(app.config['UPLOAD_FOLDER']), 'event_media.zip')
        
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            added_names = {}
            for row in rows:
                orig_name = row['original_name']
                base, ext = os.path.splitext(orig_name)
                count = added_names.get(orig_name, 0)
                if count > 0:
                    zip_filename = f"{base}_{count}{ext}"
                    added_names[orig_name] += 1
                else:
                    zip_filename = orig_name
                    added_names[orig_name] = 1
                
                # Fetch file content
                file_path = row['file_path']
                if file_path.startswith('http'):
                    # Stream file from Cloudinary and write to zip
                    r = requests.get(file_path)
                    if r.status_code == 200:
                        zipf.writestr(zip_filename, r.content)
                else:
                    # Write local file
                    if os.path.exists(file_path):
                        zipf.write(file_path, arcname=zip_filename)
        
        @request.after_this_request
        def remove_file(response):
            try:
                os.remove(zip_path)
            except Exception as e:
                print(f"[WARNING] Error deleting temp zip: {e}")
            return response
            
        return send_from_directory(
            os.path.dirname(app.config['UPLOAD_FOLDER']),
            'event_media.zip',
            as_attachment=True,
            download_name=f"event_media_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
        )
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/admin/delete/<media_id>', methods=['POST'])
def admin_delete(media_id):
    if not session.get('is_admin', False):
        return jsonify({'success': False, 'error': 'Unauthorized'}), 403
        
    try:
        row = query_db('SELECT * FROM media WHERE id = ?', (media_id,), fetchone=True)
        if not row:
            return jsonify({'success': False, 'error': 'Media item not found'}), 404
            
        file_path = row['file_path']
        preview_path = row['preview_path']
        
        # 1. Delete from Cloudinary if enabled
        if file_path.startswith('http') and CLOUDINARY_ENABLED:
            res_type = "video" if row['media_type'] == 'video' else "image"
            try:
                cloudinary.uploader.destroy(f"event_gallery/{media_id}", resource_type=res_type)
            except Exception as e:
                print(f"[WARNING] Failed to destroy asset on Cloudinary: {e}")
        else:
            # Delete local files
            if os.path.exists(file_path):
                os.remove(file_path)
            if preview_path and os.path.exists(preview_path):
                os.remove(preview_path)
            
        # 2. Delete from DB
        query_db('DELETE FROM media WHERE id = ?', (media_id,), commit=True)
            
        return jsonify({'success': True, 'message': 'Media deleted successfully'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# Error Handler for Payload Too Large (Flask automatic block)
@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'success': False, 'error': 'Uploaded file exceeds overall network limit (200MB)'}), 413

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True)
