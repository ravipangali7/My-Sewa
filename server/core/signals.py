"""
Django signals for automatic wallet creation and deposit approval handling
"""
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver
from django.contrib.auth import get_user_model
from django.db import transaction
from .models import Wallet, Deposit

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
                wallet = Wallet.objects.get(user=instance.user)
                with transaction.atomic():
                    wallet.balance += instance.amount
                    wallet.save()
        except Deposit.DoesNotExist:
            pass  # New instance, no action needed
