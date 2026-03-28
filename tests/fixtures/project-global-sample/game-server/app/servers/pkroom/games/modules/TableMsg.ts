export class TableMsg {
    waitPut = true;

    init() {
        this.regHandler('PKPut', this.pkPut);
    }

    regHandler(_cmd: string, _handler: (...args: any[]) => unknown) {}

    handleMsg(cmd: string) {
        switch (cmd) {
            case 'PKPut':
                return this.pkPut();
            default:
                return null;
        }
    }

    pkPut() {
        if (!this.waitPut) {
            return false;
        }
        this.waitPut = false;
        this.pkPutCard();
        this.waitPut = true;
        return true;
    }

    pkPutCard() {
        return 'put-card';
    }
}
