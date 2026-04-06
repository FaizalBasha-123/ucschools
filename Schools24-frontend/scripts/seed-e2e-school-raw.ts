type SeedClass = { name: string; sort_order: number }
type SeedSubject = { name: string; code: string }

type LoginResponse = {
  access_token: string
  refresh_token?: string
  expires_in: number
  user?: { role?: string }
}

type School = { id: string; name: string; code?: string }
type CatalogClass = { id: string; name: string; sort_order: number }
type CatalogSubject = { id: string; name: string; code: string }

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

const normalize = (value: string) => value.trim().toLowerCase()

const normalizeApiBase = (raw: string) => {
  const trimmed = (raw || '').trim().replace(/\/+$/, '')
  if (!trimmed) return 'http://localhost:8000/api/v1'
  return trimmed.endsWith('/api/v1') ? trimmed : `${trimmed}/api/v1`
}

function getEnv(name: (typeof REQUIRED_ENV)[number]): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required env var: ${name}`)
  }
  return value
}

async function request<T>(
  apiBase: string,
  method: string,
  endpoint: string,
  token?: string,
  body?: unknown
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(`${apiBase}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await response.text()
  const data = text ? JSON.parse(text) : {}

  if (!response.ok) {
    const message = data?.message || data?.error || `HTTP ${response.status}`
    throw new Error(`${method} ${endpoint} failed: ${message}`)
  }

  return data as T
}

async function login(apiBase: string, email: string, password: string): Promise<string> {
  const response = await request<LoginResponse>(apiBase, 'POST', '/auth/login', undefined, {
    email,
    password,
    remember_me: false,
  })

  if (!response.access_token) {
    throw new Error('Login succeeded without access token')
  }
  return response.access_token
}

async function ensureGlobalAcademicYear(apiBase: string, token: string, academicYear: string) {
  const settings = await request<{ current_academic_year?: string }>(apiBase, 'GET', '/super-admin/settings/global', token)
  if ((settings.current_academic_year || '').trim() === academicYear) {
    return
  }
  await request(apiBase, 'PUT', '/super-admin/settings/global', token, { current_academic_year: academicYear })
}

async function ensureCatalogClasses(apiBase: string, token: string): Promise<CatalogClass[]> {
  let current = await request<{ classes: CatalogClass[] }>(apiBase, 'GET', '/super-admin/catalog/classes', token)
  const existing = new Map(current.classes.map((item) => [normalize(item.name), item]))

  for (const item of CATALOG_CLASSES) {
    if (existing.has(normalize(item.name))) {
      continue
    }
    await request(apiBase, 'POST', '/super-admin/catalog/classes', token, {
      name: item.name,
      sort_order: item.sort_order,
    })
  }

  current = await request<{ classes: CatalogClass[] }>(apiBase, 'GET', '/super-admin/catalog/classes', token)
  return current.classes
}

async function ensureCatalogSubjects(apiBase: string, token: string): Promise<CatalogSubject[]> {
  let current = await request<{ subjects: CatalogSubject[] }>(apiBase, 'GET', '/super-admin/catalog/subjects', token)
  const existing = new Map(current.subjects.map((item) => [normalize(item.code), item]))

  for (const item of CATALOG_SUBJECTS) {
    if (existing.has(normalize(item.code))) {
      continue
    }
    await request(apiBase, 'POST', '/super-admin/catalog/subjects', token, {
      name: item.name,
      code: item.code,
    })
  }

  current = await request<{ subjects: CatalogSubject[] }>(apiBase, 'GET', '/super-admin/catalog/subjects', token)
  return current.subjects
}

async function ensureAssignments(apiBase: string, token: string, classes: CatalogClass[], subjects: CatalogSubject[]) {
  const classByName = new Map(classes.map((item) => [normalize(item.name), item]))
  const subjectByCode = new Map(subjects.map((item) => [normalize(item.code), item]))

  for (const [className, codes] of Object.entries(CLASS_SUBJECT_CODES)) {
    const schoolClass = classByName.get(normalize(className))
    if (!schoolClass) {
      throw new Error(`Catalog class not found: ${className}`)
    }

    const subjectIds = codes.map((code) => {
      const subject = subjectByCode.get(normalize(code))
      if (!subject?.id) {
        throw new Error(`Catalog subject not found: ${code}`)
      }
      return subject.id
    })

    await request(apiBase, 'PUT', `/super-admin/catalog/classes/${schoolClass.id}/subjects`, token, {
      subject_ids: subjectIds,
    })
  }
}

async function ensureSchool(apiBase: string, token: string) {
  const schoolName = process.env.S24_SCHOOL_NAME!
  const schoolCode = process.env.S24_SCHOOL_CODE!
  const schoolAdminName = process.env.S24_SCHOOL_ADMIN_NAME || 'School Admin'
  const schoolAdminEmail = process.env.S24_SCHOOL_ADMIN_EMAIL!
  const schoolAdminPassword = process.env.S24_SCHOOL_ADMIN_PASSWORD!
  const schoolAddress = process.env.S24_SCHOOL_ADDRESS || 'Demo Campus, Main Road'
  const schoolContactEmail = process.env.S24_SCHOOL_CONTACT_EMAIL || schoolAdminEmail
  const superAdminPassword = process.env.S24_SUPER_ADMIN_PASSWORD!

  const schoolsResponse = await request<{ schools: School[] }>(apiBase, 'GET', '/super-admin/schools?page=1&page_size=100', token)
  const exists = schoolsResponse.schools.some((school) => {
    const sameName = normalize(school.name) === normalize(schoolName)
    const sameCode = school.code && normalize(school.code) === normalize(schoolCode)
    return sameName || sameCode
  })

  if (exists) {
    return
  }

  // Payload shape mirrors frontend useCreateSchool -> /super-admin/schools
  await request(apiBase, 'POST', '/super-admin/schools', token, {
    name: schoolName,
    code: schoolCode,
    address: schoolAddress,
    contact_email: schoolContactEmail,
    admins: [
      {
        name: schoolAdminName,
        email: schoolAdminEmail,
        password: schoolAdminPassword,
      },
    ],
    password: superAdminPassword,
  })
}

async function main() {
  for (const key of REQUIRED_ENV) {
    getEnv(key)
  }

  const apiBase = normalizeApiBase(process.env.S24_API_URL!)
  const superAdminEmail = process.env.S24_SUPER_ADMIN_EMAIL!
  const superAdminPassword = process.env.S24_SUPER_ADMIN_PASSWORD!
  const academicYear = process.env.S24_ACADEMIC_YEAR || '2025-2026'

  console.log('Seeding via raw backend endpoints started...')
  const token = await login(apiBase, superAdminEmail, superAdminPassword)

  await ensureGlobalAcademicYear(apiBase, token, academicYear)
  console.log(`Global academic year ensured: ${academicYear}`)

  const classes = await ensureCatalogClasses(apiBase, token)
  console.log(`Catalog classes ensured: ${classes.length}`)

  const subjects = await ensureCatalogSubjects(apiBase, token)
  console.log(`Catalog subjects ensured: ${subjects.length}`)

  await ensureAssignments(apiBase, token, classes, subjects)
  console.log('Catalog assignments ensured')

  await ensureSchool(apiBase, token)
  console.log(`School ensured: ${process.env.S24_SCHOOL_NAME}`)

  console.log('Raw endpoint seeding completed successfully.')
}

main().catch((error) => {
  console.error('Raw seeding failed:', error)
  process.exitCode = 1
})
