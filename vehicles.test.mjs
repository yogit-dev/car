import test from 'node:test';
import assert from 'node:assert/strict';
import { Vehicle } from './Vehicle.js';
import { RoadPath } from './RoadPath.js';
import { Autopilot } from './Autopilot.js';
import { InputMapper, DEFAULT_MAPPING } from './Controls.js';
import { VEHICLES, VEHICLE_TYPES, DEFAULT_VEHICLE, isVehicleType } from './VehicleSpecs.js';

const flat = { center: () => 0, halfWidth: 4 };
const idle = { steer: 0, throttle: 0, brake: 0, clutch: 0 };
const run = (v, secs, input, road = flat) => { for (let t = 0; t < secs; t += 1 / 60) v.step(1 / 60, input, road); return v; };

test('three vehicles are defined and the default is the car', () => {
  assert.deepEqual(VEHICLE_TYPES, ['car', 'bike', 'bus']);
  assert.equal(DEFAULT_VEHICLE, 'car');
  assert.equal(isVehicleType('bike'), true);
  assert.equal(isVehicleType('tank'), false);
  assert.equal(isVehicleType('toString'), false);
  for (const t of VEHICLE_TYPES) {
    const s = VEHICLES[t];
    for (const k of ['label', 'blurb', 'physics', 'mapping', 'body', 'chase', 'wheelSteerVisual']) assert.ok(s[k] !== undefined, `${t}.${k}`);
  }
});

test('the car spec leaves the physics at the original defaults', () => {
  assert.deepEqual(new Vehicle(VEHICLES.car.physics).p, new Vehicle().p);
});

test('every vehicle accelerates, reaches a sensible top speed and stops without reversing', () => {
  const limits = { car: [150, 260], bike: [120, 220], bus: [80, 130] };
  for (const t of VEHICLE_TYPES) {
    const v = new Vehicle(VEHICLES[t].physics);
    run(v, 120, { ...idle, throttle: 1 });
    const [lo, hi] = limits[t];
    assert.ok(v.kmh > lo && v.kmh < hi, `${t} top speed ${v.kmh.toFixed(0)} km/h`);
    run(v, 30, { ...idle, brake: 1 });
    assert.equal(v.speed, 0, `${t} stops`);
  }
});

test('feel: the bike out-accelerates the car, the car out-accelerates the bus; the bus needs the longest to stop', () => {
  const t60 = (t) => { const v = new Vehicle(VEHICLES[t].physics); let s = 0; while (v.kmh < 60 && s < 120) { v.step(1 / 60, { ...idle, throttle: 1 }, flat); s += 1 / 60; } return s; };
  assert.ok(t60('bike') < 8 && t60('car') < 8 && t60('bus') > 12, `0-60: bike ${t60('bike')}, car ${t60('car')}, bus ${t60('bus')}`);
  assert.ok(t60('bus') > t60('car') * 2);
  const stop = (t) => { const v = new Vehicle(VEHICLES[t].physics); v.speed = 22; let d = 0; while (v.speed > 0) { v.step(1 / 60, { ...idle, brake: 1 }, flat); d += v.speed / 60; } return d; };   // from 80 km/h
  assert.ok(stop('bus') > stop('car') && stop('bus') > stop('bike'), `stop: bike ${stop('bike')}, car ${stop('car')}, bus ${stop('bus')}`);
});

test('the bus has a wider turning circle than the car, the bike a tighter one', () => {
  const radius = (t) => {
    const v = new Vehicle(VEHICLES[t].physics); v.speed = 5; let s = 0;
    for (; s < 1; s += 1 / 60) v.step(1 / 60, { ...idle, steer: 1, throttle: 0.2 }, flat);   // let the steering settle
    const sp = v.speed, yawRate = (v.speed / v.p.wheelBase) * Math.tan(v.steerAngle);
    return sp / yawRate;
  };
  assert.ok(radius('bus') > radius('car') && radius('car') > radius('bike'), `radius bike ${radius('bike')}, car ${radius('car')}, bus ${radius('bus')}`);
});

test('auto-pilot keeps every vehicle on the road and does not lose grip', () => {
  const road = new RoadPath();
  for (const t of VEHICLE_TYPES) {
    const v = new Vehicle(VEHICLES[t].physics), ap = new Autopilot();
    v.reset({ x: road.center(0), yaw: road.heading(0) }); ap.engage(v);
    let off = 0, maxSlide = 0;
    for (let s = 0; s < 240; s += 1 / 60) {
      v.step(1 / 60, ap.drive(v, road, 1 / 60), road);
      if (v.offRoad) off += 1 / 60;
      maxSlide = Math.max(maxSlide, v.slide);
    }
    assert.equal(off, 0, `${t} left the road`);
    assert.ok(maxSlide < 0.05, `${t} slid ${maxSlide.toFixed(2)}`);
    assert.ok(v.s > 500, `${t} actually drove (${v.s.toFixed(0)} m)`);
  }
});

test('InputMapper.useVehicle swaps the steering feel and can be reset', () => {
  const m = new InputMapper();
  assert.equal(m.m.steerTiltDeg, DEFAULT_MAPPING.steerTiltDeg);
  m.useVehicle(VEHICLES.bus.mapping);
  assert.equal(m.m.steerTiltDeg, VEHICLES.bus.mapping.steerTiltDeg);
  assert.equal(m.m.steerRate, VEHICLES.bus.mapping.steerRate);
  m.useVehicle({});
  assert.equal(m.m.steerTiltDeg, DEFAULT_MAPPING.steerTiltDeg);
  const custom = new InputMapper({ steerExpo: 2 });
  custom.useVehicle(VEHICLES.bike.mapping);
  assert.equal(custom.m.steerExpo, 2, 'constructor overrides survive a vehicle change');
});
