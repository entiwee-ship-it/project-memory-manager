import { goldenEggLotteryRecordTable } from '../../db/schema/activity/goldenEggLotteryRecordSchema';
import { goldenEggUserInfoTable } from '../../db/schema/activity/goldenEggUserInfoSchema';
import { tbUserAccount } from '../../db/schema/users';
import { Utils } from '../../common/utils';

declare const db: any;
declare const global: any;

export namespace GoldenEggEvent {
    export async function getGoldenEggReward(userId: number) {
        await db.select({}).from(goldenEggUserInfoTable).where({ userId });
        await db.update(goldenEggUserInfoTable).set({ lotteryCount: 0 }).where({ userId });
        await db.insert(goldenEggLotteryRecordTable).values({ userId });
        await db.update(tbUserAccount).set({ gold: 1 }).where({ userId });
        await global.App.rpc.pkplayer.Rpc.updateUserAsset(Utils.pkplayerDispatch(userId), userId, { $inc: { gold: 1 } });
        return { code: 0, message: 'ok', data: null };
    }
}
