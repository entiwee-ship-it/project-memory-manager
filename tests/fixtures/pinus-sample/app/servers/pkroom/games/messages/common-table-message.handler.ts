export class CommonTableMessageHandler {
    static register(registry: any) {
        const unrelatedPairs = [
            ['notAProtocol', this.handleUnrelated],
        ];
        const sourceExample = "registry.registerMany('fake', [['stringProtocol', this.handleUnrelated]])";
        // registry.registerMany('fake', [['commentProtocol', this.handleUnrelated]]);
        const analytics = { registerMany: (...args: any[]) => args };
        analytics.registerMany('analytics', [
            ['notTableProtocol', this.handleUnrelated],
        ]);
        registry.registerMany('common-table-message', [
            ['reqSyncTable', this.handleRequestSyncTable],
        ]);
        return { unrelatedPairs, sourceExample };
    }

    static async handleRequestSyncTable(table: any, player: any, message: any) {
        return { table, player, message };
    }

    static async handleUnrelated() {
        return null;
    }
}
