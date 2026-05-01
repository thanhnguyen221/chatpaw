"""
ZIP file handler for project/folder uploads
Extracts and analyzes ZIP contents for VS Code-style explorer display
"""
import os
import zipfile
import rarfile
import tarfile
import shutil
from pathlib import Path
from typing import Dict, List, Optional, Any
import json

# Try to import rarfile, if not available, only ZIP will work
try:
    import rarfile
    RAR_AVAILABLE = True
except ImportError:
    RAR_AVAILABLE = False

# File type icons mapping (VS Code style)
FILE_ICONS = {
    # Folders
    'folder': 'folder',
    'folder-open': 'folder-open',
    
    # Code files
    'py': 'python',
    'js': 'javascript',
    'jsx': 'react',
    'ts': 'typescript',
    'tsx': 'react_ts',
    'html': 'html',
    'htm': 'html',
    'css': 'css',
    'scss': 'sass',
    'sass': 'sass',
    'less': 'less',
    'json': 'json',
    'xml': 'xml',
    'yaml': 'yaml',
    'yml': 'yaml',
    'sql': 'sql',
    'md': 'markdown',
    'markdown': 'markdown',
    'sh': 'shell',
    'bash': 'shell',
    'zsh': 'shell',
    'c': 'c',
    'cpp': 'cpp',
    'h': 'c',
    'hpp': 'cpp',
    'java': 'java',
    'cs': 'csharp',
    'php': 'php',
    'rb': 'ruby',
    'go': 'go',
    'rs': 'rust',
    'swift': 'swift',
    'kt': 'kotlin',
    'kts': 'kotlin',
    'scala': 'scala',
    'r': 'r',
    'lua': 'lua',
    'dart': 'dart',
    'vue': 'vue',
    'svelte': 'svelte',
    
    # Web
    'dockerfile': 'docker',
    'gitignore': 'git',
    'env': 'config',
    'ini': 'config',
    'conf': 'config',
    'cfg': 'config',
    'properties': 'config',
    
    # Data
    'csv': 'csv',
    'tsv': 'csv',
    'log': 'log',
    
    # Documents
    'pdf': 'pdf',
    'doc': 'word',
    'docx': 'word',
    'xls': 'excel',
    'xlsx': 'excel',
    'ppt': 'powerpoint',
    'pptx': 'powerpoint',
    'txt': 'text',
    
    # Images
    'png': 'image',
    'jpg': 'image',
    'jpeg': 'image',
    'gif': 'image',
    'svg': 'svg',
    'ico': 'image',
    
    # Audio/Video
    'mp3': 'audio',
    'wav': 'audio',
    'mp4': 'video',
    'avi': 'video',
    'mov': 'video',
    
    # Archives
    'zip': 'zip',
    'rar': 'zip',
    '7z': 'zip',
    'tar': 'zip',
    'gz': 'zip',
    
    # Default
    'default': 'file'
}


def get_file_icon(filename: str) -> str:
    """Get VS Code-style icon for a file"""
    ext = filename.split('.')[-1].lower() if '.' in filename else ''
    return FILE_ICONS.get(ext, FILE_ICONS.get('default', 'file'))


def analyze_archive(archive_path: str, extract_dir: str) -> Dict[str, Any]:
    """
    Analyze archive contents and return structured data
    Returns: {
        'success': bool,
        'error': str (if failed),
        'structure': {
            'name': str,
            'type': 'folder',
            'path': str,
            'children': [...]
        },
        'files': [{
            'name': str,
            'path': str,
            'size': int,
            'icon': str,
            'content': str (for code files < 100KB)
        }],
        'stats': {
            'total_files': int,
            'total_size': int,
            'code_files': int
        }
    }
    """
    result = {
        'success': False,
        'error': None,
        'structure': None,
        'files': [],
        'stats': {
            'total_files': 0,
            'total_size': 0,
            'code_files': 0
        }
    }
    
    try:
        # Create extraction directory
        os.makedirs(extract_dir, exist_ok=True)
        
        # Extract archive
        if archive_path.lower().endswith('.zip'):
            with zipfile.ZipFile(archive_path, 'r') as zf:
                zf.extractall(extract_dir)
                file_list = zf.namelist()
        elif archive_path.lower().endswith('.rar') and RAR_AVAILABLE:
            with rarfile.RarFile(archive_path, 'r') as rf:
                rf.extractall(extract_dir)
                file_list = rf.namelist()
        elif archive_path.lower().endswith(('.tar', '.gz', '.tgz', '.bz2', '.tbz2')):
            with tarfile.open(archive_path, 'r:*') as tf:
                tf.extractall(extract_dir)
                file_list = tf.getnames()
        else:
            result['error'] = 'Unsupported archive format'
            return result
        
        # Build directory structure
        root_name = os.path.basename(archive_path)
        if root_name.endswith(('.zip', '.rar', '.tar', '.gz', '.tgz', '.bz2', '.tbz2')):
            root_name = root_name.rsplit('.', 1)[0]
            if root_name.endswith('.tar'):
                root_name = root_name.rsplit('.', 1)[0]
        
        structure = {
            'name': root_name or 'Project',
            'type': 'folder',
            'path': '',
            'children': []
        }
        
        # Process files
        code_extensions = {
            'py', 'js', 'jsx', 'ts', 'tsx', 'html', 'htm', 'css', 'scss', 'sass', 'less',
            'json', 'xml', 'yaml', 'yml', 'sql', 'md', 'markdown', 'sh', 'bash', 'zsh',
            'c', 'cpp', 'h', 'hpp', 'java', 'cs', 'php', 'rb', 'go', 'rs', 'swift',
            'kt', 'kts', 'scala', 'r', 'lua', 'dart', 'vue', 'svelte'
        }
        
        for item_path in file_list:
            full_path = os.path.join(extract_dir, item_path)
            
            # Skip directories and hidden files
            if item_path.endswith('/') or os.path.isdir(full_path):
                continue
            if '/.' in item_path or item_path.startswith('.'):
                continue
                
            try:
                file_size = os.path.getsize(full_path)
                file_ext = item_path.split('.')[-1].lower() if '.' in item_path else ''
                
                result['stats']['total_files'] += 1
                result['stats']['total_size'] += file_size
                
                if file_ext in code_extensions:
                    result['stats']['code_files'] += 1
                
                # Read content for code files under 100KB
                content = None
                if file_ext in code_extensions and file_size < 100 * 1024:
                    try:
                        with open(full_path, 'r', encoding='utf-8', errors='ignore') as f:
                            content = f.read()
                    except:
                        pass
                
                result['files'].append({
                    'name': os.path.basename(item_path),
                    'path': item_path,
                    'size': file_size,
                    'icon': get_file_icon(item_path),
                    'extension': file_ext,
                    'content': content
                })
            except:
                continue
        
        # Build tree structure
        def add_to_tree(tree, path_parts, file_info):
            if not path_parts:
                return
            
            name = path_parts[0]
            remaining = path_parts[1:]
            
            # Check if already exists
            existing = next((c for c in tree['children'] if c['name'] == name), None)
            
            if not remaining:
                # This is a file
                if not existing:
                    tree['children'].append({
                        'name': name,
                        'type': 'file',
                        'path': file_info['path'],
                        'size': file_info['size'],
                        'icon': file_info['icon'],
                        'extension': file_info['extension'],
                        'content': file_info['content']
                    })
            else:
                # This is a folder
                if not existing:
                    existing = {
                        'name': name,
                        'type': 'folder',
                        'path': '/'.join(path_parts[:1]),
                        'children': []
                    }
                    tree['children'].append(existing)
                add_to_tree(existing, remaining, file_info)
        
        for file_info in result['files']:
            path_parts = file_info['path'].split('/')
            # Remove empty parts and the filename itself for tree building
            if path_parts:
                add_to_tree(structure, path_parts, file_info)
        
        # Sort children (folders first, then alphabetically)
        def sort_tree(node):
            if 'children' in node:
                node['children'].sort(key=lambda x: (0 if x['type'] == 'folder' else 1, x['name'].lower()))
                for child in node['children']:
                    sort_tree(child)
        
        sort_tree(structure)
        
        result['structure'] = structure
        result['success'] = True
        
    except Exception as e:
        result['error'] = str(e)
    
    return result


def cleanup_extract_dir(extract_dir: str):
    """Clean up extracted files"""
    try:
        if os.path.exists(extract_dir):
            shutil.rmtree(extract_dir)
    except:
        pass
