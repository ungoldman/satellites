import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ew, fmt, ns } from '../src/format.js'

test('numbers are grouped and fixed to the digits asked', () => {
  assert.equal(fmt(35786.4), '35,786')
  assert.equal(fmt(3.071, 2), '3.07')
})

test('latitudes and longitudes carry their hemisphere', () => {
  assert.equal(ns(12.345), '12.35°N')
  assert.equal(ns(-12.345, 0), '12°S')
  assert.equal(ew(-75.2, 1), '75.2°W')
  assert.equal(ew(140.9, 1), '140.9°E')
  // a hair below zero rounds to zero, so it reads north and east
  assert.equal(ns(-0.001), '0.00°N')
  assert.equal(ew(-0.001), '0.00°E')
})
