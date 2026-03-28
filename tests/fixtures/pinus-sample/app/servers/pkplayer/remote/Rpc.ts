export class Rpc {
    async updateUserAsset(uid: number, payload: any) {
        const pl = {
            notify(route: string, message: any) {
                return { route, message };
            },
        };

        pl.notify('updateUserAsset', payload);
        return { uid, payload };
    }
}
