import 'dart:convert';

/// Generic API response model
class ApiResponse<T> {
  final bool success;
  final String? message;
  final T? data;
  final List<String>? errors;

  ApiResponse({
    required this.success,
    this.message,
    this.data,
    this.errors,
  });

  factory ApiResponse.fromJson(
    dynamic json,
    T Function(dynamic)? fromJsonT, {
    bool? isSuccess,
  }) {
    // Handle List responses (direct list from backend, e.g., deposit list, topup history)
    if (json is List) {
      final bool success = isSuccess ?? true;
      return ApiResponse(
        success: success,
        data: fromJsonT != null ? fromJsonT(json) : null,
      );
    }
    
    // Handle String responses - try to parse as JSON
    if (json is String) {
      try {
        // Try to decode the string as JSON
        final decoded = jsonDecode(json);
        // Recursively call fromJson with decoded value
        return ApiResponse.fromJson(decoded, fromJsonT, isSuccess: isSuccess);
      } catch (e) {
        // If it's not valid JSON, it might be a plain string response
        // If fromJsonT expects a Map, we can't use a string
        if (fromJsonT != null) {
          // Try to wrap the string in a Map for models that expect it
          try {
            final wrappedData = {'value': json};
            return ApiResponse(
              success: isSuccess ?? false,
              message: 'Response is a string, not a JSON object',
              data: fromJsonT(wrappedData),
            );
          } catch (_) {
            // If that fails, return error
            return ApiResponse(
              success: false,
              message: 'Invalid response format: expected JSON object, got string: $json',
            );
          }
        } else {
          // If no fromJsonT, treat as error message
          return ApiResponse(
            success: false,
            message: json,
          );
        }
      }
    }
    
    // Handle Map responses
    if (json is! Map) {
      return ApiResponse(
        success: false,
        message: 'Invalid response format: expected Map or List, got ${json.runtimeType}',
      );
    }
    
    // Convert to Map<String, dynamic> safely
    Map<String, dynamic> jsonMap;
    try {
      // Handle both Map<String, dynamic> and Map<dynamic, dynamic>
      if (json is Map<String, dynamic>) {
        jsonMap = json;
      } else {
        // Convert Map<dynamic, dynamic> to Map<String, dynamic>
        jsonMap = json.cast<String, dynamic>();
      }
    } catch (e) {
      return ApiResponse(
        success: false,
        message: 'Failed to convert response to Map: ${e.toString()}',
      );
    }
    
    // Determine success: use isSuccess parameter if provided, otherwise check for Code or success fields
    final bool success = isSuccess ?? 
        (jsonMap['Code'] == '0' || jsonMap['success'] == true);
    
    // Extract data: check for Data/data fields first, then check for 'user' field (backend auth responses)
    dynamic dataJson;
    if (jsonMap['Data'] != null) {
      dataJson = jsonMap['Data'];
    } else if (jsonMap['data'] != null) {
      dataJson = jsonMap['data'];
    } else if (jsonMap['user'] != null && jsonMap['user'] is Map) {
      // Backend auth endpoints return user data in 'user' field (only if it's a Map)
      dataJson = jsonMap['user'];
      // If token is at root level, add it to the user data for UserModel parsing
      if (jsonMap['token'] != null && dataJson is Map<String, dynamic>) {
        dataJson = Map<String, dynamic>.from(dataJson);
        dataJson['token'] = jsonMap['token'];
      }
    } else if (success) {
      // If no nested data fields found and response is successful,
      // check if the JSON itself is the data (direct response from backend)
      // Only treat as data if it doesn't look like an error wrapper
      final hasErrorFields = jsonMap.containsKey('error') || 
                            jsonMap.containsKey('errors') || 
                            jsonMap.containsKey('Error') ||
                            jsonMap.containsKey('Errors') ||
                            jsonMap.containsKey('error_list');
      
      // Also check if the map looks like actual data (has fields like 'id', 'balance', etc.)
      // vs just being an error wrapper. Include 'token' for auth/password-change responses.
      final looksLikeData = jsonMap.containsKey('id') || 
                           jsonMap.containsKey('balance') ||
                           jsonMap.containsKey('phone') ||
                           jsonMap.containsKey('email') ||
                           jsonMap.containsKey('amount') ||
                           jsonMap.containsKey('status') ||
                           jsonMap.containsKey('token');
      
      if (!hasErrorFields && (looksLikeData || jsonMap.length > 2)) {
        // The entire JSON is the data (e.g., wallet/profile endpoints return data directly)
        // Ensure we're passing a Map, not a string
        dataJson = jsonMap;
      }
    }
    
    // Parse errors - handle multiple formats
    List<String>? parsedErrors;
    
    // First, check for error_list (from our formatted backend response)
    if (jsonMap['error_list'] != null && jsonMap['error_list'] is List) {
      parsedErrors = (jsonMap['error_list'] as List)
          .map((e) => e.toString())
          .cast<String>()
          .toList();
    }
    // Then check for Errors (capitalized, list format)
    else if (jsonMap['Errors'] != null && jsonMap['Errors'] is List) {
      parsedErrors = (jsonMap['Errors'] as List)
          .map((e) => e is Map ? (e['Message'] ?? e.toString()) : e.toString())
          .cast<String>()
          .toList();
    }
    // Check for errors dictionary (DRF format: {"field": ["error1", "error2"]})
    else if (jsonMap['errors'] != null) {
      if (jsonMap['errors'] is List) {
        // List format
        parsedErrors = (jsonMap['errors'] as List)
            .map((e) => e.toString())
            .cast<String>()
            .toList();
      } else if (jsonMap['errors'] is Map) {
        // Dictionary format - convert to readable messages
        final errorsMap = jsonMap['errors'] as Map<String, dynamic>;
        parsedErrors = <String>[];
        errorsMap.forEach((field, fieldErrors) {
          if (fieldErrors is List) {
            for (var error in fieldErrors) {
              final fieldName = field.replaceAll('_', ' ').split(' ').map((word) {
                if (word.isEmpty) return word;
                return word[0].toUpperCase() + word.substring(1).toLowerCase();
              }).join(' ');
              parsedErrors!.add('$fieldName: ${error.toString()}');
            }
          } else {
            final fieldName = field.replaceAll('_', ' ').split(' ').map((word) {
              if (word.isEmpty) return word;
              return word[0].toUpperCase() + word.substring(1).toLowerCase();
            }).join(' ');
            parsedErrors!.add('$fieldName: ${fieldErrors.toString()}');
          }
        });
      }
    }
    
    // Extract message with fallback priority: message > detail > error
    String? extractedMessage;
    if (jsonMap['Message'] != null) {
      extractedMessage = jsonMap['Message'].toString();
    } else if (jsonMap['message'] != null) {
      extractedMessage = jsonMap['message'].toString();
    } else if (jsonMap['detail'] != null) {
      extractedMessage = jsonMap['detail'].toString();
    } else if (jsonMap['error'] != null) {
      extractedMessage = jsonMap['error'].toString();
    }
    
    // Safely call fromJsonT with proper type checking
    T? parsedData;
    if (fromJsonT != null && dataJson != null) {
      try {
        // Ensure dataJson is the correct type for the fromJson function
        // Most models expect Map<String, dynamic>
        if (dataJson is Map) {
          // Convert to Map<String, dynamic> if needed
          Map<String, dynamic> dataMap;
          if (dataJson is Map<String, dynamic>) {
            dataMap = dataJson;
          } else {
            dataMap = dataJson.cast<String, dynamic>();
          }
          parsedData = fromJsonT(dataMap);
        } else if (dataJson is List) {
          // For list responses, pass as-is
          parsedData = fromJsonT(dataJson);
        } else if (dataJson is String) {
          // If dataJson is a string, try to parse it as JSON
          try {
            final decoded = jsonDecode(dataJson as String);
            if (decoded is Map) {
              Map<String, dynamic> decodedMap;
              if (decoded is Map<String, dynamic>) {
                decodedMap = decoded;
              } else {
                decodedMap = decoded.cast<String, dynamic>();
              }
              parsedData = fromJsonT(decodedMap);
            } else if (decoded is List) {
              parsedData = fromJsonT(decoded);
            } else {
              parsedData = null;
              if (extractedMessage == null) {
                extractedMessage = 'Invalid data format: decoded JSON is not Map or List';
              }
            }
          } catch (e) {
            // If string is not valid JSON, we can't parse it
            parsedData = null;
            if (extractedMessage == null) {
              extractedMessage = 'Invalid data format: expected Map or List, got string that is not valid JSON';
            }
          }
        } else {
          // If dataJson is not a Map, List, or String, we can't parse it
          parsedData = null;
          if (extractedMessage == null) {
            extractedMessage = 'Invalid data format: expected Map or List, got ${dataJson.runtimeType}';
          }
        }
      } catch (e, stackTrace) {
        // If parsing fails, return null data but keep success status
        // The error will be in the message
        parsedData = null;
        if (extractedMessage == null) {
          extractedMessage = 'Failed to parse data: ${e.toString()}';
        }
        // Log the error for debugging (you can remove this in production)
        print('Error parsing data: $e');
        print('Stack trace: $stackTrace');
        print('Data JSON: $dataJson');
      }
    }
    
    return ApiResponse(
      success: success,
      message: extractedMessage,
      data: parsedData,
      errors: parsedErrors,
    );
  }
}
