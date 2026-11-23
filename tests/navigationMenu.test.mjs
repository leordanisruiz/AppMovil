import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import typescript from 'typescript';

const source = readFileSync(new URL('../src/constants/navigationMenu.ts', import.meta.url), 'utf8');
const compiled = typescript.transpile(source, {
  module: typescript.ModuleKind.CommonJS,
  target: typescript.ScriptTarget.ES2022,
});
function loadMenu(platform, open, assign) {
  const module = { exports: {} };
  runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: (name) => {
      assert.equal(name, 'react-native');
      return { Platform: { OS: platform }, Linking: { openURL: open } };
    },
    window: { location: { assign } },
  });
  return module.exports;
}

const { getVisibleMenuItems } = loadMenu('web');

test('la programación aparece únicamente en el menú del operador', () => {
  const operatorItems = getVisibleMenuItems(false, true);
  const schedule = operatorItems.find((item) => item.value === 'programacion');
  assert.equal(schedule?.label, 'Tu Programación');
  assert.equal(schedule?.description, 'Programación enlinea desde la web de suma');
  assert.equal(operatorItems.some((item) => item.value === 'novedades'), true);

  for (const [canAssignTasks, isOperator] of [[true, false], [false, false]]) {
    assert.equal(
      getVisibleMenuItems(canAssignTasks, isOperator).some((item) => item.value === 'programacion'),
      false,
    );
  }
});

test('redirige al enlace solicitado en la web y abre el navegador en el celular', async () => {
  for (const platform of ['web', 'android', 'ios']) {
    const calls = [];
    const { openSchedulePage } = loadMenu(
      platform,
      async (url) => calls.push(['native', url]),
      (url) => calls.push(['web', url]),
    );
    await openSchedulePage();
    assert.deepEqual(calls, [[
      platform === 'web' ? 'web' : 'native',
      'https://www.sumasas.com/user/',
    ]]);
  }
});

test('informa el error si no se puede abrir el navegador', async () => {
  const { openSchedulePage } = loadMenu('android', async () => {
    throw new Error('Navegador no disponible');
  });
  await assert.rejects(openSchedulePage(), /Navegador no disponible/);
});
