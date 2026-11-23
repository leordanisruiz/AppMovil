import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import typescript from 'typescript';

function createService(platform, lastData) {
  const source = readFileSync(new URL('../src/services/notificationService.native.ts', import.meta.url), 'utf8');
  const compiled = typescript.transpile(source, {
    module: typescript.ModuleKind.CommonJS,
    target: typescript.ScriptTarget.ES2022,
  });
  let onResponse;
  const notification = (data) => ({ notification: { request: { content: { data } } } });
  const modules = {
    'react-native': { Platform: { OS: platform }, AppState: { currentState: 'active' } },
    'expo-notifications': {
      AndroidImportance: { HIGH: 4, MAX: 5 },
      getLastNotificationResponse: () => lastData ? notification(lastData) : null,
      clearLastNotificationResponse: () => {},
      addNotificationReceivedListener: () => ({ remove() {} }),
      addNotificationResponseReceivedListener: (listener) => {
        onResponse = listener;
        return { remove() {} };
      },
    },
    'expo-constants': { default: {} },
  };
  const module = { exports: {} };
  runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: (name) => {
      assert.ok(name in modules);
      return modules[name];
    },
  });
  return {
    service: module.exports,
    respond: (data) => onResponse(notification(data)),
  };
}

for (const platform of ['android', 'ios']) {
  test(`${platform}: asignación y cierre abren tareas del operador`, () => {
    const destinations = [];
    let refreshes = 0;
    const { service, respond } = createService(platform, { tipo: 'tarea', id_tarea: 55 });
    const unsubscribe = service.subscribeToNoveltyNavigation(
      () => assert.fail('No debe abrir novedades'),
      () => { refreshes += 1; },
      (destination) => destinations.push(destination),
    );
    respond({ tipo: 'tarea', evento: 'cambio_estado', estado: 'CERRADA', id_tarea: 55 });
    assert.deepEqual(destinations, ['asignadas', 'asignadas']);
    assert.equal(refreshes, 2);
    unsubscribe();
  });

  test(`${platform}: una tarea completada abre tareas creadas`, () => {
    const destinations = [];
    const { service, respond } = createService(platform, null);
    service.subscribeToNoveltyNavigation(
      () => assert.fail('No debe abrir novedades'),
      () => {},
      (destination) => destinations.push(destination),
    );
    respond({ tipo: 'tarea', evento: 'cambio_estado', estado: 'COMPLETADA', id_tarea: 55 });
    assert.deepEqual(destinations, ['creadas']);
  });
}
