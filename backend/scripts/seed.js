'use strict';

/**
 * Development seed.
 *
 * Stations sit at realistically spread coordinates across Ahmedabad so
 * distance-based discovery and sorting can actually be exercised. Statuses are
 * RECOMPUTED from the seeded reports at the end, so the derived state genuinely
 * agrees with the history behind it rather than being hand-written.
 */

const { connectDatabase, disconnectDatabase } = require('../src/config/database');
const Station = require('../src/models/Station');
const User = require('../src/models/User');
const Report = require('../src/models/Report');
const StationOperator = require('../src/models/StationOperator');
const SavedStation = require('../src/models/SavedStation');
const SupplyEvent = require('../src/models/SupplyEvent');
const StationVisit = require('../src/models/StationVisit');
const NotificationRule = require('../src/models/NotificationRule');
const NotificationEvent = require('../src/models/NotificationEvent');
const PushSubscription = require('../src/models/PushSubscription');
const RefreshSession = require('../src/models/RefreshSession');
const AuditLog = require('../src/models/AuditLog');
const stationStatusService = require('../src/services/stationStatus.service');
const { hashPassword } = require('../src/utils/auth');
const { parseQueueLabel } = require('../src/utils/domain');

const SEED_PASSWORD = 'QLessDev#2026';

const minutesAgo = (m) => new Date(Date.now() - m * 60000);
const hoursAgo = (h) => minutesAgo(h * 60);
const daysAgo = (d) => hoursAgo(d * 24);

const WEEKDAY_HOURS = {
  mon: [{ open: '06:00', close: '23:00' }],
  tue: [{ open: '06:00', close: '23:00' }],
  wed: [{ open: '06:00', close: '23:00' }],
  thu: [{ open: '06:00', close: '23:00' }],
  fri: [{ open: '06:00', close: '23:00' }],
  sat: [{ open: '06:00', close: '23:00' }],
  sun: [{ open: '07:00', close: '22:00' }],
};

const ALWAYS_OPEN = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [
    d,
    [{ open: '00:00', close: '23:59' }],
  ]),
);

// [longitude, latitude] — GeoJSON order.
const STATIONS = [
  { name: 'Navrangpura CNG Station', address: 'Ashram Road, Navrangpura', city: 'Ahmedabad', lng: 72.5611, lat: 23.0365, dispensers: 6, hours: ALWAYS_OPEN, low: 160, normal: 200 },
  { name: 'Satellite Gas Point', address: 'Jodhpur Cross Roads, Satellite', city: 'Ahmedabad', lng: 72.5075, lat: 23.0276, dispensers: 4, hours: WEEKDAY_HOURS, low: 150, normal: 195 },
  // Older equipment — deliberately lower thresholds than the platform default.
  { name: 'Maninagar Fuel Hub', address: 'Krishna Baug, Maninagar', city: 'Ahmedabad', lng: 72.6027, lat: 22.9967, dispensers: 3, hours: WEEKDAY_HOURS, low: 130, normal: 175 },
  { name: 'Bopal Highway CNG', address: 'Bopal-Ambli Road', city: 'Ahmedabad', lng: 72.4636, lat: 23.0333, dispensers: 8, hours: ALWAYS_OPEN, low: 170, normal: 210 },
  // No station-specific config: platform defaults apply.
  { name: 'Vastrapur Lake CNG', address: 'Near Vastrapur Lake', city: 'Ahmedabad', lng: 72.5297, lat: 23.0395, dispensers: 4, hours: WEEKDAY_HOURS, low: null, normal: null },
  { name: 'Chandkheda Auto Gas', address: 'New CG Road, Chandkheda', city: 'Ahmedabad', lng: 72.5849, lat: 23.1049, dispensers: 5, hours: WEEKDAY_HOURS, low: 155, normal: 200 },
  { name: 'Naroda GIDC CNG', address: 'GIDC Estate, Naroda', city: 'Ahmedabad', lng: 72.6567, lat: 23.0742, dispensers: 2, hours: WEEKDAY_HOURS, low: 145, normal: 190 },
  { name: 'SG Highway Express CNG', address: 'SG Highway, Thaltej', city: 'Ahmedabad', lng: 72.5169, lat: 23.0525, dispensers: 10, hours: ALWAYS_OPEN, low: 175, normal: 215 },
  { name: 'Gandhinagar Sector 21 CNG', address: 'Sector 21, Gandhinagar', city: 'Gandhinagar', lng: 72.6369, lat: 23.2156, dispensers: 4, hours: WEEKDAY_HOURS, low: 160, normal: 200 },
  // Closed for refurbishment — exercises the inactive-station path.
  { name: 'Kalupur Station Road CNG', address: 'Opposite Kalupur Railway Station', city: 'Ahmedabad', lng: 72.6011, lat: 23.0276, dispensers: 3, hours: WEEKDAY_HOURS, low: 150, normal: 195, active: false },
];

const USER_NAMES = [
  'Kiran Mehta', 'Priya Nair', 'Arjun Solanki', 'Neha Joshi', 'Vikram Rathod',
  'Sneha Trivedi', 'Imran Qureshi', 'Deepak Vaghela', 'Meera Bhatt',
];

async function main() {
  await connectDatabase();

  console.log('Clearing existing data...');
  await Promise.all([
    User.deleteMany({}),
    Station.deleteMany({}),
    Report.deleteMany({}),
    StationOperator.deleteMany({}),
    SavedStation.deleteMany({}),
    SupplyEvent.deleteMany({}),
    StationVisit.deleteMany({}),
    NotificationRule.deleteMany({}),
    NotificationEvent.deleteMany({}),
    PushSubscription.deleteMany({}),
    RefreshSession.deleteMany({}),
    AuditLog.deleteMany({}),
  ]);

  // Hashed once and reused: bcrypt is intentionally slow, and hashing 13 times
  // would dominate the seed's runtime for no benefit.
  const passwordHash = await hashPassword(SEED_PASSWORD);

  console.log('Seeding users...');
  const admin = await User.create({
    name: 'Anjali Desai',
    email: 'admin@qless.test',
    phone: '+919800000001',
    role: 'ADMIN',
    passwordHash,
  });

  const operators = await User.create([
    { name: 'Ramesh Patel', email: 'operator.navrangpura@qless.test', phone: '+919800000011', role: 'STATION_OPERATOR', passwordHash },
    { name: 'Suresh Chauhan', email: 'operator.bopal@qless.test', phone: '+919800000012', role: 'STATION_OPERATOR', passwordHash },
    { name: 'Farida Shaikh', email: 'operator.sghighway@qless.test', phone: '+919800000013', role: 'STATION_OPERATOR', passwordHash },
  ]);

  const users = await User.create(
    USER_NAMES.map((name, i) => ({
      name,
      email: `user${i + 1}@qless.test`,
      phone: `+9198000001${String(i + 1).padStart(2, '0')}`,
      role: 'USER',
      passwordHash,
      // Varied reputation so trust weighting has something to work with.
      reputation: {
        score: [88, 72, 55, 41, 95, 60, 50, 30, 78][i],
        totalReports: [64, 31, 12, 9, 120, 20, 5, 14, 40][i],
        verifiedReports: [58, 25, 7, 4, 115, 15, 3, 5, 35][i],
        rejectedReports: [2, 3, 3, 4, 1, 2, 1, 6, 2][i],
      },
    })),
  );

  console.log('Seeding stations...');
  const stations = await Station.create(
    STATIONS.map((s) => ({
      name: s.name,
      address: s.address,
      city: s.city,
      state: 'Gujarat',
      location: { type: 'Point', coordinates: [s.lng, s.lat] },
      numberOfDispensers: s.dispensers,
      operatingHours: s.hours,
      pressureThresholdLow: s.low,
      pressureThresholdNormal: s.normal,
      active: s.active !== false,
    })),
  );

  console.log('Seeding operator assignments...');
  await StationOperator.create([
    { user: operators[0]._id, station: stations[0]._id, role: 'MANAGER' },
    // The first operator also covers a second nearby station.
    { user: operators[0]._id, station: stations[4]._id, role: 'STAFF' },
    { user: operators[1]._id, station: stations[3]._id, role: 'MANAGER' },
    { user: operators[2]._id, station: stations[7]._id, role: 'MANAGER' },
    { user: operators[2]._id, station: stations[5]._id, role: 'STAFF' },
  ]);

  console.log('Seeding reports...');
  const queueReport = (stationIdx, userDoc, label, source, mins, verified) => {
    const parsed = parseQueueLabel(label);
    return {
      station: stations[stationIdx]._id,
      user: userDoc._id,
      kind: 'QUEUE',
      queueMin: parsed.min,
      queueMax: parsed.max,
      queueLabel: parsed.label,
      source,
      locationVerified: verified,
      distanceToStationM: verified ? 55 : null,
      createdAt: minutesAgo(mins),
    };
  };

  const availabilityReport = (stationIdx, userDoc, availability, source, mins, verified, dispensers = null) => ({
    station: stations[stationIdx]._id,
    user: userDoc._id,
    kind: 'AVAILABILITY',
    availability,
    activeDispensers: dispensers,
    source,
    locationVerified: verified,
    createdAt: minutesAgo(mins),
  });

  const pressureReport = (stationIdx, userDoc, value, source, mins, verified, unit = 'BAR') => ({
    station: stations[stationIdx]._id,
    user: userDoc._id,
    kind: 'PRESSURE',
    pressureValue: value,
    pressureUnit: unit,
    source,
    locationVerified: verified,
    createdAt: minutesAgo(mins),
  });

  await Report.insertMany([
    // Navrangpura — fresh, operator-backed, short queue.
    queueReport(0, operators[0], '0-3', 'OPERATOR', 3, true),
    availabilityReport(0, operators[0], 'AVAILABLE', 'OPERATOR', 3, true, 6),
    pressureReport(0, operators[0], 205, 'OPERATOR', 3, true),
    queueReport(0, users[0], '0-3', 'VERIFIED_NEARBY_USER', 6, true),

    // Satellite — recent user reports.
    queueReport(1, users[1], '4-7', 'VERIFIED_NEARBY_USER', 12, true),
    availabilityReport(1, users[1], 'AVAILABLE', 'VERIFIED_NEARBY_USER', 12, true),
    pressureReport(1, users[4], 2800, 'NORMAL_USER', 14, false, 'PSI'),

    // Maninagar — low supply, busier queue.
    queueReport(2, users[2], '8-15', 'NORMAL_USER', 20, false),
    availabilityReport(2, users[2], 'LOW_SUPPLY', 'NORMAL_USER', 20, false),
    pressureReport(2, users[3], 128, 'NORMAL_USER', 20, false),

    // Bopal — long queue but plenty of dispensers.
    queueReport(3, operators[1], '16-25', 'OPERATOR', 4, true),
    availabilityReport(3, operators[1], 'AVAILABLE', 'OPERATOR', 4, true, 8),
    pressureReport(3, operators[1], 212, 'OPERATOR', 4, true),

    // Vastrapur — an explicit "not sure": no queue row, only availability.
    availabilityReport(4, users[0], 'AVAILABLE', 'NORMAL_USER', 25, false),

    // Chandkheda — interrupted.
    availabilityReport(5, operators[2], 'TEMPORARILY_INTERRUPTED', 'OPERATOR', 18, true, 0),
    pressureReport(5, operators[2], 96, 'OPERATOR', 18, true),

    // Naroda — unavailable.
    queueReport(6, users[6], '0-3', 'VERIFIED_NEARBY_USER', 28, true),
    availabilityReport(6, users[6], 'UNAVAILABLE', 'VERIFIED_NEARBY_USER', 28, true),

    // SG Highway — very busy but well staffed.
    queueReport(7, operators[2], '25+', 'OPERATOR', 1, true),
    availabilityReport(7, operators[2], 'AVAILABLE', 'OPERATOR', 1, true, 10),
    pressureReport(7, operators[2], 220, 'OPERATOR', 1, true),

    // Gandhinagar — ageing data.
    queueReport(8, users[8], '0-3', 'NORMAL_USER', 26, false),
    availabilityReport(8, users[8], 'LOW_SUPPLY', 'NORMAL_USER', 26, false),
  ]);

  console.log('Seeding supply events...');
  await SupplyEvent.create([
    { station: stations[5]._id, reportedBy: operators[2]._id, type: 'TEMPORARY_INTERRUPTION', source: 'OPERATOR', note: 'Compressor tripped, engineer on site', startedAt: minutesAgo(20) },
    { station: stations[0]._id, reportedBy: operators[0]._id, type: 'SUPPLY_ARRIVED', source: 'OPERATOR', note: 'Tanker delivery completed', startedAt: hoursAgo(5), endedAt: hoursAgo(4) },
    { station: stations[9]._id, reportedBy: admin._id, type: 'MAINTENANCE_START', source: 'ADMIN', note: 'Closed for dispenser refurbishment', startedAt: daysAgo(6) },
  ]);

  console.log('Seeding visits...');
  await StationVisit.create([
    // Confirmed refuel — the only case where a wait is recorded.
    { user: users[0]._id, station: stations[0]._id, locationVerified: true, arrivedAt: hoursAgo(3), joinedQueueAt: hoursAgo(3), completedAt: hoursAgo(2), outcome: 'REFUELLED', observedWaitMinutes: 18 },
    // Ended, but the user gave up — leaving is NOT treated as success.
    { user: users[1]._id, station: stations[2]._id, locationVerified: true, arrivedAt: hoursAgo(4), joinedQueueAt: hoursAgo(4), completedAt: hoursAgo(3), outcome: 'ABANDONED_QUEUE' },
    // Still in progress.
    { user: users[4]._id, station: stations[7]._id, locationVerified: true, arrivedAt: minutesAgo(12), joinedQueueAt: minutesAgo(10) },
  ]);

  console.log('Seeding saved stations and alerts...');
  await SavedStation.create([
    { user: users[0]._id, station: stations[0]._id, label: 'Near home', sortOrder: 0 },
    { user: users[0]._id, station: stations[7]._id, label: 'On my commute', sortOrder: 1 },
    { user: users[1]._id, station: stations[1]._id, sortOrder: 0 },
    { user: users[2]._id, station: stations[3]._id, label: 'Highway stop', sortOrder: 0 },
  ]);

  await NotificationRule.create([
    { user: users[0]._id, station: stations[0]._id, requiredAvailability: ['AVAILABLE'], maxQueue: 7, maxWaitMinutes: 15, cooldownMinutes: 30 },
    { user: users[1]._id, station: stations[2]._id, requiredAvailability: ['AVAILABLE', 'LOW_SUPPLY'], maxQueue: 10, cooldownMinutes: 30 },
    { user: users[2]._id, station: stations[3]._id, requiredAvailability: ['AVAILABLE'], maxQueue: 25, minPressure: 200, cooldownMinutes: 30 },
  ]);

  await AuditLog.create([
    { adminUser: admin._id, action: 'STATION_DISABLED', entityType: 'Station', entityId: String(stations[9]._id), reason: 'Closed for dispenser refurbishment', before: { active: true }, after: { active: false }, createdAt: daysAgo(6) },
  ]);

  // Recompute so the derived status agrees with the seeded history. Stations
  // whose reports have aged out of the window correctly fall back to UNKNOWN.
  console.log('Recomputing station statuses...');
  for (const station of stations) {
    await stationStatusService.recompute(station._id);
  }

  const counts = {
    users: await User.countDocuments(),
    stations: await Station.countDocuments(),
    reports: await Report.countDocuments(),
    operatorAssignments: await StationOperator.countDocuments(),
    supplyEvents: await SupplyEvent.countDocuments(),
    visits: await StationVisit.countDocuments(),
    savedStations: await SavedStation.countDocuments(),
    notificationRules: await NotificationRule.countDocuments(),
    auditLogs: await AuditLog.countDocuments(),
  };

  console.log('Seed complete:', counts);
  console.log(`All seeded accounts share the password: ${SEED_PASSWORD}`);

  await disconnectDatabase();
}

main().catch(async (error) => {
  console.error('Seed failed:', error);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
