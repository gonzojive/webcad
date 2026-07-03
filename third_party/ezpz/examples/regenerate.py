#!/usr/bin/env python3
import os
import re
import subprocess
import sys
from PIL import Image, ImageDraw

# Root directory of the examples package
EXAMPLES_DIR = os.path.dirname(os.path.abspath(__file__))
IMAGES_DIR = os.path.join(EXAMPLES_DIR, "images")
os.makedirs(IMAGES_DIR, exist_ok=True)

# Find Bazel workspace root
WORKSPACE_ROOT = os.path.abspath(os.path.join(EXAMPLES_DIR, "../../.."))

# Colors (Sleek dark theme / modern CAD style)
BG_COLOR = (30, 34, 42)
GRID_COLOR = (45, 52, 64)
TEXT_COLOR = (220, 224, 232)
POINT_COLOR = (88, 166, 255)
LINE_COLOR = (255, 166, 0)
CIRCLE_COLOR = (188, 80, 144)

class CoordMapper:
    def __init__(self, min_x, max_x, min_y, max_y, width=800, height=800, margin=80):
        self.width = width
        self.height = height
        self.margin = margin
        
        span_x = max_x - min_x
        span_y = max_y - min_y
        span = max(span_x, span_y) if max(span_x, span_y) > 0 else 1.0
        
        self.center_x = min_x + span_x / 2.0
        self.center_y = min_y + span_y / 2.0
        self.scale = (width - 2 * margin) / span

    def map(self, x, y):
        px = int(self.width / 2.0 + (x - self.center_x) * self.scale)
        py = int(self.height / 2.0 - (y - self.center_y) * self.scale)
        return px, py

    def scale_dist(self, dist):
        return int(dist * self.scale)

def draw_grid(draw, mapper):
    step = 5
    for val in range(-50, 100, step):
        p1 = mapper.map(val, -100)
        p2 = mapper.map(val, 100)
        draw.line([p1, p2], fill=GRID_COLOR, width=1)
        p3 = mapper.map(-100, val)
        p4 = mapper.map(100, val)
        draw.line([p3, p4], fill=GRID_COLOR, width=1)
    
    p_origin_x1 = mapper.map(0, -100)
    p_origin_x2 = mapper.map(0, 100)
    draw.line([p_origin_x1, p_origin_x2], fill=(80, 90, 105), width=2)
    p_origin_y1 = mapper.map(-100, 0)
    p_origin_y2 = mapper.map(100, 0)
    draw.line([p_origin_y1, p_origin_y2], fill=(80, 90, 105), width=2)

def draw_points(draw, mapper, points):
    for label, (x, y) in points.items():
        px, py = mapper.map(x, y)
        r = 6
        draw.ellipse([px-r, py-r, px+r, py+r], fill=POINT_COLOR, outline=BG_COLOR, width=1)
        draw.text((px+10, py-10), label, fill=TEXT_COLOR)

def draw_concentric(filename, title, circles):
    img = Image.new("RGB", (800, 800), BG_COLOR)
    draw = ImageDraw.Draw(img)
    mapper = CoordMapper(-6, 6, -6, 6)
    draw_grid(draw, mapper)
    
    for circle_name, (cx, cy, radius) in circles.items():
        px, py = mapper.map(cx, cy)
        pr = mapper.scale_dist(radius)
        draw.ellipse([px-pr, py-pr, px+pr, py+pr], outline=CIRCLE_COLOR, width=3)
        cr = 4
        draw.ellipse([px-cr, py-cr, px+cr, py+cr], fill=POINT_COLOR)
        draw.text((px+10, py+10), f"{circle_name}.center", fill=TEXT_COLOR)
        draw.text((px + pr - 35, py - 20), f"R={radius:.1f}", fill=CIRCLE_COLOR)

    draw.text((30, 30), title, fill=TEXT_COLOR)
    img.save(os.path.join(IMAGES_DIR, filename))

def draw_stair_stringer(filename, title, points):
    img = Image.new("RGB", (800, 800), BG_COLOR)
    draw = ImageDraw.Draw(img)
    mapper = CoordMapper(-8, 48, -8, 38)
    draw_grid(draw, mapper)
    
    outline_labels = ["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "b1", "b0"]
    poly_points = [mapper.map(points[lbl][0], points[lbl][1]) for lbl in outline_labels]
    
    for i in range(len(poly_points)):
        p1 = poly_points[i]
        p2 = poly_points[(i+1) % len(poly_points)]
        draw.line([p1, p2], fill=LINE_COLOR, width=4)
        
    draw_points(draw, mapper, points)
    draw.text((30, 30), title, fill=TEXT_COLOR)
    img.save(os.path.join(IMAGES_DIR, filename))

def parse_guesses(filepath):
    with open(filepath, "r") as f:
        content = f.read()
    
    guesses_section = content.split("# guesses")[-1]
    
    points = {}
    scalars = {}
    
    # Matches: p1 roughly (0.5, 4.5)
    point_re = re.compile(r"(\w+(?:\.\w+)*)\s+roughly\s+\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)")
    # Matches: a.radius roughly 3.5
    scalar_re = re.compile(r"(\w+(?:\.\w+)*)\s+roughly\s+([-\d.]+)")
    
    for line in guesses_section.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if m := point_re.match(line):
            lbl, x, y = m.group(1), float(m.group(2)), float(m.group(3))
            points[lbl] = (x, y)
        elif m := scalar_re.match(line):
            lbl, val = m.group(1), float(m.group(2))
            scalars[lbl] = val
            
    return points, scalars

def run_solver(filepath):
    print(f"Solving {os.path.basename(filepath)} using Bazel...")
    
    # Run target via Bazel from workspace root
    res = subprocess.run(
        ["bazel", "run", "@ezpz//ezpz-cli:ezpz-cli", "--", "--filepath", filepath, "--show-points"],
        cwd=WORKSPACE_ROOT,
        capture_output=True,
        text=True
    )
    
    if res.returncode != 0:
        print("Solver failed!", file=sys.stderr)
        print(res.stderr, file=sys.stderr)
        sys.exit(1)
        
    stdout = res.stdout
    points = {}
    circles = {}
    
    # Parse points
    point_re = re.compile(r"^\s*(\w+):\s+\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)")
    # Parse circles
    circle_re = re.compile(r"^\s*(\w+):\s+center\s+=\s+\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\),\s+radius\s+=\s+([-\d.]+)")
    
    in_points = False
    in_circles = False
    
    for line in stdout.splitlines():
        if "Points:" in line:
            in_points = True
            in_circles = False
            continue
        elif "Circles:" in line:
            in_points = False
            in_circles = True
            continue
        elif "Arcs:" in line:
            in_points = False
            in_circles = False
            
        if in_points:
            if m := point_re.match(line):
                lbl, x, y = m.group(1), float(m.group(2)), float(m.group(3))
                points[lbl] = (x, y)
        elif in_circles:
            if m := circle_re.match(line):
                lbl, cx, cy, rad = m.group(1), float(m.group(2)), float(m.group(3)), float(m.group(4))
                circles[lbl] = (cx, cy, rad)
                
    return points, circles

def main():
    # --- Example 1: Concentric Circles ---
    concentric_path = os.path.join(EXAMPLES_DIR, "concentric.ezpz")
    guess_pts, guess_scales = parse_guesses(concentric_path)
    
    circles_before = {
        "a": (guess_pts["a.center"][0], guess_pts["a.center"][1], guess_scales["a.radius"]),
        "b": (guess_pts["b.center"][0], guess_pts["b.center"][1], guess_scales["b.radius"]),
    }
    
    solved_pts, solved_circs = run_solver(concentric_path)
    circles_after = {
        "a": (solved_circs["a"][0], solved_circs["a"][1], solved_circs["a"][2]),
        "b": (solved_circs["b"][0], solved_circs["b"][1], solved_circs["b"][2]),
    }
    
    draw_concentric("concentric_before.png", "Concentric Circles (Guesses)", circles_before)
    draw_concentric("concentric_after.png", "Concentric Circles (Solved)", circles_after)

    # --- Example 2: Stair Stringer ---
    stair_path = os.path.join(EXAMPLES_DIR, "stair_stringer.ezpz")
    stair_guesses, _ = parse_guesses(stair_path)
    stair_solved, _ = run_solver(stair_path)
    
    draw_stair_stringer("stair_before.png", "Stair Stringer (Guesses)", stair_guesses)
    draw_stair_stringer("stair_after.png", "Stair Stringer (Solved)", stair_solved)
    
    print("All visualizations regenerated successfully under examples/images/!")

if __name__ == "__main__":
    main()
