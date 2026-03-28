import { DaMaZiGameApi } from 'db://assets/script/game/DaMaZiGameApi';

export class DaMaZiView {
    phase = 'idle';
    teamupAnimating = true;

    scheduleOnce(callback: (...args: any[]) => unknown, _delay: number) {
        return callback();
    }

    async onClickPut(card: number) {
        return this.doAfterHands(card);
    }

    doAfterHands(card: number) {
        this.phase = 'afterHands';
        if (this.teamupAnimating) {
            this.phase = 'teamup';
            return this.scheduleOnce(() => this.enterPutPhase(card), 1.2);
        }
        return this.enterPutPhase(card);
    }

    enterPutPhase(card: number) {
        this.phase = 'waitPut';
        this.teamupAnimating = false;
        return DaMaZiGameApi.sendPut(card);
    }
}
