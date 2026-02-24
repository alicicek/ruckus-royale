#!/usr/bin/env python3
"""
Procedural bean character generator for Ruckus Royale.

Creates a simple bean-shaped character with an armature, auto-weights it,
and exports as GLB in T-pose.

Usage:
    blender --background --python scripts/generate_bean.py

Output:
    apps/client/public/models/bean_character.glb

Requirements:
    - Blender 3.6+ (tested with 4.x)
    - Run from the project root directory

The bean character consists of:
    - A smooth torso+head shape (elongated sphere with head blended in)
    - Stubby arms (short capsule shapes at shoulders)
    - Stubby legs (short capsule shapes at hips)
    - A matching armature with bones for ragdoll driving

Bone hierarchy:
    torso (root)
      +-- head
      +-- l_upperArm
      |     +-- l_foreArm
      +-- r_upperArm
      |     +-- r_foreArm
      +-- l_thigh
      |     +-- l_shin
      +-- r_thigh
            +-- r_shin
"""

import bpy
import bmesh
import math
import os
import sys

# ── Configuration ──

# Body proportions (matching the game's ragdoll constants)
TORSO_HEIGHT = 0.70       # full height of torso capsule
TORSO_RADIUS = 0.32
HEAD_RADIUS = 0.26
HEAD_BLEND_FACTOR = 0.6   # how much the head blends into the torso top

UPPER_ARM_LENGTH = 0.40   # full length
UPPER_ARM_RADIUS = 0.10
FOREARM_LENGTH = 0.36
FOREARM_RADIUS = 0.09

THIGH_LENGTH = 0.44
THIGH_RADIUS = 0.11
SHIN_LENGTH = 0.44
SHIN_RADIUS = 0.085

# Shoulder and hip offsets
SHOULDER_Y = TORSO_HEIGHT * 0.35   # offset from torso center (up)
SHOULDER_X = TORSO_RADIUS + 0.04   # lateral offset from center
HIP_X = 0.12                       # lateral offset for legs
HIP_Y = -TORSO_HEIGHT * 0.5        # offset from torso center (down)

# Subdivision level for smooth look
SUBDIV_LEVEL = 2

# Output path (relative to project root)
OUTPUT_PATH = "apps/client/public/models/bean_character.glb"


def clear_scene():
    """Remove all default objects from the scene."""
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    # Clear orphan data
    for block in bpy.data.meshes:
        if block.users == 0:
            bpy.data.meshes.remove(block)
    for block in bpy.data.materials:
        if block.users == 0:
            bpy.data.materials.remove(block)
    for block in bpy.data.armatures:
        if block.users == 0:
            bpy.data.armatures.remove(block)


def create_capsule(name, radius, half_length, segments_ring=12, segments_height=6, segments_cap=6):
    """
    Create a capsule mesh (cylinder with hemisphere caps).
    The capsule is oriented along the Y axis, centered at origin.
    Total height = 2 * half_length + 2 * radius (caps).
    """
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()

    # Parameters
    total_height = 2 * half_length
    rings = segments_height
    cap_rings = segments_cap

    verts_by_ring = []

    # Bottom hemisphere cap
    for i in range(cap_rings, 0, -1):
        angle = (math.pi / 2) * (i / cap_rings)
        ring_radius = radius * math.cos(angle)
        ring_y = -half_length - radius * math.sin(angle)
        ring_verts = []
        for j in range(segments_ring):
            theta = 2 * math.pi * j / segments_ring
            x = ring_radius * math.cos(theta)
            z = ring_radius * math.sin(theta)
            v = bm.verts.new((x, ring_y, z))
            ring_verts.append(v)
        verts_by_ring.append(ring_verts)

    # Cylinder body
    for i in range(rings + 1):
        ring_y = -half_length + total_height * (i / rings)
        ring_verts = []
        for j in range(segments_ring):
            theta = 2 * math.pi * j / segments_ring
            x = radius * math.cos(theta)
            z = radius * math.sin(theta)
            v = bm.verts.new((x, ring_y, z))
            ring_verts.append(v)
        verts_by_ring.append(ring_verts)

    # Top hemisphere cap
    for i in range(1, cap_rings + 1):
        angle = (math.pi / 2) * (i / cap_rings)
        ring_radius = radius * math.cos(angle)
        ring_y = half_length + radius * math.sin(angle)
        ring_verts = []
        for j in range(segments_ring):
            theta = 2 * math.pi * j / segments_ring
            x = ring_radius * math.cos(theta)
            z = ring_radius * math.sin(theta)
            v = bm.verts.new((x, ring_y, z))
            ring_verts.append(v)
        verts_by_ring.append(ring_verts)

    # Bottom pole
    bottom_pole = bm.verts.new((0, -half_length - radius, 0))
    # Top pole
    top_pole = bm.verts.new((0, half_length + radius, 0))

    bm.verts.ensure_lookup_table()

    # Create faces between rings
    for i in range(len(verts_by_ring) - 1):
        for j in range(segments_ring):
            j_next = (j + 1) % segments_ring
            v1 = verts_by_ring[i][j]
            v2 = verts_by_ring[i][j_next]
            v3 = verts_by_ring[i + 1][j_next]
            v4 = verts_by_ring[i + 1][j]
            bm.faces.new([v1, v2, v3, v4])

    # Bottom cap faces (triangles to pole)
    for j in range(segments_ring):
        j_next = (j + 1) % segments_ring
        bm.faces.new([bottom_pole, verts_by_ring[0][j_next], verts_by_ring[0][j]])

    # Top cap faces (triangles to pole)
    top_ring = verts_by_ring[-1]
    for j in range(segments_ring):
        j_next = (j + 1) % segments_ring
        bm.faces.new([top_pole, top_ring[j], top_ring[j_next]])

    bm.to_mesh(mesh)
    bm.free()
    mesh.update()

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def create_sphere(name, radius, segments=16, rings=12):
    """Create a UV sphere mesh centered at origin."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def create_bean_torso():
    """
    Create the bean torso+head shape.
    This is an elongated capsule for the torso with a sphere blended
    into the top for the head, creating a smooth bean silhouette.
    """
    # Create main torso capsule
    torso = create_capsule(
        "BeanTorso",
        radius=TORSO_RADIUS,
        half_length=TORSO_HEIGHT / 2,
        segments_ring=16,
        segments_height=8,
        segments_cap=6,
    )

    # Create head sphere, positioned at top of torso with overlap for blending
    head_y = TORSO_HEIGHT / 2 + HEAD_RADIUS * HEAD_BLEND_FACTOR
    head = create_sphere("BeanHead", radius=HEAD_RADIUS, segments=16, rings=12)
    head.location.y = head_y

    # Select both and join
    bpy.ops.object.select_all(action="DESELECT")
    torso.select_set(True)
    head.select_set(True)
    bpy.context.view_layer.objects.active = torso
    bpy.ops.object.join()

    # Remove internal faces by doing a merge by distance
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=0.02)
    # Smooth out the join area
    bpy.ops.mesh.faces_shade_smooth()
    bpy.ops.object.mode_set(mode="OBJECT")

    torso.name = "BeanBody"
    return torso


def create_limb(name, radius, half_length):
    """Create a limb (arm or leg segment) as a capsule."""
    limb = create_capsule(
        name,
        radius=radius,
        half_length=half_length,
        segments_ring=10,
        segments_height=4,
        segments_cap=4,
    )
    return limb


def create_bean_mesh():
    """
    Create the full bean character mesh by creating torso, arms, and legs,
    positioning them in T-pose, and joining into a single mesh.
    """
    # Create torso+head
    body = create_bean_torso()

    parts = [body]

    # ── Arms (T-pose: arms extend horizontally) ──
    for side, sign in [("L", -1), ("R", 1)]:
        # Upper arm
        upper = create_limb(f"UpperArm_{side}", UPPER_ARM_RADIUS, UPPER_ARM_LENGTH / 2)
        # In T-pose, arms extend along X axis, so rotate capsule 90 deg around Z
        upper.rotation_euler = (0, 0, sign * math.pi / 2)
        # Position at shoulder
        upper_x = sign * (SHOULDER_X + UPPER_ARM_LENGTH / 2)
        upper.location = (upper_x, SHOULDER_Y, 0)
        parts.append(upper)

        # Forearm
        forearm = create_limb(f"ForeArm_{side}", FOREARM_RADIUS, FOREARM_LENGTH / 2)
        forearm.rotation_euler = (0, 0, sign * math.pi / 2)
        forearm_x = sign * (SHOULDER_X + UPPER_ARM_LENGTH + FOREARM_LENGTH / 2 + 0.02)
        forearm.location = (forearm_x, SHOULDER_Y, 0)
        parts.append(forearm)

    # ── Legs (T-pose: legs extend downward) ──
    for side, sign in [("L", -1), ("R", 1)]:
        # Thigh
        thigh = create_limb(f"Thigh_{side}", THIGH_RADIUS, THIGH_LENGTH / 2)
        thigh_x = sign * HIP_X
        thigh_y = HIP_Y - THIGH_LENGTH / 2
        thigh.location = (thigh_x, thigh_y, 0)
        parts.append(thigh)

        # Shin
        shin = create_limb(f"Shin_{side}", SHIN_RADIUS, SHIN_LENGTH / 2)
        shin_x = sign * HIP_X
        shin_y = HIP_Y - THIGH_LENGTH - SHIN_LENGTH / 2 - 0.02
        shin.location = (shin_x, shin_y, 0)
        parts.append(shin)

    # Apply all transforms before joining
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # Join all parts into one mesh
    bpy.ops.object.join()
    body.name = "BeanCharacter"

    # Remove internal geometry from overlapping joins
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=0.015)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")

    return body


def create_armature():
    """
    Create the bean character armature with the required bone hierarchy.

    Bone hierarchy:
        torso (root, center of body)
          +-- head (top of torso)
          +-- l_upperArm -- l_foreArm
          +-- r_upperArm -- r_foreArm
          +-- l_thigh -- l_shin
          +-- r_thigh -- r_shin
    """
    # Create armature
    armature_data = bpy.data.armatures.new("BeanArmature")
    armature_obj = bpy.data.objects.new("BeanArmature", armature_data)
    bpy.context.collection.objects.link(armature_obj)

    bpy.context.view_layer.objects.active = armature_obj
    bpy.ops.object.mode_set(mode="EDIT")

    # ── Root bone: torso ──
    torso = armature_data.edit_bones.new("torso")
    torso.head = (0, 0, 0)                        # center of body
    torso.tail = (0, TORSO_HEIGHT * 0.5, 0)       # top of torso
    torso.use_connect = False

    # ── Head bone ──
    head = armature_data.edit_bones.new("head")
    head_base_y = TORSO_HEIGHT * 0.5
    head.head = (0, head_base_y, 0)
    head.tail = (0, head_base_y + HEAD_RADIUS * 2, 0)
    head.parent = torso
    head.use_connect = True

    # ── Left arm chain ──
    l_upper = armature_data.edit_bones.new("l_upperArm")
    l_upper.head = (-SHOULDER_X, SHOULDER_Y, 0)
    l_upper.tail = (-(SHOULDER_X + UPPER_ARM_LENGTH), SHOULDER_Y, 0)
    l_upper.parent = torso
    l_upper.use_connect = False

    l_fore = armature_data.edit_bones.new("l_foreArm")
    l_fore.head = l_upper.tail.copy()
    l_fore.tail = (-(SHOULDER_X + UPPER_ARM_LENGTH + FOREARM_LENGTH), SHOULDER_Y, 0)
    l_fore.parent = l_upper
    l_fore.use_connect = True

    # ── Right arm chain ──
    r_upper = armature_data.edit_bones.new("r_upperArm")
    r_upper.head = (SHOULDER_X, SHOULDER_Y, 0)
    r_upper.tail = (SHOULDER_X + UPPER_ARM_LENGTH, SHOULDER_Y, 0)
    r_upper.parent = torso
    r_upper.use_connect = False

    r_fore = armature_data.edit_bones.new("r_foreArm")
    r_fore.head = r_upper.tail.copy()
    r_fore.tail = (SHOULDER_X + UPPER_ARM_LENGTH + FOREARM_LENGTH, SHOULDER_Y, 0)
    r_fore.parent = r_upper
    r_fore.use_connect = True

    # ── Left leg chain ──
    l_thigh = armature_data.edit_bones.new("l_thigh")
    l_thigh.head = (-HIP_X, HIP_Y, 0)
    l_thigh.tail = (-HIP_X, HIP_Y - THIGH_LENGTH, 0)
    l_thigh.parent = torso
    l_thigh.use_connect = False

    l_shin = armature_data.edit_bones.new("l_shin")
    l_shin.head = l_thigh.tail.copy()
    l_shin.tail = (-HIP_X, HIP_Y - THIGH_LENGTH - SHIN_LENGTH, 0)
    l_shin.parent = l_thigh
    l_shin.use_connect = True

    # ── Right leg chain ──
    r_thigh = armature_data.edit_bones.new("r_thigh")
    r_thigh.head = (HIP_X, HIP_Y, 0)
    r_thigh.tail = (HIP_X, HIP_Y - THIGH_LENGTH, 0)
    r_thigh.parent = torso
    r_thigh.use_connect = False

    r_shin = armature_data.edit_bones.new("r_shin")
    r_shin.head = r_thigh.tail.copy()
    r_shin.tail = (HIP_X, HIP_Y - THIGH_LENGTH - SHIN_LENGTH, 0)
    r_shin.parent = r_thigh
    r_shin.use_connect = True

    bpy.ops.object.mode_set(mode="OBJECT")
    return armature_obj


def parent_mesh_to_armature(mesh_obj, armature_obj):
    """
    Parent the mesh to the armature using automatic weights.
    This assigns vertex groups based on bone proximity.
    """
    bpy.ops.object.select_all(action="DESELECT")
    mesh_obj.select_set(True)
    armature_obj.select_set(True)
    bpy.context.view_layer.objects.active = armature_obj

    bpy.ops.object.parent_set(type="ARMATURE_AUTO")


def add_subdivision_and_smooth(mesh_obj):
    """Add subdivision surface modifier and enable smooth shading."""
    # Add subdivision modifier
    subsurf = mesh_obj.modifiers.new("Subdivision", "SUBSURF")
    subsurf.levels = 1           # viewport
    subsurf.render_levels = SUBDIV_LEVEL  # render / export

    # Apply smooth shading
    bpy.context.view_layer.objects.active = mesh_obj
    bpy.ops.object.shade_smooth()


def add_material(mesh_obj):
    """Add a simple neutral material to the bean (tinted in-game by player color)."""
    mat = bpy.data.materials.new("BeanMaterial")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        # Neutral light gray -- the game will tint per-player
        bsdf.inputs["Base Color"].default_value = (0.85, 0.85, 0.85, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.7
        bsdf.inputs["Metallic"].default_value = 0.0
    mesh_obj.data.materials.append(mat)


def export_glb(armature_obj, mesh_obj, output_path):
    """Export the armature and mesh as a GLB file."""
    # Select only the armature and mesh for export
    bpy.ops.object.select_all(action="DESELECT")
    armature_obj.select_set(True)
    mesh_obj.select_set(True)
    bpy.context.view_layer.objects.active = armature_obj

    # Ensure output directory exists
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    # Export as GLB
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,         # apply modifiers (subdivision)
        export_animations=False,   # T-pose only, no animations
        export_skins=True,         # include skinning/weights
        export_normals=True,
        export_materials="EXPORT",
        export_colors=False,
        export_yup=True,           # Y-up for Three.js
    )

    print(f"Exported bean character to: {output_path}")


def print_mesh_stats(mesh_obj):
    """Print vertex/face counts for the mesh."""
    mesh = mesh_obj.data
    print(f"Bean character mesh stats:")
    print(f"  Vertices: {len(mesh.vertices)}")
    print(f"  Faces:    {len(mesh.polygons)}")
    print(f"  Edges:    {len(mesh.edges)}")

    # Check vertex groups
    print(f"  Vertex groups: {len(mesh_obj.vertex_groups)}")
    for vg in mesh_obj.vertex_groups:
        print(f"    - {vg.name}")


def main():
    print("=" * 60)
    print("Bean Character Generator for Ruckus Royale")
    print("=" * 60)

    # Determine output path
    # If run from project root, use relative path; otherwise try to find it
    if os.path.isdir("apps/client/public"):
        output_path = os.path.abspath(OUTPUT_PATH)
    else:
        # Try to find project root by looking for package.json
        script_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(script_dir)
        output_path = os.path.join(project_root, OUTPUT_PATH)

    print(f"Output path: {output_path}")

    # Step 1: Clear the scene
    print("\n[1/7] Clearing scene...")
    clear_scene()

    # Step 2: Create the bean mesh
    print("[2/7] Creating bean mesh...")
    bean_mesh = create_bean_mesh()

    # Step 3: Print mesh stats (before subdivision)
    print("[3/7] Mesh stats (pre-subdivision):")
    print_mesh_stats(bean_mesh)

    # Step 4: Create the armature
    print("[4/7] Creating armature...")
    armature = create_armature()

    # Step 5: Parent mesh to armature with auto weights
    print("[5/7] Parenting mesh to armature (auto weights)...")
    parent_mesh_to_armature(bean_mesh, armature)

    # Step 6: Add subdivision and smooth shading
    print("[6/7] Adding subdivision and smooth shading...")
    add_subdivision_and_smooth(bean_mesh)

    # Add a neutral material
    add_material(bean_mesh)

    # Step 7: Export as GLB
    print("[7/7] Exporting GLB...")
    export_glb(armature, bean_mesh, output_path)

    # Final stats
    print("\nDone! Bean character exported successfully.")
    print(f"  File: {output_path}")


if __name__ == "__main__":
    main()
