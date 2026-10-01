/* Bones. Every part of an avatar is drawn in the local space of one bone, so posing and
 * animating is only ever a matter of bone transforms — the same data drives the static
 * render, the animated SVG, the sprite sheets and the Unity rig export.
 *
 * Convention: at rest every bone's axes are aligned with the world (rotation 0) and a
 * limb's geometry hangs along its local +y. Pose rotations are degrees, positive =
 * clockwise on screen (SVG). */

import { mul, rotateM, scaleM, translateM, IDENTITY, type Mat } from '../core/math.ts'

export interface Bone {
  name: string
  parent: string | null
  /** Offset from the parent's origin, in the parent's local space. */
  x: number
  y: number
  /** Rest rotation, degrees. */
  rot: number
  /** Length along local +y (informational: exports, IK, debugging). */
  len: number
}

export interface BonePose {
  rot?: number
  x?: number
  y?: number
  sx?: number
  sy?: number
}

export type Pose = Record<string, BonePose>

/** A point on a bone, in that bone's local space: where accessories attach. */
export interface Anchor {
  bone: string
  x: number
  y: number
}

export class Skeleton {
  readonly bones: Bone[] = []
  private readonly map = new Map<string, Bone>()
  readonly anchors: Record<string, Anchor> = {}

  add(name: string, parent: string | null, x: number, y: number, len = 0, rot = 0): this {
    if (parent && !this.map.has(parent)) throw new Error(`Bone "${name}" has unknown parent "${parent}"`)
    const b: Bone = { name, parent, x, y, rot, len }
    this.bones.push(b)
    this.map.set(name, b)
    return this
  }

  anchor(name: string, bone: string, x: number, y: number): this {
    this.anchors[name] = { bone, x, y }
    return this
  }

  has(name: string): boolean {
    return this.map.has(name)
  }

  get(name: string): Bone | undefined {
    return this.map.get(name)
  }

  /** World matrix of every bone for a pose. */
  world(pose: Pose = {}, root: Mat = IDENTITY): Map<string, Mat> {
    const out = new Map<string, Mat>()
    out.set('world', root)
    for (const b of this.bones) {
      const p = pose[b.name]
      const parentM = b.parent ? (out.get(b.parent) as Mat) : root
      let m = mul(parentM, translateM(b.x + (p?.x ?? 0), b.y + (p?.y ?? 0)))
      const r = b.rot + (p?.rot ?? 0)
      if (r) m = mul(m, rotateM(r))
      if (p && (p.sx !== undefined || p.sy !== undefined)) m = mul(m, scaleM(p.sx ?? 1, p.sy ?? 1))
      out.set(b.name, m)
    }
    return out
  }
}

/** Blends two poses (t = 0 → a, 1 → b). Missing channels read as rest. */
export function blendPose(a: Pose, b: Pose, t: number): Pose {
  const out: Pose = {}
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    const pa = a[k] ?? {}
    const pb = b[k] ?? {}
    out[k] = {
      rot: (pa.rot ?? 0) + ((pb.rot ?? 0) - (pa.rot ?? 0)) * t,
      x: (pa.x ?? 0) + ((pb.x ?? 0) - (pa.x ?? 0)) * t,
      y: (pa.y ?? 0) + ((pb.y ?? 0) - (pa.y ?? 0)) * t,
      sx: (pa.sx ?? 1) + ((pb.sx ?? 1) - (pa.sx ?? 1)) * t,
      sy: (pa.sy ?? 1) + ((pb.sy ?? 1) - (pa.sy ?? 1)) * t,
    }
  }
  return out
}

/** Adds pose b on top of pose a (rotations and offsets add, scales multiply). */
export function addPose(a: Pose, b: Pose): Pose {
  const out: Pose = { ...a }
  for (const [k, pb] of Object.entries(b)) {
    const pa = a[k] ?? {}
    out[k] = {
      rot: (pa.rot ?? 0) + (pb.rot ?? 0),
      x: (pa.x ?? 0) + (pb.x ?? 0),
      y: (pa.y ?? 0) + (pb.y ?? 0),
      sx: (pa.sx ?? 1) * (pb.sx ?? 1),
      sy: (pa.sy ?? 1) * (pb.sy ?? 1),
    }
  }
  return out
}
