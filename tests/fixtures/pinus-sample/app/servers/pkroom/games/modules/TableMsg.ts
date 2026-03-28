type MsgHandler = (tb: any, pl: any, msg: any) => Promise<any> | any;

export class TableMsg {
    private handlers: Map<string, MsgHandler>;

    static inst = new TableMsg();

    constructor() {
        this.handlers = new Map<string, MsgHandler>();
    }

    regHandler(msgName: string, handler: MsgHandler) {
        this.handlers.set(msgName, handler);
    }

    async handleMsg(msgName: string, tb: any, pl: any, msg: any) {
        const handler = this.handlers.get(msgName);
        if (!handler) {
            return null;
        }
        return handler(tb, pl, msg);
    }

    init() {
        this.regHandler('reqSyncTable', this.reqSyncTable);
    }

    async reqSyncTable(tb: any, pl: any, msg: any) {
        tb.NotifyAll('syncTable', { ok: true, msg });
        return { tb, pl, msg };
    }
}
