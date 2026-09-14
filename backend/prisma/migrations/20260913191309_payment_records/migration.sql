-- CreateTable
CREATE TABLE `payment_records` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL DEFAULT 'mercadopago',
    `preapproval_id` VARCHAR(191) NULL,
    `payment_id` VARCHAR(191) NULL,
    `event_type` VARCHAR(191) NULL,
    `status` VARCHAR(191) NULL,
    `status_detail` VARCHAR(191) NULL,
    `amount` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'MXN',
    `payer_email` VARCHAR(191) NULL,
    `raw` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payment_records_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    INDEX `payment_records_preapproval_id_idx`(`preapproval_id`),
    INDEX `payment_records_payment_id_idx`(`payment_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
