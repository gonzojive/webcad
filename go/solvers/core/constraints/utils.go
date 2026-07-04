package constraints

import (
	"fmt"
	"github.com/gonzojive/webcad/proto"
	"github.com/gonzojive/webcad/go/solvers/core/gcstypes"
)

// getParams extracts the parameters of an entity as a flat float64 slice.
// This is a copy of core.GetParams to avoid circular dependencies.
func getParams(ent *schema.Entity) []float64 {
	if ent == nil {
		return nil
	}
	switch e := ent.GetEntityType().(type) {
	case *schema.Entity_Point:
		if e.Point == nil {
			return nil
		}
		return []float64{e.Point.X, e.Point.Y}
	case *schema.Entity_Line:
		return nil
	case *schema.Entity_Circle:
		if e.Circle == nil {
			return nil
		}
		return []float64{e.Circle.R}
	case *schema.Entity_Arc:
		if e.Arc == nil {
			return nil
		}
		return []float64{e.Arc.R, e.Arc.StartAngle, e.Arc.EndAngle}
	case *schema.Entity_Ellipse:
		if e.Ellipse == nil {
			return nil
		}
		return []float64{e.Ellipse.Rx, e.Ellipse.Ry, e.Ellipse.Theta}
	case *schema.Entity_Spline:
		if e.Spline == nil {
			return nil
		}
		return e.Spline.ControlPoints
	}
	return nil
}

// Geometry type helpers (copied from core to avoid cycles)

func isCircleOrArc(ent *schema.Entity) bool {
	switch ent.GetEntityType().(type) {
	case *schema.Entity_Circle, *schema.Entity_Arc:
		return true
	}
	return false
}

func isLine(ent *schema.Entity) bool {
	_, ok := ent.GetEntityType().(*schema.Entity_Line)
	return ok
}

func isPoint(ent *schema.Entity) bool {
	_, ok := ent.GetEntityType().(*schema.Entity_Point)
	return ok
}

func resolvePointOrCenter(id gcstypes.EntityID, entities map[gcstypes.EntityID]*schema.Entity) (gcstypes.EntityID, error) {
	ent, ok := entities[id]
	if !ok {
		return "", fmt.Errorf("entity %q not found", id)
	}
	var targetID gcstypes.EntityID
	switch e := ent.GetEntityType().(type) {
	case *schema.Entity_Point:
		return id, nil
	case *schema.Entity_Circle:
		if e.Circle == nil {
			return "", fmt.Errorf("circle entity %q is nil", id)
		}
		targetID = gcstypes.EntityID(e.Circle.CenterId)
	case *schema.Entity_Arc:
		if e.Arc == nil {
			return "", fmt.Errorf("arc entity %q is nil", id)
		}
		targetID = gcstypes.EntityID(e.Arc.CenterId)
	case *schema.Entity_Ellipse:
		if e.Ellipse == nil {
			return "", fmt.Errorf("ellipse entity %q is nil", id)
		}
		targetID = gcstypes.EntityID(e.Ellipse.CenterId)
	default:
		return "", fmt.Errorf("entity %q is not a point, circle, arc, or ellipse", id)
	}

	// Verify targetID is a point
	targetEnt, ok := entities[targetID]
	if !ok {
		return "", fmt.Errorf("entity %q references missing center point %q", id, targetID)
	}
	if _, ok := targetEnt.GetEntityType().(*schema.Entity_Point); !ok {
		return "", fmt.Errorf("entity %q references center point %q which is not a point", id, targetID)
	}
	return targetID, nil
}

func getRadius(ent *schema.Entity) (float64, error) {
	if ent == nil {
		return 0, fmt.Errorf("entity is nil")
	}
	switch e := ent.GetEntityType().(type) {
	case *schema.Entity_Circle:
		if e.Circle == nil {
			return 0, fmt.Errorf("circle entity is nil")
		}
		return e.Circle.R, nil
	case *schema.Entity_Arc:
		if e.Arc == nil {
			return 0, fmt.Errorf("arc entity is nil")
		}
		return e.Arc.R, nil
	default:
		return 0, fmt.Errorf("entity %q does not have a radius", ent.GetId())
	}
}

// getLinePoints retrieves the start and end point IDs and entities for a line entity from the entities map.
func getLinePoints(lineEnt *schema.Entity, entities map[gcstypes.EntityID]*schema.Entity) (p1Id, p2Id gcstypes.EntityID, p1, p2 *schema.PointEntity, err error) {
	line, ok := lineEnt.GetEntityType().(*schema.Entity_Line)
	if !ok || line.Line == nil {
		return "", "", nil, nil, fmt.Errorf("entity %q is not a line", lineEnt.GetId())
	}
	
	p1Id = gcstypes.EntityID(line.Line.P1Id)
	p1Ent, ok := entities[p1Id]
	if !ok {
		return "", "", nil, nil, fmt.Errorf("line %q references missing start point %q", lineEnt.GetId(), p1Id)
	}
	p1Wrapper, ok := p1Ent.GetEntityType().(*schema.Entity_Point)
	if !ok || p1Wrapper.Point == nil {
		return "", "", nil, nil, fmt.Errorf("line %q start point %q is not a point entity", lineEnt.GetId(), p1Id)
	}
	
	p2Id = gcstypes.EntityID(line.Line.P2Id)
	p2Ent, ok := entities[p2Id]
	if !ok {
		return "", "", nil, nil, fmt.Errorf("line %q references missing end point %q", lineEnt.GetId(), p2Id)
	}
	p2Wrapper, ok := p2Ent.GetEntityType().(*schema.Entity_Point)
	if !ok || p2Wrapper.Point == nil {
		return "", "", nil, nil, fmt.Errorf("line %q end point %q is not a point entity", lineEnt.GetId(), p2Id)
	}
	
	return p1Id, p2Id, p1Wrapper.Point, p2Wrapper.Point, nil
}
