export class HttpClient {
    static getInstance() {
        return new HttpClient();
    }

    get(url: string, params?: unknown) {
        return Promise.resolve({ data: { url, params } });
    }

    post(url: string, data?: unknown) {
        return Promise.resolve({ data: { url, data } });
    }

    request(config: { url: string; method?: string; data?: unknown }) {
        return Promise.resolve({ data: config });
    }
}
