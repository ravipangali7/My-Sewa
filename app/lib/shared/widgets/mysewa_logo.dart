import 'package:flutter/material.dart';
import '../../core/theme/app_colors.dart';

/// Circular MySewa brand mark — stylized MS monogram (not a plain "S").
class MySewaLogoMark extends StatelessWidget {
  final double size;
  final bool showShadow;

  const MySewaLogoMark({
    super.key,
    this.size = 36,
    this.showShadow = true,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: LinearGradient(
          colors: [
            AppColors.secondary,
            AppColors.primary,
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        boxShadow: showShadow
            ? [
                BoxShadow(
                  color: Colors.black.withOpacity(0.15),
                  blurRadius: 4,
                  offset: const Offset(0, 2),
                ),
              ]
            : null,
      ),
      child: CustomPaint(
        painter: _MySewaMonogramPainter(),
        size: Size(size, size),
      ),
    );
  }
}

class _MySewaMonogramPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.stroke
      ..strokeWidth = size.width * 0.08
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    final fill = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.fill;

    final cx = size.width / 2;
    final cy = size.height / 2;
    final r = size.width * 0.28;

    // Stylized "M" on the left
    final m = Path()
      ..moveTo(cx - r * 1.05, cy + r * 0.85)
      ..lineTo(cx - r * 1.05, cy - r * 0.75)
      ..lineTo(cx - r * 0.35, cy + r * 0.15)
      ..lineTo(cx + r * 0.15, cy - r * 0.75)
      ..lineTo(cx + r * 0.15, cy + r * 0.85);
    canvas.drawPath(m, paint);

    // Accent leaf/dot (Sewa mark) overlapping right side
    canvas.drawCircle(
      Offset(cx + r * 0.72, cy - r * 0.15),
      size.width * 0.09,
      fill,
    );

    // Soft arc under monogram suggesting care/service
    final arc = Path()
      ..moveTo(cx - r * 0.55, cy + r * 1.05)
      ..quadraticBezierTo(cx + r * 0.1, cy + r * 1.35, cx + r * 0.85, cy + r * 0.55);
    canvas.drawPath(arc, paint..strokeWidth = size.width * 0.055);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

/// Header brand row: logo + MySewa + Nepali tagline
class MySewaBrandHeader extends StatelessWidget {
  const MySewaBrandHeader({super.key});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const MySewaLogoMark(size: 34),
        const SizedBox(width: 8),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'MySewa',
              style: TextStyle(
                color: Colors.white,
                fontSize: 18,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.2,
                height: 1.1,
              ),
            ),
            Text(
              'सजिलो, सुरक्षित, हाम्रो सँग',
              style: TextStyle(
                color: Colors.white.withOpacity(0.85),
                fontSize: 9,
                fontWeight: FontWeight.w400,
                height: 1.2,
              ),
            ),
          ],
        ),
      ],
    );
  }
}
