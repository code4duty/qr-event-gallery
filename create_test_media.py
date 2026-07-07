import os
from datetime import datetime
from PIL import Image, ImageDraw, ImageFont

# Define directory for saving test images
test_dir = os.path.dirname(os.path.abspath(__file__))

def create_image(filename, text, color, timestamp_str=None):
    # Create a 800x800 image
    img = Image.new('RGB', (800, 800), color=color)
    draw = ImageDraw.Draw(img)
    
    # Draw simple text
    draw.text((100, 360), text, fill=(255, 255, 255), size=60)
    draw.text((100, 440), f"Created: {timestamp_str or 'No EXIF'}", fill=(200, 200, 200), size=30)
    
    filepath = os.path.join(test_dir, filename)
    
    if timestamp_str:
        # Convert EXIF string to tags
        # EXIF Tag 36867 is DateTimeOriginal, 306 is DateTime
        exif = img.getexif()
        exif[36867] = timestamp_str
        exif[306] = timestamp_str
        img.save(filepath, 'JPEG', exif=exif)
    else:
        img.save(filepath, 'JPEG')
        
    print(f"Created {filename} with EXIF timestamp: {timestamp_str}")

if __name__ == '__main__':
    # Create test images
    create_image('test_blue.jpg', "Event Welcome reception", (24, 20, 80), "2026:07:07 18:00:00")
    create_image('test_magenta.jpg', "Main Concert Performance", (150, 10, 80), "2026:07:07 21:00:00")
    create_image('test_cyan.jpg', "Late Night Afterparty", (10, 120, 140), None) # No EXIF
