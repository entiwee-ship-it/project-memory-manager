import { redisClient } from '../app';

export function generateCaptcha() {
  return {
    key: 'captcha-key',
    code: '1234'
  };
}

export async function saveCaptcha(key, code) {
  return redisClient.set(key, code);
}
