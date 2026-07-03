#[cfg(test)]
mod tests {
    use crate::{solve_gcs, GCSSolvedOutput};

    #[test]
    fn test_coincident_points() {
        let input_json = r#"{
            "points": [
                { "id": "p0", "x": 0.0, "y": 0.0, "fixed": true },
                { "id": "p1", "x": 2.0, "y": 2.0, "fixed": false }
            ],
            "lines": [],
            "circles": [],
            "constraints": [
                { "id": "c0", "type": "coincident", "entityIds": ["p0", "p1"] }
            ]
        }"#;

        let output_json = solve_gcs(input_json);
        let output: GCSSolvedOutput = serde_json::from_str(&output_json).unwrap();

        assert!(output.success);
        assert!(output.error.is_none());

        let p0 = &output.points[0];
        let p1 = &output.points[1];

        assert_eq!(p0.id, "p0");
        assert!((p0.x - 0.0).abs() < 1e-5);
        assert!((p0.y - 0.0).abs() < 1e-5);

        assert_eq!(p1.id, "p1");
        // p1 should solve to match p0 (coincident)
        assert!((p1.x - 0.0).abs() < 1e-5);
        assert!((p1.y - 0.0).abs() < 1e-5);
    }
}
