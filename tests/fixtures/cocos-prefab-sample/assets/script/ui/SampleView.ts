import { Button, Node, Prefab, SpriteFrame } from 'cc';
import { CardSlot } from './CardSlot';

export class SampleView {
    public actionNode: Node | null = null;
    public actionButton: Button | null = null;
    public iconSprite: SpriteFrame | null = null;
    public slotPrefab: Prefab | null = null;
    public slotView: CardSlot | null = null;
    public slotNode: Node | null = null;
    public rewardSprite: SpriteFrame | null = null;
    public slotHelper: CardSlot | null = null;
    public delayMs: number = 0.25;

    public onClickStart() {
        this.syncBindings();
    }

    public syncBindings() {
        return 'ok';
    }
}
