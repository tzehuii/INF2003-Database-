-- INF2003 Grp1 database schema
-- DBMS: MariaDB 12
--

-- 1. ACRA registered entities

CREATE SCHEMA IF NOT EXISTS `inf2003_db_mariadb`
    DEFAULT CHARACTER SET utf8mb4
    COLLATE utf8mb4_uca1400_ai_ci;

USE `inf2003_db_mariadb`;

CREATE TABLE Company (
    company_id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    uen                 VARCHAR(20) NOT NULL,
    company_name        VARCHAR(500) NOT NULL,
    status              VARCHAR(100) NULL,
    registration_date   DATE NULL,
    normalized_name     VARCHAR(500) NOT NULL,

    PRIMARY KEY (company_id),
    CONSTRAINT uq_company_uen UNIQUE (uen),
    INDEX idx_company_normalized_name (normalized_name)
) ENGINE = InnoDB;



CREATE TABLE Address (
    address_id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    company_id          INT UNSIGNED NOT NULL,
    address_type        VARCHAR(30) NULL,
    block               VARCHAR(30) NULL,
    street_name         VARCHAR(255) NULL,
    level_no            VARCHAR(20) NULL,
    unit_no             VARCHAR(20) NULL,
    building_name       VARCHAR(255) NULL,
    postal_code         VARCHAR(20) NULL,
    other_address_line1 VARCHAR(500) NULL,
    other_address_line2 VARCHAR(500) NULL,

    PRIMARY KEY (address_id),
    INDEX idx_address_company_id (company_id),
    CONSTRAINT fk_address_company
        FOREIGN KEY (company_id)
        REFERENCES Company (company_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE
) ENGINE = InnoDB;

CREATE TABLE FormerEntityName (
    former_name_id      INT UNSIGNED NOT NULL AUTO_INCREMENT,
    company_id          INT UNSIGNED NOT NULL,
    source_slot         TINYINT UNSIGNED NOT NULL,
    former_name         VARCHAR(500) NOT NULL,

    PRIMARY KEY (former_name_id),
    CONSTRAINT uq_former_entity_name_slot
        UNIQUE (company_id, source_slot),
    CONSTRAINT fk_former_entity_name_company
        FOREIGN KEY (company_id)
        REFERENCES Company (company_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT ck_former_entity_name_source_slot
        CHECK (source_slot BETWEEN 1 AND 15)
) ENGINE = InnoDB;



-- 2. SSIC business-activity catalogue and company assignments


CREATE TABLE BusinessActivity (
    activity_id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    parent_activity_id  INT UNSIGNED NULL,
    ssic_code           VARCHAR(5) NOT NULL,
    ssic_title          VARCHAR(500) NOT NULL,
    ssic_level          VARCHAR(30) NOT NULL,

    PRIMARY KEY (activity_id),

    CONSTRAINT uq_business_activity_ssic_code
        UNIQUE (ssic_code),

    INDEX idx_business_activity_parent_id
        (parent_activity_id),

    CONSTRAINT fk_business_activity_parent
        FOREIGN KEY (parent_activity_id)
        REFERENCES BusinessActivity (activity_id)
        ON UPDATE RESTRICT
        ON DELETE SET NULL
)
ENGINE = InnoDB;


CREATE TABLE CompanyActivity (
    company_id              INT UNSIGNED NOT NULL,
    activity_type           VARCHAR(10) NOT NULL,
    activity_id             INT UNSIGNED NOT NULL,
    source_ssic_description VARCHAR(500) NULL,
    user_described_activity VARCHAR(500) NULL,

    PRIMARY KEY (company_id, activity_type),
    INDEX idx_company_activity_activity_id (activity_id),
    CONSTRAINT fk_company_activity_company
        FOREIGN KEY (company_id)
        REFERENCES Company (company_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT fk_company_activity_business_activity
        FOREIGN KEY (activity_id)
        REFERENCES BusinessActivity (activity_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    CONSTRAINT ck_company_activity_type
        CHECK (LOWER(activity_type) IN ('primary', 'secondary'))
) ENGINE = InnoDB;



-- 3. GeBIZ tenders and supplier awards


CREATE TABLE GovernmentAgency (
    agency_id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
    agency_name         VARCHAR(255) NOT NULL,

    PRIMARY KEY (agency_id),
    CONSTRAINT uq_government_agency_name UNIQUE (agency_name)
) ENGINE = InnoDB;


CREATE TABLE Tender (
    tender_id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
    agency_id           INT UNSIGNED NOT NULL,
    tender_no           VARCHAR(100) NOT NULL,
    tender_description  TEXT NOT NULL,
    tender_status       VARCHAR(100) NULL,
    award_date          DATE NULL,

    PRIMARY KEY (tender_id),
    CONSTRAINT uq_tender_no UNIQUE (tender_no),
    INDEX idx_tender_agency_id (agency_id),
    INDEX idx_tender_award_date (award_date),
    CONSTRAINT fk_tender_government_agency
        FOREIGN KEY (agency_id)
        REFERENCES GovernmentAgency (agency_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
) ENGINE = InnoDB;


CREATE TABLE Supplier (
    supplier_id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
    supplier_name_raw           VARCHAR(500) NOT NULL,
    normalized_supplier_name    VARCHAR(500) NOT NULL,

    PRIMARY KEY (supplier_id),
    CONSTRAINT uq_supplier_name_raw UNIQUE (supplier_name_raw),
    INDEX idx_supplier_normalized_name (normalized_supplier_name)
) ENGINE = InnoDB;


CREATE TABLE TenderAward (
    award_id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    tender_id           INT UNSIGNED NOT NULL,
    supplier_id         INT UNSIGNED NOT NULL,
    awarded_amt         DECIMAL(18,2) NOT NULL,

    PRIMARY KEY (award_id),
    INDEX idx_tender_award_tender_id (tender_id),
    INDEX idx_tender_award_supplier_id (supplier_id),
    CONSTRAINT fk_tender_award_tender
        FOREIGN KEY (tender_id)
        REFERENCES Tender (tender_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT fk_tender_award_supplier
        FOREIGN KEY (supplier_id)
        REFERENCES Supplier (supplier_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    CONSTRAINT ck_tender_award_amount
        CHECK (awarded_amt >= 0)
) ENGINE = InnoDB;



-- 4. Supplier-to-ACRA matching


CREATE TABLE SupplierEntityMatch (
    match_id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    supplier_id         INT UNSIGNED NOT NULL,
    company_id          INT UNSIGNED NOT NULL,
    match_method        VARCHAR(50) NOT NULL,
    confidence_score    DECIMAL(5,4) NULL,
    verified            BOOLEAN NOT NULL DEFAULT FALSE,

    PRIMARY KEY (match_id),
    CONSTRAINT uq_supplier_entity_match_pair
        UNIQUE (supplier_id, company_id),
    INDEX idx_supplier_entity_match_company_id (company_id),
    CONSTRAINT fk_supplier_entity_match_supplier
        FOREIGN KEY (supplier_id)
        REFERENCES Supplier (supplier_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT fk_supplier_entity_match_company
        FOREIGN KEY (company_id)
        REFERENCES Company (company_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT ck_supplier_entity_match_verified
        CHECK (verified IN (FALSE, TRUE)),
    CONSTRAINT ck_supplier_entity_match_confidence
        CHECK (
            confidence_score IS NULL
            OR confidence_score BETWEEN 0.0000 AND 1.0000
        )
) ENGINE = InnoDB;


-- 5. User-created saved company lists


CREATE TABLE SavedList (
    list_id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
    list_name           VARCHAR(200) NOT NULL,

    PRIMARY KEY (list_id),
    CONSTRAINT uq_saved_list_name UNIQUE (list_name)
) ENGINE = InnoDB;


CREATE TABLE SavedListEntry (
    company_id          INT UNSIGNED NOT NULL,
    list_id             INT UNSIGNED NOT NULL,
    review_status       VARCHAR(30) NOT NULL DEFAULT 'Pending',
    saved_at            TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    PRIMARY KEY (company_id, list_id),
    INDEX idx_saved_list_entry_list_id (list_id),
    CONSTRAINT fk_saved_list_entry_company
        FOREIGN KEY (company_id)
        REFERENCES Company (company_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT fk_saved_list_entry_list
        FOREIGN KEY (list_id)
        REFERENCES SavedList (list_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE
) ENGINE = InnoDB;