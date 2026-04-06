package admin

import (
	"context"

	"github.com/google/uuid"
)

func (s *Service) GetBusRoutes(ctx context.Context, schoolID uuid.UUID, search string, page, pageSize int) ([]BusRoute, int, error) {
	return s.repo.ListBusRoutes(ctx, schoolID, search, page, pageSize)
}

func (s *Service) CreateBusRoute(ctx context.Context, schoolID uuid.UUID, req CreateBusRouteRequest) (*BusRoute, error) {
	return s.repo.CreateBusRoute(ctx, schoolID, req)
}

func (s *Service) UpdateBusRoute(ctx context.Context, routeID uuid.UUID, schoolID uuid.UUID, req UpdateBusRouteRequest) (*BusRoute, error) {
	return s.repo.UpdateBusRoute(ctx, routeID, schoolID, req)
}

func (s *Service) DeleteBusRoute(ctx context.Context, routeID uuid.UUID, schoolID uuid.UUID) error {
	return s.repo.DeleteBusRoute(ctx, routeID, schoolID)
}

func (s *Service) GetBusRouteStops(ctx context.Context, routeID uuid.UUID, schoolID uuid.UUID) ([]BusRouteStop, error) {
	return s.repo.ListBusRouteStops(ctx, routeID, schoolID)
}

func (s *Service) UpdateBusRouteStops(ctx context.Context, routeID uuid.UUID, schoolID uuid.UUID, stops []BusRouteStopInput) ([]BusRouteStop, error) {
	return s.repo.ReplaceBusRouteStops(ctx, routeID, schoolID, stops)
}

func (s *Service) UpdateBusRouteShape(ctx context.Context, routeID uuid.UUID, schoolID uuid.UUID, req UpdateBusRouteShapeRequest) (*BusRouteShape, error) {
	return s.repo.UpsertBusRouteShape(ctx, routeID, schoolID, req)
}

func (s *Service) GetBusStopAssignments(ctx context.Context, routeID uuid.UUID, schoolID uuid.UUID) ([]BusStopAssignment, error) {
	return s.repo.ListBusStopAssignments(ctx, routeID, schoolID)
}

func (s *Service) UpdateBusStopAssignments(ctx context.Context, routeID uuid.UUID, schoolID uuid.UUID, items []BusStopAssignmentInput) ([]BusStopAssignment, error) {
	return s.repo.ReplaceBusStopAssignments(ctx, routeID, schoolID, items)
}
