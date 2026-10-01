/* A tiny string-based SVG builder. The engine produces SVG text directly (no DOM), so it
 * runs identically in a browser, in Node for server-side rendering, and in tests. */

import { f } from './path.ts'

export type AttrValue = string | number | boolean | null | undefined
export type Attrs = Record<string, AttrValue>
export type Child = string | false | null | undefined | 0

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] as string)
}

function attrs(a: Attrs | null | undefined): string {
  if (!a) return ''
  let out = ''
  for (const k in a) {
    const v = a[k]
    if (v === undefined || v === null || v === false) continue
    if (v === true) out += ` ${k}`
    else out += ` ${k}="${typeof v === 'number' ? f(v) : escapeXml(v)}"`
  }
  return out
}

export function el(tag: string, a: Attrs | null, ...children: Child[]): string {
  const body = children.filter((c) => typeof c === 'string' && c.length > 0).join('')
  return body ? `<${tag}${attrs(a)}>${body}</${tag}>` : `<${tag}${attrs(a)}/>`
}

export const g = (a: Attrs | null, ...children: Child[]): string => {
  const body = children.filter((c) => typeof c === 'string' && c.length > 0).join('')
  if (!body) return ''
  return a && Object.keys(a).some((k) => a[k] !== undefined && a[k] !== null && a[k] !== false)
    ? `<g${attrs(a)}>${body}</g>`
    : body
}

export const path = (d: string, a: Attrs = {}): string => (d ? el('path', { d, ...a }) : '')

export const matrixAttr = (m: readonly number[]): string =>
  `matrix(${m.map((v) => f(Math.abs(v) < 1e-9 ? 0 : v)).join(' ')})`

/**
 * Per-document registry for gradients, clip paths and patterns. Ids are prefixed so
 * several avatars can be inlined in one HTML page without their defs colliding, and
 * keyed so a gradient used by twenty shapes is emitted once.
 */
export class Defs {
  readonly prefix: string
  private readonly items = new Map<string, string>()
  private counter = 0

  constructor(prefix: string) {
    this.prefix = prefix
  }

  /** Registers (once) a def under `key`; `build` receives the final id. Returns the id. */
  add(key: string, build: (id: string) => string): string {
    const id = `${this.prefix}-${key.replace(/[^a-zA-Z0-9_-]/g, '')}`
    if (!this.items.has(id)) this.items.set(id, build(id))
    return id
  }

  /** A fresh unique id for one-off defs (clip paths of a specific shape). */
  unique(label: string): string {
    this.counter += 1
    return `${this.prefix}-${label}${this.counter}`
  }

  put(id: string, content: string): void {
    this.items.set(id, content)
  }

  get size(): number {
    return this.items.size
  }

  /** Copies every def into `other` (a companion drawn inside its owner's document). */
  copyTo(other: Defs): void {
    for (const [id, content] of this.items) other.put(id, content)
  }

  toString(): string {
    return this.items.size ? `<defs>${[...this.items.values()].join('')}</defs>` : ''
  }
}

export const url = (id: string): string => `url(#${id})`
