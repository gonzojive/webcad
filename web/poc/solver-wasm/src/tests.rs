#[cfg(test)]
mod tests {
    use crate::{solve_gcs, GCSSolvedOutput};

    /// Helper to parse solver output from a JSON input string.
    fn run_solver(input_json: &str) -> GCSSolvedOutput {
        let output_json = solve_gcs(input_json);
        serde_json::from_str(&output_json).unwrap()
    }

    /// Helper to find a point by ID in the solver output.
    fn find_point(output: &GCSSolvedOutput, id: &str) -> (f64, f64) {
        let p = output
            .points
            .iter()
            .find(|p| p.id == id)
            .unwrap_or_else(|| panic!("Point {} not found in output", id));
        (p.x, p.y)
    }

    #[test]
    fn test_coincident_points() {
        let output = run_solver(
            r#"{
            "points": [
                { "id": "p0", "x": 0.0, "y": 0.0, "fixed": true },
                { "id": "p1", "x": 2.0, "y": 2.0, "fixed": false }
            ],
            "lines": [],
            "circles": [],
            "constraints": [
                { "id": "c0", "type": "coincident", "entityIds": ["p0", "p1"] }
            ]
        }"#,
        );

        assert!(output.success);
        assert!(output.error.is_none());

        let (p0x, p0y) = find_point(&output, "p0");
        let (p1x, p1y) = find_point(&output, "p1");

        assert!((p0x - 0.0).abs() < 1e-5, "p0.x should stay fixed at 0.0");
        assert!((p0y - 0.0).abs() < 1e-5, "p0.y should stay fixed at 0.0");
        assert!(
            (p1x - 0.0).abs() < 1e-5,
            "p1 should solve to coincident with p0"
        );
        assert!(
            (p1y - 0.0).abs() < 1e-5,
            "p1 should solve to coincident with p0"
        );
    }

    /// Simulates a drag operation: the user drags p1 to a new position (200, 150)
    /// and the solver should keep p1 fixed at (200, 150) because it is marked fixed.
    /// This is the core mechanism that enables interactive dragging in the UI.
    #[test]
    fn test_drag_fixed_point_stays_at_dragged_position() {
        let output = run_solver(
            r#"{
            "points": [
                { "id": "p0", "x": 100.0, "y": 100.0, "fixed": false },
                { "id": "p1", "x": 200.0, "y": 150.0, "fixed": true }
            ],
            "lines": [],
            "circles": [],
            "constraints": []
        }"#,
        );

        assert!(output.success, "Solver should succeed with no constraints");

        let (p0x, p0y) = find_point(&output, "p0");
        let (p1x, p1y) = find_point(&output, "p1");

        // p0 is free, should stay near its initial guess
        assert!(
            (p0x - 100.0).abs() < 1e-3,
            "Free point p0.x should stay near 100.0, got {}",
            p0x
        );
        assert!(
            (p0y - 100.0).abs() < 1e-3,
            "Free point p0.y should stay near 100.0, got {}",
            p0y
        );

        // p1 is fixed at the "dragged" position, solver must preserve it exactly
        assert!(
            (p1x - 200.0).abs() < 1e-5,
            "Fixed (dragged) p1.x must be 200.0, got {}",
            p1x
        );
        assert!(
            (p1y - 150.0).abs() < 1e-5,
            "Fixed (dragged) p1.y must be 150.0, got {}",
            p1y
        );
    }

    /// Simulates dragging p1 while a distance constraint exists between p0 and p1.
    /// p1 is fixed (simulating drag hold) and p0 is free. The solver should move p0
    /// to satisfy the distance constraint relative to p1's dragged position.
    #[test]
    fn test_drag_with_distance_constraint_moves_connected_point() {
        let output = run_solver(
            r#"{
            "points": [
                { "id": "p0", "x": 0.0, "y": 0.0, "fixed": false },
                { "id": "p1", "x": 100.0, "y": 0.0, "fixed": true }
            ],
            "lines": [],
            "circles": [],
            "constraints": [
                { "id": "c0", "type": "distance", "entityIds": ["p0", "p1"], "value": 50.0 }
            ]
        }"#,
        );

        assert!(output.success, "Solver should succeed with distance constraint");

        let (p0x, p0y) = find_point(&output, "p0");
        let (p1x, p1y) = find_point(&output, "p1");

        // p1 is fixed, must stay at (100, 0)
        assert!(
            (p1x - 100.0).abs() < 1e-5,
            "Fixed p1.x must be 100.0, got {}",
            p1x
        );
        assert!(
            (p1y - 0.0).abs() < 1e-5,
            "Fixed p1.y must be 0.0, got {}",
            p1y
        );

        // p0 is free but constrained to be exactly 50.0 units from p1
        let actual_dist = ((p0x - p1x).powi(2) + (p0y - p1y).powi(2)).sqrt();
        assert!(
            (actual_dist - 50.0).abs() < 1e-3,
            "Distance from p0 to p1 should be 50.0, got {}",
            actual_dist
        );
    }

    /// Simulates dragging p0 (fixed) to a new position while p0 and p1 are connected
    /// by a line with a horizontal constraint. p1 should adjust its y-coordinate to
    /// match p0's new position while keeping its x-coordinate free.
    #[test]
    fn test_drag_with_horizontal_line_constraint() {
        let output = run_solver(
            r#"{
            "points": [
                { "id": "p0", "x": 50.0, "y": 200.0, "fixed": true },
                { "id": "p1", "x": 300.0, "y": 100.0, "fixed": false }
            ],
            "lines": [
                { "id": "L0", "p1Id": "p0", "p2Id": "p1" }
            ],
            "circles": [],
            "constraints": [
                { "id": "c0", "type": "horizontal", "entityIds": ["L0"] }
            ]
        }"#,
        );

        assert!(
            output.success,
            "Solver should succeed with horizontal constraint"
        );

        let (_p0x, p0y) = find_point(&output, "p0");
        let (_p1x, p1y) = find_point(&output, "p1");

        // Horizontal constraint means both points share the same y-coordinate
        assert!(
            (p0y - p1y).abs() < 1e-3,
            "Horizontal line constraint: p0.y ({}) and p1.y ({}) should match",
            p0y,
            p1y
        );
    }

    /// Verifies that a completely unconstrained free point stays near its initial
    /// guess. This is the simplest "drag" scenario: place a point, no constraints,
    /// solver should not move it.
    #[test]
    fn test_free_point_stays_at_initial_position() {
        let output = run_solver(
            r#"{
            "points": [
                { "id": "p0", "x": 42.5, "y": 73.2, "fixed": false }
            ],
            "lines": [],
            "circles": [],
            "constraints": []
        }"#,
        );

        assert!(output.success);

        let (px, py) = find_point(&output, "p0");
        assert!(
            (px - 42.5).abs() < 1e-3,
            "Free point should stay near initial x=42.5, got {}",
            px
        );
        assert!(
            (py - 73.2).abs() < 1e-3,
            "Free point should stay near initial y=73.2, got {}",
            py
        );
    }
}
