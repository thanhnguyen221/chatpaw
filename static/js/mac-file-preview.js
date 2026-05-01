/**
 * macOS Style File Preview Module
 * Xử lý xem trước file giống macOS Quick Look
 * Hỗ trợ: PDF, Word, Excel, PowerPoint, TXT, Images, Videos
 */

class MacFilePreview {
  constructor() {
    this.overlay = null;
    this.container = null;
    this.currentFile = null;
    this.isOpen = false;
    
    // File type configurations
    this.fileTypes = {
      // Documents
      'pdf': { icon: 'fa-file-pdf', class: 'pdf', name: 'PDF Document' },
      'doc': { icon: 'fa-file-word', class: 'word', name: 'Word Document' },
      'docx': { icon: 'fa-file-word', class: 'word', name: 'Word Document' },
      'xls': { icon: 'fa-file-excel', class: 'excel', name: 'Excel Spreadsheet' },
      'xlsx': { icon: 'fa-file-excel', class: 'excel', name: 'Excel Spreadsheet' },
      'ppt': { icon: 'fa-file-powerpoint', class: 'powerpoint', name: 'PowerPoint Presentation' },
      'pptx': { icon: 'fa-file-powerpoint', class: 'powerpoint', name: 'PowerPoint Presentation' },
      // Text
      'txt': { icon: 'fa-file-alt', class: 'text', name: 'Text File' },
      'md': { icon: 'fa-file-alt', class: 'text', name: 'Markdown File' },
      'rtf': { icon: 'fa-file-alt', class: 'text', name: 'Rich Text' },
      // Code Files
      'js': { icon: 'fa-file-code', class: 'code', name: 'JavaScript File' },
      'jsx': { icon: 'fa-file-code', class: 'code', name: 'React JSX File' },
      'ts': { icon: 'fa-file-code', class: 'code', name: 'TypeScript File' },
      'tsx': { icon: 'fa-file-code', class: 'code', name: 'React TSX File' },
      'py': { icon: 'fa-file-code', class: 'code', name: 'Python File' },
      'html': { icon: 'fa-file-code', class: 'code', name: 'HTML File' },
      'htm': { icon: 'fa-file-code', class: 'code', name: 'HTML File' },
      'css': { icon: 'fa-file-code', class: 'code', name: 'CSS File' },
      'scss': { icon: 'fa-file-code', class: 'code', name: 'SCSS File' },
      'sass': { icon: 'fa-file-code', class: 'code', name: 'Sass File' },
      'less': { icon: 'fa-file-code', class: 'code', name: 'Less File' },
      'json': { icon: 'fa-file-code', class: 'code', name: 'JSON File' },
      'xml': { icon: 'fa-file-code', class: 'code', name: 'XML File' },
      'yaml': { icon: 'fa-file-code', class: 'code', name: 'YAML File' },
      'yml': { icon: 'fa-file-code', class: 'code', name: 'YAML File' },
      'sql': { icon: 'fa-file-code', class: 'code', name: 'SQL File' },
      'c': { icon: 'fa-file-code', class: 'code', name: 'C File' },
      'cpp': { icon: 'fa-file-code', class: 'code', name: 'C++ File' },
      'h': { icon: 'fa-file-code', class: 'code', name: 'C Header' },
      'hpp': { icon: 'fa-file-code', class: 'code', name: 'C++ Header' },
      'java': { icon: 'fa-file-code', class: 'code', name: 'Java File' },
      'cs': { icon: 'fa-file-code', class: 'code', name: 'C# File' },
      'php': { icon: 'fa-file-code', class: 'code', name: 'PHP File' },
      'rb': { icon: 'fa-file-code', class: 'code', name: 'Ruby File' },
      'go': { icon: 'fa-file-code', class: 'code', name: 'Go File' },
      'rs': { icon: 'fa-file-code', class: 'code', name: 'Rust File' },
      'swift': { icon: 'fa-file-code', class: 'code', name: 'Swift File' },
      'kt': { icon: 'fa-file-code', class: 'code', name: 'Kotlin File' },
      'kts': { icon: 'fa-file-code', class: 'code', name: 'Kotlin Script' },
      'scala': { icon: 'fa-file-code', class: 'code', name: 'Scala File' },
      'r': { icon: 'fa-file-code', class: 'code', name: 'R File' },
      'lua': { icon: 'fa-file-code', class: 'code', name: 'Lua File' },
      'dart': { icon: 'fa-file-code', class: 'code', name: 'Dart File' },
      'vue': { icon: 'fa-file-code', class: 'code', name: 'Vue File' },
      'svelte': { icon: 'fa-file-code', class: 'code', name: 'Svelte File' },
      'sh': { icon: 'fa-file-code', class: 'code', name: 'Shell Script' },
      'bash': { icon: 'fa-file-code', class: 'code', name: 'Bash Script' },
      'zsh': { icon: 'fa-file-code', class: 'code', name: 'Zsh Script' },
      'ps1': { icon: 'fa-file-code', class: 'code', name: 'PowerShell Script' },
      'dockerfile': { icon: 'fa-file-code', class: 'code', name: 'Dockerfile' },
      'gitignore': { icon: 'fa-file-code', class: 'code', name: 'Git Ignore' },
      'env': { icon: 'fa-file-code', class: 'code', name: 'Environment File' },
      'ini': { icon: 'fa-file-code', class: 'code', name: 'INI File' },
      'conf': { icon: 'fa-file-code', class: 'code', name: 'Config File' },
      'cfg': { icon: 'fa-file-code', class: 'code', name: 'Config File' },
      'properties': { icon: 'fa-file-code', class: 'code', name: 'Properties File' },
      'log': { icon: 'fa-file-code', class: 'code', name: 'Log File' },
      'csv': { icon: 'fa-file-code', class: 'code', name: 'CSV File' },
      'tsv': { icon: 'fa-file-code', class: 'code', name: 'TSV File' },
      // Images
      'jpg': { icon: 'fa-file-image', class: 'image', name: 'JPEG Image' },
      'jpeg': { icon: 'fa-file-image', class: 'image', name: 'JPEG Image' },
      'png': { icon: 'fa-file-image', class: 'image', name: 'PNG Image' },
      'gif': { icon: 'fa-file-image', class: 'image', name: 'GIF Image' },
      'webp': { icon: 'fa-file-image', class: 'image', name: 'WebP Image' },
      'svg': { icon: 'fa-file-image', class: 'image', name: 'SVG Image' },
      'ico': { icon: 'fa-file-image', class: 'image', name: 'Icon File' },
      'bmp': { icon: 'fa-file-image', class: 'image', name: 'BMP Image' },
      // Videos
      'mp4': { icon: 'fa-file-video', class: 'video', name: 'MP4 Video' },
      'mov': { icon: 'fa-file-video', class: 'video', name: 'QuickTime Video' },
      'avi': { icon: 'fa-file-video', class: 'video', name: 'AVI Video' },
      'mkv': { icon: 'fa-file-video', class: 'video', name: 'MKV Video' },
      'webm': { icon: 'fa-file-video', class: 'video', name: 'WebM Video' },
      'flv': { icon: 'fa-file-video', class: 'video', name: 'FLV Video' },
      'wmv': { icon: 'fa-file-video', class: 'video', name: 'WMV Video' },
      'm4v': { icon: 'fa-file-video', class: 'video', name: 'M4V Video' },
      '3gp': { icon: 'fa-file-video', class: 'video', name: '3GP Video' },
      // Audio
      'mp3': { icon: 'fa-file-audio', class: 'audio', name: 'MP3 Audio' },
      'wav': { icon: 'fa-file-audio', class: 'audio', name: 'WAV Audio' },
      'ogg': { icon: 'fa-file-audio', class: 'audio', name: 'OGG Audio' },
      'm4a': { icon: 'fa-file-audio', class: 'audio', name: 'M4A Audio' },
      'flac': { icon: 'fa-file-audio', class: 'audio', name: 'FLAC Audio' },
      'aac': { icon: 'fa-file-audio', class: 'audio', name: 'AAC Audio' },
      'wma': { icon: 'fa-file-audio', class: 'audio', name: 'WMA Audio' },
      // Archives
      'zip': { icon: 'fa-file-archive', class: 'archive', name: 'ZIP Archive' },
      'rar': { icon: 'fa-file-archive', class: 'archive', name: 'RAR Archive' },
      '7z': { icon: 'fa-file-archive', class: 'archive', name: '7Z Archive' },
      'tar': { icon: 'fa-file-archive', class: 'archive', name: 'TAR Archive' },
      'gz': { icon: 'fa-file-archive', class: 'archive', name: 'GZ Archive' },
      'tgz': { icon: 'fa-file-archive', class: 'archive', name: 'TGZ Archive' },
      'bz2': { icon: 'fa-file-archive', class: 'archive', name: 'BZ2 Archive' },
      'tbz2': { icon: 'fa-file-archive', class: 'archive', name: 'TBZ2 Archive' },
      'xz': { icon: 'fa-file-archive', class: 'archive', name: 'XZ Archive' },
    };
    
    this.init();
  }
  
  init() {
    // Create overlay HTML structure
    this.createOverlay();
    
    // Bind keyboard events
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });
  }
  
  createOverlay() {
    // Remove existing overlay if any
    const existing = document.getElementById('mac-file-preview');
    if (existing) existing.remove();
    
    this.overlay = document.createElement('div');
    this.overlay.id = 'mac-file-preview';
    this.overlay.className = 'mac-preview-overlay';
    this.overlay.innerHTML = `
      <div class="mac-preview-container">
        <div class="mac-preview-header">
          <div class="mac-preview-traffic-lights">
            <button class="mac-traffic-btn mac-traffic-close" title="Close"></button>
            <button class="mac-traffic-btn mac-traffic-minimize" title="Minimize"></button>
            <button class="mac-traffic-btn mac-traffic-expand" title="Full Screen"></button>
          </div>
          <div class="mac-preview-title">Preview</div>
          <div class="mac-preview-actions">
            <button class="mac-preview-btn" id="mac-preview-share" title="Share">
              <i class="fas fa-share-alt"></i>
            </button>
            <button class="mac-preview-btn" id="mac-preview-open" title="Mở file">
              <i class="fas fa-external-link-alt"></i>
            </button>
            <button class="mac-preview-btn primary" id="mac-preview-download" title="Tải xuống">
              <i class="fas fa-download"></i>
            </button>
          </div>
        </div>
        <div class="mac-preview-content" id="mac-preview-content">
          <div class="mac-preview-loading">
            <div class="mac-preview-spinner"></div>
            <div class="mac-preview-loading-text">Loading preview...</div>
          </div>
        </div>
        <div class="mac-preview-footer">
          <div class="mac-preview-toolbar">
            <button class="mac-preview-tool-btn" title="Zoom Out">
              <i class="fas fa-minus"></i>
            </button>
            <button class="mac-preview-tool-btn" title="Zoom In">
              <i class="fas fa-plus"></i>
            </button>
          </div>
          <div class="mac-preview-page-info" id="mac-preview-page-info"></div>
          <div class="mac-preview-toolbar">
            <button class="mac-preview-tool-btn" id="mac-preview-info" title="File Info">
              <i class="fas fa-info-circle"></i>
            </button>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(this.overlay);
    this.container = this.overlay.querySelector('.mac-preview-container');
    
    // Bind close button
    this.overlay.querySelector('.mac-traffic-close').addEventListener('click', () => this.close());
    this.overlay.querySelector('.mac-traffic-minimize').addEventListener('click', () => this.close());
    
    // Close on overlay click
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
    
    // Download button
    this.overlay.querySelector('#mac-preview-download').addEventListener('click', () => {
      if (this.currentFile) this.downloadFile(this.currentFile);
    });
    
    // Open file button
    this.overlay.querySelector('#mac-preview-open').addEventListener('click', () => {
      if (this.currentFile) window.open(this.currentFile.url, '_blank');
    });
    
    // Share button
    this.overlay.querySelector('#mac-preview-share').addEventListener('click', () => {
      if (this.currentFile) this.shareFile(this.currentFile);
    });
  }
  
  open(fileUrl, fileName, fileSize = null) {
    this.currentFile = { url: fileUrl, name: fileName, size: fileSize };
    
    // Update title
    const titleEl = this.overlay.querySelector('.mac-preview-title');
    titleEl.textContent = fileName;
    
    // Show overlay
    this.overlay.classList.add('active');
    this.isOpen = true;
    
    // Load content based on file type
    this.loadContent(fileUrl, fileName);
    
    // Prevent body scroll
    document.body.style.overflow = 'hidden';
  }
  
  close() {
    this.overlay.classList.remove('active');
    this.isOpen = false;
    this.currentFile = null;
    
    // Clear content after animation
    setTimeout(() => {
      const contentEl = document.getElementById('mac-preview-content');
      if (contentEl) {
        contentEl.innerHTML = `
          <div class="mac-preview-loading">
            <div class="mac-preview-spinner"></div>
            <div class="mac-preview-loading-text">Loading preview...</div>
          </div>
        `;
      }
    }, 300);
    
    // Restore body scroll
    document.body.style.overflow = '';
  }
  
  loadContent(fileUrl, fileName) {
    const contentEl = document.getElementById('mac-preview-content');
    const ext = this.getFileExtension(fileName).toLowerCase();
    const fileType = this.fileTypes[ext] || { icon: 'fa-file', class: 'default', name: 'File' };
    
    // Update page info
    const pageInfoEl = document.getElementById('mac-preview-page-info');
    if (pageInfoEl) {
      pageInfoEl.textContent = fileType.name;
    }
    
    // Check if it's a direct URL or needs special handling
    const isDirectUrl = fileUrl.startsWith('http') || fileUrl.startsWith('/static/');
    
    switch (true) {
      // PDF
      case ext === 'pdf':
        this.loadPDF(contentEl, fileUrl);
        break;
        
      // Images
      case ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext):
        this.loadImage(contentEl, fileUrl);
        break;
        
      // Videos
      case ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext):
        this.loadVideo(contentEl, fileUrl);
        break;
        
      // Audio
      case ['mp3', 'wav', 'ogg', 'm4a', 'webm'].includes(ext):
        this.loadAudio(contentEl, fileUrl);
        break;
        
      // Text files
      case ['txt', 'md', 'rtf', 'js', 'py', 'html', 'css', 'json', 'xml'].includes(ext):
        this.loadText(contentEl, fileUrl);
        break;
        
      // Archives - include more extensions
      case ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'tbz2', 'xz'].includes(ext):
        this.loadArchive(contentEl, fileUrl, fileName, fileType);
        break;
        
      // Office documents - try Microsoft Office Online Viewer
      case ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext):
        this.loadOfficeDocument(contentEl, fileUrl, fileName, fileType);
        break;
        
      // Default - show file info
      default:
        this.loadGeneric(contentEl, fileUrl, fileName, fileType);
    }
  }
  
  loadPDF(container, url) {
    // Use iframe with PDF
    const fullUrl = url.startsWith('http') ? url : window.location.origin + url;
    container.innerHTML = `
      <div class="mac-preview-pdf">
        <iframe src="${fullUrl}#toolbar=1&navpanes=0" type="application/pdf"></iframe>
      </div>
    `;
    
    // Fallback for browsers that don't support PDF iframe
    const iframe = container.querySelector('iframe');
    iframe.onerror = () => {
      container.innerHTML = `
        <div class="mac-preview-document">
          <div class="mac-preview-doc-icon pdf">
            <i class="fas fa-file-pdf"></i>
          </div>
          <div class="mac-preview-doc-info">
            <div class="mac-preview-doc-name">${this.currentFile.name}</div>
            <div class="mac-preview-doc-meta">PDF Document</div>
            <div class="mac-preview-doc-actions">
              <button class="mac-preview-btn" onclick="window.open('${fullUrl}', '_blank')" title="Mở file">
                <i class="fas fa-external-link-alt"></i>
              </button>
              <button class="mac-preview-btn primary" onclick="macPreview.downloadFile(macPreview.currentFile)" title="Tải xuống">
                <i class="fas fa-download"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    };
  }
  
  loadImage(container, url) {
    container.innerHTML = `
      <img src="${url}" alt="Preview" class="mac-preview-image" loading="lazy">
    `;
    
    const img = container.querySelector('img');
    img.onerror = () => {
      this.showError(container, 'Failed to load image');
    };
  }
  
  loadVideo(container, url) {
    const ext = this.getFileExtension(this.currentFile.name).toLowerCase();
    const mimeTypes = {
      'mp4': 'video/mp4',
      'mov': 'video/quicktime',
      'avi': 'video/x-msvideo',
      'mkv': 'video/x-matroska',
      'webm': 'video/webm'
    };
    
    container.innerHTML = `
      <div class="mac-preview-video">
        <video controls autoplay muted playsinline>
          <source src="${url}" type="${mimeTypes[ext] || 'video/mp4'}">
          Your browser does not support the video tag.
        </video>
      </div>
    `;
    
    const video = container.querySelector('video');
    video.onerror = () => {
      this.showError(container, 'Failed to load video');
    };
  }
  
  loadAudio(container, url) {
    const ext = this.getFileExtension(this.currentFile.name).toLowerCase();
    const mimeTypes = {
      'mp3': 'audio/mpeg',
      'wav': 'audio/wav',
      'ogg': 'audio/ogg',
      'm4a': 'audio/mp4'
    };
    
    container.innerHTML = `
      <div class="mac-preview-document">
        <div class="mac-preview-doc-icon audio">
          <i class="fas fa-file-audio"></i>
        </div>
        <div class="mac-preview-doc-info">
          <div class="mac-preview-doc-name">${this.currentFile.name}</div>
          <div class="mac-preview-doc-meta">Audio File</div>
          <audio controls style="width: 100%; max-width: 400px; margin-top: 20px;">
            <source src="${url}" type="${mimeTypes[ext] || 'audio/mpeg'}">
            Your browser does not support the audio tag.
          </audio>
        </div>
      </div>
    `;
  }
  
  async loadText(container, url) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch');
      
      const text = await response.text();
      // Limit text length for performance
      const limitedText = text.length > 50000 ? text.substring(0, 50000) + '\n\n[... Content truncated ...]' : text;
      
      container.innerHTML = `
        <div class="mac-preview-text-content">${this.escapeHtml(limitedText)}</div>
      `;
    } catch (error) {
      this.showError(container, 'Failed to load text file');
    }
  }
  
  loadOfficeDocument(container, url, fileName, fileType) {
    // Try Microsoft Office Online Viewer for public URLs
    const isPublicUrl = url.startsWith('http') || url.includes('cloudinary');
    const fullUrl = url.startsWith('http') ? url : window.location.origin + url;
    
    if (isPublicUrl) {
      // Use Microsoft Office Online Viewer
      const viewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(fullUrl)}`;
      
      container.innerHTML = `
        <div class="mac-preview-document" style="height: 100%; width: 100%; display: flex; flex-direction: column;">
          <iframe src="${viewerUrl}" style="width: 100%; height: 100%; border: none; flex: 1;" frameborder="0"></iframe>
        </div>
      `;
      
      // Handle iframe load error
      const iframe = container.querySelector('iframe');
      iframe.onerror = () => {
        this.showOfficeFallback(container, url, fileName, fileType);
      };
      
      // Fallback after timeout if iframe doesn't load
      setTimeout(() => {
        try {
          const iframe = container.querySelector('iframe');
          if (iframe && !iframe.contentWindow.document.body.innerHTML) {
            this.showOfficeFallback(container, url, fileName, fileType);
          }
        } catch (e) {
          // Cross-origin error means viewer is loaded but we can't access it
          // This is actually success for Microsoft viewer
        }
      }, 8000);
    } else {
      // Local URLs can't use online viewers due to CORS
      this.showOfficeFallback(container, url, fileName, fileType);
    }
  }
  
  loadArchive(container, url, fileName, fileType) {
    // Check if we have archive data from server
    const hasArchiveData = this.currentFile && this.currentFile.archiveData;
    
    if (hasArchiveData && this.currentFile.archiveData.structure) {
      // Render VS Code-style explorer
      this.renderArchiveExplorer(container, this.currentFile.archiveData);
    } else {
      // Fallback - just show download option
      container.innerHTML = `
        <div class="mac-preview-archive-fallback">
          <div class="mac-preview-doc-icon ${fileType.class}">
            <i class="fas ${fileType.icon}"></i>
          </div>
          <div class="mac-preview-doc-info">
            <div class="mac-preview-doc-name">${fileName}</div>
            <div class="mac-preview-doc-meta">${fileType.name}</div>
            <div class="mac-preview-doc-actions">
              <button class="mac-preview-btn primary" onclick="macPreview.downloadFile(macPreview.currentFile)" title="Tải xuống">
                <i class="fas fa-download"></i> Tải xuống
              </button>
            </div>
          </div>
        </div>
      `;
    }
  }
  
  renderArchiveExplorer(container, archiveData) {
    const structure = archiveData.structure;
    const stats = archiveData.stats || { total_files: 0, total_size: 0, code_files: 0 };
    
    container.innerHTML = `
      <div class="mac-preview-archive-explorer">
        <div class="archive-sidebar">
          <div class="archive-header">
            <i class="fas fa-folder-open"></i>
            <span>${structure.name}</span>
          </div>
          <div class="archive-tree" id="archive-tree"></div>
          <div class="archive-stats">
            <div class="stat-item">
              <i class="fas fa-file"></i>
              <span>${stats.total_files} files</span>
            </div>
            <div class="stat-item">
              <i class="fas fa-code"></i>
              <span>${stats.code_files} code files</span>
            </div>
            <div class="stat-item">
              <i class="fas fa-hdd"></i>
              <span>${this.formatFileSize(stats.total_size)}</span>
            </div>
          </div>
        </div>
        <div class="archive-content" id="archive-content">
          <div class="archive-welcome">
            <i class="fas fa-folder-tree"></i>
            <p>Chọn file từ sidebar để xem nội dung</p>
            <p class="archive-hint">Hoặc tải toàn bộ project xuống</p>
            <button class="mac-preview-btn primary" onclick="macPreview.downloadFile(macPreview.currentFile)">
              <i class="fas fa-download"></i> Tải project
            </button>
          </div>
        </div>
      </div>
    `;
    
    // Build tree
    const treeEl = container.querySelector('#archive-tree');
    this.buildTreeElement(treeEl, structure);
    
    // Add click handlers
    treeEl.querySelectorAll('.tree-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const path = item.dataset.path;
        const type = item.dataset.type;
        
        if (type === 'folder') {
          item.classList.toggle('expanded');
        } else {
          // Show file content
          this.showArchiveFileContent(path, archiveData);
        }
        
        // Update active state
        treeEl.querySelectorAll('.tree-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
      });
    });
  }
  
  buildTreeElement(parent, node, level = 0) {
    const item = document.createElement('div');
    item.className = `tree-item ${node.type}`;
    item.dataset.path = node.path || '';
    item.dataset.type = node.type;
    item.style.paddingLeft = `${level * 16}px`;
    
    const icon = node.type === 'folder' 
      ? '<i class="fas fa-folder"></i>' 
      : `<i class="fas ${this.getFileIcon(node.name)}"></i>`;
    
    item.innerHTML = `
      <span class="tree-icon">${icon}</span>
      <span class="tree-label">${node.name}</span>
    `;
    
    parent.appendChild(item);
    
    if (node.children && node.children.length > 0) {
      const childrenContainer = document.createElement('div');
      childrenContainer.className = 'tree-children';
      childrenContainer.style.display = 'none';
      
      node.children.forEach(child => {
        this.buildTreeElement(childrenContainer, child, level + 1);
      });
      
      parent.appendChild(childrenContainer);
      
      // Add expand/collapse functionality
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        item.classList.toggle('expanded');
        childrenContainer.style.display = childrenContainer.style.display === 'none' ? 'block' : 'none';
      });
    }
  }
  
  showArchiveFileContent(filePath, archiveData) {
    const contentEl = document.getElementById('archive-content');
    const fileInfo = archiveData.files.find(f => f.path === filePath);
    
    if (!fileInfo) return;
    
    if (fileInfo.content) {
      // Show code with syntax highlighting
      const ext = fileInfo.extension || 'txt';
      const langClass = this.getLanguageClass(ext);
      
      contentEl.innerHTML = `
        <div class="archive-file-header">
          <span class="file-path">${filePath}</span>
          <span class="file-size">${this.formatFileSize(fileInfo.size)}</span>
          <button class="mac-preview-btn" onclick="macPreview.downloadArchiveFile('${filePath}')" title="Tải file này">
            <i class="fas fa-download"></i>
          </button>
        </div>
        <div class="archive-file-content">
          <pre class="code-block ${langClass}"><code>${this.escapeHtml(fileInfo.content)}</code></pre>
        </div>
      `;
    } else {
      // Show file info for binary files
      contentEl.innerHTML = `
        <div class="archive-file-header">
          <span class="file-path">${filePath}</span>
          <span class="file-size">${this.formatFileSize(fileInfo.size)}</span>
          <button class="mac-preview-btn" onclick="macPreview.downloadArchiveFile('${filePath}')" title="Tải file này">
            <i class="fas fa-download"></i>
          </button>
        </div>
        <div class="archive-file-binary">
          <i class="fas ${this.getFileIcon(fileInfo.name)}"></i>
          <p>File nhị phân - không thể xem trước</p>
          <p class="binary-hint">Kích thước: ${this.formatFileSize(fileInfo.size)}</p>
        </div>
      `;
    }
  }
  
  downloadArchiveFile(filePath) {
    // Download individual file from archive
    // This would need server support to extract and serve individual files
    alert('Tính năng tải từng file đang được phát triển. Vui lòng tải toàn bộ archive.');
  }
  
  getLanguageClass(ext) {
    const langMap = {
      'js': 'language-javascript',
      'jsx': 'language-javascript',
      'ts': 'language-typescript',
      'tsx': 'language-typescript',
      'py': 'language-python',
      'html': 'language-html',
      'htm': 'language-html',
      'css': 'language-css',
      'scss': 'language-scss',
      'json': 'language-json',
      'xml': 'language-xml',
      'sql': 'language-sql',
      'java': 'language-java',
      'c': 'language-c',
      'cpp': 'language-cpp',
      'cs': 'language-csharp',
      'php': 'language-php',
      'rb': 'language-ruby',
      'go': 'language-go',
      'rs': 'language-rust',
      'swift': 'language-swift',
      'kt': 'language-kotlin',
      'scala': 'language-scala',
      'r': 'language-r',
      'lua': 'language-lua',
      'dart': 'language-dart',
      'vue': 'language-vue',
      'svelte': 'language-html',
      'sh': 'language-bash',
      'bash': 'language-bash',
      'md': 'language-markdown',
      'txt': 'language-text'
    };
    return langMap[ext] || 'language-text';
  }
  
  showOfficeFallback(container, url, fileName, fileType) {
    container.innerHTML = `
      <div class="mac-preview-document">
        <div class="mac-preview-doc-icon ${fileType.class}">
          <i class="fas ${fileType.icon}"></i>
        </div>
        <div class="mac-preview-doc-info">
          <div class="mac-preview-doc-name">${fileName}</div>
          <div class="mac-preview-doc-meta">${fileType.name}</div>
          <div class="mac-preview-doc-actions">
            <button class="mac-preview-btn" onclick="window.open('${url}', '_blank')" title="Mở file">
              <i class="fas fa-external-link-alt"></i>
            </button>
            <button class="mac-preview-btn primary" onclick="macPreview.downloadFile(macPreview.currentFile)" title="Tải xuống">
              <i class="fas fa-download"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }
  
  loadGeneric(container, url, fileName, fileType) {
    container.innerHTML = `
      <div class="mac-preview-document">
        <div class="mac-preview-doc-icon ${fileType.class}">
          <i class="fas ${fileType.icon}"></i>
        </div>
        <div class="mac-preview-doc-info">
          <div class="mac-preview-doc-name">${fileName}</div>
          <div class="mac-preview-doc-meta">${fileType.name}</div>
          <div class="mac-preview-doc-actions">
            <button class="mac-preview-btn" onclick="window.open('${url}', '_blank')" title="Mở file">
              <i class="fas fa-external-link-alt"></i>
            </button>
            <button class="mac-preview-btn primary" onclick="macPreview.downloadFile(macPreview.currentFile)" title="Tải xuống">
              <i class="fas fa-download"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }
  
  showError(container, message) {
    container.innerHTML = `
      <div class="mac-preview-error">
        <div class="mac-preview-error-icon">⚠️</div>
        <div class="mac-preview-error-text">${message}</div>
        <div class="mac-preview-error-hint">Try downloading the file instead</div>
      </div>
    `;
  }
  
  // Create in-chat file attachment element
  createAttachment(fileUrl, fileName, fileSize = null) {
    const ext = this.getFileExtension(fileName).toLowerCase();
    const fileType = this.fileTypes[ext] || { icon: 'fa-file', class: 'default', name: 'File' };
    const sizeStr = fileSize ? this.formatFileSize(fileSize) : '';
    
    const attachment = document.createElement('div');
    attachment.className = 'mac-file-attachment';
    attachment.innerHTML = `
      <div class="mac-file-icon ${fileType.class}">
        <i class="fas ${fileType.icon}"></i>
      </div>
      <div class="mac-file-info">
        <div class="mac-file-name">${fileName}</div>
        <div class="mac-file-meta">
          ${sizeStr}
          <span class="mac-file-preview-hint">
            <i class="fas fa-eye"></i> Click to preview
          </span>
        </div>
      </div>
      <div class="mac-file-quicklook">
        <i class="fas fa-expand"></i>
      </div>
    `;
    
    // Click to preview
    attachment.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.open(fileUrl, fileName, fileSize);
    });
    
    return attachment;
  }
  
  // Get file icon class based on filename
  getFileIconClass(fileName) {
    const ext = this.getFileExtension(fileName).toLowerCase();
    const fileType = this.fileTypes[ext];
    return fileType ? fileType.class : 'default';
  }
  
  // Get file icon based on filename
  getFileIcon(fileName) {
    const ext = this.getFileExtension(fileName).toLowerCase();
    const fileType = this.fileTypes[ext];
    return fileType ? fileType.icon : 'fa-file';
  }
  
  // Download file
  downloadFile(file) {
    const link = document.createElement('a');
    link.href = file.url;
    link.download = file.name;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
  
  // Share file
  async shareFile(file) {
    if (navigator.share) {
      try {
        await navigator.share({
          title: file.name,
          url: file.url
        });
      } catch (error) {
        console.log('Share cancelled');
      }
    } else {
      // Fallback: copy to clipboard
      try {
        await navigator.clipboard.writeText(file.url);
        alert('Link copied to clipboard!');
      } catch (error) {
        prompt('Copy this link:', file.url);
      }
    }
  }
  
  // Utility: Get file extension
  getFileExtension(filename) {
    return filename.split('.').pop() || '';
  }
  
  // Utility: Format file size
  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
  
  // Utility: Escape HTML
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Create global instance
const macPreview = new MacFilePreview();

// Export for module use
export { MacFilePreview, macPreview };

// Make available globally
window.MacFilePreview = MacFilePreview;
window.macPreview = macPreview;
