-- AlterTable
ALTER TABLE `appointments` ADD COLUMN `contact_phone` VARCHAR(191) NULL,
    ADD COLUMN `home_address` VARCHAR(191) NULL,
    ADD COLUMN `maps_url` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `tenants` ADD COLUMN `offered_modalities` VARCHAR(191) NOT NULL DEFAULT 'in_person';
-- Backfill: copiar offered_modality (legacy) a offered_modalities.
-- Mapeo: 'both' -> 'in_person,online'; cualquier otro valor se copia tal cual.
UPDATE `tenants` SET offered_modalities = CASE WHEN offered_modality = 'both' THEN 'in_person,online' ELSE offered_modality END;
