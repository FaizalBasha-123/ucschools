import { createSDK } from './index'
import { CatalogClass, Subject } from './types'

type SeedClass = { name: string; sort_order: number }
type SeedSubject = { name: string; code: string }

type SeedConfig = {
  apiUrl: string
  superAdminEmail: string
  superAdminPassword: string
  schoolName: string
  schoolCode: string
  schoolAddress: string
  schoolContactEmail: string
  schoolAdminName: string
  schoolAdminEmail: string
  schoolAdminPassword: string
  academicYear: string
}

const REQUIRED_ENV = [
  'S24_API_URL',
  'S24_SUPER_ADMIN_EMAIL',
  'S24_SUPER_ADMIN_PASSWORD',
  'S24_SCHOOL_NAME',
  'S24_SCHOOL_CODE',
  'S24_SCHOOL_ADMIN_EMAIL',
  'S24_SCHOOL_ADMIN_PASSWORD',
] as const

const CATALOG_CLASSES: SeedClass[] = [
  { name: 'LKG', sort_order: 1 },
  { name: 'UKG', sort_order: 2 },
  { name: 'Class 1', sort_order: 3 },
  { name: 'Class 2', sort_order: 4 },
  { name: 'Class 3', sort_order: 5 },
  { name: 'Class 4', sort_order: 6 },
  { name: 'Class 5', sort_order: 7 },
  { name: 'Class 6', sort_order: 8 },
  { name: 'Class 7', sort_order: 9 },
  { name: 'Class 8', sort_order: 10 },
  { name: 'Class 9', sort_order: 11 },
  { name: 'Class 10', sort_order: 12 },
]

const CATALOG_SUBJECTS: SeedSubject[] = [
  { name: 'English', code: 'ENG' },
  { name: 'Hindi', code: 'HIN' },
  { name: 'Mathematics', code: 'MATH' },
  { name: 'Environmental Studies', code: 'EVS' },
  { name: 'Science', code: 'SCI' },
  { name: 'Social Studies', code: 'SST' },
  { name: 'Computer Science', code: 'CS' },
  { name: 'Art & Design', code: 'ART' },
  { name: 'General Knowledge', code: 'GK' },
  { name: 'Physical Education', code: 'PE' },
  { name: 'Sanskrit', code: 'SAN' },
  { name: 'Life Skills', code: 'LS' },
]

const CLASS_SUBJECT_CODES: Record<string, string[]> = {
  LKG: ['ENG', 'HIN', 'ART', 'GK', 'LS'],
  UKG: ['ENG', 'HIN', 'ART', 'GK', 'LS'],
  'Class 1': ['ENG', 'HIN', 'MATH', 'EVS', 'ART', 'GK'],
  'Class 2': ['ENG', 'HIN', 'MATH', 'EVS', 'CS', 'ART'],
  'Class 3': ['ENG', 'HIN', 'MATH', 'EVS', 'CS', 'PE'],
  'Class 4': ['ENG', 'HIN', 'MATH', 'SCI', 'SST', 'CS'],
  'Class 5': ['ENG', 'HIN', 'MATH', 'SCI', 'SST', 'CS'],
  'Class 6': ['ENG', 'HIN', 'MATH', 'SCI', 'SST', 'SAN', 'CS'],
  'Class 7': ['ENG', 'HIN', 'MATH', 'SCI', 'SST', 'SAN', 'CS'],
  'Class 8': ['ENG', 'HIN', 'MATH', 'SCI', 'SST', 'SAN', 'CS'],
  'Class 9': ['ENG', 'HIN', 'MATH', 'SCI', 'SST', 'CS', 'PE'],
  'Class 10': ['ENG', 'HIN', 'MATH', 'SCI', 'SST', 'CS', 'PE'],
}

const getConfigFromEnv = (): SeedConfig => {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key])
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`)
  }

  return {
    apiUrl: process.env.S24_API_URL!,
    superAdminEmail: process.env.S24_SUPER_ADMIN_EMAIL!,
    superAdminPassword: process.env.S24_SUPER_ADMIN_PASSWORD!,
    schoolName: process.env.S24_SCHOOL_NAME!,
    schoolCode: process.env.S24_SCHOOL_CODE!,
    schoolAddress: process.env.S24_SCHOOL_ADDRESS || 'Demo Campus, Main Road',
    schoolContactEmail: process.env.S24_SCHOOL_CONTACT_EMAIL || process.env.S24_SCHOOL_ADMIN_EMAIL!,
    schoolAdminName: process.env.S24_SCHOOL_ADMIN_NAME || 'School Admin',
    schoolAdminEmail: process.env.S24_SCHOOL_ADMIN_EMAIL!,
    schoolAdminPassword: process.env.S24_SCHOOL_ADMIN_PASSWORD!,
    academicYear: process.env.S24_ACADEMIC_YEAR || '2025-2026',
  }
}

const normalize = (value: string) => value.trim().toLowerCase()

const byName = <T extends { name: string }>(items: T[]) => {
  const map = new Map<string, T>()
  for (const item of items) {
    map.set(normalize(item.name), item)
  }
  return map
}

const byCode = <T extends { code?: string }>(items: T[]) => {
  const map = new Map<string, T>()
  for (const item of items) {
    if (item.code) {
      map.set(normalize(item.code), item)
    }
  }
  return map
}

async function ensureCatalogClasses(sdk: ReturnType<typeof createSDK>): Promise<CatalogClass[]> {
  let classes = await sdk.listCatalogClasses()
  const existing = byName(classes)

  for (const cls of CATALOG_CLASSES) {
    if (existing.has(normalize(cls.name))) {
      continue
    }
    await sdk.createCatalogClass(cls)
  }

  classes = await sdk.listCatalogClasses()
  return classes
}

async function ensureCatalogSubjects(sdk: ReturnType<typeof createSDK>): Promise<Subject[]> {
  let subjects = await sdk.listSubjects()
  const existingByCode = byCode(subjects)

  for (const subject of CATALOG_SUBJECTS) {
    if (existingByCode.has(normalize(subject.code))) {
      continue
    }
    await sdk.createSubject(subject)
  }

  subjects = await sdk.listSubjects()
  return subjects
}

async function ensureCatalogAssignments(
  sdk: ReturnType<typeof createSDK>,
  classes: CatalogClass[],
  subjects: Subject[]
): Promise<void> {
  const classMap = byName(classes)
  const subjectMap = byCode(subjects)

  for (const [className, subjectCodes] of Object.entries(CLASS_SUBJECT_CODES)) {
    const schoolClass = classMap.get(normalize(className))
    if (!schoolClass) {
      throw new Error(`Catalog class not found for assignments: ${className}`)
    }

    const subjectIds = subjectCodes.map((code) => {
      const subject = subjectMap.get(normalize(code))
      if (!subject?.id) {
        throw new Error(`Catalog subject not found for code: ${code}`)
      }
      return subject.id
    })

    await sdk.setCatalogClassSubjects(schoolClass.id, subjectIds)
  }
}

async function ensureGlobalAcademicYear(sdk: ReturnType<typeof createSDK>, academicYear: string): Promise<void> {
  const current = await sdk.getGlobalSettings().catch(() => ({ current_academic_year: '' }))
  if (current.current_academic_year === academicYear) {
    return
  }
  await sdk.updateGlobalSettings({ current_academic_year: academicYear })
}

async function ensureSchool(sdk: ReturnType<typeof createSDK>, config: SeedConfig): Promise<void> {
  const schools = await sdk.listSchools()
  const existing = schools.find((school) => {
    const sameCode = school.code && normalize(school.code) === normalize(config.schoolCode)
    const sameName = normalize(school.name) === normalize(config.schoolName)
    return sameCode || sameName
  })

  if (existing) {
    return
  }

  await sdk.createSchool({
    name: config.schoolName,
    code: config.schoolCode,
    address: config.schoolAddress,
    contact_email: config.schoolContactEmail,
    admins: [
      {
        name: config.schoolAdminName,
        email: config.schoolAdminEmail,
        password: config.schoolAdminPassword,
      },
    ],
    password: config.superAdminPassword,
  })
}

async function main() {
  const config = getConfigFromEnv()

  const sdk = createSDK({
    apiUrl: config.apiUrl,
    enableLogging: true,
    logFilePath: 'scripts/logs/seed-e2e-school.log',
    retryAttempts: 3,
    timeout: 30000,
  })

  console.log('Seeding started...')
  await sdk.login(config.superAdminEmail, config.superAdminPassword)

  await ensureGlobalAcademicYear(sdk, config.academicYear)
  console.log(`Global academic year ensured: ${config.academicYear}`)

  const classes = await ensureCatalogClasses(sdk)
  console.log(`Catalog classes ensured: ${classes.length}`)

  const subjects = await ensureCatalogSubjects(sdk)
  console.log(`Catalog subjects ensured: ${subjects.length}`)

  await ensureCatalogAssignments(sdk, classes, subjects)
  console.log('Catalog class-subject assignments ensured')

  await ensureSchool(sdk, config)
  console.log(`School ensured: ${config.schoolName}`)

  await sdk.logout()
  console.log('Seeding completed successfully.')
}

main().catch((error) => {
  console.error('Seed failed:', error)
  process.exitCode = 1
})
