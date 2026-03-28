export class Net {
    static inst = new Net();

    tableMsg(payload: { cmd: string; card?: number }) {
        return Promise.resolve(payload);
    }
}
