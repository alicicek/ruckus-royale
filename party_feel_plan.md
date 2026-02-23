# Party Feel Implementation Plan

## Decision: Keep Three.js + Rapier.js + Colyseus
Upgrade Rapier from 0.17.3 → 0.19.3. Add active ragdoll skeleton to existing capsule-based movement.

---

## Milestone 1: Ragdoll Skeleton Foundation

### Goal
Replace the WobbleSimulator hack with a real 10-body ragdoll skeleton per player, driven by PD-controlled joints toward procedural pose targets. Characters should visually wobble during movement while core movement stays crisp.

### Files to Change
| File | Changes |
|------|---------|
| `apps/client/package.json` | Upgrade `@dimforge/rapier3d-compat` to `^0.19.3` |
| `apps/client/src/ragdoll.ts` | **NEW** — RagdollFactory: creates 10-body skeleton with joints, motors, collision groups |
| `apps/client/src/main.ts` | Replace `WobbleSimulator` with `RagdollManager`. Update `SceneRenderer` to skin mesh to ragdoll bone positions. Update render loop to step ragdoll and read bone transforms. |
| `packages/shared/src/constants.ts` | Add ragdoll tuning constants (per-joint Kp/Kd, body dimensions, collision group bits) |

### Acceptance Checks
- [ ] `npm run typecheck` passes
- [ ] Characters display with multi-part body (head, torso, arms, legs)
- [ ] Bodies wobble when moving/turning (PD motors active)
- [ ] Bodies are stable when idle (no jitter, no drift)
- [ ] No self-collision between ragdoll limbs of same player
- [ ] Inter-player ragdoll collision works
- [ ] Practice mode stable, no reconnect on Space
- [ ] `render_game_to_text()` matches on-screen behavior
- [ ] No blocking console errors
- [ ] 60fps with 8 characters in solo mode

### Ragdoll Body Layout
```
[Head] — fixed joint to torso (stiff)
[Torso] — root body, positioned at capsule controller position
[L.UpperArm] — spherical joint to torso (shoulder)
[R.UpperArm] — spherical joint to torso (shoulder)
[L.LowerArm] — revolute joint to L.UpperArm (elbow)
[R.LowerArm] — revolute joint to R.UpperArm (elbow)
[L.Thigh] — spherical joint to torso (hip)
[R.Thigh] — spherical joint to torso (hip)
[L.Shin] — revolute joint to L.Thigh (knee)
[R.Shin] — revolute joint to R.Thigh (knee)
```

### PD Tuning Targets
| Joint | Kp (stiffness) | Kd (damping) | Limits |
|-------|---------------|-------------|--------|
| Head-Torso | 800 | 80 | ±30° |
| Shoulders | 400 | 40 | ±120° |
| Elbows | 200 | 20 | 0–145° |
| Hips | 600 | 60 | ±90° |
| Knees | 300 | 30 | 0–150° |

---

## Milestone 2: Hit Reactions & Knockout Ragdoll

### Goal
Hits apply impulse to struck body part (not just velocity). Knockout causes full ragdoll collapse (stiffness → 0). Recovery ramps stiffness back up.

### Files to Change
| File | Changes |
|------|---------|
| `apps/client/src/ragdoll.ts` | Add `applyHitImpulse(bodyPart, force, direction)`, `setKnockoutState()`, `startRecovery()` |
| `apps/client/src/main.ts` | Hook `round_event` handler to trigger ragdoll hit reactions. Add knockout/recovery state machine per player. |
| `packages/shared/src/constants.ts` | Add hit reaction constants (impulse multipliers, recovery duration, stiffness curves) |

### Acceptance Checks
- [ ] Light attack visibly pushes struck body parts
- [ ] Heavy attack causes more dramatic body deformation
- [ ] Knockout causes full ragdoll collapse (limbs go limp)
- [ ] Recovery ramps stiffness back up over ~0.5-1.0s
- [ ] Torso recovers first, arms last (per-limb blend)
- [ ] No physics instability during state transitions
- [ ] Hit reactions are proportional to attack force

---

## Milestone 3: Physics Grab & Throw

### Goal
Grab creates a physics joint between hand and target. Throw releases joint + impulse. Grab has break force.

### Files to Change
| File | Changes |
|------|---------|
| `apps/client/src/ragdoll.ts` | Add `createGrabJoint(grabberHand, targetBody)`, `releaseGrab()`, `applyThrowImpulse()` |
| `apps/client/src/main.ts` | Hook grab/release/throw events to ragdoll joint creation/destruction |
| `packages/shared/src/constants.ts` | Add grab joint stiffness, break force, throw impulse scale |

### Acceptance Checks
- [ ] Grab visually connects grabber's hand to target's body
- [ ] Grabbed target's ragdoll responds physically to grabber's movement
- [ ] Strong hits break the grab joint
- [ ] Throw applies directional impulse with momentum
- [ ] No physics explosion on grab creation/destruction

---

## Milestone 4: Network-Synced Ragdoll Visuals

### Goal
Remote players show approximate ragdoll behavior from synced state.

### Files to Change
| File | Changes |
|------|---------|
| `packages/shared/src/types.ts` | Add ragdoll hint fields to `PlayerStateNet` (hit direction, knockout state, stiffness level) |
| `apps/server/src/sim/simulation.ts` | Track and emit ragdoll state hints per player |
| `apps/client/src/main.ts` | For remote players: drive ragdoll from interpolated capsule position + state hints |

### Acceptance Checks
- [ ] Remote players show ragdoll wobble during movement
- [ ] Remote player knockouts show ragdoll collapse
- [ ] Remote player hit reactions are visible
- [ ] No significant bandwidth increase (only hints, not full ragdoll state)
- [ ] No visual pops or glitches on state corrections

---

## Milestone 5: Polish & Tuning

### Goal
Production-quality feel matching Party Animals responsiveness with Gang Beasts chaos flavor.

### Files to Change
| File | Changes |
|------|---------|
| `apps/client/src/main.ts` | Camera juice (shake on impact), sound tied to contact force |
| `apps/client/src/ragdoll.ts` | Per-character weight tuning, performance LOD for distant players |
| `packages/shared/src/constants.ts` | Final tuning pass on all PD values |

### Acceptance Checks
- [ ] Movement feels responsive and physics-reactive
- [ ] Practice mode stable: no reconnect/reset on gameplay keys
- [ ] No authoritative snapback under normal play
- [ ] No blocking console/page errors
- [ ] `render_game_to_text` matches on-screen behavior
- [ ] `npm run typecheck` passes
- [ ] Smooth 60fps with 8 players

---

## Risk List

| Risk | Severity | Mitigation |
|------|----------|------------|
| Rapier upgrade breaks existing code | Medium | Test typecheck/runtime after upgrade before adding ragdoll |
| PD motor instability (jitter/explosion) | High | Start with low stiffness, increase gradually. Use joint limits. |
| Performance regression with 8 ragdolls | Medium | Use simplified ragdoll for remote players, capsule colliders |
| Ragdoll interferes with server movement | Low | Ragdoll is visual-only on client; server uses same capsule math |
| Self-collision causes physics instability | Medium | Disable self-collision via collision groups |
| Grab joint creates physics explosion | Medium | Use spring joints with break force, not rigid fixed joints |
| Network state grows too large | Low | Sync only hints (knockout, hit direction), not full ragdoll state |
| Practice mode regression | Medium | Test practice mode after every milestone |

---

## Implementation Order & Dependencies

```
Milestone 1 (Ragdoll Skeleton) ← REQUIRED FIRST
    ↓
Milestone 2 (Hit Reactions) ← depends on ragdoll bodies existing
    ↓
Milestone 3 (Grab/Throw) ← depends on ragdoll + hit reactions
    ↓
Milestone 4 (Network Sync) ← depends on all client ragdoll work
    ↓
Milestone 5 (Polish) ← depends on all above
```

## Measurable Acceptance (Final)
1. Movement feels responsive and physics-reactive (subjective + Playwright automation)
2. Practice mode stable: no reconnect/reset on gameplay keys
3. No authoritative snapback under normal play
4. No blocking console/page errors in final runs
5. `render_game_to_text` matches on-screen behavior
6. `npm run typecheck` passes
7. Characters visually wobble/react to physics
8. Knockouts show ragdoll collapse and recovery
9. Grabs/throws feel physical with momentum
