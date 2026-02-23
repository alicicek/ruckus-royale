/**
 * Lightweight particle system for Ruckus Royale VFX.
 * Uses an object pool of small sphere meshes to avoid GC pressure.
 */

import * as THREE from "three";

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  active: boolean;
}

const POOL_SIZE = 200;
const GRAVITY = -9.8;

export class ParticleManager {
  private readonly pool: Particle[] = [];
  private readonly group = new THREE.Group();
  private nextIndex = 0;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.SphereGeometry(0.04, 4, 4);

    for (let i = 0; i < POOL_SIZE; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.group.add(mesh);

      this.pool.push({
        mesh,
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 0,
        active: false,
      });
    }

    scene.add(this.group);
  }

  /** Spawn a burst of particles at a position. */
  burst(
    position: { x: number; y: number; z: number },
    count: number,
    speed: number,
    color: number,
    life: number,
  ): void {
    for (let i = 0; i < count; i++) {
      const p = this.pool[this.nextIndex % POOL_SIZE];
      this.nextIndex++;

      p.mesh.position.set(
        position.x + (Math.random() - 0.5) * 0.15,
        position.y + (Math.random() - 0.5) * 0.15,
        position.z + (Math.random() - 0.5) * 0.15,
      );

      // Random velocity in a sphere
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const s = speed * (0.5 + Math.random() * 0.5);
      p.velocity.set(
        Math.sin(phi) * Math.cos(theta) * s,
        Math.abs(Math.sin(phi) * Math.sin(theta)) * s + speed * 0.3, // bias upward
        Math.cos(phi) * s,
      );

      p.life = life * (0.7 + Math.random() * 0.3);
      p.maxLife = p.life;
      p.active = true;
      p.mesh.visible = true;

      const mat = p.mesh.material as THREE.MeshBasicMaterial;
      mat.color.setHex(color);
      p.mesh.scale.setScalar(0.8 + Math.random() * 0.4);
    }
  }

  /** Update all active particles. */
  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.active) continue;

      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }

      // Physics
      p.velocity.y += GRAVITY * dt;
      p.mesh.position.x += p.velocity.x * dt;
      p.mesh.position.y += p.velocity.y * dt;
      p.mesh.position.z += p.velocity.z * dt;

      // Fade out and shrink
      const t = p.life / p.maxLife;
      const mat = p.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = t;
      mat.transparent = t < 1;
      p.mesh.scale.setScalar(t * (0.8 + (1 - t) * 0.5));
    }
  }
}
