import { Router } from 'express';
import { GoldenEggEvent } from '../../../modules/activity/goldenEgg';

const router = Router();

router.get('/getGoldenEggReward', async (req: any, res: any) => {
    const userId = Number(req.userId || 1);
    const result = await GoldenEggEvent.getGoldenEggReward(userId);
    return res.json(result);
});

module.exports = router;
