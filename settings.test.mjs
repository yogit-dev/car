import test from 'node:test';
import assert from 'node:assert/strict';
import { TIMES, WEATHERS, SEASONS, DEFAULT_ENV, composeEnvironment, luminance } from './Environment.js';
import { DEFAULT_SETTINGS, SETTING_GROUPS, SETTING_KEYS, isValid, pickValid, normalizeSettings, envChanged } from './Settings.js';
import { VEHICLE_TYPES } from './VehicleSpecs.js';

const finite = (v) => (Array.isArray(v) ? v.every(finite) : typeof v === 'number' ? Number.isFinite(v) : v && typeof v === 'object' ? Object.values(v).every(finite) : true);

test('the four settings, with the options the UI lists', () => {
  assert.deepEqual(SETTING_KEYS, ['vehicle', 'time', 'weather', 'season']);
  const ids = (k) => SETTING_GROUPS.find((g) => g.key === k).options.map((o) => o.id);
  assert.deepEqual(ids('vehicle'), VEHICLE_TYPES);
  assert.deepEqual(ids('time').sort(), ['afternoon', 'evening', 'morning', 'night', 'sunset']);
  assert.deepEqual(ids('weather').sort(), ['clear', 'cloudy', 'fog', 'rain', 'snow']);
  assert.deepEqual(ids('season').sort(), ['autumn', 'spring', 'summer', 'winter']);
  for (const g of SETTING_GROUPS) for (const o of g.options) assert.ok(o.label && o.icon, `${g.key}/${o.id} has a label and icon`);
});

test('defaults keep the original look: car, sunset, clear, summer', () => {
  assert.deepEqual(DEFAULT_SETTINGS, { vehicle: 'car', time: 'sunset', weather: 'clear', season: 'summer' });
});

test('anything off the network or storage is validated', () => {
  assert.equal(isValid('time', 'night'), true);
  assert.equal(isValid('time', 'midnight'), false);
  assert.equal(isValid('nope', 'night'), false);
  assert.equal(isValid('time', 42), false);
  assert.equal(isValid('time', '__proto__'), false);
  assert.deepEqual(pickValid({ time: 'night', weather: 'lava', hack: 1, vehicle: 'bus' }), { time: 'night', vehicle: 'bus' });
  assert.deepEqual(pickValid(null), {});
  assert.deepEqual(pickValid('x'), {});
  assert.deepEqual(normalizeSettings({ weather: 'rain', season: 7 }), { ...DEFAULT_SETTINGS, weather: 'rain' });
  assert.equal(envChanged({ time: 'night', weather: 'clear', season: 'summer' }, { time: 'night', weather: 'clear', season: 'summer', vehicle: 'bus' }), false);
  assert.equal(envChanged(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, season: 'winter' }), true);
});

test('every time × weather × season composes to finite numbers', () => {
  for (const time of Object.keys(TIMES)) for (const weather of Object.keys(WEATHERS)) for (const season of Object.keys(SEASONS)) {
    const e = composeEnvironment({ time, weather, season });
    assert.ok(finite(e), `${time}/${weather}/${season}`);
    for (const c of [e.sky.horizon, e.sky.mid, e.sky.zenith, e.fog.color, e.hemi.sky, e.sun.color]) assert.ok(c.every((v) => v >= 0 && v <= 1.0001), `${time}/${weather}/${season} colour in range`);
    assert.ok(e.fog.near < e.fog.far);
  }
});

test('unknown values fall back to the defaults instead of throwing', () => {
  assert.deepEqual(composeEnvironment({ time: 'x', weather: 'y', season: 'z' }), composeEnvironment(DEFAULT_ENV));
  assert.deepEqual(composeEnvironment(), composeEnvironment(DEFAULT_ENV));
});

test('the default environment reproduces the original sunset', () => {
  const e = composeEnvironment(DEFAULT_ENV);
  assert.deepEqual(e.sky.horizon, [1.0, 0.66, 0.42]);
  assert.deepEqual(e.sky.zenith, [0.10, 0.15, 0.40]);
  assert.equal(e.fog.near, 140); assert.equal(e.fog.far, 720);
  assert.equal(e.hemi.intensity, 1.3); assert.equal(e.sun.intensity, 1.8);
  assert.equal(e.ground, 'summer'); assert.equal(e.precip.type, 'none'); assert.equal(e.headlights, 0);
});

test('time of day: night is darkest, afternoon brightest, headlights and stars come on after dark', () => {
  const at = (time) => composeEnvironment({ time, weather: 'clear', season: 'summer' });
  const bright = (e) => e.hemi.intensity + e.sun.intensity;
  assert.ok(bright(at('night')) < bright(at('evening')) && bright(at('evening')) < bright(at('afternoon')));
  assert.ok(luminance(at('night').sky.horizon) < 0.15 && luminance(at('afternoon').sky.horizon) > 0.7);
  assert.equal(at('night').headlights, 1); assert.equal(at('afternoon').headlights, 0);
  assert.equal(at('night').sky.stars, 1); assert.equal(at('afternoon').sky.stars, 0);
  assert.ok(at('evening').headlights > 0 && at('evening').headlights < 1);
});

test('weather: fog and rain cut visibility, rain/snow fall, clouds hide the sun and stars', () => {
  const w = (weather, time = 'afternoon') => composeEnvironment({ time, weather, season: 'summer' });
  assert.ok(w('fog').fog.far < w('rain').fog.far && w('rain').fog.far < w('cloudy').fog.far && w('cloudy').fog.far < w('clear').fog.far);
  assert.equal(w('rain').precip.type, 'rain'); assert.equal(w('snow').precip.type, 'snow'); assert.equal(w('clear').precip.type, 'none');
  assert.ok(w('cloudy').sun.intensity < w('clear').sun.intensity);
  assert.ok(w('cloudy').sky.sunVis < 1 && w('clear').sky.sunVis === 1);
  assert.equal(w('fog', 'night').sky.stars, 0);
  assert.ok(w('rain').road.tint[0] < 1 && w('rain').road.wet === 1);
  assert.ok(w('fog').headlights > w('clear').headlights);
  // in fog the whole sky collapses toward one colour
  const f = w('fog'), spread = (e) => Math.abs(luminance(e.sky.horizon) - luminance(e.sky.zenith));
  assert.ok(spread(f) < spread(w('clear')) * 0.4);
});

test('season: ground and tree colours change, winter and snow are white and frosty', () => {
  const s = (season, weather = 'clear') => composeEnvironment({ time: 'afternoon', weather, season });
  assert.deepEqual(['spring', 'summer', 'autumn', 'winter'].map((x) => s(x).ground), ['spring', 'summer', 'autumn', 'snow']);
  assert.ok(s('autumn').leaf.h[0] < s('summer').leaf.h[0], 'autumn trees are orange/red, summer green');
  assert.equal(s('summer').leaf.frost, 0); assert.ok(s('winter').leaf.frost > 0.5);
  assert.equal(s('summer', 'snow').ground, 'snow', 'it snows → the ground goes white even in summer');
  assert.ok(s('summer', 'snow').leaf.frost > 0);
  assert.ok(s('winter').shoulder[0] > s('summer').shoulder[0]);
  assert.ok(s('winter', 'snow').road.emissive[0] > s('summer').road.emissive[0]);
});

test('Simulator.applySettings ignores invalid values instead of resetting (pure check of the merge rule)', () => {
  const current = { vehicle: 'bus', time: 'night', weather: 'rain', season: 'winter' };
  assert.deepEqual(normalizeSettings({ ...current, ...pickValid({ time: 'lava', vehicle: 'tank' }) }), current);
  assert.deepEqual(normalizeSettings({ ...current, ...pickValid({ time: 'morning' }) }), { ...current, time: 'morning' });
});
