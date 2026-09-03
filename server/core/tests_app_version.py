from django.test import SimpleTestCase, TestCase
from rest_framework import status
from rest_framework.test import APIClient

from .models import Settings
from .services.app_version import (
    is_newer_version,
    normalize_app_version,
    version_tuple,
)


class AppVersionNormalizeTests(SimpleTestCase):
    def test_pads_major_only_and_partial(self):
        self.assertEqual(normalize_app_version('3'), '3.0.0')
        self.assertEqual(normalize_app_version('3.0'), '3.0.0')
        self.assertEqual(normalize_app_version('3.0.0'), '3.0.0')
        self.assertEqual(normalize_app_version('v3.1'), '3.1.0')
        self.assertEqual(normalize_app_version(' 3.2.1 '), '3.2.1')
        self.assertEqual(normalize_app_version('3.0.0+2'), '3.0.0')
        self.assertEqual(normalize_app_version('3.0.0-beta'), '3.0.0')
        self.assertEqual(normalize_app_version(''), '')

    def test_equality_across_equivalent_forms(self):
        self.assertEqual(version_tuple('3'), version_tuple('3.0.0'))
        self.assertEqual(version_tuple('3.0'), version_tuple('3.0.0'))
        self.assertFalse(is_newer_version('3', '3.0.0'))
        self.assertFalse(is_newer_version('3.0.0', '3'))
        self.assertFalse(is_newer_version('3.0', '3.0.0'))

    def test_newer_and_downgrade(self):
        self.assertTrue(is_newer_version('3.0.1', '3.0.0'))
        self.assertTrue(is_newer_version('3.1', '3.0.0'))
        self.assertTrue(is_newer_version('4', '3.0.0'))
        self.assertFalse(is_newer_version('3.0.0', '3.0.1'))
        self.assertFalse(is_newer_version('2.9.9', '3.0.0'))
        self.assertFalse(is_newer_version('3.0.0', '3.0.0'))


class PublicSettingsAppVersionApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        settings_obj = Settings.load()
        settings_obj.auto_update_enabled = True
        settings_obj.app_version = '3'
        settings_obj.save()

    def test_get_settings_returns_normalized_version_and_no_store(self):
        response = self.client.get('/api/settings/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['app_version'], '3.0.0')
        self.assertTrue(response.data['auto_update_enabled'])
        cache_control = response.get('Cache-Control', '')
        self.assertIn('no-store', cache_control)
        self.assertIn('no-cache', cache_control)

    def test_settings_save_normalizes_db_value(self):
        settings_obj = Settings.load()
        settings_obj.app_version = '3.0'
        settings_obj.save()
        settings_obj.refresh_from_db()
        self.assertEqual(settings_obj.app_version, '3.0.0')
