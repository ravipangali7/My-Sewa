"""Validate and classify Support Chat attachments. Files stay in private storage."""
from __future__ import annotations

import os
import re

IMAGE_EXTS = frozenset({'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp'})
VIDEO_EXTS = frozenset({'mp4', 'mov', 'webm', '3gp', 'm4v', 'avi'})
FILE_EXTS = frozenset({
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'zip', 'rar', '7z',
    'ppt', 'pptx', 'rtf', 'odt', 'ods',
})
ALLOWED_EXTS = IMAGE_EXTS | VIDEO_EXTS | FILE_EXTS

IMAGE_MAX_BYTES = 15 * 1024 * 1024
VIDEO_MAX_BYTES = 50 * 1024 * 1024
FILE_MAX_BYTES = 25 * 1024 * 1024

_SAFE_NAME_RE = re.compile(r'[^A-Za-z0-9._\- ()\[\]]+')


class AttachmentError(ValueError):
    def __init__(self, message: str, code: str = 'invalid_attachment'):
        super().__init__(message)
        self.code = code
        self.message = message


def extension_of(filename: str) -> str:
    return os.path.splitext(filename or '')[1].lower().lstrip('.')


def sanitize_filename(filename: str) -> str:
    name = os.path.basename((filename or '').replace('\\', '/')).strip()
    name = _SAFE_NAME_RE.sub('_', name).strip('._')
    if not name:
        return 'attachment'
    return name[:255]


def kind_for(filename: str, content_type: str = '') -> str:
    ext = extension_of(filename)
    if ext in IMAGE_EXTS:
        return 'image'
    if ext in VIDEO_EXTS:
        return 'video'
    if ext in FILE_EXTS:
        return 'file'
    ctype = (content_type or '').lower().split(';')[0].strip()
    if ctype.startswith('image/'):
        return 'image'
    if ctype.startswith('video/'):
        return 'video'
    return 'file'


def max_bytes_for(kind: str) -> int:
    if kind == 'image':
        return IMAGE_MAX_BYTES
    if kind == 'video':
        return VIDEO_MAX_BYTES
    return FILE_MAX_BYTES


def validate_uploaded_file(uploaded) -> dict:
    if uploaded is None:
        raise AttachmentError('Choose a file to send.', 'file_required')

    original_name = sanitize_filename(getattr(uploaded, 'name', '') or 'attachment')
    ext = extension_of(original_name)
    if ext not in ALLOWED_EXTS:
        raise AttachmentError(
            'This file type is not allowed. Send an image, video, or a document such as PDF, Word, Excel, CSV, TXT, or ZIP.',
            'file_type_not_allowed',
        )

    content_type = (getattr(uploaded, 'content_type', None) or '').split(';')[0].strip().lower()
    kind = kind_for(original_name, content_type)
    size = int(getattr(uploaded, 'size', 0) or 0)
    limit = max_bytes_for(kind)
    if size <= 0:
        raise AttachmentError('The file is empty.', 'empty_file')
    if size > limit:
        mb = limit // (1024 * 1024)
        raise AttachmentError(
            f'This {kind} is too large. Maximum size is {mb} MB.',
            'file_too_large',
        )

    if kind == 'image' and content_type and not content_type.startswith('image/') and content_type != 'application/octet-stream':
        raise AttachmentError('The file does not look like an image.', 'file_type_not_allowed')
    if kind == 'video' and content_type and not content_type.startswith('video/') and content_type != 'application/octet-stream':
        raise AttachmentError('The file does not look like a video.', 'file_type_not_allowed')

    if not content_type or content_type == 'application/octet-stream':
        content_type = {
            'image': 'image/jpeg',
            'video': 'video/mp4',
            'file': 'application/octet-stream',
        }.get(kind, 'application/octet-stream')
        guessed = {
            'png': 'image/png',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'pdf': 'application/pdf',
            'txt': 'text/plain',
            'csv': 'text/csv',
            'zip': 'application/zip',
            'mp4': 'video/mp4',
            'webm': 'video/webm',
            'mov': 'video/quicktime',
        }.get(ext)
        if guessed:
            content_type = guessed

    return {
        'kind': kind,
        'name': original_name,
        'size': size,
        'content_type': content_type,
    }
