"""Admin ↔ User/Dealer Support Chat APIs."""
from __future__ import annotations

from urllib.parse import quote

from django.contrib.auth import get_user_model
from django.db import IntegrityError
from django.db.utils import OperationalError, ProgrammingError
from django.http import FileResponse, Http404
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..models import (
    SupportChatMessage,
    SupportChatReadState,
    SupportChatThread,
    _ensure_support_chat_attachment_columns,
    _ensure_support_chat_tables,
)
from ..serializers import SupportChatMessageSerializer, SupportChatThreadSerializer, support_chat_user_brief
from ..services.hierarchy import (
    admin_actors_qs,
    can_initiate_support_chat,
    can_send_support_chat,
    is_admin_actor,
    support_contacts_qs,
)
from ..services.support_chat import (
    get_or_create_admin_thread,
    mark_thread_read,
    message_preview_text,
    other_participant,
    threads_for,
    unread_count_for,
    unread_messages_qs,
    user_in_thread,
)
from ..services.support_chat_attachments import AttachmentError, validate_uploaded_file

User = get_user_model()

MAX_MESSAGE_LEN = 4000
CONTACTS_LIMIT = 50
MESSAGES_LIMIT = 200


def _chat_forbidden():
    return Response(
        {
            'error': 'You are not allowed to chat with this user.',
            'message': 'Support Chat is only between Super Admin and a User or Dealer.',
            'code': 'support_chat_forbidden',
        },
        status=status.HTTP_403_FORBIDDEN,
    )


def _ensure_chat_schema():
    _ensure_support_chat_tables()
    _ensure_support_chat_attachment_columns()


def _thread_or_404(request, thread_id):
    _ensure_chat_schema()
    try:
        thread = SupportChatThread.objects.select_related('user_low', 'user_high').get(pk=thread_id)
    except SupportChatThread.DoesNotExist:
        return None, Response(
            {'error': 'Thread not found', 'message': 'Conversation not found.', 'code': 'not_found'},
            status=status.HTTP_404_NOT_FOUND,
        )
    if not user_in_thread(thread, request.user):
        return None, _chat_forbidden()
    other = other_participant(thread, request.user)
    if not can_send_support_chat(request.user, other):
        return None, _chat_forbidden()
    return thread, None


def _unread_map(user, thread_ids):
    _ensure_chat_schema()
    if not thread_ids:
        return {}
    reads = {
        row.thread_id: row.last_read_at
        for row in SupportChatReadState.objects.filter(user=user, thread_id__in=thread_ids)
    }
    unread = {}
    for thread_id in thread_ids:
        qs = unread_messages_qs(thread_id, user)
        last_read = reads.get(thread_id)
        if last_read:
            qs = qs.filter(created_at__gt=last_read)
        unread[thread_id] = qs.count()
    return unread


def _peer_read_at(thread, viewer):
    if is_admin_actor(viewer):
        other = other_participant(thread, viewer)
        row = SupportChatReadState.objects.filter(thread=thread, user=other).first()
        return row.last_read_at if row else None
    admin_ids = list(admin_actors_qs().values_list('pk', flat=True))
    if not admin_ids:
        return None
    row = (
        SupportChatReadState.objects.filter(thread=thread, user_id__in=admin_ids)
        .order_by('-last_read_at')
        .first()
    )
    return row.last_read_at if row else None


def _serialize_message(msg, request, peer_read_at=None):
    return SupportChatMessageSerializer(
        msg,
        context={'request': request, 'peer_read_at': peer_read_at},
    ).data


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def support_chat_contacts(request):
    q = (request.query_params.get('q') or '').strip()
    qs = support_contacts_qs(request.user, q=q)[:CONTACTS_LIMIT]
    items = [support_chat_user_brief(u, request, viewer=request.user) for u in qs]
    return Response({'items': items, 'count': len(items)})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def support_chat_unread(request):
    try:
        _ensure_chat_schema()
        return Response({'count': unread_count_for(request.user)})
    except (OperationalError, ProgrammingError):
        return Response({'count': 0})


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def support_chat_threads(request):
    _ensure_chat_schema()
    if request.method == 'POST':
        raw = request.data.get('user_id')
        try:
            target_id = int(raw)
        except (TypeError, ValueError):
            return Response(
                {
                    'error': 'user_id is required',
                    'message': 'Select a user to start a conversation.',
                    'code': 'invalid_user',
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            target = User.objects.get(pk=target_id)
        except User.DoesNotExist:
            return Response(
                {'error': 'User not found', 'message': 'User not found.', 'code': 'not_found'},
                status=status.HTTP_404_NOT_FOUND,
            )
        if not can_initiate_support_chat(request.user, target):
            return _chat_forbidden()
        try:
            if is_admin_actor(request.user):
                thread = get_or_create_admin_thread(target, admin=request.user)
            else:
                thread = get_or_create_admin_thread(request.user, admin=target)
        except ValueError:
            return Response(
                {
                    'error': 'Support Chat is unavailable',
                    'message': 'No Super Admin account is available.',
                    'code': 'support_unavailable',
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        unread_map = _unread_map(request.user, [thread.pk])
        return Response(
            SupportChatThreadSerializer(
                thread,
                context={'request': request, 'actor': request.user, 'unread_map': unread_map},
            ).data,
            status=status.HTTP_200_OK,
        )

    qs = (
        threads_for(request.user)
        .select_related('user_low', 'user_high')
        .order_by('-last_message_at', '-id')
    )
    thread_ids = [t.pk for t in qs]
    unread_map = _unread_map(request.user, thread_ids)
    data = SupportChatThreadSerializer(
        qs,
        many=True,
        context={'request': request, 'actor': request.user, 'unread_map': unread_map},
    ).data
    return Response({'items': data, 'count': len(data)})


def _existing_by_nonce(thread, nonce):
    nonce = (nonce or '').strip()
    if not nonce:
        return None
    return SupportChatMessage.objects.filter(thread=thread, client_nonce=nonce).select_related('sender').first()


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def support_chat_messages(request, thread_id):
    thread, err = _thread_or_404(request, thread_id)
    if err:
        return err

    if request.method == 'POST':
        other = other_participant(thread, request.user)
        if not can_send_support_chat(request.user, other):
            return _chat_forbidden()

        nonce = (request.data.get('client_nonce') or request.data.get('nonce') or '').strip()[:64]
        existing = _existing_by_nonce(thread, nonce)
        if existing is not None:
            mark_thread_read(thread, request.user)
            return Response(_serialize_message(existing, request, _peer_read_at(thread, request.user)))

        body = (request.data.get('body') or '').strip()
        uploaded = request.FILES.get('file') or request.FILES.get('attachment')
        if not body and uploaded is None:
            return Response(
                {
                    'error': 'Message is required',
                    'message': 'Type a message or attach a file before sending.',
                    'code': 'empty_message',
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(body) > MAX_MESSAGE_LEN:
            return Response(
                {
                    'error': 'Message is too long',
                    'message': f'Message cannot exceed {MAX_MESSAGE_LEN} characters.',
                    'code': 'message_too_long',
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        meta = None
        kind = SupportChatMessage.KIND_TEXT
        if uploaded is not None:
            try:
                meta = validate_uploaded_file(uploaded)
            except AttachmentError as exc:
                return Response(
                    {'error': exc.message, 'message': exc.message, 'code': exc.code},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            kind = meta['kind']

        try:
            msg = SupportChatMessage(
                thread=thread,
                sender=request.user,
                body=body,
                kind=kind,
                client_nonce=nonce or None,
            )
            if meta is not None:
                msg.attachment = uploaded
                msg.attachment_name = meta['name']
                msg.attachment_size = meta['size']
                msg.attachment_content_type = meta['content_type']
            msg.save()
        except IntegrityError:
            existing = _existing_by_nonce(thread, nonce)
            if existing is not None:
                mark_thread_read(thread, request.user)
                return Response(_serialize_message(existing, request, _peer_read_at(thread, request.user)))
            raise

        preview = message_preview_text(kind, body, (meta or {}).get('name', ''))
        thread.last_message_at = msg.created_at
        thread.last_message_preview = preview
        thread.save(update_fields=['last_message_at', 'last_message_preview'])
        mark_thread_read(thread, request.user)
        try:
            from ..services.notifications import notify_support_chat_message
            notify_support_chat_message(msg, thread, request.user)
        except Exception:
            pass
        return Response(
            _serialize_message(msg, request, _peer_read_at(thread, request.user)),
            status=status.HTTP_201_CREATED,
        )

    qs = SupportChatMessage.objects.filter(thread=thread).select_related('sender').order_by('created_at', 'id')
    after_id = (request.query_params.get('after_id') or '').strip()
    if after_id.isdigit():
        qs = qs.filter(id__gt=int(after_id))
        items = list(qs)
    else:
        items = list(qs[max(0, qs.count() - MESSAGES_LIMIT):])
    mark_thread_read(thread, request.user)
    peer_read_at = _peer_read_at(thread, request.user)
    return Response({
        'items': SupportChatMessageSerializer(
            items,
            many=True,
            context={'request': request, 'peer_read_at': peer_read_at},
        ).data,
        'count': len(items),
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def support_chat_attachment(request, thread_id, message_id):
    thread, err = _thread_or_404(request, thread_id)
    if err:
        return err
    try:
        msg = SupportChatMessage.objects.get(pk=message_id, thread=thread)
    except SupportChatMessage.DoesNotExist:
        return Response(
            {'error': 'Attachment not found', 'message': 'File not found.', 'code': 'not_found'},
            status=status.HTTP_404_NOT_FOUND,
        )
    if not msg.attachment:
        return Response(
            {'error': 'Attachment not found', 'message': 'This message has no file.', 'code': 'not_found'},
            status=status.HTTP_404_NOT_FOUND,
        )
    try:
        handle = msg.attachment.open('rb')
    except FileNotFoundError as exc:
        raise Http404('File not found.') from exc

    filename = msg.attachment_name or 'attachment'
    content_type = msg.attachment_content_type or 'application/octet-stream'
    force_download = (request.query_params.get('download') or '').lower() in ('1', 'true', 'yes')
    inline_ok = (msg.kind in (SupportChatMessage.KIND_IMAGE, SupportChatMessage.KIND_VIDEO) or content_type == 'application/pdf')
    disposition = 'attachment' if force_download or not inline_ok else 'inline'
    ascii_name = filename.encode('ascii', 'ignore').decode().replace('"', '') or 'attachment'
    response = FileResponse(handle, content_type=content_type)
    response['Content-Disposition'] = (
        f'{disposition}; filename="{ascii_name}"; filename*=UTF-8\'\'{quote(filename)}'
    )
    response['X-Content-Type-Options'] = 'nosniff'
    response['Cache-Control'] = 'private, no-store'
    return response
