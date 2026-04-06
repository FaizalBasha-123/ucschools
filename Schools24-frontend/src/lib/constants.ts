export const SUBJECTS_LIST = [
    "Mathematics",
    "Physics",
    "Chemistry",
    "Biology",
    "Science",
    "English",
    "Hindi",
    "Sanskrit",
    "History",
    "Geography",
    "Civics",
    "Social Studies",
    "Computer Science",
    "Information Technology",
    "Economics",
    "Accountancy",
    "Business Studies",
    "Physical Education",
    "Art",
    "Music",
    "Dance",
    "General Knowledge",
    "Environmental Science"
] as const;

export type SubjectName = typeof SUBJECTS_LIST[number];

export const GRADE_LEVELS = [
    "LKG",
    "UKG",
    "Class 1",
    "Class 2",
    "Class 3",
    "Class 4",
    "Class 5",
    "Class 6",
    "Class 7",
    "Class 8",
    "Class 9",
    "Class 10",
    "Class 11",
    "Class 12"
] as const;

export type GradeLevel = typeof GRADE_LEVELS[number];

export const SECTIONS = ["A", "B", "C", "D", "E"] as const;

export type Section = typeof SECTIONS[number];

export const SUBJECT_COLORS: Record<string, string> = {
    'Mathematics': 'from-blue-500 to-cyan-500',
    'Physics': 'from-violet-500 to-purple-500',
    'Chemistry': 'from-green-500 to-emerald-500',
    'Biology': 'from-emerald-500 to-green-500',
    'Science': 'from-green-500 to-emerald-500',
    'English': 'from-orange-500 to-amber-500',
    'Hindi': 'from-pink-500 to-rose-500',
    'Sanskrit': 'from-rose-500 to-pink-500',
    'History': 'from-red-500 to-rose-500',
    'Geography': 'from-teal-500 to-cyan-500',
    'Civics': 'from-amber-500 to-orange-500',
    'Social Studies': 'from-red-500 to-orange-500',
    'Computer Science': 'from-slate-500 to-gray-500',
    'Information Technology': 'from-slate-500 to-gray-500',
    'Economics': 'from-emerald-600 to-green-600',
    'Accountancy': 'from-blue-600 to-indigo-600',
    'Business Studies': 'from-purple-600 to-indigo-600',
    'Physical Education': 'from-lime-500 to-green-500',
    'Art': 'from-fuchsia-500 to-pink-500',
    'Music': 'from-violet-500 to-fuchsia-500',
    'Dance': 'from-pink-500 to-rose-500',
    'General Knowledge': 'from-yellow-500 to-amber-500',
    'Environmental Science': 'from-green-400 to-emerald-400',
};

export const getSubjectColor = (subject: string): string => {
    return SUBJECT_COLORS[subject] || 'from-gray-500 to-slate-500';
};
