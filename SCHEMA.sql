-- Qtonix Site Analysis — MySQL schema reference.
-- You do not need to run this: Sequelize creates these tables on first boot
-- (npm run seed). It is here so your DBA can review the shape.

CREATE DATABASE IF NOT EXISTS qtonix_audit
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE qtonix_audit;

CREATE TABLE users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(120)  NOT NULL,
  email         VARCHAR(180)  NOT NULL UNIQUE,
  passwordHash  VARCHAR(255)  NOT NULL,          -- bcrypt, cost 12
  phone         VARCHAR(40)   DEFAULT '',
  designation   VARCHAR(80)   DEFAULT 'Sales Executive',
  role          ENUM('agent','admin') DEFAULT 'agent',
  active        TINYINT(1)    DEFAULT 1,
  reportsRun    INT           DEFAULT 0,
  lastLogin     DATETIME,
  createdAt     DATETIME NOT NULL,
  updatedAt     DATETIME NOT NULL,
  INDEX idx_role (role)
) ENGINE=InnoDB;

CREATE TABLE reports (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  agentId           INT NOT NULL,
  -- Denormalised on purpose: agents get deactivated, their reports must survive.
  agentName         VARCHAR(120),
  agentPhone        VARCHAR(40),
  agentEmail        VARCHAR(180),
  agentDesignation  VARCHAR(80),
  website           VARCHAR(255) NOT NULL,
  domain            VARCHAR(190),
  businessName      VARCHAR(190) NOT NULL,
  customerName      VARCHAR(190) NOT NULL,
  services          JSON,
  country           VARCHAR(4)  DEFAULT 'us',
  location          VARCHAR(190),
  status            ENUM('queued','running','complete','failed') DEFAULT 'queued',
  progress          INT DEFAULT 0,
  currentStep       VARCHAR(120),
  error             TEXT,
  scores            JSON,
  headline          JSON,
  summary           JSON,
  data              JSON,          -- full render payload, 100-300KB. Never SELECTed in lists.
  opportunityValue  JSON,
  -- CRM: how sales tracks the prospect after the report is sent
  stage             ENUM('new','contacted','interested','proposal','negotiation','won','lost') DEFAULT 'new',
  tags              JSON,          -- what they asked for
  remark            TEXT,          -- free-text call notes
  followUpAt        DATETIME,
  isDemo            TINYINT(1) DEFAULT 0,
  pdfPath           VARCHAR(255),
  htmlPath          VARCHAR(255),
  creditsUsed       INT,
  durationMs        INT,
  completedAt       DATETIME,
  createdAt         DATETIME NOT NULL,
  updatedAt         DATETIME NOT NULL,
  INDEX idx_agent  (agentId),
  INDEX idx_status (status),
  INDEX idx_domain (domain),      -- powers the 7-day cache lookup
  INDEX idx_demo   (isDemo),
  INDEX idx_stage  (stage),       -- pipeline filtering
  FOREIGN KEY (agentId) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE settings (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  singleton        VARCHAR(20) UNIQUE DEFAULT 'settings',
  companyName      VARCHAR(190),
  companyShort     VARCHAR(60),
  logoPath         VARCHAR(255),
  faviconPath      VARCHAR(255),
  website          VARCHAR(190),
  email            VARCHAR(190),
  phone            VARCHAR(40),
  address          VARCHAR(255),
  colors           JSON,
  fontFamily       VARCHAR(80),
  apiKeys          JSON,   -- AES-256-GCM ciphertext per key: iv:tag:data
  pricing          JSON,   -- packages, features, guarantee — admin editable
  reportValidDays  INT DEFAULT 14,
  dailyReportLimit INT DEFAULT 20,
  cacheDays        INT DEFAULT 7,
  defaultCountry   VARCHAR(4) DEFAULT 'us',
  createdAt        DATETIME NOT NULL,
  updatedAt        DATETIME NOT NULL
) ENGINE=InnoDB;

CREATE TABLE audit_logs (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  userId    INT,
  userName  VARCHAR(120),
  action    VARCHAR(60),
  target    VARCHAR(190),
  meta      JSON,
  ip        VARCHAR(60),
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  INDEX idx_user (userId)
) ENGINE=InnoDB;
