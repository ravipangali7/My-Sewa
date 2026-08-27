# Hierarchical dealer mapping, service-wise commission, and Super Admin profit snapshot.

import django.core.validators
import django.db.models.deletion
from decimal import Decimal
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0044_merge_0043_citizenship_and_dealer'),
    ]

    operations = [
        migrations.AddField(
            model_name='customuser',
            name='assigned_sub_agent',
            field=models.ForeignKey(
                blank=True,
                help_text='Sub-Agent this customer belongs to, if any. Dealer is still assigned_dealer.',
                limit_choices_to={'role': 'sub_agent'},
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='assigned_customers',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AlterField(
            model_name='customuser',
            name='parent_agent',
            field=models.ForeignKey(
                blank=True,
                help_text='Parent Agent for nested Sub-Agent accounts. Optional when a Dealer creates a Sub-Agent directly.',
                limit_choices_to={'role': 'agent'},
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='sub_agents',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AlterField(
            model_name='customuser',
            name='role',
            field=models.CharField(
                choices=[
                    ('customer', 'Customer'),
                    ('dealer', 'Dealer'),
                    ('agent', 'Agent'),
                    ('sub_agent', 'Sub-Agent'),
                ],
                db_index=True,
                default='customer',
                help_text='Business hierarchy role: Super Admin (staff) → Dealer → Agent/Sub-Agent → Customer.',
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name='dealercommissionconfig',
            name='sub_agent_commission_rate',
            field=models.DecimalField(
                decimal_places=4,
                default=Decimal('0.0000'),
                help_text="Default Sub-Agent percent of transaction amount for this Dealer's network.",
                max_digits=7,
                validators=[django.core.validators.MinValueValidator(Decimal('0'))],
            ),
        ),
        migrations.AddField(
            model_name='dealercommissionconfig',
            name='super_admin_rate',
            field=models.DecimalField(
                decimal_places=4,
                default=Decimal('0.0000'),
                help_text='Super Admin profit percent of transaction amount generated through this Dealer.',
                max_digits=7,
                validators=[django.core.validators.MinValueValidator(Decimal('0'))],
            ),
        ),
        migrations.AddField(
            model_name='dealercommission',
            name='sub_agent',
            field=models.ForeignKey(
                blank=True,
                help_text='Agent or Sub-Agent in the chain at the time of the transaction, if any.',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='sub_agent_commissions',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='dealercommission',
            name='sub_agent_commission_rate',
            field=models.DecimalField(decimal_places=4, default=Decimal('0.0000'), max_digits=7),
        ),
        migrations.AddField(
            model_name='dealercommission',
            name='sub_agent_commission',
            field=models.DecimalField(decimal_places=2, default=Decimal('0.00'), max_digits=12),
        ),
        migrations.AddField(
            model_name='dealercommission',
            name='super_admin_rate',
            field=models.DecimalField(decimal_places=4, default=Decimal('0.0000'), max_digits=7),
        ),
        migrations.AddField(
            model_name='dealercommission',
            name='super_admin_profit',
            field=models.DecimalField(decimal_places=2, default=Decimal('0.00'), max_digits=12),
        ),
        migrations.AlterField(
            model_name='dealercommission',
            name='created_at',
            field=models.DateTimeField(auto_now_add=True, db_index=True),
        ),
        migrations.CreateModel(
            name='ServiceCommissionRule',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('txn_type', models.CharField(db_index=True, max_length=40)),
                ('dealer_rate', models.DecimalField(
                    decimal_places=4, default=Decimal('0.0000'), max_digits=7,
                    validators=[django.core.validators.MinValueValidator(Decimal('0'))],
                )),
                ('sub_agent_rate', models.DecimalField(
                    decimal_places=4, default=Decimal('0.0000'), max_digits=7,
                    validators=[django.core.validators.MinValueValidator(Decimal('0'))],
                )),
                ('super_admin_rate', models.DecimalField(
                    decimal_places=4, default=Decimal('0.0000'), max_digits=7,
                    validators=[django.core.validators.MinValueValidator(Decimal('0'))],
                )),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('dealer', models.ForeignKey(
                    limit_choices_to={'role': 'dealer'},
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='service_commission_rules',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'verbose_name': 'Service Commission Rule',
                'verbose_name_plural': 'Service Commission Rules',
            },
        ),
        migrations.AddConstraint(
            model_name='servicecommissionrule',
            constraint=models.UniqueConstraint(
                fields=('dealer', 'txn_type'),
                name='uniq_service_commission_dealer_txn',
            ),
        ),
        migrations.AddIndex(
            model_name='servicecommissionrule',
            index=models.Index(fields=['dealer', 'txn_type'], name='core_svcrule_dealer_txn_idx'),
        ),
        migrations.AddIndex(
            model_name='customuser',
            index=models.Index(fields=['assigned_dealer', 'role'], name='core_user_dealer_role_idx'),
        ),
        migrations.AddIndex(
            model_name='customuser',
            index=models.Index(fields=['assigned_sub_agent', 'role'], name='core_user_subag_role_idx'),
        ),
        migrations.AddIndex(
            model_name='customuser',
            index=models.Index(fields=['parent_agent', 'role'], name='core_user_parent_role_idx'),
        ),
        migrations.AddIndex(
            model_name='dealercommission',
            index=models.Index(fields=['sub_agent', '-created_at'], name='core_dealerc_subag__idx'),
        ),
        migrations.AddIndex(
            model_name='dealercommission',
            index=models.Index(fields=['status', '-created_at'], name='core_dealerc_status__idx'),
        ),
        migrations.AddIndex(
            model_name='dealercommission',
            index=models.Index(fields=['txn_type', '-created_at'], name='core_dealerc_txn_ty__idx'),
        ),
        migrations.AlterField(
            model_name='securityauditlog',
            name='action',
            field=models.CharField(
                choices=[
                    ('transaction_pin_set', 'Transaction PIN Set'),
                    ('transaction_pin_changed', 'Transaction PIN Changed'),
                    ('transaction_pin_reset', 'Transaction PIN Reset'),
                    ('transaction_pin_reset_otp_sent', 'Transaction PIN Reset OTP Sent'),
                    ('transaction_pin_admin_set', 'Transaction PIN Admin Set'),
                    ('phone_change_otp_sent', 'Phone Change OTP Sent'),
                    ('phone_changed', 'Phone Changed'),
                    ('email_change_otp_sent', 'Email Change OTP Sent'),
                    ('email_changed', 'Email Changed'),
                    ('login_otp_sent', 'Login OTP Sent'),
                    ('login_otp_verified', 'Login OTP Verified'),
                    ('dealer_created', 'Dealer Created'),
                    ('dealer_updated', 'Dealer Updated'),
                    ('dealer_status_changed', 'Dealer Status Changed'),
                    ('sub_agent_created', 'Sub-Agent Created'),
                    ('customer_mapped', 'Customer Mapped'),
                    ('customer_reassigned', 'Customer Reassigned'),
                    ('commission_changed', 'Commission Changed'),
                    ('tds_changed', 'TDS Changed'),
                    ('wallet_frozen', 'Wallet Frozen'),
                    ('wallet_unfrozen', 'Wallet Unfrozen'),
                ],
                db_index=True,
                max_length=40,
            ),
        ),
    ]
