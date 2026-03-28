import { TableMsg } from '../games/modules/TableMsg';

export class handler {
    async tableMsg(msg: any) {
        return TableMsg.inst.handleMsg(msg.cmd, {
            NotifyAll(route: string, payload: any) {
                return { route, payload };
            },
        }, null, msg);
    }
}
