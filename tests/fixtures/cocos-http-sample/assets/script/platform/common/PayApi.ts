import { HttpClient } from 'db://assets/script/network/http/HttpClient';

export class PayApi {
    static async getOrderPayment(orderId: string) {
        const params = {
            orderId,
        };
        const response = await HttpClient.getInstance().post('/order/pay/getOrderPayment', params);
        return response.data;
    }
}
