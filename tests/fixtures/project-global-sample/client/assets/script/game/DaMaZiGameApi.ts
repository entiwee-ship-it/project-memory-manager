import { Net } from 'db://assets/script/network/Net';

export class DaMaZiGameApi {
    static async sendPut(card: number) {
        return Net.inst.tableMsg({
            cmd: 'PKPut',
            card,
        });
    }
}
