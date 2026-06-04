<template>
  <form @submit.prevent="handleLogin">
    <input v-model="form.username" name="username" />
    <input v-model="form.password" name="password" />
    <button type="submit">login</button>
  </form>
</template>

<script setup>
import { reactive, onMounted } from 'vue';
import { api } from '@/utils/api';

const form = reactive({
  username: '',
  password: '',
  captcha: ''
});

async function initCaptcha() {
  const result = await api.auth.getCaptcha();
  form.captcha = result.code;
}

async function handleLogin() {
  if (!validateCaptcha()) {
    showError('captcha is required');
    return;
  }
  await api.auth.login(form);
  saveLoginInfo();
  refreshCaptcha();
}

function validateCaptcha() {
  return form.captcha.length > 0;
}

function showError(message) {
  form.error = message;
}

function saveLoginInfo() {
  form.lastLogin = form.username;
}

function refreshCaptcha() {
  initCaptcha();
}

function resetAuthState() {
  if (window.$requestService?.resetAuthState) {
    window.$requestService.resetAuthState();
  }
}

onMounted(() => {
  initCaptcha();
  resetAuthState();
});
</script>

<style scoped>
form {
  display: grid;
  gap: 8px;
}
</style>
