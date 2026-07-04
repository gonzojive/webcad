import { Vector2D, dot, sub, add, mult, dist } from './vector.js';

export function projectPointOntoLine(p: Vector2D, a: Vector2D, b: Vector2D): Vector2D {
    const ab = sub(b, a);
    const ap = sub(p, a);
    const abLenSq = dot(ab, ab);
    if (abLenSq === 0) return a;
    const t = dot(ap, ab) / abLenSq;
    return add(a, mult(ab, t));
}

export function projectPointOntoSegment(p: Vector2D, a: Vector2D, b: Vector2D): Vector2D {
    const ab = sub(b, a);
    const ap = sub(p, a);
    const abLenSq = dot(ab, ab);
    if (abLenSq === 0) return a;
    let t = dot(ap, ab) / abLenSq;
    t = Math.max(0, Math.min(1, t));
    return add(a, mult(ab, t));
}

export function distanceToLine(p: Vector2D, a: Vector2D, b: Vector2D): number {
    const proj = projectPointOntoLine(p, a, b);
    return dist(p, proj);
}

export function distanceToSegment(p: Vector2D, a: Vector2D, b: Vector2D): number {
    const proj = projectPointOntoSegment(p, a, b);
    return dist(p, proj);
}
