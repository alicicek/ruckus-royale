# Visual Quality Research: Party Animals / Gang Beasts Level Graphics in the Browser

Research compiled 2026-02-23 for Ruckus Royale web party brawler.

---

## 1. Browser-Based Physics Brawlers at This Visual Level

### Short Answer: No direct equivalent exists in the browser.

There is no browser-based game that achieves the visual quality of Party Animals or Gang Beasts. Those games use Unity (Gang Beasts) and Unreal Engine 4 (Party Animals) with native GPU access, fur/hair shaders, high-polygon skinned meshes, screen-space ambient occlusion, and advanced post-processing. Browser games are improving rapidly but remain 1-2 generations behind native in character rendering quality.

### What DOES Exist in Browser

**High-quality 3D browser games (closest examples):**
- **PlayCanvas-powered games** (e.g., Venge.io, Robostorm) deliver console-quality lighting and 60fps but focus on hard-surface FPS/vehicle models, not soft-body characters.
- **Krunker.io** — One of the most polished browser FPS games, built with Three.js. Clean visuals but stylized/low-poly, no character physics.
- **Shell Shockers** — PlayCanvas multiplayer FPS with stylized egg characters. Good performance but no ragdoll.
- **Mk48.io, Kiomet** — WebGL multiplayer games with physics, but 2D/isometric.
- **Miniplay "Party Animals"** — A simplified 2D clone, not comparable in visual quality.

**WebGPU emerging titles (2025-2026):**
- Chrome, Edge, and Firefox now enable WebGPU by default. This unlocks compute shaders for cloth physics, fluid dynamics, and complex particle systems that were impossible with WebGL alone.
- No physics brawler has shipped on WebGPU yet, but the capability gap is closing.

### What Tech They Use

| Game | Engine | Rendering | Physics |
|------|--------|-----------|---------|
| Party Animals (native) | Unreal Engine 4 | Deferred rendering, fur shader, SSS, SSAO | PhysX active ragdoll |
| Gang Beasts (native) | Unity | Forward rendering, toon outlines, soft shadows | Unity PhysX ragdoll |
| Venge.io (browser) | PlayCanvas | Forward PBR, dynamic shadows, bloom | Ammo.js |
| Shell Shockers (browser) | PlayCanvas | Forward rendering, baked lighting | Ammo.js |
| Krunker (browser) | Three.js | Forward rendering, custom shaders | Custom |

### Verdict for Ruckus Royale
We cannot match Party Animals' fur shaders or Gang Beasts' post-processing pipeline in the browser. But we CAN achieve a **stylized toon/plush aesthetic** that reads as high quality by using:
1. MeshToonMaterial or custom toon shader with gradient maps
2. Soft shadows (PCF or PCSS)
3. Rim lighting for character silhouette pop
4. Subsurface scattering approximation for "squishy" translucent look
5. Bloom post-processing for warmth
6. Stylized low-poly models (fewer polygons = better performance = more budget for shader effects)

---

## 2. Three.js vs Babylon.js vs PlayCanvas for Character Animation

### Architecture Summary

| Feature | Three.js | Babylon.js | PlayCanvas |
|---------|----------|------------|------------|
| **Type** | Rendering library | Full game engine | Cloud game engine + editor |
| **Animation System** | AnimationMixer, AnimationClip, KeyframeTrack | AnimationGroup, Animatable, weighted blending | State-based animation graph |
| **Skinned Mesh** | SkinnedMesh + Skeleton + Bone | Skeleton + TransformNode bones | Built-in skinned mesh |
| **Ragdoll** | None built-in (DIY with Rapier/Cannon) | Built-in Ragdoll class (v7.0+) | Ammo.js integration, manual setup |
| **Animation Blending** | CrossFadeAction (2 anims), limited weighting | AnimationGroup weights + masks (v7.0+), per-bone masks | Animation state graph with blend trees |
| **Physics Integration** | External (Rapier, Cannon, Ammo) | Built-in (Cannon, Ammo, Oimo, Havok) | Built-in (Ammo.js / Bullet) |
| **WebGPU** | Yes (r171+, zero-config) | Yes (since v5.0) | Yes (experimental) |
| **Weekly Downloads** | ~4.2M | ~120K | ~15K (plus hosted editor users) |
| **Community Size** | Largest by far | Strong, very responsive forum | Smaller but professional |

### For Skinned Mesh Animation

**Three.js**: AnimationMixer handles glTF skeletal animations well. You load a GLB, extract AnimationClips, and use `crossFadeTo()` for smooth transitions between idle/walk/run/attack. It works. The limitation is that blending is binary (crossfade between 2 clips) — there is no built-in additive animation layering or per-bone masking.

**Babylon.js**: AnimationGroups in v7.0 support weighted blending and bone masks. You can run a walk cycle on legs while playing a sword swing on the upper body simultaneously. This is significantly more powerful for character games. The `AnimationGroup.weight` property and `AnimationGroupMask` class enable:
- Forward walk + sideways strafe blending
- Upper/lower body split animations
- Active morph target lip sync layered on top

**PlayCanvas**: Has a visual animation state graph editor. Define states (idle, walk, run, attack), transitions, and blend trees visually. Best for teams with animators. The state graph approach prevents animation bugs (impossible states).

### For Ragdoll Physics Blending

**Three.js + Rapier** (our current stack): Rapier has PD motor support on joints. We build the ragdoll manually, set motor targets from animation poses, and read bone transforms back into the Three.js Skeleton. This is what our existing plan describes. It works but requires custom code for everything.

**Babylon.js**: Has a dedicated `Ragdoll` class since v7.0. Configuration-based: you pass a skeleton, mesh, and config array defining shapes per bone. Supports kinematic mode (animation drives physics) and dynamic mode (physics drives bones). The API:
```javascript
const ragdoll = new BABYLON.Ragdoll(skeleton, skinnedMesh, config);
ragdoll.ragdoll(); // switch from kinematic to dynamic
ragdoll.getAggregate(0)?.body.applyImpulse(impulse, point);
```
Limitation: GLTF/GLB imports only work in Right Handed scenes.

**PlayCanvas**: No built-in ragdoll class. You integrate Ammo.js constraints manually, similar to the Three.js approach.

### Recommendation for Ruckus Royale

**Stay with Three.js + Rapier.** Rationale:
1. Already integrated; switching engines mid-project is high risk.
2. Rapier's PD motor API provides everything Babylon's Ragdoll class does, just with more manual setup.
3. Three.js has the largest community — every problem is solved somewhere.
4. Babylon's ragdoll class is convenient but comes with the entire Babylon.js engine. It does not justify a full engine migration.
5. The "missing" features (animation masks, weighted blending) matter less because our characters use procedural ragdoll poses, not complex layered animation clips.

If we were starting from scratch, Babylon.js would be a strong choice for its animation and ragdoll features. But for this project, the switching cost far exceeds the benefit.

---

## 3. Achieving the "Soft Toy / Plush" Look in WebGL

### Key Visual Properties of Party Animals Characters
1. **Soft, rounded silhouettes** — no hard edges
2. **Matte fabric-like surface** — not shiny, not flat
3. **Subtle subsurface scattering** — light passes through ears, paws
4. **Warm, soft shadows** — no harsh shadow edges
5. **Rim/fresnel lighting** — bright edge highlight for readability
6. **Slight fuzz/fur** — NOT achievable in WebGL at game framerate (skip this)
7. **Bright, saturated colors** — child-friendly palette

### Technique Breakdown

#### A. Toon/Cel Shading (Primary Look)

**Three.js MeshToonMaterial** provides the foundation:
- Uses a gradient map (1D texture) to discretize lighting into bands
- Default: 2-band (70% brightness / 100% brightness)
- Custom gradient maps can create 3-4 bands for softer transitions
- Supports normal maps, emissive, environment maps

```javascript
const gradientMap = new THREE.DataTexture(
  new Uint8Array([80, 160, 200, 255]), 4, 1, THREE.LuminanceFormat
);
gradientMap.minFilter = THREE.NearestFilter;
gradientMap.magFilter = THREE.NearestFilter;

const material = new THREE.MeshToonMaterial({
  color: 0xff9966,
  gradientMap: gradientMap,
});
```

**Custom toon shader** for more control:
- Add rim lighting: `pow(1.0 - dot(normal, viewDir), rimPower) * rimColor`
- Multiply rim by NdotL to only show rim in lit areas
- Use smoothstep for crisp but not aliased light/shadow boundary

Resources:
- [Custom Toon Shader Tutorial (maya-ndljk)](https://www.maya-ndljk.com/blog/threejs-basic-toon-shader)
- [Three.js Toon Shader Repo](https://github.com/mayacoda/toon-shader)
- [Adapting Toon Shaders for Stylized Objects](https://blog.dddice.com/adapting-three-js-toon-shader-for-cartoony-3d-dice/)
- [WebGL Toon Shader Example](https://webgl-shaders.com/toon-example.html)

#### B. Subsurface Scattering Approximation

Three.js has a built-in SSS example (`webgl_materials_subsurface_scattering`) using the Blinn-Phong wrap lighting approach. This is NOT full ray-traced SSS but a screen-space approximation that runs at game framerate.

**Fast SSS technique:**
1. Wrap diffuse lighting: `max(0, (NdotL + wrap) / (1 + wrap))` where wrap ~0.3
2. Add a translucency term based on view-through-light alignment
3. Multiply by a "thickness map" (baked in Blender as inverted AO from inside the mesh)

This gives the "light passing through ears/paws" effect cheaply.

Resources:
- [Three.js SSS Example](https://github.com/mrdoob/three.js/blob/dev/examples/webgl_materials_subsurface_scattering.html)
- [Fast SSS Demo](https://mjurczyk.github.io/three.js/examples/webgl_materials_subsurface_scattering.html)
- [SSS in Babylon.js Forum](https://forum.babylonjs.com/t/subsurface-scattering-in-babylonjs/425)

#### C. Soft Shadows

Three.js supports PCF soft shadow maps:
```javascript
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
directionalLight.shadow.radius = 4;
directionalLight.shadow.blurSamples = 16;
```

For even softer shadows, use PCSS (Percentage-Closer Soft Shadows) via a custom shader chunk override. This gives distance-dependent shadow softness (contact shadows are sharp, distant shadows are blurry).

#### D. Post-Processing for Warmth

Three.js EffectComposer pipeline:
1. **Bloom** (UnrealBloomPass) — adds glow to bright areas, makes the scene feel warm
2. **Color grading** — push toward warm palette
3. **Vignette** — subtle darkening at edges for coziness
4. **FXAA/SMAA** — anti-aliasing to soften geometry edges

#### E. Combined "Plush Shader" Recipe

For Ruckus Royale, the recommended shader stack (in priority order):

1. **MeshToonMaterial with 3-4 band gradient map** — establishes the cartoon look
2. **Rim lighting** via custom shader modification — character readability
3. **Soft shadows** (PCFSoft, radius 4-6) — removes harsh edges
4. **Bloom post-processing** (threshold 0.8, strength 0.3) — warmth and glow
5. **Optional: Wrap diffuse lighting** for SSS approximation on ears/extremities
6. **Saturated, warm color palette** — the single biggest factor in "cute" perception

Skip: fur shaders, shell texturing, hair cards. These are too expensive for 8 characters at 60fps in WebGL.

---

## 4. GLTF Animated Character Models for Web Games

### Free/CC0 Sources for Cute Animal Characters

#### Quaternius — Ultimate Animated Animal Pack
- **URL**: https://quaternius.com/packs/ultimateanimatedanimals.html
- **Contents**: 12 different animals, each with 12+ animations (Attack, Death, Kicks, Gallops, Walk, Jump, etc.)
- **Formats**: FBX, OBJ, glTF, Blend
- **License**: CC0 (public domain — free for commercial use)
- **Quality**: Low-poly stylized, game-ready. Good starting point for further customization.
- **Verdict**: BEST free option for this project. Immediately usable in Three.js via GLTFLoader.

#### Quaternius — Farm Animal Pack
- **URL**: https://poly.pizza/bundle/Farm-Animal-Pack-1kUvRTPLzT
- **Contents**: 7 farm animals (cow, pig, chicken, etc.) with idle, walk, run, jump animations
- **Formats**: FBX, glTF
- **License**: CC0

#### Quaternius — Low Poly Animated Animals
- **URL**: https://quaternius.itch.io/lowpoly-animated-animals
- **Contents**: Additional low-poly animal set
- **Formats**: FBX, glTF, Blend
- **License**: CC0

#### Itch.io Cartoon Animals (24 Models)
- **URL**: https://itch.io/blog/1109246/24-cartoon-animal-3d-models-with-animations-ready-to-use-for-games-animation-teaching
- **Contents**: 24 cartoon animal models with animations
- **Quality**: Purpose-built for games and teaching

#### KayKit Game Assets
- **URL**: https://kaylousberg.itch.io/
- **Contents**: Character packs (Adventurers, Skeletons, Dungeon assets) — humanoid, not animals
- **Formats**: FBX, OBJ, DAE, glTF
- **License**: CC0
- **Note**: Useful for humanoid prototyping, not for animal characters specifically

#### TurboSquid glTF Animated Models
- **URL**: https://www.turbosquid.com/Search/3D-Models/animated/gltf
- **Contents**: Mixed quality/price. Some free, most paid.
- **Formats**: glTF among others

### Creating Custom Characters

#### Mixamo Pipeline (Humanoid Only)
Mixamo only rigs humanoid bipeds. For non-human characters:

1. **Model in Blender** (or use Quaternius base)
2. **Rig manually** with Blender's armature tools or use Rigify with custom bone chains
3. **Animate in Blender** using NLA editor or retarget Mixamo animations to custom rigs
4. **Export as glTF 2.0** (.glb binary) with embedded animations
5. **Load in Three.js** via GLTFLoader, extract AnimationClips

Reference workflow: [Creating Animated glTF Characters with Mixamo and Blender](https://www.donmccurdy.com/2017/11/06/creating-animated-gltf-characters-with-mixamo-and-blender/) (Don McCurdy, Three.js glTF maintainer)

#### Recommended Workflow for Ruckus Royale
1. Start with **Quaternius Ultimate Animated Animal Pack** as placeholder/prototype
2. Test glTF loading, animation playback, and ragdoll attachment with these models
3. Commission or create custom models later once the gameplay feel is locked
4. Custom models should target **2000-5000 triangles per character** for 8-player 60fps

### Technical Notes on glTF for Web
- **GLB (binary glTF)** is the preferred format — single file, smaller, faster to load
- Three.js GLTFLoader handles skeletal animation, morph targets, PBR materials natively
- Draco compression can reduce mesh size by 80-90%
- Animation data often dominates file size — use quantization or reduce keyframes in Blender
- Target **< 500KB per character GLB** for fast web loading

---

## 5. Babylon.js Ragdoll + Animation Blending vs Three.js

### Babylon.js Ragdoll System (v7.0+)

**Built-in Ragdoll class** with configuration-based setup:

```javascript
const config = [
  { bones: ["spine"], size: 0.15, boxOffset: 0.1 },
  { bones: ["head"], size: 0.12 },
  { bones: ["leftUpperArm", "rightUpperArm"], size: 0.08,
    rotationAxis: BABYLON.Axis.Z, min: -1.5, max: 1.5 },
  { bones: ["leftLowerArm", "rightLowerArm"], size: 0.07,
    rotationAxis: BABYLON.Axis.Z, min: 0, max: 2.5 },
  { bones: ["leftUpperLeg", "rightUpperLeg"], size: 0.1,
    rotationAxis: BABYLON.Axis.X, min: -1.5, max: 0.5 },
  { bones: ["leftLowerLeg", "rightLowerLeg"], size: 0.09,
    rotationAxis: BABYLON.Axis.X, min: 0, max: 2.5 },
];

const ragdoll = new BABYLON.Ragdoll(skeleton, mesh, config);
```

**Two modes:**
1. **Kinematic** (default on creation): Animation drives the physics bodies. Physics bodies follow bone positions. Useful for normal gameplay.
2. **Dynamic** (after `ragdoll.ragdoll()`): Physics drives the bones. Bones follow physics body positions. Useful for knockout/death.

**Applying forces:**
```javascript
ragdoll.getAggregate(0)?.body.applyImpulse(
  new BABYLON.Vector3(200, 200, 200),
  BABYLON.Vector3.ZeroReadOnly
);
```

**Limitation**: GLTF/GLB imports only work as ragdolls in Right Handed scenes. Left Handed scenes add intermediate TransformNodes that break the ragdoll bone mapping.

### Babylon.js Animation Blending (v7.0+)

**AnimationGroup weights:**
```javascript
walkGroup.weight = 0.6;
strafeGroup.weight = 0.4;
// Both play simultaneously, blended by weight
```

**Animation masks (per-bone):**
```javascript
const upperBodyMask = new BABYLON.AnimationGroupMask(skeleton, {
  includeOnly: ["spine", "head", "leftUpperArm", "rightUpperArm", ...]
});
attackGroup.mask = upperBodyMask;
// Attack only affects upper body; legs continue walking
```

This enables:
- Simultaneous walk cycle + upper body attack
- Forward walk blended with sideways strafe at arbitrary ratios
- Morph target lip sync layered on top of body animation

### Three.js Animation System (Current)

**AnimationMixer** with crossfade:
```javascript
const mixer = new THREE.AnimationMixer(model);
const idleAction = mixer.clipAction(idleClip);
const walkAction = mixer.clipAction(walkClip);

idleAction.crossFadeTo(walkAction, 0.3); // 0.3s transition
```

**Limitations:**
- CrossFade is between 2 actions only (A fades out, B fades in)
- No native per-bone masking
- No native additive animation layers
- Weighted blending possible but manual (set `action.weight` + `action.play()` for multiple simultaneous actions)

**Workaround for upper/lower body split:**
- Run two AnimationMixers on different bone subsets
- Manually set bone transforms for one half
- This is hacky and error-prone

### Three.js + Rapier Ragdoll (Our Approach)

We build the ragdoll from scratch using Rapier rigid bodies and joints:
- Each body part = RigidBody with Collider
- Joints use `configureMotorPosition(target, stiffness, damping)` for PD control
- Read body transforms back into Three.js Bone positions each frame
- No dependency on Three.js animation system for ragdoll-driven poses

This actually bypasses the Three.js animation limitation because we are not using AnimationClips for gameplay poses — we are using physics motor targets.

### Comparison Matrix

| Feature | Babylon.js (v7.0) | Three.js + Rapier (our stack) |
|---------|-------------------|-------------------------------|
| Ragdoll setup | Config-based, ~20 lines | Manual body/joint creation, ~200 lines |
| Ragdoll activation | `ragdoll.ragdoll()` | Set motor stiffness to 0 |
| Ragdoll deactivation | Switch to kinematic | Ramp motor stiffness back up |
| Force on body part | `getAggregate().body.applyImpulse()` | `rigidBody.applyImpulse()` |
| Animation blending | Native weights + masks | Not needed (ragdoll-driven) |
| PD motor control | Not exposed in Ragdoll API | Full control via Rapier motor API |
| Active ragdoll (partial stiffness) | Not built-in (kinematic OR dynamic) | Native via motor stiffness values |
| Physics solver quality | Depends on backend (Havok, Ammo) | Rapier XPBD solver (stable, fast) |
| Performance (8 ragdolls) | Comparable | ~3-5ms per frame (well within budget) |

### Key Insight: Babylon's Ragdoll Is All-or-Nothing

Babylon's Ragdoll class switches between **fully kinematic** (animation-driven) and **fully dynamic** (physics-driven). It does NOT natively support the "active ragdoll" state where physics bodies have partial stiffness and are trying to match an animation target.

Our Rapier-based approach with PD motors is fundamentally better for Party Animals-style gameplay because:
1. We can set per-joint stiffness to any value (high = animation-like, low = ragdoll-like)
2. We can gradually reduce stiffness for knockout and ramp it back for recovery
3. We can have different stiffness per body part (stiff hips, floppy arms)
4. Hit reactions naturally blend with animation via temporary stiffness reduction

Babylon would require custom code on top of their Ragdoll class to achieve this, negating its convenience advantage.

### Active Ragdoll: The Babylon.js Community Perspective

A Babylon.js forum thread titled "Active ragdoll physics" (https://forum.babylonjs.com/t/active-ragdoll-physics/49526) confirms that active ragdolls are NOT a built-in feature. Developers need to build this on top of the base physics system, similar to what we're doing with Rapier.

### ragdoll.js (Standalone Library)

There is a standalone library called ragdoll.js (https://github.com/jongomez/ragdoll.js) that works with Babylon.js + AmmoJS/CannonJS/OimoJS. It is a small community project, not production-grade. It provides ragdoll creation helpers but does NOT implement active ragdoll / PD motor control.

---

## Overall Recommendations for Ruckus Royale

### Engine Stack: KEEP Three.js + Rapier.js + Colyseus
No findings in this research change the recommendation from `party_feel_research.md`. The Rapier PD motor approach is the right one.

### Visual Quality Strategy

**Phase 1 (Now — with procedural geometry):**
1. Switch from MeshStandardMaterial to MeshToonMaterial with custom gradient map
2. Add soft shadows (PCFSoftShadowMap)
3. Add subtle bloom post-processing
4. Use warm, saturated color palette

**Phase 2 (After ragdoll is working):**
1. Replace procedural geometry with Quaternius animal GLB models
2. Add rim lighting via ShaderMaterial extension or onBeforeCompile hook
3. Add SSS approximation for ears/extremities
4. Add outline pass for character readability

**Phase 3 (Polish):**
1. Commission or create custom animal models (2000-5000 tris each)
2. Per-character material variations (color, slight shader tweaks)
3. Environment art to match character style
4. Particle effects (dust, impact stars, knockout spirals)

### Character Models: Start with Quaternius
- Download the Ultimate Animated Animal Pack (CC0, free, glTF format)
- Test immediately with GLTFLoader
- The animations won't be used for gameplay (ragdoll-driven) but useful for:
  - Idle pose targets for PD motors
  - Walk cycle targets for PD motors
  - Visual reference for proportions

### Performance Budget
- 8 characters at 60fps on mid-range hardware
- Target per-character: < 5000 triangles, 1 draw call (instanced material)
- Ragdoll physics: ~3-5ms total for 8 ragdolls (Rapier WASM)
- Rendering: < 8ms (60fps = 16.6ms total frame budget)
- Leave ~4ms for networking, game logic, JS overhead

---

## Source Links

### Browser Game Examples
- [PlayCanvas Engine](https://playcanvas.com/)
- [WebGPU Browser Games 2025](https://netgamex.com/blog/the-webgpu-browser-games-of-2025)
- [Best WebGL Games (Awwwards)](https://www.awwwards.com/best-webgl-games-best-HTML5-games.html)
- [HTML5 Game Dev Trends 2025](https://playgama.com/blog/general/top-html5-game-development-trends-in-2024-and-beyond/)

### Engine Comparisons
- [Three.js vs Babylon.js vs PlayCanvas 2026](https://www.utsubo.com/blog/threejs-vs-babylonjs-vs-playcanvas-comparison)
- [Babylon.js vs Three.js (Slant)](https://www.slant.co/versus/11077/11348/~babylon-js_vs_three-js)
- [Three.js vs Babylon.js (LogRocket)](https://blog.logrocket.com/three-js-vs-babylon-js/)
- [Best JS Game Engines 2025 (LogRocket)](https://blog.logrocket.com/best-javascript-html5-game-engines-2025/)

### Toon Shading / Visual Quality
- [Custom Toon Shader Tutorial](https://www.maya-ndljk.com/blog/threejs-basic-toon-shader)
- [Three.js Toon Shader Repository](https://github.com/mayacoda/toon-shader)
- [MeshToonMaterial Tutorial](https://sbcode.net/threejs/meshtoonmaterial/)
- [Toon Shader for Cartoony Objects](https://blog.dddice.com/adapting-three-js-toon-shader-for-cartoony-3d-dice/)
- [WebGL Toon Shader Example](https://webgl-shaders.com/toon-example.html)
- [WebGL Palette/Toon Shader](https://github.com/Tw1ddle/webgl-palette-shader)

### Subsurface Scattering
- [Three.js SSS Example (GitHub)](https://github.com/mrdoob/three.js/blob/dev/examples/webgl_materials_subsurface_scattering.html)
- [Fast SSS Demo](https://mjurczyk.github.io/three.js/examples/webgl_materials_subsurface_scattering.html)
- [SSS in Babylon.js Forum](https://forum.babylonjs.com/t/subsurface-scattering-in-babylonjs/425)
- [Intro to Real-Time SSS](https://therealmjp.github.io/posts/sss-intro/)
- [SSS Shader (Medium)](https://medium.com/dotcrossdot/subsurface-scattering-d092ab72aab)

### Soft Shadows
- [Three.js Soft Shadows Tutorial](https://sbcode.net/threejs/soft-shadows/)

### Character Models
- [Quaternius Ultimate Animated Animals](https://quaternius.com/packs/ultimateanimatedanimals.html)
- [Quaternius All Packs](https://quaternius.com/)
- [24 Cartoon Animal Models (itch.io)](https://itch.io/blog/1109246/24-cartoon-animal-3d-models-with-animations-ready-to-use-for-games-animation-teaching)
- [KayKit Character Assets](https://kaylousberg.itch.io/)
- [Animated glTF Characters Workflow (Don McCurdy)](https://www.donmccurdy.com/2017/11/06/creating-animated-gltf-characters-with-mixamo-and-blender/)
- [TurboSquid Animated glTF Models](https://www.turbosquid.com/Search/3D-Models/animated/gltf)
- [Free Character Animations (RancidMilk)](https://rancidmilk.itch.io/free-character-animations)

### Ragdoll Systems
- [Babylon.js Ragdoll Documentation](https://doc.babylonjs.com/features/featuresDeepDive/physics/ragdolls)
- [Babylon.js Advanced Animation](https://doc.babylonjs.com/features/featuresDeepDive/animation/advanced_animations)
- [Babylon.js 7.0 Announcement](https://babylonjs.medium.com/introducing-babylon-js-7-0-a141cd7ede0d)
- [Active Ragdoll Physics (Babylon Forum)](https://forum.babylonjs.com/t/active-ragdoll-physics/49526)
- [ragdoll.js Library](https://github.com/jongomez/ragdoll.js)
- [3D Ragdoll Game with JavaScript Tutorial](https://www.threejsworld.com/tutorials/how-i-made-a-3d-ragdoll-game-with-javascript)
- [Cannon.js Ragdoll Demo](https://schteppe.github.io/cannon.js/demos/ragdoll.html)
- [Ragdoll Physics CodeSandbox (Cannon)](https://codesandbox.io/s/ragdoll-physics-wdzv4)
