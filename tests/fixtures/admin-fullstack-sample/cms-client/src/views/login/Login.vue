<template>
  <form @submit.prevent="handleLogin">
    <input v-model="form.username" name="username" />
    <input v-model="form.password" name="password" />
    <button type="submit">login</button>
  </form>
</template>

<script setup>
import { reactive, onMounted } from 'vue';
import { authApi } from '../../api/authApi';

const form = reactive({
  username: '',
  password: '',
  captcha: ''
});

async function initCaptcha() {
  const result = await authApi.getCaptcha();
  form.captcha = result.code;
}

async function handleLogin() {
  await authApi.login(form);
}

onMounted(() => {
  initCaptcha();
});
</script>

<style scoped>
form {
  display: grid;
  gap: 8px;
}
</style>
