type MsgHandler = (tb: any, pl: any, msg: any) => Promise<any> | any;
declare const eventBus: any;

export class TableMsg {
    private handlers: Map<string, MsgHandler>;
    private syncState: any;

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
        eventBus.on('tableSynced', this.handleTableSynced, this);
    }

    async reqSyncTable(tb: any, pl: any, msg: any) {
        this.syncState = msg;
        tb.NotifyAll('syncTable', { ok: true, msg });
        if (this.syncState) {
            eventBus.emit('tableSynced');
        }
        return { tb, pl, msg };
    }

    async handleTableSynced() {
        if (!this.syncState) {
            return null;
        }
        return this.syncState;
    }
}
