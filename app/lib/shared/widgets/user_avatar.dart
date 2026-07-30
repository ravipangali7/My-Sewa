import 'package:flutter/material.dart';

/// Circular avatar that loads [avatarUrl] or falls back to initials / person icon.
class UserAvatar extends StatelessWidget {
  final String? avatarUrl;
  final String? displayName;
  final double size;
  final Color borderColor;
  final double borderWidth;
  final Color? backgroundColor;
  final Color fallbackIconColor;

  const UserAvatar({
    super.key,
    this.avatarUrl,
    this.displayName,
    this.size = 48,
    this.borderColor = Colors.white,
    this.borderWidth = 2,
    this.backgroundColor,
    this.fallbackIconColor = Colors.white,
  });

  String? get _initials {
    final name = displayName?.trim() ?? '';
    if (name.isEmpty) return null;
    final parts = name.split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return null;
    if (parts.length == 1) {
      return parts.first.substring(0, 1).toUpperCase();
    }
    return (parts[0].substring(0, 1) + parts[1].substring(0, 1)).toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final hasUrl = avatarUrl != null && avatarUrl!.isNotEmpty;

    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(color: borderColor, width: borderWidth),
        color: backgroundColor ?? Colors.white.withOpacity(0.25),
      ),
      child: ClipOval(
        child: hasUrl
            ? Image.network(
                avatarUrl!,
                fit: BoxFit.cover,
                width: size,
                height: size,
                errorBuilder: (_, __, ___) => _fallback(),
                loadingBuilder: (context, child, progress) {
                  if (progress == null) return child;
                  return _fallback();
                },
              )
            : _fallback(),
      ),
    );
  }

  Widget _fallback() {
    final initials = _initials;
    return Container(
      color: backgroundColor ?? Colors.white.withOpacity(0.3),
      alignment: Alignment.center,
      child: initials != null
          ? Text(
              initials,
              style: TextStyle(
                color: fallbackIconColor,
                fontSize: size * 0.36,
                fontWeight: FontWeight.w700,
              ),
            )
          : Icon(
              Icons.person,
              color: fallbackIconColor,
              size: size * 0.55,
            ),
    );
  }
}
