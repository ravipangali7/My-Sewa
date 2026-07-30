"""
Service Hub API Integration
Handles JWT authentication, RSA signature generation, and API calls for NTC/NCELL topup
"""
import os
import json
import base64
import logging
import traceback
import requests
from datetime import datetime
from typing import Dict, Optional, Any
from pathlib import Path
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.backends import default_backend
from django.conf import settings

logger = logging.getLogger(__name__)


class ServiceHubAPI:
    """Service Hub API client for mobile topup services"""

    def __init__(self):
        self.base_url = getattr(settings, 'SERVICE_HUB_BASE_URL', 'https://servicehubapiuat.yoapp.com.np')
        self.api_username = getattr(settings, 'SERVICE_HUB_API_USERNAME', '')
        self.api_password = getattr(settings, 'SERVICE_HUB_API_PASSWORD', '')
        self.private_key_path = getattr(settings, 'SERVICE_HUB_PRIVATE_KEY_PATH', '')
        self.bypass_api = getattr(settings, 'SERVICE_HUB_BYPASS_API', False)
        # Note: Tokens cannot be reused - each request needs a new token per documentation

    def _format_private_key(self, key_str: str) -> str:
        """
        Convert single-line private key format to proper PEM format
        Handles keys with spaces instead of newlines
        """
        # Remove any existing newlines and normalize
        key_str = key_str.strip()
        
        # Check if already in proper format (has newlines)
        if '\n' in key_str:
            # Already formatted, just ensure it's clean
            lines = [line.strip() for line in key_str.split('\n') if line.strip()]
            return '\n'.join(lines)
        
        # Single-line format - need to convert
        # Extract BEGIN marker
        begin_marker = '-----BEGIN RSA PRIVATE KEY-----'
        end_marker = '-----END RSA PRIVATE KEY-----'
        
        if begin_marker not in key_str or end_marker not in key_str:
            raise ValueError("Invalid private key format: missing BEGIN or END markers")
        
        # Extract the base64 content between markers
        begin_idx = key_str.find(begin_marker) + len(begin_marker)
        end_idx = key_str.find(end_marker)
        base64_content = key_str[begin_idx:end_idx].strip()
        
        # Remove all spaces from base64 content
        base64_content = base64_content.replace(' ', '').replace('\n', '').replace('\r', '')
        
        # Split base64 into lines of 64 characters (PEM standard)
        formatted_base64 = '\n'.join([base64_content[i:i+64] for i in range(0, len(base64_content), 64)])
        
        # Reconstruct proper PEM format
        formatted_key = f"{begin_marker}\n{formatted_base64}\n{end_marker}"
        
        return formatted_key

    def _extract_first_key(self, key_content: str) -> str:
        """
        Extract the first private key from content that may contain multiple keys.
        This is important because service_hub_key.txt contains two keys, and we need
        the first one (which matches the API's public key).
        """
        begin_marker = '-----BEGIN RSA PRIVATE KEY-----'
        end_marker = '-----END RSA PRIVATE KEY-----'
        
        # Find the first occurrence of BEGIN marker
        first_begin = key_content.find(begin_marker)
        if first_begin == -1:
            # No key found, return as-is (will be handled by _format_private_key)
            return key_content.strip()
        
        # Find the first END marker after the first BEGIN
        first_end = key_content.find(end_marker, first_begin)
        if first_end == -1:
            # No end marker found, return as-is
            return key_content.strip()
        
        # Extract the first complete key (including markers)
        first_key = key_content[first_begin:first_end + len(end_marker)].strip()
        
        # Check if there are more keys
        remaining = key_content[first_end + len(end_marker):].strip()
        if begin_marker in remaining:
            logger.warning(f"Multiple private keys found in file. Using the first key only.")
            logger.debug(f"First key starts with: {first_key[:50]}...")
        
        return first_key

    def _load_private_key(self):
        """Load RSA private key from file or environment variable"""
        # Get BASE_DIR equivalent for path resolution
        backend_dir = Path(__file__).resolve().parent.parent.parent
        
        # First, try loading from workspace root service hub api folder (updated key location)
        # Go up from mysewa_backend/core/services/ to workspace root, then to service hub api folder
        workspace_key_path = backend_dir.parent / 'service hub api' / 'Private key.txt'
        if workspace_key_path.exists():
            try:
                with open(workspace_key_path, 'rb') as key_file:
                    key_data = key_file.read()
                    key_str = key_data.decode('utf-8')
                    # Extract first key if multiple keys exist
                    first_key = self._extract_first_key(key_str)
                    # Format the key properly
                    formatted_key = self._format_private_key(first_key)
                    key_data = formatted_key.encode('utf-8')
                    private_key = serialization.load_pem_private_key(
                        key_data,
                        password=None,
                        backend=default_backend()
                    )
                    # Verify key is loaded correctly
                    key_size = private_key.key_size
                    logger.info(f"Loaded private key from workspace root: {workspace_key_path} (key size: {key_size} bits)")
                    return private_key
            except Exception as e:
                logger.error(f"Failed to load private key from workspace root {workspace_key_path}: {str(e)}")
                logger.error(f"Error details: {traceback.format_exc()}")
        
        # Second, try loading from environment variable path (settings)
        # Resolve relative paths relative to BASE_DIR (backend_dir)
        if self.private_key_path:
            # If path is relative, resolve it relative to BASE_DIR
            if not os.path.isabs(self.private_key_path):
                resolved_path = backend_dir / self.private_key_path
            else:
                resolved_path = Path(self.private_key_path)
            
            if resolved_path.exists():
                try:
                    with open(resolved_path, 'rb') as key_file:
                        key_data = key_file.read()
                        key_str = key_data.decode('utf-8')
                        # Extract first key if multiple keys exist
                        first_key = self._extract_first_key(key_str)
                        # Format the key properly
                        formatted_key = self._format_private_key(first_key)
                        key_data = formatted_key.encode('utf-8')
                        private_key = serialization.load_pem_private_key(
                            key_data,
                            password=None,
                            backend=default_backend()
                        )
                        key_size = private_key.key_size
                        logger.info(f"Loaded private key from path: {resolved_path} (key size: {key_size} bits)")
                        return private_key
                except Exception as e:
                    logger.error(f"Failed to load private key from path {resolved_path}: {str(e)}")
                    logger.error(f"Error details: {traceback.format_exc()}")
            else:
                logger.debug(f"Private key path not found: {resolved_path}")
        
        # Third, try loading from backend project directory
        # Check in mysewa_backend/service_hub_key.txt
        backend_key_path = backend_dir / 'service_hub_key.txt'
        if backend_key_path.exists():
            try:
                with open(backend_key_path, 'rb') as key_file:
                    key_data = key_file.read()
                    key_str = key_data.decode('utf-8')
                    # Extract first key if multiple keys exist (service_hub_key.txt has 2 keys)
                    first_key = self._extract_first_key(key_str)
                    # Format the key properly
                    formatted_key = self._format_private_key(first_key)
                    key_data = formatted_key.encode('utf-8')
                    private_key = serialization.load_pem_private_key(
                        key_data,
                        password=None,
                        backend=default_backend()
                    )
                    key_size = private_key.key_size
                    logger.info(f"Loaded private key from backend project: {backend_key_path} (key size: {key_size} bits)")
                    return private_key
            except Exception as e:
                logger.error(f"Failed to load private key from backend project {backend_key_path}: {str(e)}")
                logger.error(f"Error details: {traceback.format_exc()}")
        
        # Fourth, try loading from settings (private key content directly)
        key_content = getattr(settings, 'SERVICE_HUB_PRIVATE_KEY', '')
        if key_content:
            try:
                # Extract first key if multiple keys exist
                first_key = self._extract_first_key(key_content)
                # Format the key properly
                formatted_key = self._format_private_key(first_key)
                
                private_key = serialization.load_pem_private_key(
                    formatted_key.encode('utf-8'),
                    password=None,
                    backend=default_backend()
                )
                key_size = private_key.key_size
                logger.info(f"Loaded private key from settings (SERVICE_HUB_PRIVATE_KEY) (key size: {key_size} bits)")
                return private_key
            except Exception as e:
                logger.error(f"Failed to load private key from settings: {str(e)}")
                logger.error(f"Error details: {traceback.format_exc()}")
        
        raise ValueError(
            "Private key not found. Please ensure 'service hub api/Private key.txt' exists in workspace root, "
            "or set SERVICE_HUB_PRIVATE_KEY_PATH or SERVICE_HUB_PRIVATE_KEY in settings.py, "
            "or ensure 'service_hub_key.txt' exists in mysewa_backend/ directory."
        )

    def _try_login(self, login_url: str) -> tuple[requests.Response, str, bytes, dict]:
        """
        Login to Service Hub API with correct payload format
        Returns: (response, response_text, response_content, response_json_data)
        """
        # Exact payload format as per documentation
        payload = {
            "username": self.api_username,
            "password": self.api_password,
            "grant_type": "password"
        }
        
        # Variables to store response content
        response_text = None
        response_content = None
        response_json_data = None
        
        # Use JSON format only
        headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
        
        logger.info(f"Attempting login to Service Hub API")
        logger.info(f"Request URL: {login_url}")
        logger.info(f"Request headers: {headers}")
        logger.info(f"Request payload (JSON): {json.dumps(payload, indent=2)}")
        
        response = requests.post(login_url, json=payload, headers=headers, timeout=30)
        
        # Log response details
        logger.info(f"Response status: {response.status_code}")
        logger.info(f"Response headers: {dict(response.headers)}")
        
        # Store response content BEFORE any operations that might consume the stream
        try:
            response_content = response.content
            logger.debug(f"Response content length (bytes): {len(response_content)}")
            
            if response.encoding:
                logger.debug(f"Response encoding: {response.encoding}")
            
            response_text = response.text
            
            # If text is empty but we have bytes, try to decode manually
            if not response_text and response_content:
                try:
                    response_text = response_content.decode('utf-8')
                    logger.debug("Decoded response as UTF-8")
                except UnicodeDecodeError:
                    try:
                        response_text = response_content.decode('iso-8859-1')
                        logger.debug("Decoded response as ISO-8859-1")
                    except UnicodeDecodeError:
                        response_text = response_content.decode('utf-8', errors='replace')
                        logger.debug("Decoded response as UTF-8 with error replacement")
            
            # Log response body
            if response_text:
                logger.info(f"Response body (raw, length={len(response_text)}): {response_text}")
                try:
                    response_json_data = response.json()
                    logger.info(f"Response body (JSON): {json.dumps(response_json_data, indent=2)}")
                except (ValueError, json.JSONDecodeError):
                    logger.info(f"Response body is not JSON: {response_text}")
            else:
                logger.warning(f"Response body is EMPTY (status={response.status_code})")
                if response_content:
                    logger.warning(f"Response has {len(response_content)} bytes but text is empty - encoding issue?")
                else:
                    logger.warning("Response has no content at all")
        except Exception as parse_error:
            logger.error(f"Could not parse response body: {parse_error}", exc_info=True)
        
        return response, response_text, response_content, response_json_data

    def _get_jwt_token(self) -> str:
        """
        Get JWT token by logging in to Service Hub API
        IMPORTANT: Per documentation, each request needs a new and unique token.
        Tokens cannot be reused, so we always get a fresh token for every request.
        """
        if not self.api_username or not self.api_password:
            raise ValueError("Service Hub API credentials not configured. Set SERVICE_HUB_API_USERNAME and SERVICE_HUB_API_PASSWORD")

        login_url = f"{self.base_url}/gateway/login"
        
        logger.info(f"Attempting to login to Service Hub API at {login_url}")
        logger.info(f"Using username: {self.api_username}")
        
        try:
            response, response_text, response_content, response_json_data = self._try_login(login_url)
            
            # Check if request was successful
            response.raise_for_status()
            
            # If we get here, status is 200
            if response_json_data is None:
                data = response.json()
            else:
                data = response_json_data
            
            # Check for accesstoken (lowercase, no underscore) as per documentation
            token = None
            refresh_token = None
            
            if 'accesstoken' in data:
                token = data['accesstoken']
            elif 'access_token' in data:
                token = data['access_token']
            elif 'accessToken' in data:
                token = data['accessToken']
            elif 'token' in data:
                token = data['token']
            elif isinstance(data, str):
                # Sometimes the response is just the token string
                token = data
            
            # Store refresh token if available
            if 'refreshtoken' in data:
                refresh_token = data['refreshtoken']
            elif 'refresh_token' in data:
                refresh_token = data['refresh_token']
            elif 'refreshToken' in data:
                refresh_token = data['refreshToken']
            
            if token:
                logger.info(f"Successfully obtained JWT token from Service Hub API")
                if refresh_token:
                    logger.debug(f"Refresh token also received (not stored - tokens cannot be reused)")
                # Return token directly - do not cache as per documentation requirement
                return token
            else:
                error_msg = f"Login failed: Token not found in response. Response: {data}"
                logger.error(error_msg)
                print(f"\n{'='*80}")
                print(f"LOGIN FAILED - Token not found")
                print(f"Response: {json.dumps(data, indent=2) if isinstance(data, dict) else data}")
                print(f"{'='*80}\n")
                raise Exception(error_msg)
                    
        except requests.HTTPError as e:
            # Handle HTTP errors (like 401, 403, etc.)
            error_msg = f"Service Hub login HTTP error: {e.response.status_code} {e.response.reason}"
            logger.error(error_msg)
            logger.error(f"Login URL: {login_url}")
            logger.error(f"Response status code: {e.response.status_code}")
            logger.error(f"Response headers: {dict(e.response.headers)}")
            
            # Use stored response content if available, otherwise try to read from exception
            stored_text = response_text if 'response_text' in locals() else None
            stored_content = response_content if 'response_content' in locals() else None
            stored_json = response_json_data if 'response_json_data' in locals() else None
            
            # If we don't have stored content, try to read from exception response
            if stored_text is None or stored_content is None:
                try:
                    if hasattr(e, 'response') and e.response is not None:
                        stored_content = e.response.content
                        stored_text = e.response.text
                        if not stored_text and stored_content:
                            try:
                                stored_text = stored_content.decode('utf-8')
                            except UnicodeDecodeError:
                                try:
                                    stored_text = stored_content.decode('iso-8859-1')
                                except UnicodeDecodeError:
                                    stored_text = stored_content.decode('utf-8', errors='replace')
                except Exception as read_error:
                    logger.error(f"Could not read response from exception: {read_error}")
            
            # Log response body using stored values
            if stored_text:
                logger.error(f"Response body (raw, length={len(stored_text)}): {stored_text}")
                if stored_json:
                    logger.error(f"Response body (JSON): {json.dumps(stored_json, indent=2)}")
                    error_msg += f" - Response: {json.dumps(stored_json)}"
                else:
                    try:
                        parsed_json = json.loads(stored_text)
                        logger.error(f"Response body (JSON): {json.dumps(parsed_json, indent=2)}")
                        error_msg += f" - Response: {json.dumps(parsed_json)}"
                    except (ValueError, json.JSONDecodeError):
                        logger.error(f"Response body (text): {stored_text}")
                        error_msg += f" - Response: {stored_text}"
            else:
                if stored_content:
                    logger.error(f"Response body is empty but has {len(stored_content)} bytes - encoding issue?")
                    logger.error(f"Response content (hex): {stored_content.hex()[:100]}...")
                    error_msg += " - Response body is empty (possible encoding issue)"
                else:
                    logger.error("Response body is completely empty")
                    error_msg += " - Response body is empty"
            
            print(f"\n{'='*80}")
            print(f"LOGIN FAILED - HTTP {e.response.status_code}")
            print(f"URL: {login_url}")
            print(f"Username: {self.api_username}")
            if stored_text:
                print(f"Response body: {stored_text}")
            elif stored_content:
                print(f"Response body: <empty text, {len(stored_content)} bytes>")
                print(f"Response content (first 200 chars as hex): {stored_content.hex()[:200]}")
            else:
                print(f"Response body: <completely empty>")
            print(f"{'='*80}\n")
            
            logger.error(f"Full traceback:\n{traceback.format_exc()}")
            raise Exception(error_msg)
                    
        except requests.RequestException as e:
            error_msg = f"Service Hub login error: {str(e)}"
            logger.error(error_msg)
            logger.error(f"Login URL: {login_url}")
            
            # Use stored response content if available
            stored_text = response_text if 'response_text' in locals() else None
            stored_content = response_content if 'response_content' in locals() else None
            
            if hasattr(e, 'response') and e.response is not None:
                logger.error(f"Response status code: {e.response.status_code}")
                logger.error(f"Response headers: {dict(e.response.headers)}")
                
                if stored_text is None or stored_content is None:
                    try:
                        stored_content = e.response.content
                        stored_text = e.response.text
                        if not stored_text and stored_content:
                            try:
                                stored_text = stored_content.decode('utf-8')
                            except UnicodeDecodeError:
                                try:
                                    stored_text = stored_content.decode('iso-8859-1')
                                except UnicodeDecodeError:
                                    stored_text = stored_content.decode('utf-8', errors='replace')
                    except Exception as read_error:
                        logger.error(f"Could not read response body: {read_error}")
                
                if stored_text:
                    logger.error(f"Response body: {stored_text}")
                    print(f"\n{'='*80}")
                    print(f"LOGIN ERROR - Response body:")
                    print(f"{stored_text}")
                    print(f"{'='*80}\n")
                elif stored_content:
                    logger.error(f"Response body: <empty text, {len(stored_content)} bytes>")
                    print(f"\n{'='*80}")
                    print(f"LOGIN ERROR - Response body is empty but has {len(stored_content)} bytes")
                    print(f"Response content (hex): {stored_content.hex()[:200]}...")
                    print(f"{'='*80}\n")
                else:
                    logger.error("Response body is completely empty")
                    print(f"\n{'='*80}")
                    print(f"LOGIN ERROR - Response body is completely empty")
                    print(f"{'='*80}\n")
            
            logger.error(f"Full traceback:\n{traceback.format_exc()}")
            raise Exception(error_msg)

    def _sort_json_keys(self, data: Dict) -> Dict:
        """
        Sort JSON object keys in ascending alphabetical order (case-sensitive)
        Important: All fields must be case-sensitive and sorted ascending
        """
        # Sort keys alphabetically (case-sensitive)
        sorted_items = sorted(data.items(), key=lambda x: x[0])
        return dict(sorted_items)

    def _generate_signature(self, data_model: Dict) -> tuple:
        """
        Generate RSA signature for the data model
        Follows exact steps from Service Hub API documentation:
        1. Sort data model keys alphabetically (case-sensitive, ascending)
        2. Create signing model with Model and TimeStamp
        3. Serialize to compact JSON (no spaces, tabs, line breaks)
        4. Sign with RSA SHA-256 + PKCS#1
        5. Base64 encode signature
        
        Returns: (signature_base64, timestamp)
        """
        try:
            print(f"\n{'='*80}")
            print(f"SIGNATURE GENERATION - Starting")
            print(f"Original Data Model: {json.dumps(data_model, indent=2)}")
            print(f"{'='*80}\n")
            
            # Step 1: Sort the data model keys alphabetically (case-sensitive, ascending)
            sorted_model = self._sort_json_keys(data_model)
            logger.debug(f"Sorted data model: {json.dumps(sorted_model, indent=2)}")
            print(f"\n{'='*80}")
            print(f"SIGNATURE GENERATION - Step 1: Sorted Data Model")
            print(f"Sorted keys: {list(sorted_model.keys())}")
            print(f"Sorted data model: {json.dumps(sorted_model, indent=2)}")
            print(f"{'='*80}\n")

            # Step 2: Create signing model with timestamp
            # Format: yyyy-MM-ddTHH:mm:ss.fff (24 hour format)
            timestamp = datetime.now().strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3]
            signing_model = {
                "Model": sorted_model,
                "TimeStamp": timestamp
            }
            logger.debug(f"Signing model: {json.dumps(signing_model, indent=2)}")
            print(f"\n{'='*80}")
            print(f"SIGNATURE GENERATION - Step 2: Signing Model Created")
            print(f"Signing model: {json.dumps(signing_model, indent=2)}")
            print(f"{'='*80}\n")

            # Step 3: Serialize to compact JSON string (no spaces, tabs, line breaks)
            # Must use separators=(',', ':') to remove all whitespace
            json_string = json.dumps(signing_model, separators=(',', ':'), ensure_ascii=False)
            logger.debug(f"Signing model JSON (compact): {json_string}")
            print(f"\n{'='*80}")
            print(f"SIGNATURE GENERATION - Step 3: Compact JSON String")
            print(f"JSON String (length: {len(json_string)}): {json_string}")
            print(f"{'='*80}\n")

            # Step 4: Generate RSA signature using SHA-256 + RSA + PKCS#1
            private_key = self._load_private_key()
            print(f"\n{'='*80}")
            print(f"SIGNATURE GENERATION - Step 4: Signing with RSA SHA-256 + PKCS#1")
            print(f"JSON String to sign (length: {len(json_string)}): {json_string}")
            print(f"{'='*80}\n")
            
            signature_bytes = private_key.sign(
                json_string.encode('utf-8'),
                padding.PKCS1v15(),
                hashes.SHA256()
            )

            # Step 5: Base64 encode the signature
            signature_base64 = base64.b64encode(signature_bytes).decode('utf-8')
            logger.info(f"Signature generated successfully (length: {len(signature_base64)})")
            logger.debug(f"Signature (first 50 chars): {signature_base64[:50]}...")
            print(f"\n{'='*80}")
            print(f"SIGNATURE GENERATION - Step 5: Base64 Encoded")
            print(f"Signature length: {len(signature_base64)} characters")
            print(f"Signature (first 100 chars): {signature_base64[:100]}...")
            print(f"{'='*80}\n")
            return signature_base64, timestamp
        except Exception as e:
            error_msg = f"Signature generation failed: {str(e)}"
            logger.error(error_msg)
            logger.error(f"Full traceback:\n{traceback.format_exc()}")
            print(f"\n{'='*80}")
            print(f"SIGNATURE GENERATION ERROR:")
            print(f"Error: {error_msg}")
            print(f"Full traceback:\n{traceback.format_exc()}")
            print(f"{'='*80}\n")
            raise Exception(error_msg)

    def _prepare_request_body(self, data_model: Dict) -> Dict:
        """
        Prepare the final request body with data, signature, and timestamp
        Important: timestamp must be the same value used in signature generation
        """
        # Generate signature (this also generates the timestamp)
        signature, timestamp = self._generate_signature(data_model)

        # Base64 encode the original data model (not sorted, as per documentation)
        # The data field contains the original payload DataModel JSON
        data_json = json.dumps(data_model, separators=(',', ':'), ensure_ascii=False)
        data_base64 = base64.b64encode(data_json.encode('utf-8')).decode('utf-8')
        
        logger.debug(f"Request body prepared - data length: {len(data_base64)}, signature length: {len(signature)}")
        logger.debug(f"Timestamp: {timestamp}")
        
        print(f"\n{'='*80}")
        print(f"REQUEST BODY PREPARATION:")
        print(f"Data Model (original): {json.dumps(data_model, indent=2)}")
        print(f"Data JSON (compact): {data_json}")
        print(f"Data Base64 length: {len(data_base64)}")
        print(f"Signature length: {len(signature)}")
        print(f"Timestamp: {timestamp}")
        print(f"{'='*80}\n")

        return {
            "data": data_base64,
            "signature": signature,
            "timestamp": timestamp  # Must match TimeStamp in signing model
        }

    def _make_api_request(self, endpoint: str, data_model: Dict) -> Dict:
        """Make authenticated API request to Service Hub"""
        try:
            # Get JWT token
            token = self._get_jwt_token()

            # Prepare request body
            request_body = self._prepare_request_body(data_model)

            # Make request
            url = f"{self.base_url}{endpoint}"
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }

            logger.info(f"Making API request to {url}")
            logger.debug(f"Request payload keys: {list(request_body.keys())}")
            
            print(f"\n{'='*80}")
            print(f"MAKING API REQUEST:")
            print(f"URL: {url}")
            print(f"Headers: {json.dumps(headers, indent=2)}")
            print(f"Request Body Keys: {list(request_body.keys())}")
            print(f"Request Body (data length: {len(request_body.get('data', ''))}, signature length: {len(request_body.get('signature', ''))})")
            print(f"{'='*80}\n")
            
            response = requests.post(url, json=request_body, headers=headers, timeout=30)
            response.raise_for_status()
            response_data = response.json()
            
            logger.info(f"API response code: {response_data.get('Code', 'N/A')}, message: {response_data.get('Message', 'N/A')}")
            print(f"\n{'='*80}")
            print(f"API RESPONSE:")
            print(f"Code: {response_data.get('Code', 'N/A')}")
            print(f"Message: {response_data.get('Message', 'N/A')}")
            print(f"Full Response: {json.dumps(response_data, indent=2)}")
            print(f"{'='*80}\n")
            
            return response_data
        except requests.RequestException as e:
            error_msg = f"Service Hub API error for endpoint {endpoint}: {str(e)}"
            logger.error(error_msg)
            logger.error(f"Request URL: {url}")
            logger.error(f"Request headers: {headers}")
            logger.error(f"Request payload keys: {list(request_body.keys())}")
            
            print(f"\n{'='*80}")
            print(f"API REQUEST ERROR:")
            print(f"Error: {error_msg}")
            print(f"Request URL: {url}")
            print(f"Request headers: {json.dumps(headers, indent=2)}")
            print(f"Request payload keys: {list(request_body.keys())}")
            
            if hasattr(e, 'response') and e.response is not None:
                logger.error(f"Response status code: {e.response.status_code}")
                logger.error(f"Response headers: {dict(e.response.headers)}")
                print(f"Response status code: {e.response.status_code}")
                print(f"Response headers: {dict(e.response.headers)}")
                try:
                    error_detail = e.response.json()
                    error_msg += f" Response: {error_detail}"
                    logger.error(f"API error response (JSON): {json.dumps(error_detail, indent=2)}")
                    print(f"API error response (JSON): {json.dumps(error_detail, indent=2)}")
                    
                    # Check for signature verification errors
                    if isinstance(error_detail, dict):
                        errors = error_detail.get('Errors', [])
                        for err in errors:
                            if 'signature' in err.get('Message', '').lower():
                                print(f"\n{'!'*80}")
                                print(f"SIGNATURE VERIFICATION FAILED!")
                                print(f"Error Message: {err.get('Message', '')}")
                                print(f"{'!'*80}\n")
                except:
                    error_text = e.response.text[:500] if len(e.response.text) > 500 else e.response.text
                    error_msg += f" Response status: {e.response.status_code}, text: {error_text}"
                    logger.error(f"API error status: {e.response.status_code}")
                    logger.error(f"API error response (text): {error_text}")
                    print(f"API error status: {e.response.status_code}")
                    print(f"API error response (text): {error_text}")
            else:
                logger.error("No response object available in exception")
                print("No response object available in exception")
            
            logger.error(f"Full traceback:\n{traceback.format_exc()}")
            print(f"Full traceback:\n{traceback.format_exc()}")
            print(f"{'='*80}\n")
            raise Exception(error_msg)
        except Exception as e:
            error_msg = f"Unexpected error in Service Hub API request for endpoint {endpoint}: {str(e)}"
            logger.error(error_msg)
            logger.error(f"Full traceback:\n{traceback.format_exc()}")
            print(f"\n{'='*80}")
            print(f"UNEXPECTED ERROR in Service Hub API request:")
            print(f"Endpoint: {endpoint}")
            print(f"Error: {error_msg}")
            print(f"Full traceback:\n{traceback.format_exc()}")
            print(f"{'='*80}\n")
            raise Exception(error_msg)

    def topup_ntc(self, mobile_number: str, amount: float, user_login_number: str, 
                  created_platform: str, merchant_txn_id: str, created_ip: str = "192.168.1.1") -> Dict:
        """
        Topup NTC mobile number
        ProductId: 1 for NTC
        Amount should be string without decimals for whole numbers (e.g., "50" not "50.00")
        """
        # Format amount: remove unnecessary decimals for whole numbers
        amount_float = float(amount)
        if amount_float == int(amount_float):
            # Whole number - use string without decimals
            amount_str = str(int(amount_float))
        else:
            # Has decimals - format with 2 decimal places
            amount_str = "{:.2f}".format(amount_float)
        
        # Amount in data model must be string (as per API documentation)
        data_model = {
            "MobileNumber": mobile_number,
            "Amount": amount_str,  # String in data model (as per documentation)
            "ProductId": 1,
            "UserLoginNumber": user_login_number,
            "CreatedPlatform": created_platform,
            "CreatedIp": created_ip,
            "MerchantTxnId": merchant_txn_id
        }

        logger.info(f"Processing NTC topup: mobile={mobile_number}, amount={amount_str}, txn_id={merchant_txn_id}")
        
        # Check if API bypass is enabled
        if self.bypass_api:
            logger.warning("API bypass is enabled - returning mock success response without making API call")
            print(f"\n{'='*80}")
            print(f"API BYPASS ENABLED - Returning mock success response")
            print(f"Mobile: {mobile_number}, Amount: {amount_str}, Txn ID: {merchant_txn_id}")
            print(f"{'='*80}\n")
            return {
                "Code": "0",
                "Message": "Success"
            }
        
        endpoint = "/gateway/topup/mobiletopup"
        return self._make_api_request(endpoint, data_model)

    def topup_ncell(self, mobile_number: str, amount: float, user_login_number: str,
                    created_platform: str, merchant_txn_id: str, created_ip: str = "192.168.1.1") -> Dict:
        """
        Topup NCELL mobile number
        ProductId: 2 for NCELL
        Amount should be string without decimals for whole numbers (e.g., "60" not "60.00")
        """
        # Format amount: remove unnecessary decimals for whole numbers
        amount_float = float(amount)
        if amount_float == int(amount_float):
            # Whole number - use string without decimals
            amount_str = str(int(amount_float))
        else:
            # Has decimals - format with 2 decimal places
            amount_str = "{:.2f}".format(amount_float)
        
        # Amount in data model must be string (as per API documentation)
        data_model = {
            "MobileNumber": mobile_number,
            "Amount": amount_str,  # String in data model (as per documentation)
            "ProductId": 2,
            "UserLoginNumber": user_login_number,
            "CreatedPlatform": created_platform,
            "CreatedIp": created_ip,
            "MerchantTxnId": merchant_txn_id
        }

        logger.info(f"Processing NCELL topup: mobile={mobile_number}, amount={amount_str}, txn_id={merchant_txn_id}")
        
        # Check if API bypass is enabled
        if self.bypass_api:
            logger.warning("API bypass is enabled - returning mock success response without making API call")
            print(f"\n{'='*80}")
            print(f"API BYPASS ENABLED - Returning mock success response")
            print(f"Mobile: {mobile_number}, Amount: {amount_str}, Txn ID: {merchant_txn_id}")
            print(f"{'='*80}\n")
            return {
                "Code": "0",
                "Message": "Success"
            }
        
        endpoint = "/gateway/topup/mobiletopup"
        return self._make_api_request(endpoint, data_model)
