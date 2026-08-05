"""
Django signals for automatic wallet creation and deposit approval handling
"""
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver
from django.contrib.auth import get_user_model
from django.db import transaction
from .models import Wallet, Deposit
from .services.txn_status import credit_wallet_for_txn

User = get_user_model()


@receiver(post_save, sender=User)
def create_user_wallet(sender, instance, created, **kwargs):
    """Create wallet automatically when a new user is created"""
    if created:
        Wallet.objects.get_or_create(user=instance, defaults={'balance': 0.00})


@receiver(pre_save, sender=Deposit)
def handle_deposit_approval(sender, instance, **kwargs):
    """Handle deposit approval - update wallet balance when status changes to approved"""
    if instance.pk:  # Only for existing instances (updates)
        try:
            old_instance = Deposit.objects.get(pk=instance.pk)
            # If status changed from non-approved to approved
            if old_instance.status != 'approved' and instance.status == 'approved':
                with transaction.atomic():
                    wallet = Wallet.objects.select_for_update().get(user=instance.user)
                    credit_wallet_for_txn(wallet, instance, instance.amount)
                # Flag for post_save notification (avoid double-send on create)
                instance._notify_deposit_approved = True
                instance._balance_after = wallet.balance
        except Deposit.DoesNotExist:
            pass  # New instance, no action needed
        except Wallet.DoesNotExist:
            with transaction.atomic():
                wallet = Wallet.objects.create(user=instance.user, balance=0.00)
                wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)
                credit_wallet_for_txn(wallet, instance, instance.amount)
            instance._notify_deposit_approved = True
            instance._balance_after = wallet.balance


@receiver(post_save, sender=Deposit)
def notify_on_deposit_approved(sender, instance, **kwargs):
    if getattr(instance, '_notify_deposit_approved', False):
        from .services.notifications import notify_deposit_approved
        notify_deposit_approved(
            instance,
            balance_after=getattr(instance, '_balance_after', None),
        )
