use ezpz::{
    solve, Config, Constraint, ConstraintRequest, Id,
    datatypes::{
        inputs::{DatumCircle, DatumDistance, DatumLineSegment, DatumPoint},
        AngleKind,
    },
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GCSRawPoint {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub fixed: Option<bool>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GCSRawLine {
    pub id: String,
    pub p1_id: String,
    pub p2_id: String,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GCSRawCircle {
    pub id: String,
    pub center_id: String,
    pub radius: f64,
    pub fixed_radius: Option<bool>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GCSRawConstraint {
    pub id: String,
    pub r#type: String,
    pub entity_ids: Vec<String>,
    pub value: Option<f64>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GCSSketchInput {
    pub points: Vec<GCSRawPoint>,
    pub lines: Vec<GCSRawLine>,
    pub circles: Vec<GCSRawCircle>,
    pub constraints: Vec<GCSRawConstraint>,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GCSSolvedPoint {
    pub id: String,
    pub x: f64,
    pub y: f64,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GCSSolvedCircle {
    pub id: String,
    pub center_id: String,
    pub radius: f64,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GCSSolvedOutput {
    pub success: bool,
    pub points: Vec<GCSSolvedPoint>,
    pub circles: Vec<GCSSolvedCircle>,
    pub error: Option<String>,
}

#[wasm_bindgen]
pub fn solve_gcs(input_json: &str) -> String {
    let input: GCSSketchInput = match serde_json::from_str(input_json) {
        Ok(data) => data,
        Err(e) => {
            return serde_json::to_string(&GCSSolvedOutput {
                success: false,
                points: vec![],
                circles: vec![],
                error: Some(format!("Invalid input JSON: {}", e)),
            })
            .unwrap();
        }
    };

    let n_points = input.points.len();
    let mut point_id_map: HashMap<String, usize> = HashMap::new();
    for (idx, point) in input.points.iter().enumerate() {
        point_id_map.insert(point.id.clone(), idx);
    }

    let mut line_id_map: HashMap<String, usize> = HashMap::new();
    for (idx, line) in input.lines.iter().enumerate() {
        line_id_map.insert(line.id.clone(), idx);
    }

    let mut circle_id_map: HashMap<String, usize> = HashMap::new();
    for (idx, circle) in input.circles.iter().enumerate() {
        circle_id_map.insert(circle.id.clone(), idx);
    }

    // Prepare initial guesses
    let mut initial_guesses: Vec<(Id, f64)> = Vec::new();
    for i in 0..n_points {
        let p = &input.points[i];
        initial_guesses.push((2 * i as Id, p.x));
        initial_guesses.push((2 * i as Id + 1, p.y));
    }
    for j in 0..input.circles.len() {
        let c = &input.circles[j];
        initial_guesses.push(((2 * n_points + j) as Id, c.radius));
    }

    // Build constraints
    let mut constraints: Vec<ConstraintRequest> = Vec::new();

    // 1. Fixed constraints from points/circles
    for i in 0..n_points {
        let p = &input.points[i];
        if p.fixed.unwrap_or(false) {
            constraints.push(ConstraintRequest::highest_priority(Constraint::Fixed(
                2 * i as Id,
                p.x,
            )));
            constraints.push(ConstraintRequest::highest_priority(Constraint::Fixed(
                2 * i as Id + 1,
                p.y,
            )));
        }
    }
    for j in 0..input.circles.len() {
        let c = &input.circles[j];
        if c.fixed_radius.unwrap_or(false) {
            constraints.push(ConstraintRequest::highest_priority(Constraint::Fixed(
                (2 * n_points + j) as Id,
                c.radius,
            )));
        }
    }

    // 2. User constraints
    for req in &input.constraints {
        match req.r#type.as_str() {
            "fixed" => {
                if let Some(&p_idx) = point_id_map.get(&req.entity_ids[0]) {
                    let p = &input.points[p_idx];
                    constraints.push(ConstraintRequest::highest_priority(Constraint::Fixed(
                        2 * p_idx as Id,
                        p.x,
                    )));
                    constraints.push(ConstraintRequest::highest_priority(Constraint::Fixed(
                        2 * p_idx as Id + 1,
                        p.y,
                    )));
                }
            }
            "coincident" => {
                if req.entity_ids.len() == 2 {
                    if let (Some(&idx1), Some(&idx2)) = (
                        point_id_map.get(&req.entity_ids[0]),
                        point_id_map.get(&req.entity_ids[1]),
                    ) {
                        let p0 = DatumPoint::new_xy(2 * idx1 as Id, 2 * idx1 as Id + 1);
                        let p1 = DatumPoint::new_xy(2 * idx2 as Id, 2 * idx2 as Id + 1);
                        constraints.push(ConstraintRequest::highest_priority(
                            Constraint::PointsCoincident(p0, p1),
                        ));
                    }
                }
            }
            "distance" => {
                if req.entity_ids.len() == 2 {
                    if let (Some(&idx1), Some(&idx2)) = (
                        point_id_map.get(&req.entity_ids[0]),
                        point_id_map.get(&req.entity_ids[1]),
                    ) {
                        let p0 = DatumPoint::new_xy(2 * idx1 as Id, 2 * idx1 as Id + 1);
                        let p1 = DatumPoint::new_xy(2 * idx2 as Id, 2 * idx2 as Id + 1);
                        let val = req.value.unwrap_or(0.0);
                        constraints.push(ConstraintRequest::highest_priority(
                            Constraint::Distance(p0, p1, val),
                        ));
                    }
                }
            }
            "horizontalDistance" => {
                if req.entity_ids.len() == 2 {
                    if let (Some(&idx1), Some(&idx2)) = (
                        point_id_map.get(&req.entity_ids[0]),
                        point_id_map.get(&req.entity_ids[1]),
                    ) {
                        let p0 = DatumPoint::new_xy(2 * idx1 as Id, 2 * idx1 as Id + 1);
                        let p1 = DatumPoint::new_xy(2 * idx2 as Id, 2 * idx2 as Id + 1);
                        let val = req.value.unwrap_or(0.0);
                        constraints.push(ConstraintRequest::highest_priority(
                            Constraint::HorizontalDistance(p0, p1, val),
                        ));
                    }
                }
            }
            "verticalDistance" => {
                if req.entity_ids.len() == 2 {
                    if let (Some(&idx1), Some(&idx2)) = (
                        point_id_map.get(&req.entity_ids[0]),
                        point_id_map.get(&req.entity_ids[1]),
                    ) {
                        let p0 = DatumPoint::new_xy(2 * idx1 as Id, 2 * idx1 as Id + 1);
                        let p1 = DatumPoint::new_xy(2 * idx2 as Id, 2 * idx2 as Id + 1);
                        let val = req.value.unwrap_or(0.0);
                        constraints.push(ConstraintRequest::highest_priority(
                            Constraint::VerticalDistance(p0, p1, val),
                        ));
                    }
                }
            }
            "pointLineDistance" => {
                if req.entity_ids.len() == 2 {
                    if let (Some(&p_idx), Some(&line_idx)) = (
                        point_id_map.get(&req.entity_ids[0]),
                        line_id_map.get(&req.entity_ids[1]),
                    ) {
                        let p = DatumPoint::new_xy(2 * p_idx as Id, 2 * p_idx as Id + 1);
                        let line = &input.lines[line_idx];
                        if let (Some(&lp1_idx), Some(&lp2_idx)) = (
                            point_id_map.get(&line.p1_id),
                            point_id_map.get(&line.p2_id),
                        ) {
                            let lp0 = DatumPoint::new_xy(2 * lp1_idx as Id, 2 * lp1_idx as Id + 1);
                            let lp1 = DatumPoint::new_xy(2 * lp2_idx as Id, 2 * lp2_idx as Id + 1);
                            let val = req.value.unwrap_or(0.0);
                            constraints.push(ConstraintRequest::highest_priority(
                                Constraint::PointLineDistance(p, DatumLineSegment::new(lp0, lp1), val),
                            ));
                        }
                    }
                }
            }
            "vertical" => {
                if req.entity_ids.len() == 1 {
                    if let Some(&line_idx) = line_id_map.get(&req.entity_ids[0]) {
                        let line = &input.lines[line_idx];
                        if let (Some(&idx1), Some(&idx2)) = (
                            point_id_map.get(&line.p1_id),
                            point_id_map.get(&line.p2_id),
                        ) {
                            let p0 = DatumPoint::new_xy(2 * idx1 as Id, 2 * idx1 as Id + 1);
                            let p1 = DatumPoint::new_xy(2 * idx2 as Id, 2 * idx2 as Id + 1);
                            constraints.push(ConstraintRequest::highest_priority(
                                Constraint::Vertical(DatumLineSegment::new(p0, p1)),
                            ));
                        }
                    }
                }
            }
            "horizontal" => {
                if req.entity_ids.len() == 1 {
                    if let Some(&line_idx) = line_id_map.get(&req.entity_ids[0]) {
                        let line = &input.lines[line_idx];
                        if let (Some(&idx1), Some(&idx2)) = (
                            point_id_map.get(&line.p1_id),
                            point_id_map.get(&line.p2_id),
                        ) {
                            let p0 = DatumPoint::new_xy(2 * idx1 as Id, 2 * idx1 as Id + 1);
                            let p1 = DatumPoint::new_xy(2 * idx2 as Id, 2 * idx2 as Id + 1);
                            constraints.push(ConstraintRequest::highest_priority(
                                Constraint::Horizontal(DatumLineSegment::new(p0, p1)),
                            ));
                        }
                    }
                }
            }
            "parallel" => {
                if req.entity_ids.len() == 2 {
                    if let (Some(&line1_idx), Some(&line2_idx)) = (
                        line_id_map.get(&req.entity_ids[0]),
                        line_id_map.get(&req.entity_ids[1]),
                    ) {
                        let line1 = &input.lines[line1_idx];
                        let line2 = &input.lines[line2_idx];
                        if let (Some(&l1_p1), Some(&l1_p2), Some(&l2_p1), Some(&l2_p2)) = (
                            point_id_map.get(&line1.p1_id),
                            point_id_map.get(&line1.p2_id),
                            point_id_map.get(&line2.p1_id),
                            point_id_map.get(&line2.p2_id),
                        ) {
                            let p0 = DatumPoint::new_xy(2 * l1_p1 as Id, 2 * l1_p1 as Id + 1);
                            let p1 = DatumPoint::new_xy(2 * l1_p2 as Id, 2 * l1_p2 as Id + 1);
                            let p2 = DatumPoint::new_xy(2 * l2_p1 as Id, 2 * l2_p1 as Id + 1);
                            let p3 = DatumPoint::new_xy(2 * l2_p2 as Id, 2 * l2_p2 as Id + 1);
                            constraints.push(ConstraintRequest::highest_priority(
                                Constraint::LinesAtAngle(
                                    DatumLineSegment::new(p0, p1),
                                    DatumLineSegment::new(p2, p3),
                                    AngleKind::Parallel,
                                ),
                            ));
                        }
                    }
                }
            }
            "perpendicular" => {
                if req.entity_ids.len() == 2 {
                    if let (Some(&line1_idx), Some(&line2_idx)) = (
                        line_id_map.get(&req.entity_ids[0]),
                        line_id_map.get(&req.entity_ids[1]),
                    ) {
                        let line1 = &input.lines[line1_idx];
                        let line2 = &input.lines[line2_idx];
                        if let (Some(&l1_p1), Some(&l1_p2), Some(&l2_p1), Some(&l2_p2)) = (
                            point_id_map.get(&line1.p1_id),
                            point_id_map.get(&line1.p2_id),
                            point_id_map.get(&line2.p1_id),
                            point_id_map.get(&line2.p2_id),
                        ) {
                            let p0 = DatumPoint::new_xy(2 * l1_p1 as Id, 2 * l1_p1 as Id + 1);
                            let p1 = DatumPoint::new_xy(2 * l1_p2 as Id, 2 * l1_p2 as Id + 1);
                            let p2 = DatumPoint::new_xy(2 * l2_p1 as Id, 2 * l2_p1 as Id + 1);
                            let p3 = DatumPoint::new_xy(2 * l2_p2 as Id, 2 * l2_p2 as Id + 1);
                            constraints.push(ConstraintRequest::highest_priority(
                                Constraint::LinesAtAngle(
                                    DatumLineSegment::new(p0, p1),
                                    DatumLineSegment::new(p2, p3),
                                    AngleKind::Perpendicular,
                                ),
                            ));
                        }
                    }
                }
            }
            _ => {}
        }
    }

    let config = Config::default();
    match solve(&constraints, initial_guesses, config) {
        Ok(outcome) => {
            let final_vals = outcome.final_values();
            let mut solved_points = Vec::new();
            for i in 0..n_points {
                let p = &input.points[i];
                let sol_x = *final_vals.get(2 * i).unwrap_or(&p.x);
                let sol_y = *final_vals.get(2 * i + 1).unwrap_or(&p.y);
                solved_points.push(GCSSolvedPoint {
                    id: p.id.clone(),
                    x: sol_x,
                    y: sol_y,
                });
            }

            let mut solved_circles = Vec::new();
            for j in 0..input.circles.len() {
                let c = &input.circles[j];
                let sol_rad = *final_vals.get(2 * n_points + j).unwrap_or(&c.radius);
                solved_circles.push(GCSSolvedCircle {
                    id: c.id.clone(),
                    center_id: c.center_id.clone(),
                    radius: sol_rad,
                });
            }

            serde_json::to_string(&GCSSolvedOutput {
                success: true,
                points: solved_points,
                circles: solved_circles,
                error: None,
            })
            .unwrap()
        }
        Err(e) => serde_json::to_string(&GCSSolvedOutput {
            success: false,
            points: vec![],
            circles: vec![],
            error: Some(format!("Solver error: {:?}", e)),
        })
        .unwrap(),
    }
}

#[cfg(test)]
mod tests;
