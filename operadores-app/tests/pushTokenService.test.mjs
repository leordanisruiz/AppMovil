import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import typescript from 'typescript';

function createService(httpClient, tokenStorage) {
  const source = readFileSync(new URL('../src/services/pushTokenService.ts', import.meta.url), 'utf8');
  const compiled = typescript.transpile(source, {
    module: typescript.ModuleKind.CommonJS,
    target: typescript.ScriptTarget.ES2022,
  });
  const module = { exports: {} };
  const modules = {
    'react-native': { Platform: { OS: 'android' } },
    axios: { isAxiosError: (error) => error?.isAxiosError === true },
    '../api/httpClient': { httpClient },
    './notificationService': {
      areNativeNotificationsAvailable: () => true,
      getExpoPushToken: async () => 'new-token',
      requestNotificationPermission: async () => true,
    },
    './tokenStorage': { tokenStorage },
  };
  runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: (name) => {
      assert.ok(name in modules);
      return modules[name];
    },
  });
  return module.exports;
}

test('desactiva el token anterior después de registrar el nuevo', async () => {
  const calls = [];
  const service = createService(
    {
      post: async (_path, body) => {
        calls.push(`post:${body.expo_push_token}`);
        return { data: { registrado: true } };
      },
      delete: async (_path, config) => {
        calls.push(`delete:${config.data.expo_push_token}`);
      },
    },
    {
      getPushToken: async () => 'old-token',
      savePushToken: async (token) => calls.push(`save:${token}`),
    },
  );
  await service.registerDeviceForPushNotifications();
  assert.deepEqual(calls, ['post:new-token', 'delete:old-token', 'save:new-token']);
});

test('conserva el token anterior para reintentar si falla su desactivación', async () => {
  let saved = false;
  const service = createService(
    {
      post: async () => ({ data: { registrado: true } }),
      delete: async () => { throw new Error('red no disponible'); },
    },
    {
      getPushToken: async () => 'old-token',
      savePushToken: async () => { saved = true; },
    },
  );
  await assert.rejects(service.registerDeviceForPushNotifications(), /red no disponible/);
  assert.equal(saved, false);
});
