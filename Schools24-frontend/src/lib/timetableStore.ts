/**
 * Timetable Store
 * 
 * This module provides a centralized store for timetable data that can be shared
 * across admin, teacher, and student views. When admins update timetables,
 * the changes are automatically reflected in teacher and student views.
 * 
 * In a real application, this would be replaced with a proper backend API
 * and database, but for now it uses localStorage for persistence.
 */

import { TimetableSlot } from './mockData'

const TIMETABLE_STORAGE_KEY = 'school_timetable_data'
const PERIODS_CONFIG_KEY = 'school_periods_config'

export interface PeriodConfig {
    id: number;
    startTime: string;
    endTime: string;
    isBreak: boolean;
    breakName?: string;
}

export interface PeriodsConfiguration {
    periodCount: number;
    periods: PeriodConfig[];
}

// Default periods configuration
export const DEFAULT_PERIODS: PeriodConfig[] = [
    { id: 1, startTime: '08:00', endTime: '08:45', isBreak: false },
    { id: 2, startTime: '08:45', endTime: '09:30', isBreak: false },
    { id: 3, startTime: '09:45', endTime: '10:30', isBreak: false },
    { id: 4, startTime: '10:30', endTime: '11:15', isBreak: false },
    { id: 5, startTime: '11:30', endTime: '12:15', isBreak: false },
    { id: 6, startTime: '12:15', endTime: '01:00', isBreak: true, breakName: 'LUNCH BREAK' },
]

export const DEFAULT_PERIODS_CONFIG: PeriodsConfiguration = {
    periodCount: 6,
    periods: DEFAULT_PERIODS
}

class TimetableStore {
    private listeners: Set<() => void> = new Set()
    private configListeners: Set<() => void> = new Set()

    /**
     * Get the current timetable data
     */
    getTimetable(): TimetableSlot[] {
        if (typeof window === 'undefined') return []

        const stored = localStorage.getItem(TIMETABLE_STORAGE_KEY)
        if (stored) {
            try {
                return JSON.parse(stored)
            } catch (e) {
                console.error('Failed to parse timetable data:', e)
                return []
            }
        }
        return []
    }

    /**
     * Update the timetable data (admin only)
     */
    setTimetable(timetable: TimetableSlot[]): void {
        if (typeof window === 'undefined') return

        localStorage.setItem(TIMETABLE_STORAGE_KEY, JSON.stringify(timetable))
        this.notifyListeners()
    }

    /**
     * Initialize timetable with default data if empty
     */
    initializeTimetable(defaultData: TimetableSlot[]): void {
        if (typeof window === 'undefined') return

        const existing = this.getTimetable()
        if (existing.length === 0) {
            this.setTimetable(defaultData)
        }
    }

    /**
     * Get periods configuration
     */
    getPeriodsConfig(): PeriodsConfiguration {
        if (typeof window === 'undefined') return DEFAULT_PERIODS_CONFIG

        const stored = localStorage.getItem(PERIODS_CONFIG_KEY)
        if (stored) {
            try {
                return JSON.parse(stored)
            } catch (e) {
                console.error('Failed to parse periods config:', e)
                return DEFAULT_PERIODS_CONFIG
            }
        }
        return DEFAULT_PERIODS_CONFIG
    }

    /**
     * Update periods configuration (admin only)
     */
    setPeriodsConfig(config: PeriodsConfiguration): void {
        if (typeof window === 'undefined') return

        localStorage.setItem(PERIODS_CONFIG_KEY, JSON.stringify(config))
        this.notifyConfigListeners()
        this.notifyListeners()
    }

    /**
     * Subscribe to timetable changes
     */
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener)
        return () => {
            this.listeners.delete(listener)
        }
    }

    /**
     * Subscribe to periods config changes
     */
    subscribeConfig(listener: () => void): () => void {
        this.configListeners.add(listener)
        return () => {
            this.configListeners.delete(listener)
        }
    }

    /**
     * Notify all listeners of changes
     */
    private notifyListeners(): void {
        this.listeners.forEach(listener => listener())
    }

    /**
     * Notify all config listeners of changes
     */
    private notifyConfigListeners(): void {
        this.configListeners.forEach(listener => listener())
    }

    /**
     * Clear all timetable data (for testing/reset)
     */
    clear(): void {
        if (typeof window === 'undefined') return
        localStorage.removeItem(TIMETABLE_STORAGE_KEY)
        localStorage.removeItem(PERIODS_CONFIG_KEY)
        this.notifyListeners()
        this.notifyConfigListeners()
    }
}

export const timetableStore = new TimetableStore()
