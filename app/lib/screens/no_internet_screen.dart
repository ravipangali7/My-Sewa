import 'package:flutter/material.dart';

import '../config/app_config.dart';

class NoInternetScreen extends StatelessWidget {
  const NoInternetScreen({super.key, required this.onRetry, this.isChecking = false});

  final VoidCallback onRetry;
  final bool isChecking;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(AppConfig.bg),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 28),
          child: Column(
            children: [
              const Spacer(flex: 2),
              Container(
                width: 88,
                height: 88,
                decoration: BoxDecoration(
                  color: const Color(AppConfig.brand).withValues(alpha: 0.12),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.wifi_off_rounded,
                  size: 42,
                  color: Color(AppConfig.brand),
                ),
              ),
              const SizedBox(height: 28),
              const Text(
                'No Internet Connection',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w700,
                  color: Color(AppConfig.label),
                  letterSpacing: -0.3,
                ),
              ),
              const SizedBox(height: 12),
              const Text(
                'Please check your mobile data or Wi‑Fi and try again.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 15,
                  height: 1.45,
                  color: Color(AppConfig.secondary),
                ),
              ),
              const SizedBox(height: 32),
              SizedBox(
                width: double.infinity,
                height: 52,
                child: FilledButton(
                  onPressed: isChecking ? null : onRetry,
                  style: FilledButton.styleFrom(
                    backgroundColor: const Color(AppConfig.brand),
                    disabledBackgroundColor:
                        const Color(AppConfig.brand).withValues(alpha: 0.5),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                    elevation: 0,
                  ),
                  child: isChecking
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(
                            strokeWidth: 2.4,
                            color: Colors.white,
                          ),
                        )
                      : const Text(
                          'Try Again',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                ),
              ),
              const Spacer(flex: 3),
              const Text(
                AppConfig.appName,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: Color(AppConfig.secondary),
                ),
              ),
              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }
}
