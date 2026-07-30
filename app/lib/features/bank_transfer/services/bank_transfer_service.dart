import '../../../shared/services/api_service.dart';
import '../../../shared/models/api_response.dart';
import '../../../core/constants/app_constants.dart';
import '../models/bank_transfer_model.dart';

/// HimalPay bank transfer service
class BankTransferService {
  final ApiService _apiService = ApiService();

  Future<ApiResponse<List<BankModel>>> getBanks() async {
    return _apiService.get<List<BankModel>>(
      '${AppConstants.apiPrefix}/api/bank-transfer/banks/',
      fromJson: (json) {
        List? banks;
        if (json is Map) {
          banks = json['banks'] as List? ??
              (json['data'] is Map ? (json['data'] as Map)['banks'] as List? : null);
        } else if (json is List) {
          banks = json;
        }
        if (banks == null) return <BankModel>[];
        return banks
            .whereType<Map>()
            .map((e) => BankModel.fromJson(Map<String, dynamic>.from(e)))
            .toList();
      },
      requireAuth: true,
    );
  }

  Future<ApiResponse<Map<String, dynamic>>> verifyAccount({
    required String bankCode,
    required String accountName,
    required String accountNumber,
    bool isMobile = false,
    String? merchantTxnId,
  }) async {
    return _apiService.post<Map<String, dynamic>>(
      '${AppConstants.apiPrefix}/api/bank-transfer/verify/',
      {
        'bank_code': bankCode,
        'account_name': accountName,
        'account_number': accountNumber,
        'is_mobile': isMobile,
        if (merchantTxnId != null && merchantTxnId.isNotEmpty)
          'merchant_txn_id': merchantTxnId,
      },
      fromJson: (json) {
        if (json is Map<String, dynamic>) return json;
        return <String, dynamic>{};
      },
      requireAuth: true,
    );
  }

  Future<ApiResponse<ChargePreview>> calculateCharge({
    required double amount,
  }) async {
    return _apiService.post<ChargePreview>(
      '${AppConstants.apiPrefix}/api/bank-transfer/calculate/',
      {'amount': amount.toString()},
      fromJson: (json) {
        if (json is Map<String, dynamic>) {
          return ChargePreview.fromJson(json);
        }
        return ChargePreview(
          amount: amount,
          charge: 0,
          cashback: 0,
          totalDebited: amount,
        );
      },
      requireAuth: true,
    );
  }

  Future<ApiResponse<BankTransferModel>> createTransfer({
    required double amount,
    required String destinationBank,
    required String destinationBankName,
    required String destinationAccNo,
    required String destinationAccName,
    bool isDestinationMobile = false,
    String transactionRemarks = 'Fund Transfer',
    String? merchantTxnId,
  }) async {
    return _apiService.post<BankTransferModel>(
      '${AppConstants.apiPrefix}/api/bank-transfer/create/',
      {
        'amount': amount.toString(),
        'destination_bank': destinationBank,
        'destination_bank_name': destinationBankName,
        'destination_acc_no': destinationAccNo,
        'destination_acc_name': destinationAccName,
        'is_destination_mobile': isDestinationMobile,
        'transaction_remarks': transactionRemarks,
        if (merchantTxnId != null && merchantTxnId.isNotEmpty)
          'merchant_txn_id': merchantTxnId,
      },
      fromJson: (json) {
        // ApiResponse already unwraps the nested `data` field.
        if (json is Map<String, dynamic>) {
          if (json.containsKey('data') && json['data'] is Map) {
            return BankTransferModel.fromJson(
              Map<String, dynamic>.from(json['data'] as Map),
            );
          }
          return BankTransferModel.fromJson(json);
        }
        throw Exception('Invalid bank transfer response');
      },
      requireAuth: true,
    );
  }

  Future<ApiResponse<List<BankTransferModel>>> getHistory() async {
    return _apiService.get<List<BankTransferModel>>(
      '${AppConstants.apiPrefix}/api/bank-transfer/history/',
      fromJson: (json) {
        if (json is List) {
          return json
              .whereType<Map>()
              .map((e) => BankTransferModel.fromJson(Map<String, dynamic>.from(e)))
              .toList();
        }
        return <BankTransferModel>[];
      },
      requireAuth: true,
    );
  }
}
