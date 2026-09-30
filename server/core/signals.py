"""
Django signals for automatic wallet creation and deposit approval handling
"""
import logging
import threading

from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver
from django.contrib.auth import get_user_model
from django.db import transaction
from .models import Wallet, Deposit
from .services.txn_status import credit_wallet_for_txn

logger = logging.getLogger(__name__)

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
                if getattr(old_instance, 'balance_after', None) is not None:
                    return
                with transaction.atomic():
                    wallet = Wallet.objects.select_for_update().get(user=instance.user)
                    from .services.wallet_guard import WalletFrozenError, WALLET_FROZEN_MESSAGE
                    if getattr(wallet, 'is_frozen', False):
                        raise ValueError(
                            (wallet.freeze_reason or '').strip() or WALLET_FROZEN_MESSAGE
                        )
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
    if not getattr(instance, '_notify_deposit_approved', False):
        return
    # Email uses EMAIL_TIMEOUT (30s) and push uses a 15–20s HTTP timeout.
    # Running them inside the settlement transaction held the deposit row lock
    # and the browser return for that full timeout. Send them after commit.
    deposit_id = instance.pk
    balance_after = getattr(instance, '_balance_after', None)
    instance._notify_deposit_approved = False

    def _send():
        def _run():
            from django.db import close_old_connections
            close_old_connections()
            try:
                deposit = Deposit.objects.select_related('user').filter(pk=deposit_id).first()
                if deposit is None:
                    return
                from .services.notifications import notify_deposit_approved
                notify_deposit_approved(deposit, balance_after=balance_after)
            except Exception:
                logger.exception(
                    'deposit approval notification failed deposit=%s',
                    deposit_id,
                )
            finally:
                close_old_connections()

        threading.Thread(
            target=_run,
            name=f'deposit-notify-{deposit_id}',
            daemon=True,
        ).start()

    transaction.on_commit(_send)
