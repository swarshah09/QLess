/**
 * Seed data for local development and manual testing.
 *
 * Stations are placed at realistically spread coordinates across Ahmedabad so
 * distance-based discovery and sorting can actually be exercised. Statuses vary
 * deliberately across availability, queue, pressure, freshness and confidence
 * so the frontend has every state to render.
 *
 * The script is idempotent: fixed UUIDs plus upserts mean re-running it
 * refreshes rather than duplicates.
 */
import {
  Availability,
  Freshness,
  NotificationChannel,
  PressureStatus,
  PressureUnit,
  PrismaClient,
  ReportSource,
  RuleConditionState,
  StationOperatorRole,
  SupplyEventType,
  UserRole,
  VisitOutcome,
} from '@prisma/client';
import { stationStatusService } from '../src/services/stationStatus.service';
import { hashPassword } from '../src/utils/password';
import { bucketForRange } from '../src/utils/queue';

const prisma = new PrismaClient();

const minutesAgo = (minutes: number): Date => new Date(Date.now() - minutes * 60_000);
const hoursAgo = (hours: number): Date => minutesAgo(hours * 60);
const daysAgo = (days: number): Date => hoursAgo(days * 24);

/**
 * Deterministic v4-shaped UUIDs keep re-runs stable and make manual API testing
 * easy. `group` must be 8 hex characters.
 */
const id = (group: string, n: number): string =>
  `${group}-0000-4000-8000-${String(n).padStart(12, '0')}`;

const STATION_IDS = Array.from({ length: 10 }, (_, i) => id('57a71040', i + 1));
const ADMIN_ID = id('ad414000', 1);
const OPERATOR_IDS = Array.from({ length: 3 }, (_, i) => id('09e4a704', i + 1));
const USER_IDS = Array.from({ length: 9 }, (_, i) => id('05e40000', i + 1));

// ---------------------------------------------------------------------------
// Station definitions
// ---------------------------------------------------------------------------

const WEEKDAY_HOURS = {
  mon: [{ open: '06:00', close: '23:00' }],
  tue: [{ open: '06:00', close: '23:00' }],
  wed: [{ open: '06:00', close: '23:00' }],
  thu: [{ open: '06:00', close: '23:00' }],
  fri: [{ open: '06:00', close: '23:00' }],
  sat: [{ open: '06:00', close: '23:00' }],
  sun: [{ open: '07:00', close: '22:00' }],
};

const ALWAYS_OPEN = {
  mon: [{ open: '00:00', close: '23:59' }],
  tue: [{ open: '00:00', close: '23:59' }],
  wed: [{ open: '00:00', close: '23:59' }],
  thu: [{ open: '00:00', close: '23:59' }],
  fri: [{ open: '00:00', close: '23:59' }],
  sat: [{ open: '00:00', close: '23:59' }],
  sun: [{ open: '00:00', close: '23:59' }],
};

interface SeedStation {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  latitude: number;
  longitude: number;
  numberOfDispensers: number;
  active: boolean;
  operatingHours: object;
  pressureThresholdLow: number | null;
  pressureThresholdNormal: number | null;
}

const stations: SeedStation[] = [
  {
    id: STATION_IDS[0],
    name: 'Navrangpura CNG Station',
    address: 'Ashram Road, Navrangpura',
    city: 'Ahmedabad',
    state: 'Gujarat',
    pincode: '380009',
    latitude: 23.0365,
    longitude: 72.5611,
    numberOfDispensers: 6,
    active: true,
    operatingHours: ALWAYS_OPEN,
    pressureThresholdLow: 160,
    pressureThresholdNormal: 200,
  },
  {
    id: STATION_IDS[1],
    name: 'Satellite Gas Point',
    address: 'Jodhpur Cross Roads, Satellite',
    city: 'Ahmedabad',
    state: 'Gujarat',
    pincode: '380015',
    latitude: 23.0276,
    longitude: 72.5075,
    numberOfDispensers: 4,
    active: true,
    operatingHours: WEEKDAY_HOURS,
    pressureThresholdLow: 150,
    pressureThresholdNormal: 195,
  },
  {
    id: STATION_IDS[2],
    name: 'Maninagar Fuel Hub',
    address: 'Krishna Baug, Maninagar',
    city: 'Ahmedabad',
    state: 'Gujarat',
    pincode: '380008',
    latitude: 22.9967,
    longitude: 72.6027,
    numberOfDispensers: 3,
    active: true,
    operatingHours: WEEKDAY_HOURS,
    // Older equipment — deliberately lower thresholds than the platform default.
    pressureThresholdLow: 130,
    pressureThresholdNormal: 175,
  },
  {
    id: STATION_IDS[3],
    name: 'Bopal Highway CNG',
    address: 'Bopal-Ambli Road',
    city: 'Ahmedabad',
    state: 'Gujarat',
    pincode: '380058',
    latitude: 23.0333,
    longitude: 72.4636,
    numberOfDispensers: 8,
    active: true,
    operatingHours: ALWAYS_OPEN,
    pressureThresholdLow: 170,
    pressureThresholdNormal: 210,
  },
  {
    id: STATION_IDS[4],
    name: 'Vastrapur Lake CNG',
    address: 'Near Vastrapur Lake, Vastrapur',
    city: 'Ahmedabad',
    state: 'Gujarat',
    pincode: '380015',
    latitude: 23.0395,
    longitude: 72.5297,
    numberOfDispensers: 4,
    active: true,
    operatingHours: WEEKDAY_HOURS,
    // No station-specific config: platform defaults apply.
    pressureThresholdLow: null,
    pressureThresholdNormal: null,
  },
  {
    id: STATION_IDS[5],
    name: 'Chandkheda Auto Gas',
    address: 'New CG Road, Chandkheda',
    city: 'Ahmedabad',
    state: 'Gujarat',
    pincode: '382424',
    latitude: 23.1049,
    longitude: 72.5849,
    numberOfDispensers: 5,
    active: true,
    operatingHours: WEEKDAY_HOURS,
    pressureThresholdLow: 155,
    pressureThresholdNormal: 200,
  },
  {
    id: STATION_IDS[6],
    name: 'Naroda GIDC CNG',
    address: 'GIDC Estate, Naroda',
    city: 'Ahmedabad',
    state: 'Gujarat',
    pincode: '382330',
    latitude: 23.0742,
    longitude: 72.6567,
    numberOfDispensers: 2,
    active: true,
    operatingHours: WEEKDAY_HOURS,
    pressureThresholdLow: 145,
    pressureThresholdNormal: 190,
  },
  {
    id: STATION_IDS[7],
    name: 'SG Highway Express CNG',
    address: 'Sarkhej-Gandhinagar Highway, Thaltej',
    city: 'Ahmedabad',
    state: 'Gujarat',
    pincode: '380054',
    latitude: 23.0525,
    longitude: 72.5169,
    numberOfDispensers: 10,
    active: true,
    operatingHours: ALWAYS_OPEN,
    pressureThresholdLow: 175,
    pressureThresholdNormal: 215,
  },
  {
    id: STATION_IDS[8],
    name: 'Gandhinagar Sector 21 CNG',
    address: 'Sector 21, Gandhinagar',
    city: 'Gandhinagar',
    state: 'Gujarat',
    pincode: '382021',
    latitude: 23.2156,
    longitude: 72.6369,
    numberOfDispensers: 4,
    active: true,
    operatingHours: WEEKDAY_HOURS,
    pressureThresholdLow: 160,
    pressureThresholdNormal: 200,
  },
  {
    id: STATION_IDS[9],
    name: 'Kalupur Station Road CNG',
    address: 'Opposite Kalupur Railway Station',
    city: 'Ahmedabad',
    state: 'Gujarat',
    pincode: '380002',
    latitude: 23.0276,
    longitude: 72.6011,
    numberOfDispensers: 3,
    // Closed for refurbishment — exercises the inactive-station path.
    active: false,
    operatingHours: WEEKDAY_HOURS,
    pressureThresholdLow: 150,
    pressureThresholdNormal: 195,
  },
];

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

interface SeedUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
}

const admin: SeedUser = {
  id: ADMIN_ID,
  name: 'Anjali Desai',
  email: 'admin@qless.test',
  phone: '+919800000001',
  role: UserRole.ADMIN,
};

const operators: SeedUser[] = [
  {
    id: OPERATOR_IDS[0],
    name: 'Ramesh Patel',
    email: 'operator.navrangpura@qless.test',
    phone: '+919800000011',
    role: UserRole.STATION_OPERATOR,
  },
  {
    id: OPERATOR_IDS[1],
    name: 'Suresh Chauhan',
    email: 'operator.bopal@qless.test',
    phone: '+919800000012',
    role: UserRole.STATION_OPERATOR,
  },
  {
    id: OPERATOR_IDS[2],
    name: 'Farida Shaikh',
    email: 'operator.sghighway@qless.test',
    phone: '+919800000013',
    role: UserRole.STATION_OPERATOR,
  },
];

const normalUserNames = [
  'Kiran Mehta',
  'Priya Nair',
  'Arjun Solanki',
  'Neha Joshi',
  'Vikram Rathod',
  'Sneha Trivedi',
  'Imran Qureshi',
  'Deepak Vaghela',
  'Meera Bhatt',
];

const normalUsers: SeedUser[] = normalUserNames.map((name, i) => ({
  id: USER_IDS[i],
  name,
  email: `user${i + 1}@qless.test`,
  phone: `+9198000001${String(i + 1).padStart(2, '0')}`,
  role: UserRole.USER,
}));

const allUsers = [admin, ...operators, ...normalUsers];

// ---------------------------------------------------------------------------
// Station status definitions — deliberately varied
// ---------------------------------------------------------------------------

interface SeedStatus {
  stationIndex: number;
  availability: Availability;
  queueMin: number | null;
  queueMax: number | null;
  waitMin: number | null;
  waitMax: number | null;
  pressureValue: number | null;
  pressureStatus: PressureStatus;
  activeDispensers: number | null;
  confidence: number;
  freshness: Freshness;
  computedMinutesAgo: number;
  operatorUpdateMinutesAgo: number | null;
  userUpdateMinutesAgo: number | null;
}

const statuses: SeedStatus[] = [
  {
    stationIndex: 0,
    availability: Availability.AVAILABLE,
    queueMin: 0,
    queueMax: 3,
    waitMin: 2,
    waitMax: 6,
    pressureValue: 205,
    pressureStatus: PressureStatus.NORMAL,
    activeDispensers: 6,
    confidence: 92,
    freshness: Freshness.LIVE,
    computedMinutesAgo: 2,
    operatorUpdateMinutesAgo: 4,
    userUpdateMinutesAgo: 6,
  },
  {
    stationIndex: 1,
    availability: Availability.AVAILABLE,
    queueMin: 4,
    queueMax: 7,
    waitMin: 8,
    waitMax: 15,
    pressureValue: 188,
    pressureStatus: PressureStatus.NORMAL,
    activeDispensers: 3,
    confidence: 74,
    freshness: Freshness.RECENT,
    computedMinutesAgo: 18,
    operatorUpdateMinutesAgo: null,
    userUpdateMinutesAgo: 18,
  },
  {
    stationIndex: 2,
    availability: Availability.LOW_SUPPLY,
    queueMin: 8,
    queueMax: 15,
    waitMin: 20,
    waitMax: 35,
    pressureValue: 128,
    pressureStatus: PressureStatus.LOW,
    activeDispensers: 2,
    confidence: 61,
    freshness: Freshness.RECENT,
    computedMinutesAgo: 25,
    operatorUpdateMinutesAgo: 40,
    userUpdateMinutesAgo: 25,
  },
  {
    stationIndex: 3,
    availability: Availability.AVAILABLE,
    queueMin: 16,
    queueMax: 25,
    waitMin: 30,
    waitMax: 50,
    pressureValue: 212,
    pressureStatus: PressureStatus.NORMAL,
    activeDispensers: 8,
    confidence: 88,
    freshness: Freshness.LIVE,
    computedMinutesAgo: 5,
    operatorUpdateMinutesAgo: 5,
    userUpdateMinutesAgo: 12,
  },
  {
    stationIndex: 4,
    // Genuinely unknown queue: both bounds stay null, never 0.
    availability: Availability.UNKNOWN,
    queueMin: null,
    queueMax: null,
    waitMin: null,
    waitMax: null,
    pressureValue: null,
    pressureStatus: PressureStatus.UNKNOWN,
    activeDispensers: null,
    confidence: 12,
    freshness: Freshness.EXPIRED,
    computedMinutesAgo: 200,
    operatorUpdateMinutesAgo: null,
    userUpdateMinutesAgo: 260,
  },
  {
    stationIndex: 5,
    availability: Availability.TEMPORARILY_INTERRUPTED,
    queueMin: 4,
    queueMax: 7,
    waitMin: null,
    waitMax: null,
    pressureValue: 96,
    pressureStatus: PressureStatus.CRITICAL,
    activeDispensers: 0,
    confidence: 68,
    freshness: Freshness.RECENT,
    computedMinutesAgo: 22,
    operatorUpdateMinutesAgo: 22,
    userUpdateMinutesAgo: 34,
  },
  {
    stationIndex: 6,
    availability: Availability.UNAVAILABLE,
    queueMin: 0,
    queueMax: 3,
    waitMin: null,
    waitMax: null,
    pressureValue: 0,
    pressureStatus: PressureStatus.CRITICAL,
    activeDispensers: 0,
    confidence: 55,
    freshness: Freshness.STALE,
    computedMinutesAgo: 75,
    operatorUpdateMinutesAgo: null,
    userUpdateMinutesAgo: 75,
  },
  {
    stationIndex: 7,
    availability: Availability.AVAILABLE,
    queueMin: 26,
    queueMax: 40,
    waitMin: 45,
    waitMax: 70,
    pressureValue: 220,
    pressureStatus: PressureStatus.NORMAL,
    activeDispensers: 10,
    confidence: 95,
    freshness: Freshness.LIVE,
    computedMinutesAgo: 1,
    operatorUpdateMinutesAgo: 1,
    userUpdateMinutesAgo: 3,
  },
  {
    stationIndex: 8,
    availability: Availability.LOW_SUPPLY,
    queueMin: 0,
    queueMax: 3,
    waitMin: 3,
    waitMax: 9,
    pressureValue: 158,
    pressureStatus: PressureStatus.LOW,
    activeDispensers: 2,
    confidence: 47,
    freshness: Freshness.STALE,
    computedMinutesAgo: 95,
    operatorUpdateMinutesAgo: null,
    userUpdateMinutesAgo: 95,
  },
  {
    stationIndex: 9,
    availability: Availability.UNAVAILABLE,
    queueMin: null,
    queueMax: null,
    waitMin: null,
    waitMax: null,
    pressureValue: null,
    pressureStatus: PressureStatus.UNKNOWN,
    activeDispensers: 0,
    confidence: 30,
    freshness: Freshness.EXPIRED,
    computedMinutesAgo: 600,
    operatorUpdateMinutesAgo: 600,
    userUpdateMinutesAgo: null,
  },
];

// ---------------------------------------------------------------------------
// Seed execution
// ---------------------------------------------------------------------------

async function clearSeededData(): Promise<void> {
  // Ordered to respect foreign keys, deepest dependents first.
  await prisma.notificationEvent.deleteMany();
  await prisma.notificationRule.deleteMany();
  await prisma.pushSubscription.deleteMany();
  await prisma.savedStation.deleteMany();
  await prisma.stationVisit.deleteMany();
  await prisma.queueReport.deleteMany();
  await prisma.availabilityReport.deleteMany();
  await prisma.pressureReport.deleteMany();
  await prisma.supplyEvent.deleteMany();
  await prisma.stationHistoricalMetric.deleteMany();
  await prisma.stationStatus.deleteMany();
  await prisma.stationOperator.deleteMany();
  await prisma.adminAuditLog.deleteMany();
  await prisma.reporterReputation.deleteMany();
  await prisma.station.deleteMany();
  await prisma.user.deleteMany();
}

/**
 * Shared password for every seeded account. Development convenience only — the
 * seed never runs against production, and these accounts all use @qless.test
 * addresses.
 */
const SEED_PASSWORD = 'QLessDev#2026';

async function seedUsers(): Promise<void> {
  // Hashed once and reused: bcrypt at cost 12 is intentionally slow, and
  // hashing 13 times would dominate the seed's runtime for no benefit.
  const passwordHash = await hashPassword(SEED_PASSWORD);

  for (const user of allUsers) {
    await prisma.user.create({
      data: {
        ...user,
        passwordHash,
        emailVerifiedAt: daysAgo(30),
        lastLoginAt: hoursAgo(Math.floor(Math.random() * 48) + 1),
      },
    });
  }

  // Reputation varies so trust-weighted logic has something to work with later.
  const reputationSeeds = [
    { userId: normalUsers[0].id, score: 88, total: 64, verified: 58, rejected: 2 },
    { userId: normalUsers[1].id, score: 72, total: 31, verified: 25, rejected: 3 },
    { userId: normalUsers[2].id, score: 55, total: 12, verified: 7, rejected: 3 },
    { userId: normalUsers[3].id, score: 41, total: 9, verified: 4, rejected: 4 },
    { userId: normalUsers[4].id, score: 95, total: 120, verified: 115, rejected: 1 },
    { userId: operators[0].id, score: 99, total: 210, verified: 209, rejected: 0 },
  ];

  for (const rep of reputationSeeds) {
    await prisma.reporterReputation.create({
      data: {
        userId: rep.userId,
        score: rep.score,
        totalReports: rep.total,
        verifiedReports: rep.verified,
        rejectedReports: rep.rejected,
        lastReportAt: hoursAgo(3),
      },
    });
  }
}

async function seedStations(): Promise<void> {
  for (const station of stations) {
    await prisma.station.create({ data: station });
  }
}

async function seedOperatorAssignments(): Promise<void> {
  const assignments = [
    { userId: operators[0].id, stationIndex: 0, role: StationOperatorRole.MANAGER },
    // The first operator also covers a second nearby station.
    { userId: operators[0].id, stationIndex: 4, role: StationOperatorRole.STAFF },
    { userId: operators[1].id, stationIndex: 3, role: StationOperatorRole.MANAGER },
    { userId: operators[2].id, stationIndex: 7, role: StationOperatorRole.MANAGER },
    { userId: operators[2].id, stationIndex: 5, role: StationOperatorRole.STAFF },
  ];

  for (const a of assignments) {
    await prisma.stationOperator.create({
      data: {
        userId: a.userId,
        stationId: STATION_IDS[a.stationIndex],
        role: a.role,
        assignedAt: daysAgo(60),
      },
    });
  }
}

async function seedStatuses(): Promise<void> {
  for (const s of statuses) {
    const station = stations[s.stationIndex];
    await prisma.stationStatus.create({
      data: {
        stationId: station.id,
        availability: s.availability,
        queueMin: s.queueMin,
        queueMax: s.queueMax,
        queueBucket: bucketForRange({ min: s.queueMin, max: s.queueMax }),
        waitMin: s.waitMin,
        waitMax: s.waitMax,
        pressureValue: s.pressureValue,
        pressureUnit: PressureUnit.BAR,
        pressureStatus: s.pressureStatus,
        activeDispensers: s.activeDispensers,
        confidence: s.confidence,
        freshness: s.freshness,
        computedAt: minutesAgo(s.computedMinutesAgo),
        lastOperatorUpdateAt:
          s.operatorUpdateMinutesAgo === null ? null : minutesAgo(s.operatorUpdateMinutesAgo),
        lastUserUpdateAt:
          s.userUpdateMinutesAgo === null ? null : minutesAgo(s.userUpdateMinutesAgo),
      },
    });
  }
}

async function seedReports(): Promise<void> {
  const queueReports = [
    { stationIndex: 0, userIndex: 0, min: 1, max: 3, source: ReportSource.VERIFIED_NEARBY_USER, verified: true, mins: 6 },
    { stationIndex: 0, userIndex: 1, min: 2, max: 4, source: ReportSource.NORMAL_USER, verified: false, mins: 25 },
    { stationIndex: 1, userIndex: 2, min: 4, max: 7, source: ReportSource.VERIFIED_NEARBY_USER, verified: true, mins: 18 },
    { stationIndex: 2, userIndex: 3, min: 9, max: 14, source: ReportSource.NORMAL_USER, verified: false, mins: 25 },
    { stationIndex: 3, userIndex: 4, min: 18, max: 24, source: ReportSource.VERIFIED_NEARBY_USER, verified: true, mins: 12 },
    { stationIndex: 5, userIndex: 5, min: 5, max: 7, source: ReportSource.NORMAL_USER, verified: false, mins: 34 },
    { stationIndex: 6, userIndex: 6, min: 0, max: 2, source: ReportSource.VERIFIED_NEARBY_USER, verified: true, mins: 75 },
    { stationIndex: 7, userIndex: 7, min: 28, max: 38, source: ReportSource.VERIFIED_NEARBY_USER, verified: true, mins: 3 },
    { stationIndex: 8, userIndex: 8, min: 1, max: 3, source: ReportSource.NORMAL_USER, verified: false, mins: 95 },
    // An explicit "I don't know" report: both bounds null, NOT zero.
    { stationIndex: 4, userIndex: 0, min: null, max: null, source: ReportSource.NORMAL_USER, verified: false, mins: 260 },
  ];

  for (const r of queueReports) {
    const station = stations[r.stationIndex];
    await prisma.queueReport.create({
      data: {
        stationId: station.id,
        userId: normalUsers[r.userIndex].id,
        queueMin: r.min,
        queueMax: r.max,
        queueBucket: bucketForRange({ min: r.min, max: r.max }),
        source: r.source,
        locationVerified: r.verified,
        reportedLatitude: r.verified ? station.latitude + 0.0004 : null,
        reportedLongitude: r.verified ? station.longitude - 0.0003 : null,
        distanceToStationM: r.verified ? 55 : null,
        createdAt: minutesAgo(r.mins),
      },
    });
  }

  // Operator-sourced queue reports for the stations that have operators.
  const operatorQueueReports = [
    { stationIndex: 0, operatorIndex: 0, min: 0, max: 3, mins: 4 },
    { stationIndex: 3, operatorIndex: 1, min: 16, max: 25, mins: 5 },
    { stationIndex: 7, operatorIndex: 2, min: 26, max: 40, mins: 1 },
  ];

  for (const r of operatorQueueReports) {
    await prisma.queueReport.create({
      data: {
        stationId: STATION_IDS[r.stationIndex],
        userId: operators[r.operatorIndex].id,
        queueMin: r.min,
        queueMax: r.max,
        queueBucket: bucketForRange({ min: r.min, max: r.max }),
        source: ReportSource.OPERATOR,
        locationVerified: true,
        createdAt: minutesAgo(r.mins),
      },
    });
  }

  const availabilityReports = [
    { stationIndex: 0, reporter: operators[0].id, availability: Availability.AVAILABLE, source: ReportSource.OPERATOR, verified: true, mins: 4 },
    { stationIndex: 1, reporter: normalUsers[2].id, availability: Availability.AVAILABLE, source: ReportSource.VERIFIED_NEARBY_USER, verified: true, mins: 18 },
    { stationIndex: 2, reporter: normalUsers[3].id, availability: Availability.LOW_SUPPLY, source: ReportSource.NORMAL_USER, verified: false, mins: 25 },
    { stationIndex: 3, reporter: operators[1].id, availability: Availability.AVAILABLE, source: ReportSource.OPERATOR, verified: true, mins: 5 },
    { stationIndex: 5, reporter: operators[2].id, availability: Availability.TEMPORARILY_INTERRUPTED, source: ReportSource.OPERATOR, verified: true, mins: 22 },
    { stationIndex: 6, reporter: normalUsers[6].id, availability: Availability.UNAVAILABLE, source: ReportSource.VERIFIED_NEARBY_USER, verified: true, mins: 75 },
    { stationIndex: 7, reporter: operators[2].id, availability: Availability.AVAILABLE, source: ReportSource.OPERATOR, verified: true, mins: 1 },
    { stationIndex: 8, reporter: normalUsers[8].id, availability: Availability.LOW_SUPPLY, source: ReportSource.NORMAL_USER, verified: false, mins: 95 },
    { stationIndex: 9, reporter: admin.id, availability: Availability.UNAVAILABLE, source: ReportSource.ADMIN, verified: false, mins: 600 },
  ];

  for (const r of availabilityReports) {
    const station = stations[r.stationIndex];
    await prisma.availabilityReport.create({
      data: {
        stationId: station.id,
        userId: r.reporter,
        availability: r.availability,
        source: r.source,
        locationVerified: r.verified,
        reportedLatitude: r.verified ? station.latitude - 0.0002 : null,
        reportedLongitude: r.verified ? station.longitude + 0.0005 : null,
        distanceToStationM: r.verified ? 70 : null,
        createdAt: minutesAgo(r.mins),
      },
    });
  }

  const pressureReports: Array<{
    stationIndex: number;
    reporter: string;
    value: number;
    source: ReportSource;
    verified: boolean;
    mins: number;
    unit?: PressureUnit;
  }> = [
    { stationIndex: 0, reporter: operators[0].id, value: 205, source: ReportSource.OPERATOR, verified: true, mins: 4 },
    { stationIndex: 1, reporter: normalUsers[1].id, value: 188, source: ReportSource.VERIFIED_NEARBY_USER, verified: true, mins: 18 },
    { stationIndex: 2, reporter: normalUsers[3].id, value: 128, source: ReportSource.NORMAL_USER, verified: false, mins: 25 },
    { stationIndex: 3, reporter: operators[1].id, value: 212, source: ReportSource.OPERATOR, verified: true, mins: 5 },
    { stationIndex: 5, reporter: operators[2].id, value: 96, source: ReportSource.OPERATOR, verified: true, mins: 22 },
    { stationIndex: 6, reporter: normalUsers[6].id, value: 0, source: ReportSource.VERIFIED_NEARBY_USER, verified: true, mins: 75 },
    { stationIndex: 7, reporter: operators[2].id, value: 220, source: ReportSource.OPERATOR, verified: true, mins: 1 },
    { stationIndex: 8, reporter: normalUsers[8].id, value: 158, source: ReportSource.NORMAL_USER, verified: false, mins: 95 },
    // Reported in PSI to exercise unit conversion (~193 bar).
    { stationIndex: 1, reporter: normalUsers[4].id, value: 2800, source: ReportSource.NORMAL_USER, verified: false, mins: 120, unit: PressureUnit.PSI },
  ];

  for (const r of pressureReports) {
    const station = stations[r.stationIndex];
    await prisma.pressureReport.create({
      data: {
        stationId: station.id,
        userId: r.reporter,
        pressureValue: r.value,
        pressureUnit: r.unit ?? PressureUnit.BAR,
        source: r.source,
        locationVerified: r.verified,
        reportedLatitude: r.verified ? station.latitude : null,
        reportedLongitude: r.verified ? station.longitude : null,
        distanceToStationM: r.verified ? 30 : null,
        createdAt: minutesAgo(r.mins),
      },
    });
  }
}

async function seedSupplyEvents(): Promise<void> {
  await prisma.supplyEvent.create({
    data: {
      stationId: STATION_IDS[5],
      reportedByUserId: operators[2].id,
      type: SupplyEventType.TEMPORARY_INTERRUPTION,
      source: ReportSource.OPERATOR,
      note: 'Compressor tripped, engineer on site',
      startedAt: minutesAgo(30),
    },
  });

  await prisma.supplyEvent.create({
    data: {
      stationId: STATION_IDS[0],
      reportedByUserId: operators[0].id,
      type: SupplyEventType.SUPPLY_ARRIVED,
      source: ReportSource.OPERATOR,
      note: 'Tanker delivery completed',
      startedAt: hoursAgo(5),
      endedAt: hoursAgo(4),
    },
  });

  await prisma.supplyEvent.create({
    data: {
      stationId: STATION_IDS[9],
      reportedByUserId: admin.id,
      type: SupplyEventType.MAINTENANCE_START,
      source: ReportSource.ADMIN,
      note: 'Station closed for dispenser refurbishment',
      startedAt: daysAgo(6),
    },
  });
}

async function seedVisits(): Promise<void> {
  const visits = [
    // Completed and confirmed as an actual refuel.
    { userIndex: 0, stationIndex: 0, arrived: 180, joined: 178, completed: 160, outcome: VisitOutcome.REFUELLED, wait: 18 },
    // Ended, but the user gave up — leaving is NOT treated as success.
    { userIndex: 1, stationIndex: 2, arrived: 240, joined: 238, completed: 205, outcome: VisitOutcome.ABANDONED_QUEUE, wait: null },
    // Ended with no outcome established yet.
    { userIndex: 2, stationIndex: 3, arrived: 300, joined: 295, completed: 250, outcome: VisitOutcome.UNKNOWN, wait: null },
    { userIndex: 3, stationIndex: 6, arrived: 90, joined: null, completed: 85, outcome: VisitOutcome.STATION_UNAVAILABLE, wait: null },
    // Still in progress.
    { userIndex: 4, stationIndex: 7, arrived: 12, joined: 10, completed: null, outcome: VisitOutcome.UNKNOWN, wait: null },
  ];

  for (const v of visits) {
    await prisma.stationVisit.create({
      data: {
        userId: normalUsers[v.userIndex].id,
        stationId: STATION_IDS[v.stationIndex],
        locationVerified: true,
        arrivedAt: minutesAgo(v.arrived),
        joinedQueueAt: v.joined === null ? null : minutesAgo(v.joined),
        completedAt: v.completed === null ? null : minutesAgo(v.completed),
        outcome: v.outcome,
        observedWaitMinutes: v.wait,
        createdAt: minutesAgo(v.arrived),
      },
    });
  }
}

async function seedSavedStations(): Promise<void> {
  const saved = [
    { userIndex: 0, stationIndex: 0, label: 'Near home', order: 0 },
    { userIndex: 0, stationIndex: 7, label: 'On my commute', order: 1 },
    { userIndex: 1, stationIndex: 1, label: null, order: 0 },
    { userIndex: 1, stationIndex: 4, label: 'Backup', order: 1 },
    { userIndex: 2, stationIndex: 3, label: 'Highway stop', order: 0 },
    { userIndex: 4, stationIndex: 7, label: null, order: 0 },
    { userIndex: 5, stationIndex: 5, label: 'Office', order: 0 },
    { userIndex: 8, stationIndex: 8, label: 'Gandhinagar trips', order: 0 },
  ];

  for (const s of saved) {
    await prisma.savedStation.create({
      data: {
        userId: normalUsers[s.userIndex].id,
        stationId: STATION_IDS[s.stationIndex],
        label: s.label,
        sortOrder: s.order,
      },
    });
  }
}

async function seedNotificationRules(): Promise<void> {
  const rules = [
    {
      userIndex: 0,
      stationIndex: 0,
      requiredAvailability: [Availability.AVAILABLE],
      maxQueue: 7,
      maxWait: 15,
      minPressure: 190,
      state: RuleConditionState.MET,
      lastTriggeredMinsAgo: 45,
      cooldownMinsFromNow: null,
    },
    {
      userIndex: 0,
      stationIndex: 7,
      requiredAvailability: [Availability.AVAILABLE],
      maxQueue: 15,
      maxWait: 25,
      minPressure: null,
      state: RuleConditionState.UNMET,
      lastTriggeredMinsAgo: null,
      cooldownMinsFromNow: null,
    },
    {
      userIndex: 1,
      stationIndex: 2,
      requiredAvailability: [Availability.AVAILABLE, Availability.LOW_SUPPLY],
      maxQueue: 10,
      maxWait: 30,
      minPressure: 140,
      state: RuleConditionState.UNMET,
      lastTriggeredMinsAgo: 600,
      cooldownMinsFromNow: null,
    },
    {
      // Recently fired and currently cooling down.
      userIndex: 2,
      stationIndex: 3,
      requiredAvailability: [Availability.AVAILABLE],
      maxQueue: 25,
      maxWait: 60,
      minPressure: 200,
      state: RuleConditionState.MET,
      lastTriggeredMinsAgo: 5,
      cooldownMinsFromNow: 25,
    },
    {
      userIndex: 4,
      stationIndex: 5,
      requiredAvailability: [Availability.AVAILABLE],
      maxQueue: null,
      maxWait: null,
      minPressure: null,
      state: RuleConditionState.UNKNOWN,
      lastTriggeredMinsAgo: null,
      cooldownMinsFromNow: null,
    },
  ];

  for (const r of rules) {
    await prisma.notificationRule.create({
      data: {
        userId: normalUsers[r.userIndex].id,
        stationId: STATION_IDS[r.stationIndex],
        requiredAvailability: r.requiredAvailability,
        maxQueue: r.maxQueue,
        maxWaitMinutes: r.maxWait,
        minPressure: r.minPressure,
        pressureUnit: PressureUnit.BAR,
        channel: NotificationChannel.WEB_PUSH,
        enabled: true,
        currentConditionState: r.state,
        lastEvaluatedAt: minutesAgo(3),
        lastTriggeredAt:
          r.lastTriggeredMinsAgo === null ? null : minutesAgo(r.lastTriggeredMinsAgo),
        cooldownUntil:
          r.cooldownMinsFromNow === null
            ? null
            : new Date(Date.now() + r.cooldownMinsFromNow * 60_000),
      },
    });
  }
}

async function seedPushSubscriptions(): Promise<void> {
  const subscribers = [0, 1, 2, 4];
  for (const i of subscribers) {
    await prisma.pushSubscription.create({
      data: {
        userId: normalUsers[i].id,
        endpoint: `https://fcm.googleapis.com/fcm/send/seed-endpoint-${i + 1}`,
        p256dh: `seed-p256dh-key-${i + 1}`,
        auth: `seed-auth-secret-${i + 1}`,
        userAgent: 'Mozilla/5.0 (seed) Chrome/120.0 Mobile',
        active: true,
        lastUsedAt: hoursAgo(2),
      },
    });
  }
}

async function seedAuditLog(): Promise<void> {
  await prisma.adminAuditLog.create({
    data: {
      adminUserId: admin.id,
      action: 'STATION_DEACTIVATED',
      entityType: 'Station',
      entityId: STATION_IDS[9],
      before: { active: true },
      after: { active: false },
      ipAddress: '203.0.113.42',
      userAgent: 'Mozilla/5.0 (seed admin console)',
      createdAt: daysAgo(6),
    },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminUserId: admin.id,
      action: 'OPERATOR_ASSIGNED',
      entityType: 'StationOperator',
      entityId: STATION_IDS[7],
      after: { userId: operators[2].id, role: 'MANAGER' },
      ipAddress: '203.0.113.42',
      createdAt: daysAgo(60),
    },
  });
}

async function main(): Promise<void> {
  console.info('Clearing existing data...');
  await clearSeededData();

  console.info('Seeding users...');
  await seedUsers();

  console.info('Seeding stations...');
  await seedStations();

  console.info('Seeding operator assignments...');
  await seedOperatorAssignments();

  console.info('Seeding baseline station statuses...');
  await seedStatuses();

  console.info('Seeding raw reports...');
  await seedReports();

  console.info('Seeding supply events...');
  await seedSupplyEvents();

  // Recompute from the seeded reports so the derived status actually agrees
  // with the history behind it. Stations whose only reports have aged out of
  // the input window correctly fall back to UNKNOWN rather than keeping a
  // stale hand-written value.
  console.info('Recomputing station statuses from seeded reports...');
  for (const station of stations) {
    await stationStatusService.recompute(station.id);
  }

  console.info('Seeding station visits...');
  await seedVisits();

  console.info('Seeding saved stations...');
  await seedSavedStations();

  console.info('Seeding notification rules...');
  await seedNotificationRules();

  console.info('Seeding push subscriptions...');
  await seedPushSubscriptions();

  console.info('Seeding admin audit log...');
  await seedAuditLog();

  const counts = {
    users: await prisma.user.count(),
    stations: await prisma.station.count(),
    stationOperators: await prisma.stationOperator.count(),
    stationStatuses: await prisma.stationStatus.count(),
    queueReports: await prisma.queueReport.count(),
    availabilityReports: await prisma.availabilityReport.count(),
    pressureReports: await prisma.pressureReport.count(),
    supplyEvents: await prisma.supplyEvent.count(),
    stationVisits: await prisma.stationVisit.count(),
    savedStations: await prisma.savedStation.count(),
    notificationRules: await prisma.notificationRule.count(),
    pushSubscriptions: await prisma.pushSubscription.count(),
    reporterReputations: await prisma.reporterReputation.count(),
    adminAuditLogs: await prisma.adminAuditLog.count(),
  };

  console.info('Seed complete:', counts);
  console.info(`All seeded accounts share the password: ${SEED_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
