import { authApi } from './modules/authApi.js';

export const api = {
  get auth() {
    return authApi;
  }
};
