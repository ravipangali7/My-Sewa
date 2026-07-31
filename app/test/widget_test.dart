import 'package:flutter_test/flutter_test.dart';

import 'package:mysewa/main.dart';

void main() {
  testWidgets('MySewa app builds', (WidgetTester tester) async {
    await tester.pumpWidget(const MySewaApp());
    expect(find.byType(MySewaApp), findsOneWidget);
  });
}
