export interface Vector2D {
    x: number;
    y: number;
}

export function dist(a: Vector2D, b: Vector2D): number {
    return Math.hypot(b.x - a.x, b.y - a.y);
}

export function add(a: Vector2D, b: Vector2D): Vector2D {
    return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vector2D, b: Vector2D): Vector2D {
    return { x: a.x - b.x, y: a.y - b.y };
}

export function mult(v: Vector2D, scalar: number): Vector2D {
    return { x: v.x * scalar, y: v.y * scalar };
}

export function div(v: Vector2D, scalar: number): Vector2D {
    return { x: v.x / scalar, y: v.y / scalar };
}

export function dot(a: Vector2D, b: Vector2D): number {
    return a.x * b.x + a.y * b.y;
}

export function cross(a: Vector2D, b: Vector2D): number {
    return a.x * b.y - a.y * b.x;
}

export function mag(v: Vector2D): number {
    return Math.hypot(v.x, v.y);
}

export function normalize(v: Vector2D): Vector2D {
    const m = mag(v);
    if (m === 0) return { x: 0, y: 0 };
    return { x: v.x / m, y: v.y / m };
}

export function project(v: Vector2D, onto: Vector2D): Vector2D {
    const ontoNorm = normalize(onto);
    const scalar = dot(v, ontoNorm);
    return mult(ontoNorm, scalar);
}
