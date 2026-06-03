import { Router } from 'express';
import { authController, AuthController } from '../controllers/authController';

const router = Router();
const classAuthController = new AuthController();

router.get('/captcha', authController.getCaptcha);
router.get('/classCaptcha', classAuthController.getClassCaptcha);
router.post('/login', authController.login);

export default router;
