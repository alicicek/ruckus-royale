# Party Brawler Ragdoll Feel - Technical Research

Research compiled 2026-02-23 for Ruckus Royale web party brawler.

---

## 1. Party Animals Feel Decomposition

### Active Ragdoll System

Party Animals uses a **hybrid active ragdoll** approach developed in-house by Recreate Games (Unity engine). The core principle: characters are physics objects at all times but are driven toward animation poses through joint motors, giving a "controlled chaos" feel.

**How it works:**
- Each character has a **dual-body architecture**: an invisible kinematic "puppet master" that plays traditional animations, and a physical ragdoll body that follows it via PD-controlled joint torques.
- The ragdoll body's joints apply torques to match the puppet master's pose each physics step. High stiffness = snappy control, low stiffness = floppy ragdoll.
- External forces (hits, grabs, falls) override the pose matching, causing the character to deform realistically.
- Once external forces subside, the PD controllers pull the character back to the target animation pose.

**Movement Model:**
- Snappy acceleration with high base movement force on the pelvis/root body.
- Deceleration is friction-based: when no input, ground friction stops the character quickly.
- Turning is near-instantaneous (torque applied to the hip to rotate toward movement direction).
- The upper body wobbles slightly behind movement due to joint compliance, which creates the signature "physical" feel without sacrificing responsiveness.

**Grab/Throw Mechanics:**
- Grabbing creates a **temporary fixed/spring joint** between the grabber's hand collider and the target.
- The grab joint has a **break force threshold** -- excessive force (from punches, falls) breaks the grab.
- Throwing adds an impulse to the grabbed object in the character's facing direction, with release timing adding a velocity component.
- The effect of a punch varies based on relative positions, speeds, stamina, and hit location.

**Hit Reactions and Knockback:**
- Hit reactions are implemented as **impulse forces** applied to the struck body part.
- Knockback magnitude scales with the attacker's fist velocity (faster swing = bigger knockback).
- A **stun accumulator** builds with successive hits; when it exceeds a threshold, the character goes fully ragdoll (knockout state).
- Heavy attacks apply larger impulses and more stun than light attacks.
- The "fling" (super heavy punch) combines running momentum + punch impulse for maximum knockback.

**Recovery from Ragdoll:**
- After knockout, there is a recovery timer during which PD controller stiffness ramps back up.
- The character transitions from full ragdoll to a "getting up" state where the animation target is a stand-up pose.
- Joint stiffness increases gradually, creating a natural-looking recovery.
- Players can mash buttons to reduce recovery time.

**What Makes It Responsive:**
- **Root body movement is kinematic-like**: The pelvis has very high joint stiffness and responds nearly instantly to input, giving tight movement control.
- **Limbs are cosmetically physical**: Arms and legs have lower stiffness, creating visual wobble without affecting core movement.
- **Input is never delayed**: The game processes input immediately on the root body; the ragdoll aesthetic is purely visual feedback.
- **Separate physics layers**: Movement collisions use a simple capsule, while visual ragdoll uses the full skeleton. This means movement is crisp even though the character looks floppy.

### Key Design Insight

Party Animals is NOT truly physics-driven movement. The core locomotion is essentially a capsule character controller with instant response. The ragdoll system is layered on top for visual flair and combat interactions only. This is why it feels "responsive despite being physics-based" -- the physics don't actually drive the movement, they only dress it up.

**Sources:**
- [Interview with Recreate Games](https://muse.international/interview-with-recreate-games-for-party-animals/)
- [Party Animals Dev Log 05](https://www.moddb.com/games/party-animals/news/dev-log-05)
- [Party Animals - Competitive Ragdoll Gameplay](https://www.taptap.io/post/5815026)
- [Goomba Stomp Developer Interview](https://goombastomp.com/party-animals-interview/)

---

## 2. Gang Beasts Feel Decomposition

### Full Ragdoll Approach

Gang Beasts uses a **fully physics-driven** character system where every movement emerges from forces applied to ragdoll bodies. Characters are always physics objects -- there is no separate kinematic controller.

**How it works:**
- Characters are built from multiple rigid bodies (head, torso, upper arms, lower arms, hands, upper legs, lower legs, feet) connected by configurable joints.
- Movement is achieved by applying forces/torques to the pelvis and legs rather than directly setting velocity.
- Walking is procedural: legs alternate applying downward + forward forces to create a shuffling motion.
- The "wobbly" feel comes from intentionally low joint stiffness across the entire body.

### Wobble/Stagger System

- All joints have relatively low angular spring values, causing the entire body to wobble during movement.
- When hit, joint stiffness temporarily drops further, causing increased wobble/stagger.
- Balance is maintained through **external upright force** on the pelvis (an invisible force pushing the pelvis upward and rotated toward upright).
- When stagger exceeds a threshold, this upright force is removed, causing full collapse.
- The "drunken" movement comes from the combination of low joint stiffness + delayed force propagation through the body chain.

### Grab Mechanics ("Sticky Hands")

- Each hand has a grab collider that, when activated, creates a **spring joint** (spring force ~12000, with break force) to whatever it touches.
- Hands can grab other players, environment geometry, or objects.
- Grabbed targets can be climbed by alternating hand grabs at higher positions.
- The "punch-grab" technique (pressing grab during a punch) places the hand higher, enabling faster climbing.
- Grip has a stamina system -- holding too long with dangling weight eventually breaks the joint.

### The Chaos Factor - What Makes It Fun

1. **Emergent gameplay**: Because everything is physics-driven, no two fights play out the same way. The low joint stiffness means small differences in position/timing cascade into wildly different outcomes.
2. **Failure is entertaining**: The wobbly movement makes even basic actions look funny. Players laugh at themselves rather than getting frustrated.
3. **Skill expression through physics mastery**: Advanced players learn to exploit the physics (headbutt momentum, climbing techniques, throw timing) creating a high skill ceiling hidden behind a casual exterior.
4. **Collaborative chaos**: Multiple players grabbing each other creates complex constraint chains that resolve in unexpected ways.

### Why It Feels "Heavy" and "Floppy"

- **Mass distribution**: Characters have significant total mass distributed across all body parts. Each limb has realistic mass, making the whole body feel weighty.
- **Low joint stiffness/high damping**: Joints resist sudden changes but don't snap to positions quickly. This creates the "moving through jello" feel.
- **Force-based locomotion**: Movement forces need to overcome the mass of the entire ragdoll chain, causing inherent lag between input and movement.
- **No upright torque shortcut**: Unlike Party Animals, Gang Beasts doesn't use a snappy root controller -- the character must physically balance, which means all inputs feel filtered through the body's inertia.
- **Ground contact forces**: Walking requires actual ground-reaction forces through the feet, making movement dependent on terrain contact and body orientation.

**Sources:**
- [Gang Beasts Physics Discussion (Steam)](https://steamcommunity.com/app/285900/discussions/0/152391995416478298/?l=koreana)
- [UE5 Active Ragdoll Tutorial (Gang Beasts-style)](https://dev.epicgames.com/community/learning/tutorials/9LW5/how-to-make-an-active-ragdoll-like-gang-beasts-in-unreal-engine-5)
- [Gang Beasts Grip Mechanics (Steam)](https://steamcommunity.com/app/285900/discussions/0/483367798515475159/)
- [Unity Forums - Physics-Based Character Like Gang Beasts](https://discussions.unity.com/t/how-to-create-physics-based-animation-character-like-in-gang-beasts/230757)

---

## 3. Active Ragdoll Implementation Techniques

### PD Controllers for Joint Torques

The core of any active ragdoll is the **Proportional-Derivative (PD) controller** applied to each joint. This is mathematically identical to a spring-damper system.

**Formula:**
```
torque = Kp * (targetAngle - currentAngle) - Kd * angularVelocity
```

Where:
- `Kp` (proportional gain / stiffness): Controls how strongly the joint pulls toward the target. Higher = snappier, more responsive. Typical range: 100-10000 depending on body part.
- `Kd` (derivative gain / damping): Controls resistance to angular velocity. Higher = less oscillation, more "heavy" feel. Typical range: 10-1000.
- `targetAngle`: The desired joint rotation from the animation pose.
- `currentAngle`: The current physical joint rotation.
- `angularVelocity`: How fast the joint is currently rotating.

**Tuning guidelines:**
- **Head/Neck**: Medium Kp (500-1000), high Kd. Head should track movement but not wobble excessively.
- **Spine/Torso**: High Kp (2000-5000), medium Kd. Core of the body needs strong control for balance.
- **Shoulders**: Medium Kp (500-2000), medium Kd. Allows arm swinging but maintains shape.
- **Elbows/Knees**: Low-medium Kp (200-1000), low Kd. These should be most "floppy."
- **Hips**: Highest Kp (3000-8000), high Kd. Critical for balance and locomotion.

**The spring analogy:**
A PD controller is mathematically a spring-damper system. The proportional term acts as the spring (pulling toward target), and the derivative term acts as the damper (resisting motion). Human muscles operate on this same principle.

### Pose Matching (Animation Target + Physics Follow)

**Dual-body architecture:**
1. An invisible **kinematic skeleton** plays traditional animations (walk, idle, attack, etc.).
2. A **physical ragdoll skeleton** attempts to match the kinematic skeleton's pose through PD-controlled joints.
3. The visual mesh is skinned to the physical ragdoll, not the kinematic skeleton.

**Each physics step:**
1. Sample the current pose of the kinematic animation skeleton.
2. For each joint in the ragdoll, compute the rotation error between current ragdoll joint orientation and target animation joint orientation.
3. Apply PD torque to drive the ragdoll joint toward the target.
4. Simulate physics (gravity, collisions, external forces all affect the ragdoll).
5. The ragdoll settles at a compromise between the target pose and physics constraints.

**Position vs. rotation matching:**
- **Rotation**: Matched in local space (parent-relative). This allows the chain to deform naturally from external forces while each joint tries to maintain its local pose.
- **Position**: Only the root/pelvis needs position matching (in world space). All other body parts follow via joint chain.
- The root position match uses a separate spring force rather than joint torque.

### Balance/Recovery Systems

**Two main approaches:**

**1. External Force Balance (simpler, used by most party games):**
- An invisible upright force is applied to the pelvis/chest, pushing it toward a standing orientation.
- This force has a maximum magnitude, so large enough impacts can still knock the character over.
- Games using this: Gang Beasts, Human: Fall Flat, Octodad, TABS.
- Implementation: Apply a torque to the pelvis that is proportional to its tilt angle from vertical.

**2. Internal Force Balance (more realistic, harder to implement):**
- No external forces. The character balances using only joint torques.
- Center of mass (COM) is tracked relative to the support polygon (foot positions).
- If COM drifts outside the support polygon, the system generates compensatory stepping motions.
- The feet "try" to go below the center of mass to maintain stability.
- Inverse kinematics is used for foot placement during recovery.
- Games using this: Euphoria engine (GTA V, Red Dead), some research projects.

**Recovery state machine:**
```
States: STANDING -> STAGGERING -> FALLING -> RAGDOLL -> GETTING_UP -> STANDING

STANDING: Full PD stiffness, animation-driven pose matching.
STAGGERING: Reduced stiffness, wider stance target pose, COM recovery active.
FALLING: Very low stiffness, ragdoll with some residual joint torques.
RAGDOLL: Zero joint torques, pure physics simulation.
GETTING_UP: Stiffness ramps up over ~0.5-1.0 seconds, target pose transitions to stand-up animation.
```

### Constraint-Based vs. Force-Based Approaches

**Constraint-based (Joint Motors):**
- Use the physics engine's built-in joint motor system.
- Configure target rotation and spring/damper parameters on the joint.
- The physics solver handles the torque calculation internally.
- Pros: Stable, integrates naturally with the physics solver, handles edge cases well.
- Cons: Less direct control, harder to implement custom behaviors.
- Used by: Rapier.js, PhysX, Havok.

**Force-based (Manual Torques):**
- Calculate PD torques manually and apply them as external torques each physics step.
- Full control over the force calculation.
- Pros: Maximum flexibility, can implement custom torque profiles, easier to debug.
- Cons: Can cause instability if not carefully tuned, requires manual integration with the solver.
- Used by: Many Unity implementations, custom engines.

**Recommendation for web (Rapier.js):** Use constraint-based approach with joint motors. Rapier's PD motor API maps directly to this use case and is more stable than manual torque application.

### Blending Between "Controlled" and "Ragdoll" States

The transition between controlled (animation-driven) and ragdoll (physics-driven) states is critical for feel.

**Smooth blend approach:**
```
effectiveStiffness = lerp(ragdollStiffness, controlledStiffness, blendFactor)
effectiveDamping  = lerp(ragdollDamping, controlledDamping, blendFactor)
```

Where `blendFactor` transitions from 0 (ragdoll) to 1 (controlled) over a tunable duration (typically 0.3-1.0 seconds).

**Per-limb blending:**
Different body parts can blend at different rates. For example:
- Torso recovers first (high priority for balance).
- Arms recover last (allows them to flop during recovery for visual appeal).
- Legs recover mid-speed (needed for standing but can wobble).

**State-blend matrix (example):**
| Body Part | Ragdoll | Getting Up | Controlled |
|-----------|---------|------------|------------|
| Hips      | 0       | 0.8        | 1.0        |
| Spine     | 0       | 0.6        | 1.0        |
| Head      | 0       | 0.3        | 0.9        |
| Arms      | 0       | 0.1        | 0.7        |
| Legs      | 0       | 0.5        | 1.0        |

### Spring-Damper Systems for Limbs

Beyond joint PD controllers, additional spring-damper systems are used for:

1. **Root position tracking**: A world-space spring pulls the ragdoll root toward the desired position from the character controller. Stiffness determines how tightly the ragdoll follows the controller.

2. **Head stabilization**: An additional angular spring keeps the head oriented toward the camera/movement direction, independent of torso wobble.

3. **Arm swing**: Passive spring-dampers on shoulders create natural arm swing during locomotion without needing explicit arm animation.

4. **Landing compression**: On landing, temporarily reducing leg joint stiffness creates a natural compression/squash effect.

**Sources:**
- [Active Ragdoll PID Implementation (GitHub)](https://github.com/ashleve/ActiveRagdoll)
- [Active Ragdolls in Unity (Sergio Abreu)](https://sergioabreu-g.medium.com/how-to-make-active-ragdolls-in-unity-35347dcb952d)
- [Hairibar.Ragdoll Package (GitHub)](https://github.com/hairibar/Hairibar.Ragdoll)
- [Joint-Torque Control Paper](https://www.xbdev.net/misc_demos/demos/joints_torques_and_control/paper.pdf)
- [8 Tips for Animating Active Ragdolls (Gamasutra)](https://www.gamedeveloper.com/design/8-tips-for-animating-active-ragdolls)
- [Active Ragdoll Puppeteer/Marionette Technique](https://medium.com/@640Lab/active-ragdoll-physics-puppeteer-marionette-balance-technique-a2c09a4d8d6a)
- [Active Ragdoll GitHub Topic](https://github.com/topics/active-ragdoll)
- [Godot Active Rigid Body Ragdolls](https://www.gadgetgodot.com/u/r3xg1l/active-rigid-body-ragdolls)

---

## 4. Web-Specific Implementation Considerations

### Rapier.js Capabilities for Active Ragdoll

Rapier.js (WASM build from Rust) is the recommended physics engine for this project. It directly supports the active ragdoll pattern.

**Joint Types for Ragdoll:**
- **SphericalJoint (Ball-in-Socket)**: 3 rotational DOF. Use for shoulders, hips. "Typically used to simulate ragdoll arms, pendulums, etc."
- **RevoluteJoint**: 1 rotational DOF. Use for elbows, knees (hinge joints).
- **FixedJoint**: 0 DOF. Use for temporary grab connections.
- **GenericJoint**: Configurable DOF. Use for spine (limited rotation on all axes).

**Motor/PD Controller API:**
```typescript
// Position-controlled motor (PD controller)
joint.configureMotorPosition(targetAngle, stiffness, damping);

// Velocity-controlled motor
joint.configureMotorVelocity(targetVelocity, dampingFactor);

// Set motor model
joint.configureMotorModel(RAPIER.MotorModel.ForceBased);
```

Parameters:
- `stiffness`: Kp of the PD controller. Controls force to reach target position.
- `damping`: Kd of the PD controller. Controls force to reach target velocity.
- `maxForce`: Optional cap on impulse delivered per step.

**Joint Limits:**
Rapier supports angular limits on spherical and revolute joints to prevent hyper-extension:
```typescript
// Set angular limits on revolute joint
joint.setLimits(minAngle, maxAngle);
```

**Collision Groups:**
Essential for ragdolls -- prevents self-collision between adjacent body parts:
```typescript
// Membership/filter bitmask system
colliderDesc.setCollisionGroups(membershipBits | (filterBits << 16));
```

**Key Rapier.js Ragdoll Recipe:**
1. Create rigid bodies for each body segment (head, torso, upper arm L/R, lower arm L/R, upper leg L/R, lower leg L/R).
2. Connect with appropriate joints (spherical for ball joints, revolute for hinges).
3. Set joint limits to prevent impossible poses.
4. Configure motors with PD parameters on each joint.
5. Each physics step, update motor target positions from the animation system.
6. Use collision groups to prevent self-intersection.

### Three.js Integration with Physics-Driven Character Rigs

**Architecture:**
```
[Animation System] --> [Target Poses]
                            |
                            v
[Rapier Physics World] --> [Ragdoll Body Positions/Rotations]
                            |
                            v
[Three.js SkinnedMesh] --> [Visual Rendering]
```

**Sync loop (each frame):**
1. Step Rapier physics world at fixed timestep (60Hz).
2. Read position/rotation of each ragdoll rigid body from Rapier.
3. Copy those transforms onto the corresponding Three.js bone.
4. Three.js automatically updates the skinned mesh vertices.

**Separate loop rates:**
- Physics: Fixed 60Hz (16.67ms steps) via `world.step()`.
- Rendering: Variable rate (requestAnimationFrame), interpolating between physics states for smooth visuals.

**SkinnedMesh bone mapping:**
```typescript
// After physics step, sync ragdoll to Three.js skeleton
for (const [boneName, rigidBody] of ragdollBodies) {
  const bone = skinnedMesh.skeleton.getBoneByName(boneName);
  const pos = rigidBody.translation();
  const rot = rigidBody.rotation();
  bone.position.set(pos.x, pos.y, pos.z);
  bone.quaternion.set(rot.x, rot.y, rot.z, rot.w);
}
```

### Performance Budget on Web

**Ragdoll body count estimates (Rapier WASM, desktop browser, 60fps target):**

| Scenario | Bodies | Joints | Estimated Budget |
|----------|--------|--------|-----------------|
| 1 ragdoll (10-12 bodies) | 12 | 11 | <0.5ms |
| 4 ragdolls | 48 | 44 | ~1-2ms |
| 8 ragdolls (full lobby) | 96 | 88 | ~3-5ms |
| 8 ragdolls + environment | ~120 | ~100 | ~4-6ms |

At 60fps, you have 16.67ms per frame. Physics should take no more than ~6ms, leaving ~10ms for rendering, networking, and game logic.

**Key performance considerations:**
- Rapier WASM is the most performant option, with 2-5x speedups over pure JS engines.
- WASM <-> JS boundary crossings are expensive. Minimize per-body callbacks. Batch state reads.
- A simplified ragdoll (6-8 bodies instead of 12+) can significantly reduce cost.
- For 8 simultaneous players, consider a **reduced ragdoll** for remote players (fewer bodies, simpler joints) and full ragdoll only for the local player.
- Rapier supports sleeping (inactive bodies don't cost simulation time). Ragdolls at rest will sleep automatically.

**Practical recommendation for Ruckus Royale:**
- **Local player**: Full 10-12 body ragdoll with PD-controlled joints.
- **Remote players**: Simplified 4-6 body ragdoll (pelvis, torso, 2 arms, 2 legs) with interpolated state from server.
- **Environment objects**: Static colliders (near zero cost).
- This gives a comfortable ~4ms physics budget for 8 players at 60fps.

### Alternative Physics Engines for Web

| Engine | Language | Binding | 3D | Joints/Motors | Ragdoll Suitability | NPM Downloads/week |
|--------|----------|---------|-----|---------------|--------------------|--------------------|
| **Rapier** | Rust | WASM | Yes | Full PD motors | Excellent | ~1M |
| **JoltPhysics.js** | C++ | WASM (emscripten) | Yes | Full constraints, ragdoll class | Excellent | ~500 |
| **cannon-es** | JS | Native | Yes | Basic springs/constraints | Fair | ~70K |
| **Ammo.js** | C++ (Bullet) | WASM (emscripten) | Yes | Full Bullet constraints | Good but heavy | ~15K |
| **Havok (Babylon)** | C++ | WASM | Yes | Full (closed source) | Excellent | ~5K (Babylon) |

**Rapier (Recommended):**
- Best WASM performance for web, actively maintained by Dimforge.
- Native PD motor support on joints maps perfectly to active ragdoll.
- TypeScript types included, first-class JS/WASM API.
- Deterministic mode available (important for networking).

**JoltPhysics.js:**
- Used by AAA games (Horizon Forbidden West, Death Stranding 2).
- Has native `RagdollSettings` and `Ragdoll` classes in the C++ API.
- WASM port exposes full interface.
- Slightly more complex API but more feature-rich for ragdolls specifically.
- Consideration: Memory management requires manual `Jolt.destroy()` calls.

**cannon-es:**
- Pure JavaScript, no WASM overhead for simple scenes.
- Limited joint motor support -- no built-in PD controller.
- Best for prototyping or simpler physics needs.
- Would require manual PD torque implementation for active ragdoll.

**Ammo.js (Bullet):**
- Most feature-complete (soft bodies, vehicles, full constraint library).
- Can suffer from performance issues and large WASM bundle size.
- Complex, C++-style API through emscripten.
- Overkill for this use case.

### 2D Alternatives

| Engine | Use Case |
|--------|----------|
| **Matter.js** | Most popular 2D engine (120K weekly downloads). Good for 2D ragdoll prototyping. |
| **Planck.js** | Box2D port. More rigid-body focused, less constraint support. |
| **Rapier 2D** | Same engine as 3D, excellent for 2D games needing motors/joints. |
| **p2.js** | Has ragdoll demo. Older, less maintained. |

**Sources:**
- [Rapier.js Documentation - Joints](https://rapier.rs/docs/user_guides/javascript/joints/)
- [Rapier.js Documentation - Joint Constraints](https://rapier.rs/docs/user_guides/javascript/joint_constraints/)
- [Rapier ImpulseJoint Motors (Three.js Tutorial)](https://sbcode.net/threejs/physics-rapier-impulsejoint-motors/)
- [Web Game Dev - Physics Engines](https://www.webgamedev.com/physics)
- [JoltPhysics.js (GitHub)](https://github.com/jrouwe/JoltPhysics.js)
- [demo-rapier-three (GitHub)](https://github.com/viridia/demo-rapier-three)
- [RapierJS Ragdoll Physics (Three.js Resources)](https://threejsresources.com/tool/rapierjs-ragdoll-physics)
- [Rapier 3D JS Demos](https://rapier.rs/demos3d/index.html)
- [cannon.js Ragdoll Demo](https://schteppe.github.io/cannon.js/demos/ragdoll.html)

---

## 5. Authoritative Networking for Physics Brawlers

### The Three Approaches to Networked Physics

Based on Glenn Fiedler's foundational work:

**1. Deterministic Lockstep:**
- All clients run identical physics with identical inputs.
- Only inputs are transmitted (minimal bandwidth).
- Requires bit-exact determinism across all clients.
- NOT suitable for web: Rapier.js's WASM can be deterministic on same platform, but cross-browser/cross-device determinism is not guaranteed for floating-point operations.

**2. Snapshot Interpolation:**
- Server runs authoritative simulation and sends periodic state snapshots.
- Clients do NOT simulate physics -- they only interpolate between received snapshots.
- Smooth even with bad network conditions (jitter buffer absorbs packet timing variance).
- Low CPU on client, high bandwidth requirement.
- Good for spectators or "visual-only" remote players.

**3. State Synchronization:**
- Both server and clients run physics simulation.
- Server sends state corrections; clients extrapolate between corrections.
- Requires priority accumulator system to send most-important objects first.
- Uses quantization, delta compression, and jitter buffers.
- Best for interactive physics where clients need responsive local simulation.

### Recommended Architecture for Ruckus Royale

**Hybrid approach: State Sync for local player + Snapshot Interpolation for remote players.**

```
                 [Server - Authoritative Simulation @ 60Hz]
                           |                    |
                    State corrections      Snapshots (20Hz)
                           |                    |
                    [Local Player]        [Remote Players]
                    Client-side           Interpolation buffer
                    prediction +          (~100ms behind)
                    reconciliation
```

**For the local player:**
- Client runs full physics prediction using Rapier.
- Client sends inputs to server at 60Hz.
- Server runs authoritative simulation with those inputs.
- Server sends state corrections (position, velocity, rotation of each body part).
- Client compares predicted state to server state; if diverged, applies correction with visual smoothing.

**For remote players:**
- Client receives server snapshots at 20Hz containing remote player ragdoll states.
- Client interpolates between the two most recent snapshots using a ~100ms buffer.
- No local physics simulation for remote players -- just interpolated transform application.
- This saves enormous CPU (no ragdoll simulation for 7 other players).

### Ragdoll State Synchronization Strategy

A full ragdoll has 10-12 bodies, each with position (3 floats), rotation (4 floats), linear velocity (3 floats), angular velocity (3 floats) = **13 floats * 12 bodies = 156 floats = 624 bytes per character per snapshot**.

For 8 players at 20Hz, that's: **8 * 624 * 20 = ~100KB/s** -- too much bandwidth.

**Optimization strategies:**

**1. Root-only sync + local ragdoll simulation:**
- Only sync the pelvis/root body position, rotation, and velocity (13 floats = 52 bytes).
- Remote clients run a simplified local ragdoll simulation driven by the synced root.
- Each client's remote ragdolls will look slightly different but close enough for gameplay.
- Bandwidth: 8 * 52 * 20 = ~8KB/s. Very reasonable.

**2. Quantized key-body sync:**
- Sync root + hands + head (4 bodies) with quantized values.
- Quantize position to 16-bit relative to root (0.5mm precision within 32m range).
- Quantize rotation to smallest-three quaternion representation (3 * 10 bits = 30 bits).
- ~20 bytes per character.
- Bandwidth: 8 * 20 * 20 = ~3.2KB/s. Excellent.

**3. Delta compression:**
- Only send state that changed since the last acknowledged packet.
- For mostly-stationary characters, this reduces bandwidth to near zero.
- Track per-object accumulators to prioritize frequently-changing objects.

### Authority and Ownership for Grab/Throw

**Problem:** When Player A grabs Player B, which client has authority over the coupled physics system?

**Solution - Dynamic authority transfer:**
1. **Default**: Each player's local client has authority over their own ragdoll.
2. **On grab**: Authority over the grabbed player transfers to the grabbing player's client (or to the server).
3. **On release/throw**: Authority transfers back to the released player's client.
4. **Conflict resolution**: Use sequence numbers. If two players grab each other simultaneously, the server decides who gets authority based on timing.

This mirrors the approach used in Gaffer on Games' VR networked physics:
- **Authority** determines who simulates an object.
- **Ownership** prevents others from interacting (e.g., can't grab an already-held object).
- Both are communicated via incrementing sequence numbers for conflict resolution.

### Rollback Considerations for Physics-Heavy Games

**Full physics rollback is impractical for ragdoll games:**
- Rewinding and re-simulating 8 ragdolls (96+ rigid bodies) for even 5 frames would take ~25-40ms, blowing the frame budget.
- Physics engines like Rapier don't natively support state save/restore (no snapshot/restore API for full world state).

**Practical alternatives:**

**1. No rollback, visual smoothing (recommended):**
- Accept that the server state is authoritative.
- When corrections arrive, blend the visual state toward the corrected state over 3-5 frames.
- Small corrections are invisible; large corrections are smoothed to avoid pops.
- This is what Party Animals likely uses.

**2. Partial rollback for local player only:**
- Save only the local player's ragdoll state (12 bodies) each frame.
- On server correction, restore the local player's state and re-simulate forward.
- Remote players are always interpolated (no rollback needed).
- Cost: ~2-4ms for one ragdoll re-simulation per correction frame.

**3. Input delay:**
- Add a small input delay (2-3 frames, ~33-50ms) to allow server confirmation before rendering.
- Combined with prediction, this eliminates most correction scenarios.
- Barely noticeable in a physics brawler where the inherent wobble masks small delays.

### Colyseus vs. Alternatives

| Framework | Protocol | Language | State Sync | Physics Support | Best For |
|-----------|----------|----------|-----------|-----------------|----------|
| **Colyseus** | WebSocket | Node.js/TS | Built-in delta sync | Manual | Web-native games (current stack) |
| **Nakama** | WebSocket/gRPC | Go | Manual | Manual | Social features + matchmaking |
| **Custom WebSocket** | WebSocket | Any | Manual | Manual | Maximum control |
| **WebRTC DataChannel** | UDP-like | Browser | Manual | Manual | P2P, lowest latency |
| **Geckos.io** | WebRTC | Node.js | Manual | Manual | UDP-like server-authoritative |

**Colyseus (Current Choice - Recommended to keep):**
- Already integrated in Ruckus Royale.
- Built-in delta-compressed state sync via `@colyseus/schema`.
- Automatic room lifecycle, matchmaking, reconnection.
- 60Hz simulation interval configurable.
- Schema tracks changed properties automatically, encoding only deltas.
- MIT licensed, 6.4K GitHub stars, 750K+ downloads.

**When to consider WebRTC (Geckos.io):**
- If TCP head-of-line blocking becomes a problem (unlikely for 8-player brawler).
- WebRTC data channels provide UDP-like unreliable delivery (10-15ms lower latency than WebSocket).
- More complex setup (STUN/TURN infrastructure).
- Consider only if latency-sensitive testing shows WebSocket is insufficient.

**Colyseus Schema approach for ragdoll state:**
```typescript
class PlayerRagdollState extends Schema {
  @type("number") rootX: number;
  @type("number") rootY: number;
  @type("number") rootZ: number;
  @type("number") rootQx: number;
  @type("number") rootQy: number;
  @type("number") rootQz: number;
  @type("number") rootQw: number;
  @type("number") velX: number;
  @type("number") velY: number;
  @type("number") velZ: number;
  // Additional key body parts as needed
}
```

Colyseus automatically detects which fields changed and sends only deltas, making it efficient for ragdoll state.

**Sources:**
- [Introduction to Networked Physics (Gaffer on Games)](https://gafferongames.com/post/introduction_to_networked_physics/)
- [State Synchronization (Gaffer on Games)](https://gafferongames.com/post/state_synchronization/)
- [Networked Physics in VR (Gaffer on Games)](https://gafferongames.com/post/networked_physics_in_virtual_reality/)
- [Client-Side Prediction and Server Reconciliation (Gabriel Gambetta)](https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html)
- [Synchronizing a Ragdoll in Networking (Photon Fusion 2)](https://projectnightmares.itch.io/project-legion/devlog/751303/synchronizing-a-ragdoll-in-networking-with-photon-fusion-2)
- [Colyseus Schema (GitHub)](https://github.com/colyseus/schema)
- [Colyseus State Synchronization Docs](https://docs.colyseus.io/state)
- [WebRTC for Web Games](https://www.webgamedev.com/backend/webrtc)
- [WebRTC vs WebSockets for Multiplayer Games](https://developers.rune.ai/blog/webrtc-vs-websockets-for-multiplayer-games)
- [Efficient Rollback for Physics (Jolt Discussion)](https://github.com/jrouwe/JoltPhysics/discussions/1034)
- [CrystalOrb - Rollback Networking (GitHub)](https://github.com/ErnWong/crystalorb)

---

## 6. Source Links and References

### GDC Talks

- [Physics Driven Ragdolls and Animation at EA: From Sports to Star Wars (GDC Vault)](https://www.gdcvault.com/play/1025210/Physics-Driven-Ragdolls-and-Animation)
- [Moving Beyond Ragdolls: Generating Versatile Human Behaviors (GDC Vault)](https://www.gdcvault.com/play/1020276/Moving-Beyond-Ragdolls-Generating-Versatile)
- [Machine Learning Summit: Ragdoll Motion Matching (GDC Vault)](https://www.gdcvault.com/play/1026712/Machine-Learning-Summit-Ragdoll-Motion)

### Technical Articles and Blog Posts

- [Analysis of Active Ragdolls in Games (Jan Schneider)](https://medium.com/@jacasch/analysis-of-active-ragdolls-in-games-82c95f8ed7a5)
- [Animation of Active Ragdolls in Games (Jan Schneider)](https://medium.com/@jacasch/animation-of-active-ragdolls-in-games-32ca9d98afc9)
- [Balancing of Active Ragdolls in Games (Jan Schneider)](https://medium.com/@jacasch/balancing-of-active-ragdolls-in-games-367f146b25fb)
- [How to Make Active Ragdolls in Unity (Sergio Abreu)](https://sergioabreu-g.medium.com/how-to-make-active-ragdolls-in-unity-35347dcb952d)
- [8 Tips for Animating Active Ragdolls (Gamasutra/Game Developer)](https://www.gamedeveloper.com/design/8-tips-for-animating-active-ragdolls)
- [Physics-Based Character Animation in Games (Ray Liao)](https://boruiliao.medium.com/what-is-physics-based-character-animation-in-games-using-unreal-engine-approach-as-an-example-571560376e4c)
- [Joint-Torque Control of Character Motions (Academic Paper)](https://www.xbdev.net/misc_demos/demos/joints_torques_and_control/paper.pdf)
- [Networked Physics Articles (Glenn Fiedler / Gaffer on Games)](https://gafferongames.com/)
- [Active Ragdoll Puppeteer/Marionette Technique (640Lab)](https://medium.com/@640Lab/active-ragdoll-physics-puppeteer-marionette-balance-technique-a2c09a4d8d6a)
- [Web Game Physics Engines Comparison](https://www.webgamedev.com/physics)

### Open Source Implementations

- [ActiveRagdoll - PID Controller Implementation (Unity/C#)](https://github.com/ashleve/ActiveRagdoll)
- [active-ragdolls - Unity Active Ragdolls (Sergio Abreu)](https://github.com/sergioabreu-g/active-ragdolls)
- [active-ragdolls - Implementation and Analysis (rmguney)](https://github.com/rmguney/active-ragdolls)
- [Hairibar.Ragdoll - Animation-Driven Ragdoll Package (Unity)](https://github.com/hairibar/Hairibar.Ragdoll)
- [Godot Open Ragdoll System](https://github.com/Wapit1/Godot_open_ragdoll_physic_body_system)
- [ragdoll.js - Browser Ragdolls (BabylonJS)](https://github.com/jongomez/ragdoll.js)
- [ragdoll-2d - Online 2D Ragdoll (p2.js)](https://github.com/abbebag/ragdoll-2d)
- [demo-rapier-three - Rapier + Three.js Demo](https://github.com/viridia/demo-rapier-three)
- [react-three-rapier - Rapier Physics in React](https://github.com/pmndrs/react-three-rapier)
- [Colyseus Schema - Delta State Serialization](https://github.com/colyseus/schema)

### Engine-Specific Ragdoll Resources

- [Rapier.js Documentation - Joints](https://rapier.rs/docs/user_guides/javascript/joints/)
- [Rapier.js Documentation - Joint Constraints](https://rapier.rs/docs/user_guides/javascript/joint_constraints/)
- [Rapier.js Documentation - Character Controller](https://rapier.rs/docs/user_guides/javascript/character_controller/)
- [JoltPhysics.js - WASM Physics for Web](https://github.com/jrouwe/JoltPhysics.js)
- [Babylon.js Ragdoll Documentation](https://doc.babylonjs.com/features/featuresDeepDive/physics/ragdolls)
- [UE5 Active Ragdoll Tutorial (Gang Beasts-style)](https://dev.epicgames.com/community/learning/tutorials/9LW5/how-to-make-an-active-ragdoll-like-gang-beasts-in-unreal-engine-5)

### Networking Resources

- [Multiplayer Networking Resources (Curated List)](https://multiplayernetworking.com/)
- [Awesome Game Networking (GitHub)](https://github.com/rumaniel/Awesome-Game-Networking)
- [Colyseus Framework](https://colyseus.io/)
- [Colyseus Documentation](https://docs.colyseus.io/)
- [Geckos.io - WebRTC for Node.js](https://github.com/geckosio/geckos.io)

---

## 7. Recommended Implementation Plan for Ruckus Royale

Based on this research, here is the recommended phased approach for upgrading the current game to have proper "party brawler ragdoll feel":

### Phase 1: Active Ragdoll Foundation (Visual Only)
- Keep the current capsule-based movement system for responsive input.
- Add a ragdoll skeleton (8-10 bodies connected by Rapier spherical/revolute joints).
- Implement PD motor-based pose matching from simple procedural animations (idle wobble, walk cycle arm swing).
- Skin the Three.js mesh to the ragdoll bones instead of the capsule.
- Result: Characters look like they have physics-based bodies while movement stays crisp.

### Phase 2: Combat Ragdoll Integration
- On hit: Apply impulse to the struck ragdoll body part, reduce PD stiffness temporarily.
- On knockout: Drop PD stiffness to zero, let character go full ragdoll.
- Recovery: Ramp PD stiffness back up over 0.5-1.0 seconds.
- Grab: Create temporary FixedJoint between hand and target.
- Throw: Remove joint + apply impulse.

### Phase 3: Network Ragdoll Sync
- Sync root body state (position, rotation, velocity) via Colyseus schema.
- Remote players: Interpolate root body + run simplified local ragdoll.
- Implement visual smoothing for state corrections.
- Add authority transfer for grab interactions.

### Phase 4: Polish and Tuning
- Per-character PD tuning for different weight classes.
- Hit reaction force curves (light vs. heavy vs. environmental).
- Grab break force tuning.
- Camera shake and juice tied to ragdoll events.
- Performance optimization pass (LOD ragdolls for far players, sleeping optimization).

### Key Architecture Decision: Party Animals Approach (Not Gang Beasts)

For a web game targeting 8 players at 60fps, the **Party Animals hybrid approach** is strongly recommended over the Gang Beasts full-ragdoll approach:

1. **Performance**: Full physics movement for 8 characters is ~3x more expensive than capsule + visual ragdoll.
2. **Responsiveness**: Capsule movement is instantly responsive. Physics movement always has inherent lag.
3. **Networking**: Syncing a capsule position + ragdoll visual state is far simpler than syncing full ragdoll physics state.
4. **Predictability**: Capsule physics is nearly deterministic, making client prediction reliable. Full ragdoll prediction would diverge frequently.
5. **Fun factor**: Party Animals proved that visual ragdoll wobble provides 90% of the comedy value without the frustration of imprecise movement.

The wobble and chaos should be cosmetic -- the actual gameplay should be tight and responsive underneath.
