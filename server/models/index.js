/**
 * Data layer — MySQL via Sequelize.
 *
 * Why Sequelize rather than raw SQL: the report payload is a deep, evolving
 * JSON blob. Sequelize's JSON column stores it natively in MySQL 5.7+ while the
 * relational columns (agent, status, domain) stay properly indexed for the
 * list / filter / cache queries the app actually runs.
 *
 * DIALECT: defaults to MySQL. Set DB_DIALECT=sqlite for the local test harness —
 * identical schema, zero setup. No application code branches on dialect.
 */

const { Sequelize, DataTypes, Op } = require('sequelize');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Field-level encryption for API keys. Keys cost real money per call, so they
// are never stored in plaintext and never leave the server unmasked.
// ---------------------------------------------------------------------------
const ALGO = 'aes-256-gcm';
const secret = () => {
  const k = process.env.ENCRYPTION_KEY || '';
  if (k.length < 32) throw new Error('ENCRYPTION_KEY must be at least 32 characters');
  return crypto.createHash('sha256').update(k).digest();
};

function encrypt(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, secret(), iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return [iv.toString('hex'), cipher.getAuthTag().toString('hex'), enc.toString('hex')].join(':');
}

function decrypt(payload) {
  if (!payload || !String(payload).includes(':')) return '';
  try {
    const [iv, tag, data] = String(payload).split(':');
    const d = crypto.createDecipheriv(ALGO, secret(), Buffer.from(iv, 'hex'));
    d.setAuthTag(Buffer.from(tag, 'hex'));
    return Buffer.concat([d.update(Buffer.from(data, 'hex')), d.final()]).toString('utf8');
  } catch {
    return ''; // fail closed on tampered ciphertext
  }
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------
const dialect = process.env.DB_DIALECT || 'mysql';

const sequelize =
  dialect === 'sqlite'
    ? new Sequelize({
        dialect: 'sqlite',
        storage: process.env.DB_STORAGE || './storage/qtonix.sqlite',
        logging: false,
      })
    : new Sequelize(
        process.env.DB_NAME || 'qtonix_audit',
        process.env.DB_USER || 'root',
        process.env.DB_PASS || '',
        {
          host: process.env.DB_HOST || '127.0.0.1',
          port: Number(process.env.DB_PORT || 3306),
          dialect: 'mysql',
          logging: false,
          define: { charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' },
          pool: { max: 10, min: 0, idle: 10000 },
        }
      );

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

const User = sequelize.define(
  'User',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(120), allowNull: false },
    email: { type: DataTypes.STRING(180), allowNull: false, unique: true },
    passwordHash: { type: DataTypes.STRING(255), allowNull: false },
    phone: { type: DataTypes.STRING(40), defaultValue: '' },
    designation: { type: DataTypes.STRING(80), defaultValue: 'Sales Executive' },
    // Team location and shift, for roster/ownership context.
    team: { type: DataTypes.ENUM('Bhubaneswar', 'Kolkata'), defaultValue: 'Bhubaneswar' },
    shift: { type: DataTypes.ENUM('Morning', 'Night'), defaultValue: 'Morning' },
    // Pseudonyms an agent uses with clients (comma-separated list stored as JSON).
    aliases: { type: DataTypes.JSON, defaultValue: [] },
    role: { type: DataTypes.ENUM('agent', 'admin'), defaultValue: 'agent' },
    active: { type: DataTypes.BOOLEAN, defaultValue: true },
    reportsRun: { type: DataTypes.INTEGER, defaultValue: 0 },
    lastLogin: { type: DataTypes.DATE },
  },
  { tableName: 'users', indexes: [{ fields: ['role'] }] }
);

const Report = sequelize.define(
  'Report',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    agentId: { type: DataTypes.INTEGER, allowNull: false },
    // Denormalised: agents get deactivated, but their reports must keep working.
    agentName: DataTypes.STRING(120),
    agentPhone: DataTypes.STRING(40),
    agentEmail: DataTypes.STRING(180),
    agentDesignation: DataTypes.STRING(80),

    website: { type: DataTypes.STRING(255), allowNull: false },
    domain: { type: DataTypes.STRING(190) },
    businessName: { type: DataTypes.STRING(190), allowNull: false },
    customerName: { type: DataTypes.STRING(190), allowNull: false },
    services: { type: DataTypes.JSON, defaultValue: [] },
    country: { type: DataTypes.STRING(4), defaultValue: 'us' },
    location: DataTypes.STRING(190),

    status: { type: DataTypes.ENUM('queued', 'running', 'complete', 'failed'), defaultValue: 'queued' },
    progress: { type: DataTypes.INTEGER, defaultValue: 0 },
    currentStep: DataTypes.STRING(120),
    error: DataTypes.TEXT,

    scores: { type: DataTypes.JSON, defaultValue: {} },
    headline: { type: DataTypes.JSON, defaultValue: {} },
    summary: { type: DataTypes.JSON, defaultValue: {} },
    // Full render payload. MySQL JSON handles it natively; it is large
    // (~100-300KB) so it is never selected in list queries.
    data: { type: DataTypes.JSON, defaultValue: {} },
    opportunityValue: { type: DataTypes.JSON, defaultValue: {} },

    // ---- CRM: how the sales team tracks the prospect after the report ----
    stage: {
      type: DataTypes.ENUM(
        'new', 'hot', 'cold', 'ni', 'contacted', 'interested',
        'proposal', 'negotiation', 'won', 'lost'
      ),
      defaultValue: 'new',
    },
    tags: { type: DataTypes.JSON, defaultValue: [] },   // what they asked for
    remark: { type: DataTypes.TEXT },                    // free-text call notes
    followUpAt: { type: DataTypes.DATE },

    // ---- Customer contact details (CRM), captured before running a report ----
    customerPhone: { type: DataTypes.STRING(40), defaultValue: '' },
    customerEmail: { type: DataTypes.STRING(180), defaultValue: '' },
    customerCountry: { type: DataTypes.STRING(60), defaultValue: '' },
    customerCompany: { type: DataTypes.STRING(190), defaultValue: '' },

    isDemo: { type: DataTypes.BOOLEAN, defaultValue: false },
    pdfPath: DataTypes.STRING(255),
    htmlPath: DataTypes.STRING(255),
    creditsUsed: DataTypes.INTEGER,
    durationMs: DataTypes.INTEGER,
    completedAt: DataTypes.DATE,
  },
  {
    tableName: 'reports',
    indexes: [
      { fields: ['agentId'] },
      { fields: ['status'] },
      { fields: ['domain'] }, // powers the 7-day cache lookup
      { fields: ['isDemo'] },
      { fields: ['stage'] },  // pipeline filtering
    ],
  }
);

const Settings = sequelize.define(
  'Settings',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    singleton: { type: DataTypes.STRING(20), defaultValue: 'settings', unique: true },

    companyName: { type: DataTypes.STRING(190), defaultValue: 'Qtonix Software Pvt. Ltd.' },
    companyShort: { type: DataTypes.STRING(60), defaultValue: 'Qtonix' },
    logoPath: { type: DataTypes.STRING(255), defaultValue: '' },
    faviconPath: { type: DataTypes.STRING(255), defaultValue: '' },
    website: { type: DataTypes.STRING(190), defaultValue: 'https://www.qtonix.com' },
    email: { type: DataTypes.STRING(190), defaultValue: 'info@qtonix.com' },
    phone: { type: DataTypes.STRING(40), defaultValue: '+91-8249016547' },
    address: { type: DataTypes.STRING(255), defaultValue: '608, 6th Floor, Utkal Signature Building, Bhubaneswar, India 752101' },

    colors: {
      type: DataTypes.JSON,
      defaultValue: { navy: '#050A1F', orange: '#FF6A00', orangeDeep: '#FF4500', blue: '#2563EB' },
    },
    fontFamily: { type: DataTypes.STRING(80), defaultValue: 'Plus Jakarta Sans' },

    apiKeys: {
      type: DataTypes.JSON,
      defaultValue: { seranking: '', anthropic: '', pagespeed: '', googlePlaces: '' },
    },

    pricing: { type: DataTypes.JSON },

    reportValidDays: { type: DataTypes.INTEGER, defaultValue: 14 },
    dailyReportLimit: { type: DataTypes.INTEGER, defaultValue: 20 },
    cacheDays: { type: DataTypes.INTEGER, defaultValue: 7 },
    defaultCountry: { type: DataTypes.STRING(4), defaultValue: 'us' },
  },
  { tableName: 'settings' }
);

const AuditLog = sequelize.define(
  'AuditLog',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: DataTypes.INTEGER,
    userName: DataTypes.STRING(120),
    action: DataTypes.STRING(60),
    target: DataTypes.STRING(190),
    meta: { type: DataTypes.JSON, defaultValue: {} },
    ip: DataTypes.STRING(60),
  },
  { tableName: 'audit_logs', indexes: [{ fields: ['userId'] }] }
);

User.hasMany(Report, { foreignKey: 'agentId', as: 'reports' });
Report.belongsTo(User, { foreignKey: 'agentId', as: 'agent' });

// The frontend was written against a Mongo-style `_id`. MySQL uses `id`. Rather
// than rewrite every reference, expose both: every Report serialised to JSON
// includes an `_id` mirror of `id`, so links like /reports/:id work correctly.
Report.prototype.toJSON = function () {
  const o = Object.assign({}, this.get());
  o._id = o.id;
  return o;
};

// Same _id mirror for User, and never leak the password hash to the client.
User.prototype.toJSON = function () {
  const o = Object.assign({}, this.get());
  o._id = o.id;
  delete o.passwordHash;
  return o;
};

// ---------------------------------------------------------------------------
// Encryption hooks — transparent at the model layer.
// ---------------------------------------------------------------------------
function encryptKeys(instance) {
  const keys = instance.apiKeys || {};
  const out = {};
  for (const [k, v] of Object.entries(keys)) {
    // Already-encrypted values contain ':' separators — never double-encrypt.
    out[k] = v && !String(v).includes(':') ? encrypt(v) : v;
  }
  instance.apiKeys = out;
}
Settings.beforeCreate(encryptKeys);
Settings.beforeUpdate(encryptKeys);

Settings.prototype.getKey = function (name) {
  return decrypt((this.apiKeys || {})[name]);
};

/** Never send real keys to the browser — only a masked hint that one is set. */
Settings.prototype.toSafeJSON = function () {
  const o = this.toJSON();
  o.apiKeys = Object.fromEntries(
    Object.entries(o.apiKeys || {}).map(([k, v]) => {
      const plain = decrypt(v);
      return [k, plain ? '••••••••' + plain.slice(-4) : ''];
    })
  );
  return o;
};

function defaultPricing() {
  return {
    enabled: true,
    currency: 'USD',
    symbol: '$',
    intro: 'Three ways to work together — all month-to-month, no lock-in. Every package includes monthly reporting, keyword tracking and a dedicated point of contact.',
    note: 'About paid backlinks. Some high-authority backlinks carry a direct placement cost paid to the publisher — this is a direct expense you pay, separate from your package. Qtonix handles all the research, outreach, backend conversations and setup for free — no agency markup and no management charge on top. And we only ever place genuine, relevant links.',
    guaranteeTitle: 'The risk is ours, not yours.',
    guaranteeBody: "If we don't increase your targeted traffic and enquiries within 90 days, we refund every dollar you've paid — and write you a cheque for $1,000 for your time.",
    packages: [
      {
        name: 'STARTER', price: '399', period: '/mo', oldPrice: '', recommended: false, badge: '',
        blurb: 'Getting started on a budget.',
        features: ['Keyword & competitor research', '2 SEO blogs / month', 'Directory submission: 12 / month', 'Social bookmarking: 8 / month', 'Profile creation: 8 / month', 'Q&A submission: 8 / month', 'Monthly report'],
        starFeatures: [],
      },
      {
        name: 'GROWTH', price: '549', period: '/mo', oldPrice: '799', recommended: true, badge: 'RECOMMENDED',
        blurb: 'Best value — builds the pages that capture high-intent searches. Lock now = lifetime price, even when our rates rise.',
        features: ['Everything in Starter, plus:', '3–4 SEO blogs / month', '2 landing pages / month', 'Guest posts: 2 / month', 'Article / blog submission: 8 / month', 'Infographic submission: 8 / month', 'PR submission: 1 / month', 'GMB / profile optimisation: 2 / month'],
        starFeatures: ['90-day money-back guarantee'],
      },
      {
        name: 'PREMIUM', price: '1,199', period: '/mo', oldPrice: '', recommended: false, badge: '',
        blurb: 'Maximum speed — includes link cleanup.',
        features: ['Everything in Growth, plus:', '8+ SEO blogs / month', '4+ landing pages / month', 'Full on-page SEO audit & fixes', 'Backlink audit & disavow', 'Technical SEO: speed, schema, JS fixes', 'Competitor gap analysis'],
        starFeatures: ['90-day money-back guarantee'],
      },
    ],
  };
}

/** Connect, create tables if absent, guarantee the settings row exists. */
async function initDb({ sync = true } = {}) {
  await sequelize.authenticate();
  if (sync) await sequelize.sync();
  let s = await Settings.findOne({ where: { singleton: 'settings' } });
  if (!s) s = await Settings.create({ singleton: 'settings', pricing: defaultPricing() });
  if (!s.pricing) {
    s.pricing = defaultPricing();
    await s.save();
  }
  return s;
}

module.exports = {
  sequelize, Sequelize, Op,
  User, Report, Settings, AuditLog,
  encrypt, decrypt, initDb, defaultPricing,
};
