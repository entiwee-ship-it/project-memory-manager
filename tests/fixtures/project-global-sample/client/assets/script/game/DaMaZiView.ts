import { DaMaZiGameApi } from 'db://assets/script/game/DaMaZiGameApi';

export class DaMaZiView {
    async onClickPut(card: number) {
        return DaMaZiGameApi.sendPut(card);
    }
}
