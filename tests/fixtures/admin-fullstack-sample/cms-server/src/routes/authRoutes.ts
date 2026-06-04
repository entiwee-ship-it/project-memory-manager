import { Router } from 'express';
import { authController, AuthController } from '../controllers/authController';
import { saveCaptcha } from '../services/captchaService';

const router = Router();
const classAuthController = new AuthController();

router.get('/captcha', authController.getCaptcha);
router.get('/classCaptcha', classAuthController.getClassCaptcha);
router.post('/login', authController.login);
router.get('/inlineStatus', async (_req, res) => {
  await saveCaptcha('inline-status', 'ok');
  res.json({ ok: true });
});

export default router;
