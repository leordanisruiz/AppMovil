import assert from 'node:assert/strict';
import test from 'node:test';
import { getHighestIsvSeverity, getIsvSeverity } from '../src/utils/isvSeverity.ts';

test('detecta la gravedad sin distinguir mayúsculas y prioriza fatalidad', () => {
  assert.equal(getIsvSeverity('Persona LesIonAdo en ruta'), 'lesionado');
  assert.equal(getIsvSeverity('FATALIDAD en accidente'), 'fatalidad');
  assert.equal(getIsvSeverity('Lesionado y fatalidad'), 'fatalidad');
  assert.equal(getIsvSeverity('Sin víctimas'), null);
  assert.equal(getIsvSeverity(null), null);
});

test('la campana representa la máxima gravedad de todos los registros', () => {
  assert.equal(getHighestIsvSeverity([]), null);
  assert.equal(getHighestIsvSeverity([{ Subgrupo: null }, { Subgrupo: 'Otro' }]), null);
  assert.equal(getHighestIsvSeverity([{ Subgrupo: 'lesionado' }]), 'lesionado');
  assert.equal(
    getHighestIsvSeverity([{ Subgrupo: 'lesionado' }, { Subgrupo: 'Fatalidad' }]),
    'fatalidad',
  );
  assert.equal(
    getHighestIsvSeverity([{ Subgrupo: 'FATALIDAD' }, { Subgrupo: 'Lesionado' }]),
    'fatalidad',
  );
});
