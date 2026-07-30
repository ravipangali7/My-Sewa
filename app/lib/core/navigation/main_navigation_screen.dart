import 'package:flutter/material.dart';
import '../../core/theme/app_colors.dart';
import '../../features/wallet/screens/wallet_screen.dart';
import '../../features/wallet/screens/history_screen.dart';
import '../../features/bank_transfer/screens/bank_transfer_screen.dart';
import '../../features/profile/screens/profile_screen.dart';

class MainNavigationScreen extends StatefulWidget {
  const MainNavigationScreen({super.key});

  @override
  State<MainNavigationScreen> createState() => _MainNavigationScreenState();
}

class _MainNavigationScreenState extends State<MainNavigationScreen> {
  int _currentIndex = 0;
  late final List<Widget> _screens;

  @override
  void initState() {
    super.initState();
    _screens = [
      WalletScreen(
        onNavigateToTransfer: () => _onTabTapped(1),
        onNavigateToHistory: () => _onTabTapped(2),
        onNavigateToProfile: () => _onTabTapped(3),
      ),
      const BankTransferScreen(),
      const HistoryScreen(),
      const ProfileScreen(),
    ];
  }

  void _onTabTapped(int index) {
    setState(() => _currentIndex = index);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: _currentIndex,
        children: _screens,
      ),
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.06),
              blurRadius: 12,
              offset: const Offset(0, -2),
            ),
          ],
        ),
        child: SafeArea(
          child: SizedBox(
            height: 62,
            child: Row(
              children: [
                _NavItem(
                  icon: Icons.home_rounded,
                  label: 'Home',
                  selected: _currentIndex == 0,
                  onTap: () => _onTabTapped(0),
                ),
                _NavItem(
                  icon: Icons.account_balance_rounded,
                  label: 'Bank Transfer',
                  selected: _currentIndex == 1,
                  onTap: () => _onTabTapped(1),
                ),
                _NavItem(
                  icon: Icons.history_rounded,
                  label: 'History',
                  selected: _currentIndex == 2,
                  onTap: () => _onTabTapped(2),
                ),
                _NavItem(
                  icon: Icons.person_outline_rounded,
                  selectedIcon: Icons.person_rounded,
                  label: 'Profile',
                  selected: _currentIndex == 3,
                  onTap: () => _onTabTapped(3),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  final IconData icon;
  final IconData? selectedIcon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _NavItem({
    required this.icon,
    this.selectedIcon,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final color = selected ? AppColors.secondary : const Color(0xFF6B7280);

    return Expanded(
      child: InkWell(
        onTap: onTap,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              selected ? (selectedIcon ?? icon) : icon,
              color: color,
              size: 24,
            ),
            const SizedBox(height: 3),
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: color,
                fontSize: 10,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
              ),
            ),
            const SizedBox(height: 4),
            AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              height: 3,
              width: selected ? 28 : 0,
              decoration: BoxDecoration(
                color: AppColors.secondary,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
