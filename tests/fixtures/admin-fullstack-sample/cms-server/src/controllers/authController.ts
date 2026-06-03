import { generateCaptcha, saveCaptcha } from '../services/captchaService';

export class AuthController {
  async getClassCaptcha(req, res) {
    const captcha = generateCaptcha();
    await saveCaptcha(captcha.key, captcha.code);
    res.json(captcha);
  }
}

export const authController = {
  async getCaptcha(req, res) {
    const captcha = generateCaptcha();
    await saveCaptcha(captcha.key, captcha.code);
    res.json(captcha);
  },

  async login(req, res) {
    res.json({ token: 'sample-token' });
  }
};
