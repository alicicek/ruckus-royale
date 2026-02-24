/**
 * Rapier debug renderer for Three.js.
 *
 * Uses `world.debugRender()` to visualise all colliders and joints as
 * wireframe line segments.  Buffers are reused across frames and only
 * reallocated when the debug geometry grows, avoiding per-frame GC pressure.
 *
 * Toggle with backtick (`) key or the Lab UI checkbox.
 */

import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";

export class RapierDebugRenderer {
  private readonly mesh: THREE.LineSegments;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.LineBasicMaterial;

  /** Current capacity (in number of floats) for the position buffer. */
  private posCapacity = 0;
  /** Current capacity (in number of floats) for the color buffer. */
  private colorCapacity = 0;

  private _visible = false;

  constructor(scene: THREE.Scene) {
    this.geometry = new THREE.BufferGeometry();
    this.material = new THREE.LineBasicMaterial({
      vertexColors: true,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      opacity: 0.85,
    });

    this.mesh = new THREE.LineSegments(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 999; // Render on top of everything else

    scene.add(this.mesh);
  }

  /**
   * Call each frame when enabled.  Reads debug geometry from the Rapier world
   * and updates the Three.js line-segment mesh.
   */
  update(world: RAPIER.World): void {
    if (!this._visible) return;

    const buffers = world.debugRender();
    const vertices = buffers.vertices; // Float32Array — [x1,y1,z1, x2,y2,z2, ...]
    const colors = buffers.colors;     // Float32Array — [r1,g1,b1,a1, r2,g2,b2,a2, ...]

    const vertexCount = vertices.length / 3;

    // ── Position attribute ──
    if (vertices.length > this.posCapacity) {
      // Need a bigger buffer — allocate with 50% headroom to reduce future reallocations
      this.posCapacity = Math.ceil(vertices.length * 1.5);
      const posArray = new Float32Array(this.posCapacity);
      posArray.set(vertices);
      this.geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(posArray, 3),
      );
    } else {
      // Reuse existing buffer
      const posAttr = this.geometry.getAttribute("position") as THREE.Float32BufferAttribute;
      (posAttr.array as Float32Array).set(vertices);
      posAttr.needsUpdate = true;
    }

    // ── Color attribute (convert RGBA to RGB) ──
    const rgbFloatCount = vertexCount * 3;

    if (rgbFloatCount > this.colorCapacity) {
      this.colorCapacity = Math.ceil(rgbFloatCount * 1.5);
      const colorArray = new Float32Array(this.colorCapacity);
      this.convertRGBAtoRGB(colors, colorArray, vertexCount);
      this.geometry.setAttribute(
        "color",
        new THREE.Float32BufferAttribute(colorArray, 3),
      );
    } else {
      const colAttr = this.geometry.getAttribute("color") as THREE.Float32BufferAttribute;
      this.convertRGBAtoRGB(colors, colAttr.array as Float32Array, vertexCount);
      colAttr.needsUpdate = true;
    }

    // Only draw the valid portion of the buffer
    this.geometry.setDrawRange(0, vertexCount);
    this.geometry.computeBoundingSphere();
  }

  /** Convert RGBA (4 floats per vertex) to RGB (3 floats per vertex). */
  private convertRGBAtoRGB(
    rgba: Float32Array,
    rgb: Float32Array,
    vertexCount: number,
  ): void {
    for (let i = 0; i < vertexCount; i++) {
      rgb[i * 3] = rgba[i * 4];
      rgb[i * 3 + 1] = rgba[i * 4 + 1];
      rgb[i * 3 + 2] = rgba[i * 4 + 2];
    }
  }

  setVisible(visible: boolean): void {
    this._visible = visible;
    this.mesh.visible = visible;

    // When hiding, clear the draw range so stale lines don't show if toggled back
    if (!visible) {
      this.geometry.setDrawRange(0, 0);
    }
  }

  get visible(): boolean {
    return this._visible;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    // The mesh is removed from the scene on disposal of the parent
  }
}
