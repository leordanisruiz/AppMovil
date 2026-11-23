import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import typescript from 'typescript';

function createService(notifications, platform = 'android') {
  const source = readFileSync(new URL('../src/services/notificationService.native.ts', import.meta.url), 'utf8');
  const compiled = typescript.transpile(source, {
    module: typescript.ModuleKind.CommonJS,
    target: typescript.ScriptTarget.ES2022,
  });
  const module = { exports: {} };
  const modules = {
    'react-native': { Platform: { OS: platform }, AppState: { currentState: 'active' } },
    'expo-notifications': {
      AndroidImportance: { LOW: 2, HIGH: 4, MAX: 5 },
      ...notifications,
    },
    'expo-constants': { default: {} },
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

test('limpia el contador de novedades sin quitar notificaciones de tareas', async () => {
  let badgeCount;
  const service = createService({
    getPresentedNotificationsAsync: async () => [
      { request: { content: { data: { tipo: 'tarea' } } } },
    ],
    setBadgeCountAsync: async (value) => { badgeCount = value; return true; },
  });
  await service.syncAppBadge(0);
  assert.equal(badgeCount, 0);
});

test('limpia el badge cuando solo hay avisos de novedades', async () => {
  let count;
  const service = createService({
    getPresentedNotificationsAsync: async () => [
      { request: { content: { data: { tipo: 'novedad' } } } },
    ],
    setBadgeCountAsync: async (value) => { count = value; return true; },
  });
  await service.syncAppBadge(0);
  assert.equal(count, 0);
});

test('informa si el launcher rechaza actualizar el badge', async () => {
  const service = createService({ setBadgeCountAsync: async () => false }, 'ios');
  await assert.rejects(service.syncAppBadge(3), /lanzador/);
});
