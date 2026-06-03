class ApiClient {
  constructor(basePath) {
    this.basePath = basePath;
  }

  get(path) {
    return fetch(`${this.basePath}${path}`);
  }

  post(path, data) {
    return fetch(`${this.basePath}${path}`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }
}

export class AuthApi extends ApiClient {
  constructor() {
    super('/auth');
  }

  getCaptcha() {
    return this.get('/captcha');
  }

  login(data) {
    return this.post('/login', data);
  }
}

export const authApi = new AuthApi();
