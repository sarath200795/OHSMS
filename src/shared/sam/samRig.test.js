import { describe, it, expect } from 'vitest'
import { facingAngle, WALK_TURN, IDLE_TURN } from './samRig'

// The rig faces +Z, and rotating by θ about Y sends that forward vector to
// (sin θ, 0, cos θ). So the X component of where Sam ends up looking is
// sin(angle) — which is the thing these tests actually check, rather than
// re-asserting whatever sign the implementation happens to use.
const looksTowardX = (angle) => Math.sin(angle)

describe('facingAngle', () => {
  it('points him right when he is walking right', () => {
    expect(looksTowardX(facingAngle(1, true))).toBeGreaterThan(0)
  })

  it('points him left when he is walking left', () => {
    expect(looksTowardX(facingAngle(-1, true))).toBeLessThan(0)
  })

  it('turns far enough to read as a direction', () => {
    // Below about 45° a turn reads as a lean rather than a heading.
    expect(Math.abs(facingAngle(1, true))).toBeGreaterThan(Math.PI / 4)
  })

  it('stops short of a right angle, which would be a faceless silhouette', () => {
    expect(Math.abs(facingAngle(1, true))).toBeLessThan(Math.PI / 2)
  })

  it('turns back toward the viewer when he stops', () => {
    expect(Math.abs(facingAngle(1, false))).toBe(IDLE_TURN)
    expect(Math.abs(facingAngle(1, false))).toBeLessThan(WALK_TURN)
  })

  it('keeps the same side facing when idle as when walking', () => {
    // Otherwise he would swing across the screen every time he stopped.
    expect(Math.sign(facingAngle(1, true))).toBe(Math.sign(facingAngle(1, false)))
    expect(Math.sign(facingAngle(-1, true))).toBe(Math.sign(facingAngle(-1, false)))
  })

  it('treats any positive or zero facing as rightward', () => {
    expect(facingAngle(0, true)).toBe(WALK_TURN)
    expect(facingAngle(1, true)).toBe(WALK_TURN)
  })
})
