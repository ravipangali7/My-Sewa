import '../../../core/constants/app_constants.dart';

/// User model - phone number is used as username
class UserModel {
  final int id;
  final String phone;
  final String email;
  final String? firstName;
  final String? lastName;
  final String? avatarUrl;
  final String? token;

  UserModel({
    required this.id,
    required this.phone,
    required this.email,
    this.firstName,
    this.lastName,
    this.avatarUrl,
    this.token,
  });

  String get displayName {
    final name = '${firstName ?? ''} ${lastName ?? ''}'.trim();
    return name.isNotEmpty ? name : phone;
  }

  static String? _resolveAvatar(dynamic avatarUrl, dynamic avatar) {
    String? value;
    if (avatarUrl != null && avatarUrl.toString().isNotEmpty) {
      value = avatarUrl.toString();
    } else if (avatar != null && avatar.toString().isNotEmpty) {
      value = avatar.toString();
    }
    if (value == null || value.isEmpty) return null;

    if (value.startsWith('http://') || value.startsWith('https://')) {
      return value;
    }

    final base = AppConstants.baseUrl.replaceAll(RegExp(r'/$'), '');
    final path = value.startsWith('/') ? value : '/$value';
    return '$base$path';
  }

  factory UserModel.fromJson(Map<String, dynamic> json) {
    final userJson = json.containsKey('user') && json['user'] is Map
        ? json['user'] as Map<String, dynamic>
        : json;

    return UserModel(
      id: userJson['id'] ?? 0,
      phone: userJson['phone'] ?? userJson['username'] ?? '',
      email: userJson['email'] ?? '',
      firstName: userJson['first_name'],
      lastName: userJson['last_name'],
      avatarUrl: _resolveAvatar(userJson['avatar_url'], userJson['avatar']),
      token: json['token'],
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'phone': phone,
      'email': email,
      'first_name': firstName,
      'last_name': lastName,
      'avatar_url': avatarUrl,
      'token': token,
    };
  }

  UserModel copyWith({
    int? id,
    String? phone,
    String? email,
    String? firstName,
    String? lastName,
    String? avatarUrl,
    String? token,
  }) {
    return UserModel(
      id: id ?? this.id,
      phone: phone ?? this.phone,
      email: email ?? this.email,
      firstName: firstName ?? this.firstName,
      lastName: lastName ?? this.lastName,
      avatarUrl: avatarUrl ?? this.avatarUrl,
      token: token ?? this.token,
    );
  }
}
