import { Router } from 'express';
import authRoutes from './authRoutes';

const router = Router();

router.use('/api/auth', authRoutes);

export default router;
