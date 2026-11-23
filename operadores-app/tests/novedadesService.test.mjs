import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import typescript from 'typescript';

function createService(httpClient) {
  const source = readFileSync(new URL('../src/services/novedadesService.ts', import.meta.url), 'utf8');
  const compiled = typescript.transpile(source, {
    module: typescript.ModuleKind.CommonJS,
    target: typescript.ScriptTarget.ES2022,
  });
  const module = { exports: {} };
  runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: (name) => {
      assert.equal(name, '../api/httpClient');
      return { httpClient };
    },
  });
  return module.exports.novedadesService;
}

test('consulta las cuatro categorías y suma ISV al total', async () => {
  const counts = { ico: 4, inasistencias: 10, danos: 5, isv: 3 };
  const calls = [];
  const service = createService({
    post: async (path, body) => {
      calls.push({ path, ...body });
      return { data: { total: counts[body.categoria], novedades: [] } };
    },
  });

  const result = await service.getAll(' 810074 ');

  assert.equal(result.total, 22);
  assert.equal(result.categorias.isv.total, 3);
  assert.deepEqual(calls.map((call) => call.categoria), ['ico', 'inasistencias', 'danos', 'isv']);
  assert.ok(calls.every((call) => call.path === '/novedades/consultar' && call.codigo_operador === '810074'));
});

test('propaga errores de ISV sin presentar un total incompleto', async () => {
  const service = createService({
    post: async (_path, body) => {
      if (body.categoria === 'isv') throw new Error('ISV no disponible');
      return { data: { total: 0, novedades: [] } };
    },
  });
  await assert.rejects(service.getAll('810074'), /ISV no disponible/);
});

test('marca la categoría e ID como vistos y exige confirmación', async () => {
  let call;
  const service = createService({
    post: async (path, body) => {
      call = { path, category: body.categoria, id: body.id_novedad };
      return { data: { registrada: true } };
    },
  });
  await service.markViewed('isv', 42);
  assert.equal(call.path, '/novedades/vistas');
  assert.equal(call.category, 'isv');
  assert.equal(call.id, 42);

  const failingService = createService({ post: async () => ({ data: { registrada: false } }) });
  await assert.rejects(failingService.markViewed('ico', 42), /No se confirmó/);
});
