/**
 * MemoryBox - Client Application Logic
 */

document.addEventListener('DOMContentLoaded', () => {
    // Application State
    const state = {
        isAdmin: false,
        mediaItems: [],
        filteredItems: [],
        currentFilter: 'all',
        currentLightboxIndex: -1
    };

    // DOM Elements
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const uploadQueueContainer = document.getElementById('upload-queue-container');
    const uploadQueueItems = document.getElementById('upload-queue-items');
    const queueCountBadge = document.getElementById('queue-count');
    
    const mediaGrid = document.getElementById('media-grid');
    const galleryLoader = document.getElementById('gallery-loader');
    const galleryEmpty = document.getElementById('gallery-empty');
    const filterButtons = document.querySelectorAll('.filter-btn');
    
    // Admin elements
    const adminBannerBar = document.getElementById('admin-banner-bar');
    const btnAdminTrigger = document.getElementById('btn-admin-panel-trigger');
    const btnAdminLogout = document.getElementById('btn-admin-logout');
    const btnAdminDownloadAll = document.getElementById('btn-admin-download-all');
    const modalAdminLogin = document.getElementById('modal-admin-login');
    const adminLoginForm = document.getElementById('admin-login-form');
    const adminPasswordInput = document.getElementById('admin-password');
    const loginErrorMsg = document.getElementById('login-error-msg');
    const btnCancelAdmin = document.getElementById('btn-cancel-admin');
    const btnCloseAdminModal = document.getElementById('btn-close-admin-modal');

    // QR Share elements
    const btnShareQR = document.getElementById('btn-share-qr');
    const modalQR = document.getElementById('modal-qr');
    const shareLinkInput = document.getElementById('share-link-input');
    const btnCopyLink = document.getElementById('btn-copy-link');
    const btnDownloadQR = document.getElementById('btn-download-qrcode');
    const btnCloseQRModal = document.getElementById('btn-close-qr-modal');
    const qrCodeContainer = document.getElementById('event-qrcode');

    // Lightbox elements
    const modalLightbox = document.getElementById('modal-lightbox');
    const lightboxContent = document.getElementById('lightbox-content-area');
    const lightboxFilename = document.getElementById('lightbox-filename');
    const lightboxTime = document.getElementById('lightbox-time');
    const lightboxAdminActions = document.getElementById('lightbox-admin-actions');
    const btnLightboxDownload = document.getElementById('btn-lightbox-download');
    const btnLightboxDelete = document.getElementById('btn-lightbox-delete');
    const btnCloseLightbox = document.getElementById('btn-close-lightbox');
    const btnPrevMedia = document.getElementById('btn-prev-media');
    const btnNextMedia = document.getElementById('btn-next-media');

    // QR Code instance variable
    let qrCodeInstance = null;

    /* ==========================================================================
       Initialization & Setup
       ========================================================================== */
    
    function init() {
        checkAdminStatus();
        loadMedia();
        setupEventListeners();
        setupGlobalSecurity();
    }

    /* ==========================================================================
       Global Security (Anti-Download Protection)
       ========================================================================== */
    
    function setupGlobalSecurity() {
        // 1. Disable Right-Click context menu globally on images, videos, and lightboxes
        document.addEventListener('contextmenu', (e) => {
            const target = e.target;
            if (
                !state.isAdmin && 
                (target.tagName === 'IMG' || 
                 target.tagName === 'VIDEO' || 
                 target.closest('.media-card img') || 
                 target.closest('.media-card video') || 
                 target.closest('.lightbox-content'))
            ) {
                e.preventDefault();
                showTemporaryAlert("Saving options are restricted to protect attendee privacy.");
            }
        });

        // 2. Disable dragging on images and videos (prevents drag-to-desktop/saving)
        document.addEventListener('dragstart', (e) => {
            const target = e.target;
            if (!state.isAdmin && (target.tagName === 'IMG' || target.tagName === 'VIDEO')) {
                e.preventDefault();
            }
        });

        // 3. Disable standard keyboard shortcuts (Save Page: Cmd+S / Ctrl+S, Print: Cmd+P / Ctrl+P)
        document.addEventListener('keydown', (e) => {
            if (state.isAdmin) return; // Allow admin full standard browser keys
            
            // Cmd+S / Ctrl+S
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                showTemporaryAlert("Saving is restricted on this event gallery.");
            }
            // Cmd+P / Ctrl+P
            if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
                e.preventDefault();
                showTemporaryAlert("Printing is restricted on this event gallery.");
            }
        });
    }

    // Helper for beautiful non-intrusive alert
    function showTemporaryAlert(message) {
        let alertEl = document.getElementById('security-toast');
        if (!alertEl) {
            alertEl = document.createElement('div');
            alertEl.id = 'security-toast';
            alertEl.style.position = 'fixed';
            alertEl.style.bottom = '2rem';
            alertEl.style.left = '50%';
            alertEl.style.transform = 'translateX(-50%) translateY(20px)';
            alertEl.style.background = 'rgba(255, 46, 147, 0.9)';
            alertEl.style.color = '#fff';
            alertEl.style.padding = '0.75rem 1.5rem';
            alertEl.style.borderRadius = '50px';
            alertEl.style.fontSize = '0.85rem';
            alertEl.style.fontWeight = '600';
            alertEl.style.zIndex = '9999';
            alertEl.style.boxShadow = '0 10px 25px rgba(255, 46, 147, 0.4)';
            alertEl.style.transition = 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
            alertEl.style.opacity = '0';
            document.body.appendChild(alertEl);
        }
        
        alertEl.textContent = message;
        alertEl.style.opacity = '1';
        alertEl.style.transform = 'translateX(-50%) translateY(0)';
        
        setTimeout(() => {
            alertEl.style.opacity = '0';
            alertEl.style.transform = 'translateX(-50%) translateY(20px)';
        }, 3000);
    }

    /* ==========================================================================
       Event Listeners Setup
       ========================================================================== */
    
    function setupEventListeners() {
        // Drag & Drop events
        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                dropZone.classList.add('drag-over');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                dropZone.classList.remove('drag-over');
            }, false);
        });

        dropZone.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;
            if (files.length > 0) {
                handleFilesUpload(files);
            }
        });


        fileInput.addEventListener('change', () => {
            if (fileInput.files.length > 0) {
                handleFilesUpload(fileInput.files);
            }
        });

        // Filter events
        filterButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                filterButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                state.currentFilter = btn.dataset.filter;
                applyFilter();
            });
        });

        // Modal Triggers
        btnShareQR.addEventListener('click', openQRModal);
        btnCloseQRModal.addEventListener('click', () => modalQR.classList.add('hidden'));
        modalQR.addEventListener('click', (e) => {
            if (e.target === modalQR) modalQR.classList.add('hidden');
        });

        btnCopyLink.addEventListener('click', copyShareLink);
        btnDownloadQR.addEventListener('click', downloadQRCodeImage);

        btnAdminTrigger.addEventListener('click', openAdminModal);
        btnCancelAdmin.addEventListener('click', () => modalAdminLogin.classList.add('hidden'));
        btnCloseAdminModal.addEventListener('click', () => modalAdminLogin.classList.add('hidden'));
        modalAdminLogin.addEventListener('click', (e) => {
            if (e.target === modalAdminLogin) modalAdminLogin.classList.add('hidden');
        });

        adminLoginForm.addEventListener('submit', handleAdminLogin);
        btnAdminLogout.addEventListener('click', handleAdminLogout);
        btnAdminDownloadAll.addEventListener('click', downloadAllOriginals);

        // Lightbox Navigation
        btnCloseLightbox.addEventListener('click', closeLightbox);
        modalLightbox.addEventListener('click', (e) => {
            if (e.target === modalLightbox || e.target === lightboxContent) closeLightbox();
        });

        btnPrevMedia.addEventListener('click', (e) => {
            e.stopPropagation();
            navigateLightbox(-1);
        });

        btnNextMedia.addEventListener('click', (e) => {
            e.stopPropagation();
            navigateLightbox(1);
        });

        // Keyboard Navigation in Lightbox
        document.addEventListener('keydown', (e) => {
            if (modalLightbox.classList.contains('hidden')) return;
            
            if (e.key === 'Escape') closeLightbox();
            if (e.key === 'ArrowLeft') navigateLightbox(-1);
            if (e.key === 'ArrowRight') navigateLightbox(1);
        });
    }

    /* ==========================================================================
       Media Fetching & Gallery Rendering
       ========================================================================== */
    
    async function loadMedia() {
        galleryLoader.classList.remove('hidden');
        mediaGrid.classList.add('hidden');
        galleryEmpty.classList.add('hidden');

        try {
            const response = await fetch('/api/media');
            const data = await response.json();
            
            if (data.success) {
                state.mediaItems = data.media;
                applyFilter();
            } else {
                console.error("Failed to load media:", data.error);
                showStatusEmpty();
            }
        } catch (err) {
            console.error("Network error fetching media:", err);
            showStatusEmpty();
        } finally {
            galleryLoader.classList.add('hidden');
        }
    }

    function applyFilter() {
        if (state.currentFilter === 'all') {
            state.filteredItems = state.mediaItems;
        } else {
            state.filteredItems = state.mediaItems.filter(item => item.media_type === state.currentFilter);
        }

        renderGalleryGrid();
    }

    function renderGalleryGrid() {
        mediaGrid.innerHTML = '';
        
        if (state.filteredItems.length === 0) {
            showStatusEmpty();
            return;
        }

        galleryEmpty.classList.add('hidden');
        mediaGrid.classList.remove('hidden');

        state.filteredItems.forEach((item, index) => {
            const card = document.createElement('div');
            card.className = 'media-card';
            card.dataset.id = item.id;
            card.dataset.index = index;

            // Media Element (Image or Video)
            let mediaElement;
            if (item.media_type === 'video') {
                mediaElement = document.createElement('video');
                mediaElement.src = item.url;
                mediaElement.preload = 'metadata';
                mediaElement.muted = true;
                mediaElement.playsInline = true;
                
                // Add play icon overlay for videos
                const videoOverlay = document.createElement('div');
                videoOverlay.className = 'video-overlay-badge';
                videoOverlay.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
                card.appendChild(videoOverlay);
            } else {
                mediaElement = document.createElement('img');
                mediaElement.src = item.url;
                mediaElement.alt = item.original_name;
                mediaElement.loading = 'lazy';
            }

            card.appendChild(mediaElement);

            // Card Hover Overlay Metadata
            const metaDiv = document.createElement('div');
            metaDiv.className = 'media-card-meta';
            
            const nameSpan = document.createElement('div');
            nameSpan.className = 'media-card-name';
            nameSpan.textContent = item.original_name;
            
            const timeSpan = document.createElement('div');
            timeSpan.className = 'media-card-time';
            // Clock icon + formatted timestamp
            timeSpan.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <span>${formatTimestamp(item.click_time)}</span>
            `;
            
            metaDiv.appendChild(nameSpan);
            metaDiv.appendChild(timeSpan);
            card.appendChild(metaDiv);

            // Admin Actions Overlay (Delete & Download)
            const adminDiv = document.createElement('div');
            adminDiv.className = 'media-card-admin-actions';

            // Download button (EVERYONE)
            const btnDl = document.createElement('button');
            btnDl.className = 'btn-card-action download';
            btnDl.title = 'Download';
            btnDl.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>`;

            btnDl.addEventListener('click', (e) => {
            e.stopPropagation();
            window.location.href = `/download/${item.id}`;
         });

            adminDiv.appendChild(btnDl);

            // Delete button (ADMIN ONLY)
            if (state.isAdmin) {
               const btnDel = document.createElement('button');
               btnDel.className = 'btn-card-action delete';
               btnDel.title = 'Delete Media';
               btnDel.innerHTML = `
               <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
               <polyline points="3 6 5 6 21 6"/>
               <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
               <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
               <line x1="10" y1="11" x2="10" y2="17"/>
               <line x1="14" y1="11" x2="14" y2="17"/>
               </svg>`;

               btnDel.addEventListener('click', (e) => {
                 e.stopPropagation();
                 confirmDeleteMedia(item.id, item.original_name);
               });

               adminDiv.appendChild(btnDel);
            }

            card.appendChild(adminDiv);

            // Click Card to Open Lightbox
            card.addEventListener('click', () => {
                openLightbox(index);
            });

            mediaGrid.appendChild(card);
        });
    }

    function showStatusEmpty() {
        mediaGrid.classList.add('hidden');
        galleryEmpty.classList.remove('hidden');
    }

    function formatTimestamp(timestampStr) {
        // Converts "YYYY-MM-DD HH:MM:SS" into a friendly readable format
        try {
            const date = new Date(timestampStr.replace(/-/g, '/')); // replace for cross-browser parsing
            if (isNaN(date.getTime())) return timestampStr;
            
            const options = { 
                month: 'short', 
                day: 'numeric', 
                hour: '2-digit', 
                minute: '2-digit',
                hour12: true 
            };
            return date.toLocaleString('en-US', options);
        } catch (e) {
            return timestampStr;
        }
    }

    /* ==========================================================================
       Uploading Module (Multi-File with Progress Queues)
       ========================================================================== */
    
    function handleFilesUpload(filesList) {
        uploadQueueContainer.classList.remove('hidden');
        
        let filesArray = Array.from(filesList);
        let activeUploadsCount = filesArray.length;
        let completedCount = 0;
        
        updateQueueHeader(completedCount, activeUploadsCount);

        filesArray.forEach((file) => {
            // Validate File Type
            const isImg =
            file.type.startsWith('image/') ||
            file.name.toLowerCase().endsWith('.heic') ||
            file.name.toLowerCase().endsWith('.heif') ||
            file.name.toLowerCase().endsWith('.jpg') ||
            file.name.toLowerCase().endsWith('.jpeg') ||
            file.name.toLowerCase().endsWith('.png');
            const isVid =
            file.type.startsWith('video/') ||
            file.name.toLowerCase().endsWith('.mov') ||
            file.name.toLowerCase().endsWith('.m4v') ||
            file.name.toLowerCase().endsWith('.mp4') ||
            file.name.toLowerCase().endsWith('.avi') ||
            file.name.toLowerCase().endsWith('.mkv') ||
            file.name.toLowerCase().endsWith('.webm') ||
            file.name.toLowerCase().endsWith('.3gp') ||
            file.name.toLowerCase().endsWith('.hevc');
            if (!isImg && !isVid) {
                createFailedQueueItem(file.name, "Unsupported format");
                completedCount++;
                updateQueueHeader(completedCount, activeUploadsCount);
                return;
            }

            // Validate File Size
            const maxSizeImg = 10 * 1024 * 1024; // 10MB
            const maxSizeVid = 200 * 1024 * 1024; // 200MB
            if (isImg && file.size > maxSizeImg) {
                createFailedQueueItem(file.name, "Exceeds 10MB limit");
                completedCount++;
                updateQueueHeader(completedCount, activeUploadsCount);
                return;
            }
            if (isVid && file.size > maxSizeVid) {
                createFailedQueueItem(file.name, "Exceeds 200MB limit");
                completedCount++;
                updateQueueHeader(completedCount, activeUploadsCount);
                return;
            }

            // Create Visual Queue UI
            const itemId = 'queue-' + Math.random().toString(36).substr(2, 9);
            createQueueItemUI(itemId, file.name);

            // Start Upload Process
            uploadFileXHR(file, itemId, () => {
                // Success Callback
                completedCount++;
                updateQueueHeader(completedCount, activeUploadsCount);
                checkAllUploadsDone(completedCount, activeUploadsCount);
            }, (errorMsg) => {
                // Failure Callback
                completedCount++;
                updateQueueHeader(completedCount, activeUploadsCount);
                checkAllUploadsDone(completedCount, activeUploadsCount);
            });
        });
    }

    function updateQueueHeader(completed, total) {
        queueCountBadge.textContent = `${completed} / ${total}`;
    }

    function checkAllUploadsDone(completed, total) {
    if (completed === total) {
        // Reset file input (important for mobile browsers)
        fileInput.value = "";

        setTimeout(() => {
            uploadQueueContainer.classList.add('hidden');
            uploadQueueItems.innerHTML = '';
        }, 4000);

        loadMedia();
    }
}

    function createQueueItemUI(id, name) {
        const item = document.createElement('div');
        item.className = 'queue-item';
        item.id = id;

        item.innerHTML = `
            <div class="queue-item-meta">
                <span class="queue-item-name">${name}</span>
                <span class="queue-item-status uploading" id="${id}-status">0%</span>
            </div>
            <div class="queue-progress-bar">
                <div class="queue-progress-fill" id="${id}-progress" style="width: 0%"></div>
            </div>
        `;
        uploadQueueItems.appendChild(item);
        uploadQueueItems.scrollTop = uploadQueueItems.scrollHeight;
    }

    function createFailedQueueItem(name, reason) {
        const item = document.createElement('div');
        item.className = 'queue-item';
        item.innerHTML = `
            <div class="queue-item-meta">
                <span class="queue-item-name">${name}</span>
                <span class="queue-item-status error">${reason}</span>
            </div>
            <div class="queue-progress-bar">
                <div class="queue-progress-fill" style="width: 100%; background: var(--color-danger)"></div>
            </div>
        `;
        uploadQueueItems.appendChild(item);
        uploadQueueItems.scrollTop = uploadQueueItems.scrollHeight;
    }

    function uploadFileXHR(file, elementId, onSuccess, onFailure) {
        const xhr = new XMLHttpRequest();
        const formData = new FormData();
        
        formData.append('file', file);
        // CRITICAL FOR CHRONOLOGICAL SORT: Send user's local filesystem click date
        formData.append('lastModified', file.lastModified || new Date().getTime());

        // Update progress bar
        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const percentComplete = Math.round((e.loaded / e.total) * 100);
                
                const statusLabel = document.getElementById(`${elementId}-status`);
                const progressBar = document.getElementById(`${elementId}-progress`);
                
                if (statusLabel) statusLabel.textContent = `${percentComplete}%`;
                if (progressBar) progressBar.style.width = `${percentComplete}%`;
            }
        });

        // Complete state
        xhr.addEventListener('load', () => {
            const statusLabel = document.getElementById(`${elementId}-status`);
            const progressBar = document.getElementById(`${elementId}-progress`);
            
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const res = JSON.parse(xhr.responseText);
                    if (res.success) {
                        if (statusLabel) {
                            statusLabel.textContent = 'Success';
                            statusLabel.className = 'queue-item-status success';
                        }
                        if (progressBar) progressBar.style.background = 'var(--color-success)';
                        onSuccess();
                        return;
                    }
                } catch(e) {}
            }
            
            // If we fall through, upload failed
            if (statusLabel) {
                statusLabel.textContent = 'Failed';
                statusLabel.className = 'queue-item-status error';
            }
            if (progressBar) progressBar.style.background = 'var(--color-danger)';
            onFailure('Upload failed');
        });

        xhr.addEventListener('error', () => {
            const statusLabel = document.getElementById(`${elementId}-status`);
            const progressBar = document.getElementById(`${elementId}-progress`);
            
            if (statusLabel) {
                statusLabel.textContent = 'Network Error';
                statusLabel.className = 'queue-item-status error';
            }
            if (progressBar) progressBar.style.background = 'var(--color-danger)';
            onFailure('Network error');
        });

        xhr.open('POST', '/api/upload', true);
        xhr.send(formData);
    }

    /* ==========================================================================
       QR Code & Sharing System
       ========================================================================== */
    
    function openQRModal() {
        modalQR.classList.remove('hidden');
        
        // Use active browser location to auto-route QR scans
        const activeUrl = window.location.href;
        shareLinkInput.value = activeUrl;

        // Render QR Code inside container if not already instantiated
        if (!qrCodeInstance) {
            qrCodeContainer.innerHTML = '';
            qrCodeInstance = new QRCode(qrCodeContainer, {
                text: activeUrl,
                width: 256,
                height: 256,
                colorDark: '#08060f', // Dark deep theme color matches background logo
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.H
            });
        } else {
            // Update QR text in case path changed (e.g. host changed local IP)
            qrCodeInstance.clear();
            qrCodeInstance.makeCode(activeUrl);
        }
    }

    async function copyShareLink() {
        try {
            await navigator.clipboard.writeText(shareLinkInput.value);
            
            // Feedback transition on copy button
            const originalSVG = btnCopyLink.innerHTML;
            btnCopyLink.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
            
            setTimeout(() => {
                btnCopyLink.innerHTML = originalSVG;
            }, 2000);
        } catch (err) {
            console.error("Could not copy text: ", err);
        }
    }

    function downloadQRCodeImage() {
        // Wait a tick to ensure QR library has finished rendering
        setTimeout(() => {
            const canvas = qrCodeContainer.querySelector('canvas');
            const img = qrCodeContainer.querySelector('img');

            // Best approach: draw onto a fresh canvas to get reliable data URL
            if (canvas) {
                try {
                    const downloadUrl = canvas.toDataURL('image/png');
                    const link = document.createElement('a');
                    link.href = downloadUrl;
                    link.download = 'memorybox_event_qr.png';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    return;
                } catch(e) {
                    console.warn('Canvas toDataURL failed:', e);
                }
            }

            // Fallback: use img src (for browsers rendering QR as img)
            if (img && img.src && img.src.startsWith('data:')) {
                const link = document.createElement('a');
                link.href = img.src;
                link.download = 'memorybox_event_qr.png';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                return;
            }

            // Last resort: open in new tab so user can save manually
            const fallback = canvas || img;
            if (fallback) {
                const url = canvas ? canvas.toDataURL('image/png') : img.src;
                const win = window.open();
                win.document.write('<img src="' + url + '" style="max-width:100%"><br><p>Right-click → Save Image As...</p>');
            } else {
                showTemporaryAlert('QR code not ready yet. Please wait and try again.');
            }
        }, 100);
    }

    /* ==========================================================================
       Custom Media Lightbox
       ========================================================================== */
    
    function openLightbox(index) {
        state.currentLightboxIndex = index;
        const item = state.filteredItems[index];

        modalLightbox.classList.remove('hidden');
        lightboxContent.innerHTML = '';

        // Inject media element based on type
        if (item.media_type === 'video') {
            const video = document.createElement('video');
            video.src = `/media/${item.id}`; // Always serve original file to view
            video.controls = true;
            video.autoplay = true;
            // Disable native downloads on chrome/safari
            video.setAttribute('controlsList', 'nodownload');
            video.setAttribute('oncontextmenu', 'return false;');
            
            // Add block overlay for videos (to prevent download context menu triggers)
            video.addEventListener('contextmenu', e => e.preventDefault());
            lightboxContent.appendChild(video);
        } else {
            const img = document.createElement('img');
            img.src = `/media/${item.id}`; // View original high-res in lightbox
            img.alt = item.original_name;
            // Image protection
            img.addEventListener('contextmenu', e => e.preventDefault());
            img.addEventListener('dragstart', e => e.preventDefault());
            lightboxContent.appendChild(img);
        }

        // Set metadata
        lightboxFilename.textContent = item.original_name;
        lightboxTime.textContent = `Captured: ${formatTimestamp(item.click_time)}`;

        // Display admin dashboard in lightbox footer
        if (state.isAdmin) {
            lightboxAdminActions.classList.remove('hidden');
            
            // Single download binding
            btnLightboxDownload.onclick = () => initiateAdminDownload(item.id);
            
            // Delete media binding
            btnLightboxDelete.onclick = () => confirmDeleteMedia(item.id, item.original_name, true);
        } else {
            lightboxAdminActions.classList.add('hidden');
        }

        // Toggle navigation arrows based on count
        btnPrevMedia.style.display = state.filteredItems.length > 1 ? 'flex' : 'none';
        btnNextMedia.style.display = state.filteredItems.length > 1 ? 'flex' : 'none';
    }

    function closeLightbox() {
        modalLightbox.classList.add('hidden');
        // Stop any active video playback
        const activeVideo = lightboxContent.querySelector('video');
        if (activeVideo) {
            activeVideo.pause();
            activeVideo.src = '';
        }
        lightboxContent.innerHTML = '';
        state.currentLightboxIndex = -1;
    }

    function navigateLightbox(direction) {
        if (state.filteredItems.length <= 1) return;
        
        let newIndex = state.currentLightboxIndex + direction;
        
        // Loop indexes
        if (newIndex >= state.filteredItems.length) newIndex = 0;
        if (newIndex < 0) newIndex = state.filteredItems.length - 1;
        
        openLightbox(newIndex);
    }

    /* ==========================================================================
       Admin Operations Module
       ========================================================================== */
    
    async function checkAdminStatus() {
        try {
            const response = await fetch('/api/admin/check');
            const data = await response.json();
            
            if (data.success && data.isAdmin) {
                setAdminState(true);
            } else {
                setAdminState(false);
            }
        } catch (err) {
            setAdminState(false);
        }
    }

    function setAdminState(isAdmin) {
        state.isAdmin = isAdmin;
        
        if (isAdmin) {
            adminBannerBar.classList.remove('hidden');
            btnAdminTrigger.classList.add('hidden');
        } else {
            adminBannerBar.classList.add('hidden');
            btnAdminTrigger.classList.remove('hidden');
        }
        
        // Refresh grid to draw/remove overlay admin panels
        applyFilter();
    }

    function openAdminModal() {
        adminPasswordInput.value = '';
        loginErrorMsg.classList.add('hidden');
        modalAdminLogin.classList.remove('hidden');
        adminPasswordInput.focus();
    }

    async function handleAdminLogin(e) {
        e.preventDefault();
        const password = adminPasswordInput.value;

        try {
            const response = await fetch('/api/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });
            const data = await response.json();

            if (response.ok && data.success) {
                modalAdminLogin.classList.add('hidden');
                setAdminState(true);
            } else {
                loginErrorMsg.classList.remove('hidden');
            }
        } catch (err) {
            loginErrorMsg.classList.remove('hidden');
        }
    }

    async function handleAdminLogout() {
        try {
            const response = await fetch('/api/admin/logout', { method: 'POST' });
            const data = await response.json();
            if (data.success) {
                setAdminState(false);
                closeLightbox();
            }
        } catch (err) {
            console.error("Logout failed:", err);
        }
    }

    function initiateAdminDownload(mediaId) {
        // Trigger a download by hitting the admin attachment endpoint
        window.location.href = `/api/admin/download/${mediaId}`;
    }

    function downloadAllOriginals() {
        // Trigger zipped download
        window.location.href = '/api/admin/download-all';
    }

    async function confirmDeleteMedia(mediaId, filename, isFromLightbox = false) {
        const confirmMsg = `Are you sure you want to permanently delete "${filename}"?\nThis cannot be undone.`;
        if (confirm(confirmMsg)) {
            try {
                const response = await fetch(`/api/admin/delete/${mediaId}`, { method: 'POST' });
                const data = await response.json();
                
                if (data.success) {
                    if (isFromLightbox) {
                        closeLightbox();
                    }
                    loadMedia();
                    showTemporaryAlert("Media file deleted successfully.");
                } else {
                    alert(`Failed to delete: ${data.error}`);
                }
            } catch (err) {
                console.error("Network error deleting media:", err);
                alert("Network error. Could not delete media.");
            }
        }
    }

    // Initialize the App
    init();
});
