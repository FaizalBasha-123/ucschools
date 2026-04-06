const normalizeSection = (value?: string | null) => (value || "").trim().toUpperCase().replace(/[^A-Z]/g, "")

const sectionToNumber = (label?: string | null) => {
    const normalized = normalizeSection(label)
    if (!normalized) return Number.MAX_SAFE_INTEGER
    let num = 0
    for (const char of normalized) {
        num = num * 26 + (char.charCodeAt(0) - 64)
    }
    return num
}

const parseGradeFromLabel = (label?: string | null) => {
    const raw = (label || "").trim().toUpperCase()
    if (!raw) return Number.MAX_SAFE_INTEGER
    if (raw === "LKG" || raw.startsWith("LKG-") || raw.startsWith("LKG ")) return -1
    if (raw === "UKG" || raw.startsWith("UKG-") || raw.startsWith("UKG ")) return 0

    const match = raw.match(/(?:CLASS\s*)?(\d+)/i)
    if (!match) return Number.MAX_SAFE_INTEGER
    const parsed = parseInt(match[1], 10)
    return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed
}

const parseSectionFromLabel = (label?: string | null) => {
    const raw = (label || "").trim().toUpperCase()
    if (!raw) return ""
    const suffixMatch = raw.match(/(?:CLASS\s*)?\d+\s*[- ]\s*([A-Z]+)$/i)
    if (suffixMatch?.[1]) return suffixMatch[1]
    const kgMatch = raw.match(/(?:LKG|UKG)\s*[- ]\s*([A-Z]+)$/i)
    if (kgMatch?.[1]) return kgMatch[1]
    return ""
}

export const compareClassLabels = (a?: string | null, b?: string | null) => {
    const gradeA = parseGradeFromLabel(a)
    const gradeB = parseGradeFromLabel(b)
    if (gradeA !== gradeB) return gradeA - gradeB

    const sectionA = sectionToNumber(parseSectionFromLabel(a))
    const sectionB = sectionToNumber(parseSectionFromLabel(b))
    if (sectionA !== sectionB) return sectionA - sectionB

    return (a || "").localeCompare(b || "")
}

export const sortClassLabels = <T extends string>(labels: T[]) => [...labels].sort((a, b) => compareClassLabels(a, b))

export const sortSchoolClasses = <T extends { grade?: number | null; section?: string | null; name?: string | null }>(classes: T[]) =>
    [...classes].sort((a, b) => {
        const gradeA = typeof a.grade === "number" ? a.grade : parseGradeFromLabel(a.name)
        const gradeB = typeof b.grade === "number" ? b.grade : parseGradeFromLabel(b.name)
        if (gradeA !== gradeB) return gradeA - gradeB

        const sectionA = sectionToNumber(a.section || parseSectionFromLabel(a.name))
        const sectionB = sectionToNumber(b.section || parseSectionFromLabel(b.name))
        if (sectionA !== sectionB) return sectionA - sectionB

        return (a.name || "").localeCompare(b.name || "")
    })

export const sortTeacherClassRows = <T extends { class_name?: string | null }>(rows: T[]) =>
    [...rows].sort((a, b) => compareClassLabels(a.class_name, b.class_name))

export const formatSchoolClassLabel = (cls: { name?: string | null; grade?: number | null; section?: string | null }) => {
    const rawName = (cls.name || "").trim()
    let baseName = rawName

    if (!baseName) {
        if (typeof cls.grade === "number") {
            if (cls.grade === -1) baseName = "LKG"
            else if (cls.grade === 0) baseName = "UKG"
            else baseName = `Class ${cls.grade}`
        } else {
            baseName = "Class"
        }
    }

    const section = (cls.section || "").trim()
    if (!section) return baseName

    const upperBase = baseName.toUpperCase()
    const upperSection = section.toUpperCase()
    if (
        upperBase.endsWith(`-${upperSection}`) ||
        upperBase.endsWith(` ${upperSection}`) ||
        upperBase === upperSection
    ) {
        return baseName
    }

    return `${baseName}-${section}`
}

const normalizeClassKey = <T extends { grade?: number | null; section?: string | null; name?: string | null }>(cls: T) => {
    const grade =
        typeof cls.grade === "number"
            ? cls.grade
            : parseGradeFromLabel(cls.name)
    const section = normalizeSection(cls.section || parseSectionFromLabel(cls.name))
    const name = (cls.name || "").trim().toUpperCase()

    // For standard school classes, grade + section is the logical identity.
    // Class names can vary across academic years while still referring to the same class.
    if (grade !== Number.MAX_SAFE_INTEGER) {
        return `${grade}|${section}`
    }

    // For custom classes without a numeric grade, fall back to name-aware grouping.
    return `${grade}|${section}|${name}`
}

export const getSchoolClassGroupingKey = <T extends { grade?: number | null; section?: string | null; name?: string | null }>(cls: T) =>
    normalizeClassKey(cls)

const isAcademicYearNewer = (candidate?: string | null, current?: string | null) =>
    (candidate || "").localeCompare(current || "") > 0

export const collapseClassesForTimetable = <
    T extends { grade?: number | null; section?: string | null; name?: string | null; academic_year?: string | null }
>(
    classes: T[],
    preferredAcademicYear?: string | null
) => {
    const grouped = new Map<string, T>()

    for (const cls of classes) {
        const key = normalizeClassKey(cls)
        const current = grouped.get(key)
        if (!current) {
            grouped.set(key, cls)
            continue
        }

        const currentPreferred = (current.academic_year || "") === (preferredAcademicYear || "")
        const nextPreferred = (cls.academic_year || "") === (preferredAcademicYear || "")

        if (nextPreferred && !currentPreferred) {
            grouped.set(key, cls)
            continue
        }
        if (currentPreferred && !nextPreferred) {
            continue
        }
        if (isAcademicYearNewer(cls.academic_year, current.academic_year)) {
            grouped.set(key, cls)
        }
    }

    return sortSchoolClasses(Array.from(grouped.values()))
}

