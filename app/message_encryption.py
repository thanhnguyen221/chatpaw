"""
Message Encryption Module - Handles encryption/decryption of messages
Uses Fernet symmetric encryption for secure message storage
"""
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
import base64
import os
from typing import Optional


class MessageEncryption:
    """Handles encryption and decryption of message content"""
    
    def __init__(self, key: Optional[str] = None):
        """
        Initialize encryption with a key
        If no key provided, generates one from environment or creates new
        """
        if key:
            # Use provided key (must be 32 bytes base64-encoded)
            self.key = key.encode() if isinstance(key, str) else key
        else:
            # Try to get from environment, or generate from secret
            env_key = os.environ.get('MESSAGE_ENCRYPTION_KEY')
            if env_key:
                self.key = env_key.encode()
            else:
                # Generate a key from environment secret
                secret = os.environ.get('MESSAGE_ENCRYPTION_SECRET')
                if not secret:
                    raise ValueError("MESSAGE_ENCRYPTION_SECRET must be set in environment variables")
                self.key = self._generate_key_from_secret(secret)
        
        self.cipher_suite = Fernet(self.key)
    
    def _generate_key_from_secret(self, secret: str, salt: Optional[bytes] = None) -> bytes:
        """Generate a Fernet key from a secret string"""
        if salt is None:
            # Use salt from env (in production, store salt separately)
            env_salt = os.environ.get('MESSAGE_ENCRYPTION_SALT')
            if not env_salt:
                raise ValueError("MESSAGE_ENCRYPTION_SALT must be set in environment variables")
            salt = env_salt.encode() if isinstance(env_salt, str) else env_salt
        
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
        )
        key = base64.urlsafe_b64encode(kdf.derive(secret.encode()))
        return key
    
    def encrypt(self, content: str) -> str:
        """
        Encrypt message content
        
        Args:
            content: Plain text message content
            
        Returns:
            Encrypted content as base64 string
        """
        if not content:
            return content
            
        try:
            # Convert to bytes and encrypt
            content_bytes = content.encode('utf-8')
            encrypted_bytes = self.cipher_suite.encrypt(content_bytes)
            # Return as string for JSON serialization
            return encrypted_bytes.decode('utf-8')
        except Exception as e:
            print(f"Encryption error: {e}")
            # Return original content if encryption fails
            return content
    
    def decrypt(self, encrypted_content: str) -> str:
        """
        Decrypt message content
        
        Args:
            encrypted_content: Encrypted content string
            
        Returns:
            Decrypted plain text content
        """
        if not encrypted_content:
            return encrypted_content
            
        # Check if content looks encrypted (Fernet tokens start with 'gAAAA')
        if not encrypted_content.startswith('gAAAA'):
            # Not encrypted, return as-is
            return encrypted_content
            
        try:
            # Convert to bytes and decrypt
            encrypted_bytes = encrypted_content.encode('utf-8')
            decrypted_bytes = self.cipher_suite.decrypt(encrypted_bytes)
            return decrypted_bytes.decode('utf-8')
        except Exception as e:
            print(f"Decryption error: {e}")
            # Return original content if decryption fails
            return encrypted_content
    
    def encrypt_dict_content(self, message_dict: dict) -> dict:
        """
        Encrypt content field in a message dictionary
        
        Args:
            message_dict: Message dictionary with 'content' field
            
        Returns:
            Message dictionary with encrypted content
        """
        if 'content' in message_dict and message_dict['content']:
            message_dict['content'] = self.encrypt(message_dict['content'])
            message_dict['encrypted'] = True
        return message_dict
    
    def decrypt_dict_content(self, message_dict: dict) -> dict:
        """
        Decrypt content field in a message dictionary
        
        Args:
            message_dict: Message dictionary with encrypted 'content' field
            
        Returns:
            Message dictionary with decrypted content
        """
        if 'content' in message_dict and message_dict['content']:
            message_dict['content'] = self.decrypt(message_dict['content'])
            # Remove encryption flag if present
            message_dict.pop('encrypted', None)
        return message_dict


# Singleton instance for global use
_encryption_instance = None


def get_encryption() -> MessageEncryption:
    """Get or create singleton encryption instance"""
    global _encryption_instance
    if _encryption_instance is None:
        _encryption_instance = MessageEncryption()
    return _encryption_instance


def encrypt_message(content: str) -> str:
    """Convenience function to encrypt a message"""
    return get_encryption().encrypt(content)


def decrypt_message(encrypted_content: str) -> str:
    """Convenience function to decrypt a message"""
    return get_encryption().decrypt(encrypted_content)


def generate_new_key() -> str:
    """Generate a new encryption key (for setup purposes)"""
    key = Fernet.generate_key()
    return key.decode('utf-8')
