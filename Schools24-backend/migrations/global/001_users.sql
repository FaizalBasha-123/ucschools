-- Schools24 Database Schema: Users Table
-- Run this in Neon PostgreSQL console

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users table (core authentication)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('super_admin', 'admin', 'teacher', 'student', 'staff', 'parent')),
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    profile_picture_url TEXT,
    is_active BOOLEAN DEFAULT true,
    email_verified BOOLEAN DEFAULT false,
    last_login_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);

-- Password reset tokens table
CREATE TABLE IF NOT EXISTS password_resets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token);
CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON password_resets(user_id);

-- Insert a test admin user (password: admin123)
-- Password hash is bcrypt of 'admin123'
INSERT INTO users (email, password_hash, role, full_name, phone)
VALUES (
    'admin@schools24.com',
    '$2a$10$rQnM1lHHd3AhJdQK4v7KzOzHvBELhJkFJGmZ5YLuGvG0c.HRx7Rni',
    'admin',
    'System Admin',
    '+91-9999999999'
) ON CONFLICT (email) DO NOTHING;

-- Insert Super Admin (password: admin123)
INSERT INTO users (email, password_hash, role, full_name, phone, is_active)
VALUES (
    'admin@school24.in',
    '$2a$10$rQnM1lHHd3AhJdQK4v7KzOzHvBELhJkFJGmZ5YLuGvG0c.HRx7Rni', -- Same hash as admin123 for now
    'super_admin',
    'Super Admin',
    '+91-0000000000',
    true
) ON CONFLICT (email) DO NOTHING;

-- Insert a test teacher user (password: teacher123)
INSERT INTO users (email, password_hash, role, full_name, phone)
VALUES (
    'teacher@schools24.com',
    '$2a$10$B7ZWKF.JHxfQfZ2O7M9GqeB1LE8lXaJjF6.5jKJLpQGm3OMu8nqMS',
    'teacher',
    'Test Teacher',
    '+91-9888888888'
) ON CONFLICT (email) DO NOTHING;

-- Insert a test student user (password: student123)
INSERT INTO users (email, password_hash, role, full_name, phone)
VALUES (
    'student@schools24.com',
    '$2a$10$HjCZxk8NhYbLA0Jl2z0dCeTQiY8kLEr0TqPMpE3yjY8A.5d8VhH2i',
    'student',
    'Test Student',
    '+91-9777777777'
) ON CONFLICT (email) DO NOTHING;
