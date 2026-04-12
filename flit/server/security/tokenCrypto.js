import crypto from 'crypto';

const CIPHER = 'aes-256-gcm';
const IV_BYTES = 12;

function getCryptoKey() {
  const base64Key = process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!base64Key || base64Key === 'REPLACE_WITH_BASE64_32_BYTE_KEY') {
    throw new Error('TOKEN_ENCRYPTION_KEY is missing or placeholder value');
  }

  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes for AES-256-GCM');
  }

  return key;
}

function getKeyVersion() {
  const parsed = Number(process.env.TOKEN_KEY_VERSION ?? 1);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.floor(parsed);
}

export function encryptSecret(plainText) {
  if (typeof plainText !== 'string' || !plainText.trim()) {
    throw new Error('encryptSecret requires a non-empty string');
  }

  const key = getCryptoKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(CIPHER, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    encryptedToken: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    keyVersion: getKeyVersion(),
  };
}

export function decryptSecret({ encryptedToken, iv, authTag }) {
  if (!encryptedToken || !iv || !authTag) {
    throw new Error('decryptSecret requires encryptedToken, iv, and authTag');
  }

  const key = getCryptoKey();
  const decipher = crypto.createDecipheriv(
    CIPHER,
    key,
    Buffer.from(iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedToken, 'base64')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}