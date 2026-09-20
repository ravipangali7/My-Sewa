from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0073_api_payin_developer_webhook'),
    ]

    operations = [
        migrations.AddField(
            model_name='customuser',
            name='api_return_url',
            field=models.URLField(
                blank=True,
                default='',
                help_text=(
                    "Optional player browser return URL after a successful API Payin. "
                    "Use a game/app page (not the webhook API). Leave empty to show "
                    "MySewa's Payment Successful page."
                ),
                max_length=500,
            ),
        ),
        migrations.AlterField(
            model_name='customuser',
            name='api_webhook_url',
            field=models.URLField(
                blank=True,
                default='',
                help_text=(
                    "Developer callback URL for Payin (PayBridgeNP) results. "
                    "MySewa POSTs the verified payment outcome here after wallet credit. "
                    "Mapped via deposit.initiated_by — never taken from client redirect alone. "
                    "This is server-to-server only; the player browser is never sent here."
                ),
                max_length=500,
            ),
        ),
    ]
