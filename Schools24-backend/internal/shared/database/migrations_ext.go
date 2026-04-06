package database

import (
	"context"
	"log"
)

// RunExtMigrations creates additional tables for inventory, events, and transport
func (db *PostgresDB) RunExtMigrations(ctx context.Context) error {
	log.Println("Running extended migrations (Inventory, Events, Bus Routes)...")

	// Inventory table
	inventoryTable := `
        CREATE TABLE IF NOT EXISTS inventory_items (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
            name VARCHAR(255) NOT NULL,
            category VARCHAR(100) NOT NULL,
            quantity INT DEFAULT 0,
            unit VARCHAR(50),
            min_stock INT DEFAULT 0,
            location VARCHAR(255),
            status VARCHAR(50) DEFAULT 'in-stock',
            last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_inventory_school_id ON inventory_items(school_id);
    `
	if err := db.Exec(ctx, inventoryTable); err != nil {
		return err
	}
	log.Println("✓ inventory_items table ready")

	// Events table
	eventsTable := `
        CREATE TABLE IF NOT EXISTS events (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
            title VARCHAR(255) NOT NULL,
            description TEXT,
            event_date DATE NOT NULL,
            start_time TIME,
            end_time TIME,
            type VARCHAR(50) NOT NULL CHECK (type IN ('holiday', 'exam', 'event', 'meeting', 'sports', 'cultural')),
            location VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_events_school_id ON events(school_id);
        CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
    `
	if err := db.Exec(ctx, eventsTable); err != nil {
		return err
	}
	log.Println("✓ events table ready")

	// Bus Routes table
	busRoutesTable := `
        CREATE TABLE IF NOT EXISTS bus_routes (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
            route_number VARCHAR(50) NOT NULL,
            driver_name VARCHAR(255),
            driver_phone VARCHAR(20),
            vehicle_number VARCHAR(50),
            capacity INT DEFAULT 0,
            status VARCHAR(20) DEFAULT 'active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(school_id, route_number)
        );
        CREATE INDEX IF NOT EXISTS idx_bus_routes_school_id ON bus_routes(school_id);
    `
	if err := db.Exec(ctx, busRoutesTable); err != nil {
		return err
	}
	log.Println("✓ bus_routes table ready")

	// Bus Stops table
	busStopsTable := `
        CREATE TABLE IF NOT EXISTS bus_stops (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            route_id UUID NOT NULL REFERENCES bus_routes(id) ON DELETE CASCADE,
            name VARCHAR(255) NOT NULL,
            arrival_time TIME,
            stop_order INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_bus_stops_route_id ON bus_stops(route_id);
    `
	if err := db.Exec(ctx, busStopsTable); err != nil {
		return err
	}
	log.Println("✓ bus_stops table ready")

	return nil
}
