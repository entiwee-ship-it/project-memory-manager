export const redisClient = {
  set(key, value) {
    return `${key}:${value}`;
  }
};
