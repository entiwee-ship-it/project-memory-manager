export function generateCaptcha() {
  return {
    key: 'captcha-key',
    code: '1234'
  };
}

export async function saveCaptcha(key, code) {
  return `${key}:${code}`;
}
