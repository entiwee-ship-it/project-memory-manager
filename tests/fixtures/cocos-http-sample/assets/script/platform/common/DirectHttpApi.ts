import { HttpClient } from 'db://assets/script/network/http/HttpClient';

export class DirectHttpApi {
    static async sendInlineRequest(orderId: string) {
        return HttpClient.getInstance().request({
            url: '/direct/request',
            method: 'PUT',
            data: { orderId },
        });
    }

    static async sendFetchRequest(orderId: string) {
        return fetch('/direct/fetch', {
            method: 'POST',
            body: JSON.stringify({ orderId }),
        });
    }

    static async sendAxiosConfig(orderId: string) {
        return axios.request({
            url: '/direct/axios',
            method: 'GET',
            data: { orderId },
        });
    }

    static async sendAxiosCall(orderId: string) {
        return axios({
            url: '/direct/axios-call',
            method: 'DELETE',
            data: { orderId },
        });
    }
}
