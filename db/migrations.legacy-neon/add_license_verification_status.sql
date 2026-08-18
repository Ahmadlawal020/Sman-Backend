-- Migration: Add verification status to customer_licenses
-- Run this SQL against your PostgreSQL database before deploying the updated code.

-- 1. Create the enum type
CREATE TYPE license_verification_status AS ENUM ('pending', 'approved', 'rejected');

-- 2. Add new columns
ALTER TABLE customer_licenses
  ADD COLUMN status license_verification_status NOT NULL DEFAULT 'pending',
  ADD COLUMN verified_by INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN verified_by_name VARCHAR(255) DEFAULT '',
  ADD COLUMN verified_at TIMESTAMPTZ,
  ADD COLUMN verification_comment TEXT DEFAULT '';

-- 3. Add index for filtering by status
CREATE INDEX customer_licenses_status_idx ON customer_licenses(status);
