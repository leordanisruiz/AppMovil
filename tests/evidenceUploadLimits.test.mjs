import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import typescript from 'typescript';

const source = readFileSync(new URL('../src/utils/evidenceUploadLimits.ts', import.meta.url), 'utf8');
const compiled = typescript.transpile(source, {
  module: typescript.ModuleKind.CommonJS,
  target: typescript.ScriptTarget.ES2022,
});
const module = { exports: {} };
runInNewContext(compiled, { module, exports: module.exports });
const { isWithinEvidenceUploadLimit } = module.exports;

test('permite hasta 1536 MiB combinados y rechaza un byte adicional', () => {
  const mib = 1024 * 1024;
  assert.equal(isWithinEvidenceUploadLimit([{ size: 1024 * mib }, { size: 512 * mib }]), true);
  assert.equal(isWithinEvidenceUploadLimit([{ size: 1024 * mib }, { size: 512 * mib + 1 }]), false);
  assert.equal(isWithinEvidenceUploadLimit([{ size: 1536 * mib + 1 }]), false);
});

test('permite continuar cuando el tamaño no está disponible en el dispositivo', () => {
  assert.equal(isWithinEvidenceUploadLimit([{ size: undefined }, { size: 200 * 1024 * 1024 }]), true);
});
