import crypto from 'crypto';

const key = crypto.randomBytes(32).toString('base64');

console.log('Generated TOKEN_ENCRYPTION_KEY (base64, 32 bytes):');
console.log(key);
console.log('');
console.log('Add this to your .env:');
console.log(`TOKEN_ENCRYPTION_KEY=${key}`);
