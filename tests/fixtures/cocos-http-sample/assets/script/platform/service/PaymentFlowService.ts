import { PayApi } from 'db://assets/script/platform/common/PayApi';
import { DirectHttpApi } from 'db://assets/script/platform/common/DirectHttpApi';

export class PaymentFlowService {
    async checkPaymentStatus(orderId: string) {
        return PayApi.getOrderPayment(orderId);
    }

    async runDirectRequests(orderId: string) {
        await DirectHttpApi.sendInlineRequest(orderId);
        await DirectHttpApi.sendFetchRequest(orderId);
        await DirectHttpApi.sendAxiosConfig(orderId);
        return DirectHttpApi.sendAxiosCall(orderId);
    }
}
