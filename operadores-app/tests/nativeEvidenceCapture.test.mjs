import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import typescript from 'typescript';

function createCapture({ platform = 'android', asset, canceled = false, microphone = true, position, launchResult } = {}) {
  const calls = [];
  const modules = {
    'react-native': { Platform: { OS: platform } },
    'expo-camera': {
      Camera: {
        requestMicrophonePermissionsAsync: async () => {
          calls.push('microphone');
          return { granted: microphone };
        },
      },
    },
    'expo-image-picker': {
      requestCameraPermissionsAsync: async () => {
        calls.push('camera');
        return { granted: true };
      },
      launchCameraAsync: async (options) => {
        calls.push(options);
        if (launchResult) return launchResult;
        return canceled ? { canceled: true, assets: null } : { canceled: false, assets: [asset] };
      },
    },
    'expo-location': {
      Accuracy: { High: 6 },
      requestForegroundPermissionsAsync: async () => {
        calls.push('location-permission');
        return { granted: true };
      },
      getCurrentPositionAsync: async () => {
        calls.push('location');
        return position ?? { timestamp: Date.now(), coords: { latitude: 4.7, longitude: -74.1 } };
      },
    },
  };
  const source = readFileSync(new URL('../src/services/nativeEvidenceCapture.ts', import.meta.url), 'utf8');
  const compiled = typescript.transpile(source, {
    module: typescript.ModuleKind.CommonJS,
    target: typescript.ScriptTarget.ES2022,
  });
  const module = { exports: {} };
  runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: (name) => {
      assert.ok(name in modules, `Unexpected import: ${name}`);
      return modules[name];
    },
  });
  return { capture: module.exports.captureNativeEvidence, calls };
}

test('graba video con la cámara nativa y conserva los metadatos de evidencia', async () => {
  const { capture, calls } = createCapture({
    asset: {
      uri: 'file:///video.mp4', fileName: 'video.mp4', mimeType: 'video/mp4',
      fileSize: 1024, duration: 125000,
    },
  });
  const result = await capture('video', 180);

  assert.deepEqual(calls.slice(0, 3), ['camera', 'microphone', 'location-permission']);
  assert.equal(calls[3].mediaTypes[0], 'videos');
  assert.equal(calls[3].videoMaxDuration, 180);
  assert.equal(calls[4], 'location');
  assert.equal(result.uri, 'file:///video.mp4');
  assert.equal(result.mimeType, 'video/mp4');
  assert.equal(result.name, 'video.mp4');
  assert.equal(result.size, 1024);
  assert.equal(result.durationMs, 125000);
  assert.equal(result.latitude, 4.7);
  assert.equal(result.longitude, -74.1);
  assert.ok(Number.isFinite(Date.parse(result.capturedAt)));
});

test('la fotografía mantiene la cámara y opciones nativas existentes', async () => {
  const { capture, calls } = createCapture({
    asset: { uri: 'file:///foto.jpg', fileName: 'foto.jpg', mimeType: 'image/jpeg' },
  });
  const result = await capture('photo', 180);

  assert.deepEqual(calls.slice(0, 2), ['camera', 'location-permission']);
  assert.equal(calls[2].mediaTypes[0], 'images');
  assert.equal(calls[2].quality, 0.9);
  assert.equal(calls[2].exif, true);
  assert.equal(result.name, 'foto.jpg');
  assert.equal(result.mimeType, 'image/jpeg');
  assert.equal(result.durationMs, undefined);
});

test('si se cancela la cámara no se adjunta evidencia ni se consulta la ubicación', async () => {
  const { capture, calls } = createCapture({ canceled: true });
  let preparing = false;
  assert.equal(await capture('video', 180, () => { preparing = true; }), null);
  assert.equal(preparing, true);
  assert.equal(calls.includes('location'), false);
});

test('avisa antes de abrir la cámara y mantiene la espera hasta recibir el video', async () => {
  let resolveCamera;
  const launchResult = new Promise((resolve) => { resolveCamera = resolve; });
  const { capture, calls } = createCapture({ launchResult });
  let preparing = false;
  const pending = capture('video', 180, () => {
    assert.deepEqual(calls, ['camera', 'microphone', 'location-permission']);
    preparing = true;
  });
  await new Promise(setImmediate);
  assert.equal(preparing, true);
  assert.equal(calls[3].videoMaxDuration, 180);
  assert.equal(calls.includes('location'), false);

  resolveCamera({
    canceled: false,
    assets: [{ uri: 'file:///video.mp4', mimeType: 'video/mp4', duration: 180000 }],
  });
  assert.equal((await pending).durationMs, 180000);
  assert.equal(calls[4], 'location');
});

test('prepara la foto aceptada y no activa el aviso si faltan permisos', async () => {
  const photo = createCapture({ asset: { uri: 'file:///foto.jpg' } });
  const denied = createCapture({ microphone: false });
  const preparationModes = [];
  await photo.capture('photo', 180, (mode) => preparationModes.push(mode));
  await assert.rejects(denied.capture('video', 180, (mode) => preparationModes.push(mode)), /micrófono/);
  assert.deepEqual(preparationModes, ['photo']);
});

test('se propagan los errores de la cámara después de activar la preparación', async () => {
  const { capture } = createCapture({ launchResult: Promise.reject(new Error('Cámara no disponible')) });
  let preparing = false;
  await assert.rejects(
    capture('video', 180, () => { preparing = true; }),
    /Cámara no disponible/,
  );
  assert.equal(preparing, true);
});

test('se notifican permisos denegados y ubicaciones desactualizadas', async () => {
  const denied = createCapture({ microphone: false });
  await assert.rejects(denied.capture('video', 180), /micrófono/);
  assert.equal(denied.calls.some((item) => typeof item === 'object'), false);

  const stale = createCapture({
    asset: { uri: 'file:///video.mov' },
    position: { timestamp: Date.now() - 60000, coords: { latitude: 4.7, longitude: -74.1 } },
  });
  await assert.rejects(stale.capture('video', 180), /ubicación no está actualizada/);
});

test('el video iOS sin nombre o MIME usa la extensión MOV compatible', async () => {
  const { capture } = createCapture({ platform: 'ios', asset: { uri: 'file:///video.mov' } });
  const result = await capture('video', 180);
  assert.equal(result.mimeType, 'video/quicktime');
  assert.match(result.name, /^video-\d+\.mov$/);
});
