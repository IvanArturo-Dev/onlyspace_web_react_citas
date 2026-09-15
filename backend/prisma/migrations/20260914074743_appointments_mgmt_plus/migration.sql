-- AlterTable
ALTER TABLE `branches` ADD COLUMN `maps_url` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `tenants` ADD COLUMN `offered_modality` VARCHAR(191) NOT NULL DEFAULT 'in_person',
    ADD COLUMN `show_contact` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `waitlist_auto_assign` BOOLEAN NOT NULL DEFAULT false;
