package database

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgresDB wraps pgxpool for Neon PostgreSQL
type PostgresDB struct {
	Pool *pgxpool.Pool
	// Test hooks (optional): allow repository SQL tests to inject a mock query layer
	// without modifying production query logic.
	QueryHook    func(ctx context.Context, sql string, args ...interface{}) (pgx.Rows, error)
	QueryRowHook func(ctx context.Context, sql string, args ...interface{}) pgx.Row
	ExecHook     func(ctx context.Context, sql string, args ...interface{}) (pgconn.CommandTag, error)
}

// NewPostgresDB creates a new PostgreSQL connection pool optimised for Neon serverless.
//
// Neon-specific considerations:
//   - Neon uses PgBouncer in transaction pooling mode by default on the pooled port.
//     Use the direct (non-pooled) connection string from Neon dashboard for schema operations.
//   - Neon suspends compute after ~5min idle; MinConns=0 avoids fighting that.
//   - The free tier allows ~20 total connections; stay conservative with MaxConns.
//   - Connections silently die when Neon proxy resets; short lifetimes detect this fast.
//   - BeforeAcquire resets search_path so recycled connections are never in a tenant schema.
func NewPostgresDB(databaseURL string) (*PostgresDB, error) {
	if databaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is not set — add it to Render environment variables")
	}

	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse database URL: %w", err)
	}

	// --- Neon / serverless-safe pool settings ---
	// MaxConns=4: Neon free tier has ~20 connections total.
	// With Render's free plan spinning up fresh containers on each deploy,
	// keeping this low prevents exhausting the connection limit.
	config.MaxConns = 4

	// MinConns=0: do NOT hold idle connections open against a serverless DB.
	// Neon suspends compute after ~5 min idle and silently drops held connections,
	// causing "broken pipe" errors on the next query.
	config.MinConns = 0

	// Short lifecycle forces reconnect before Neon's proxy kills the connection.
	config.MaxConnLifetime = 5 * time.Minute

	// Idle timeout must be shorter than Neon's own idle disconnect (~10 min).
	config.MaxConnIdleTime = 2 * time.Minute

	// Health checks should not fight Neon suspension.
	config.HealthCheckPeriod = 90 * time.Second

	// BeforeAcquire: CRITICAL for Neon / PgBouncer transaction-pooling mode.
	// When pgxpool recycles a connection, it may still have a prior tenant's
	// search_path set from a previous request. RESET ensures public schema is
	// the default, so our explicit SET LOCAL / SET calls are the only ones in effect.
	config.BeforeAcquire = func(ctx context.Context, conn *pgx.Conn) bool {
		_, err := conn.Exec(ctx, "RESET search_path")
		if err != nil {
			log.Printf("WARN: failed to reset search_path on acquired connection: %v — discarding", err)
			return false // discard this connection, get a fresh one
		}
		return true
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("failed to create connection pool: %w", err)
	}

	// Test connection — also validates SSL and credentials.
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	log.Printf("Connected to PostgreSQL (Neon) — MaxConns: %d, IdleTimeout: %s", config.MaxConns, config.MaxConnIdleTime)

	return &PostgresDB{Pool: pool}, nil
}

// Close closes the database connection pool
func (db *PostgresDB) Close() {
	db.Pool.Close()
}

// Exec executes a query without returning rows.
// If tenant_schema is in ctx, acquires a dedicated connection and sets search_path first.
func (db *PostgresDB) Exec(ctx context.Context, sql string, args ...interface{}) error {
	if db.ExecHook != nil {
		_, err := db.ExecHook(ctx, sql, args...)
		return err
	}
	if schema, ok := ctx.Value("tenant_schema").(string); ok && schema != "" {
		conn, err := db.Pool.Acquire(ctx)
		if err != nil {
			return err
		}
		defer conn.Release()
		// SET LOCAL scopes to the current transaction; SET is session-scoped.
		// We use SET (not SET LOCAL) here because we're not inside an explicit transaction.
		if _, err := conn.Exec(ctx, fmt.Sprintf("SET search_path TO %s, public", schema)); err != nil {
			return err
		}
		_, err = conn.Exec(ctx, sql, args...)
		return err
	}
	_, err := db.Pool.Exec(ctx, sql, args...)
	return err
}

// ExecResult executes a query and returns the CommandTag (for RowsAffected, etc.)
// This is tenant-aware and will set search_path if tenant_schema is in context.
func (db *PostgresDB) ExecResult(ctx context.Context, sql string, args ...interface{}) (pgconn.CommandTag, error) {
	if db.ExecHook != nil {
		return db.ExecHook(ctx, sql, args...)
	}
	if schema, ok := ctx.Value("tenant_schema").(string); ok && schema != "" {
		conn, err := db.Pool.Acquire(ctx)
		if err != nil {
			return pgconn.CommandTag{}, err
		}
		defer conn.Release()
		if _, err := conn.Exec(ctx, fmt.Sprintf("SET search_path TO %s, public", schema)); err != nil {
			return pgconn.CommandTag{}, err
		}
		return conn.Exec(ctx, sql, args...)
	}
	return db.Pool.Exec(ctx, sql, args...)
}

// QueryRow executes a query that returns a single row
func (db *PostgresDB) QueryRow(ctx context.Context, sql string, args ...interface{}) pgx.Row {
	if db.QueryRowHook != nil {
		return db.QueryRowHook(ctx, sql, args...)
	}
	if schema, ok := ctx.Value("tenant_schema").(string); ok && schema != "" {
		conn, err := db.Pool.Acquire(ctx)
		if err != nil {
			return &rowWithError{err: err}
		}
		if _, err := conn.Exec(ctx, fmt.Sprintf("SET search_path TO %s, public", schema)); err != nil {
			conn.Release()
			return &rowWithError{err: err}
		}
		row := conn.QueryRow(ctx, sql, args...)
		return &rowWithRelease{row: row, release: conn.Release}
	}
	return db.Pool.QueryRow(ctx, sql, args...)
}

// Query executes a query that returns multiple rows
func (db *PostgresDB) Query(ctx context.Context, sql string, args ...interface{}) (pgx.Rows, error) {
	if db.QueryHook != nil {
		return db.QueryHook(ctx, sql, args...)
	}
	if schema, ok := ctx.Value("tenant_schema").(string); ok && schema != "" {
		conn, err := db.Pool.Acquire(ctx)
		if err != nil {
			return nil, err
		}
		if _, err := conn.Exec(ctx, fmt.Sprintf("SET search_path TO %s, public", schema)); err != nil {
			conn.Release()
			return nil, err
		}
		rows, err := conn.Query(ctx, sql, args...)
		if err != nil {
			conn.Release()
			return nil, err
		}
		return &rowsWithRelease{Rows: rows, release: conn.Release}, nil
	}
	return db.Pool.Query(ctx, sql, args...)
}

// injectSearchPath prepends the search_path setting if found in context
func (db *PostgresDB) injectSearchPath(ctx context.Context, sql string) string {
	if schema, ok := ctx.Value("tenant_schema").(string); ok && schema != "" {
		return fmt.Sprintf("SET search_path TO %s, public; %s", schema, sql)
	}
	return sql
}

// rowWithRelease ensures pooled connections are released after Scan
type rowWithRelease struct {
	row     pgx.Row
	release func()
}

func (r *rowWithRelease) Scan(dest ...interface{}) error {
	err := r.row.Scan(dest...)
	r.release()
	return err
}

// rowWithError returns a Scan error without panicking when a connection can't be acquired
type rowWithError struct {
	err error
}

func (r *rowWithError) Scan(dest ...interface{}) error {
	return r.err
}

// rowsWithRelease ensures pooled connections are released when rows are closed
type rowsWithRelease struct {
	pgx.Rows
	release func()
}

func (r *rowsWithRelease) Close() {
	r.Rows.Close()
	r.release()
}

// Begin starts a transaction, setting search_path if tenant context is set.
// Uses SET LOCAL to scope search_path to this transaction only —
// critical for Neon/PgBouncer where session-scoped SETs leak across pooled connections.
func (db *PostgresDB) Begin(ctx context.Context) (pgx.Tx, error) {
	tx, err := db.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	if schema, ok := ctx.Value("tenant_schema").(string); ok && schema != "" {
		// SET LOCAL is transaction-scoped — automatically rolls back with the transaction.
		// This is the correct choice inside explicit transactions on pooled connections.
		if _, err := tx.Exec(ctx, fmt.Sprintf("SET LOCAL search_path TO %s, public", schema)); err != nil {
			tx.Rollback(ctx)
			return nil, err
		}
	}
	return tx, nil
}

// WithTx executes a function within a transaction.
// Uses SET LOCAL for search_path so it's scoped to this transaction only.
func (db *PostgresDB) WithTx(ctx context.Context, fn func(tx Tx) error) (err error) {
	tx, err := db.Pool.Begin(ctx)
	if err != nil {
		return err
	}

	defer func() {
		if p := recover(); p != nil {
			tx.Rollback(ctx)
			panic(p) // re-throw panic after rollback
		} else if err != nil {
			tx.Rollback(ctx) // err is set by fn()
		} else {
			err = tx.Commit(ctx) // commit if no error
		}
	}()

	// SET LOCAL: transaction-scoped search_path, safe for connection pooling.
	if schema, ok := ctx.Value("tenant_schema").(string); ok && schema != "" {
		if _, err := tx.Exec(ctx, fmt.Sprintf("SET LOCAL search_path TO %s, public", schema)); err != nil {
			return err
		}
	}

	err = fn(tx)
	return
}
