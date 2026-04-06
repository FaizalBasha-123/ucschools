/**
 * Schools24 SDK Logger
 * Enterprise-grade logging with file and console output
 */

import * as fs from 'fs';
import * as path from 'path';

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  SUCCESS = 'SUCCESS'
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  error?: Error;
}

export class Logger {
  private logFilePath: string;
  private enableConsole: boolean;
  private enableFile: boolean;

  constructor(logFilePath?: string, enableConsole = true) {
    this.enableConsole = enableConsole;
    
    if (logFilePath) {
      this.logFilePath = logFilePath;
      this.enableFile = true;
      
      // Ensure log directory exists
      const logDir = path.dirname(logFilePath);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
    } else {
      this.logFilePath = '';
      this.enableFile = false;
    }
  }

  private formatTimestamp(): string {
    return new Date().toISOString();
  }

  private formatMessage(level: LogLevel, message: string, context?: Record<string, unknown>): string {
    const timestamp = this.formatTimestamp();
    let formatted = `[${timestamp}] [${level}] ${message}`;
    
    if (context && Object.keys(context).length > 0) {
      formatted += `\n  Context: ${JSON.stringify(context, null, 2)}`;
    }
    
    return formatted;
  }

  private getColoredLevel(level: LogLevel): string {
    const colors = {
      [LogLevel.DEBUG]: '\x1b[36m', // Cyan
      [LogLevel.INFO]: '\x1b[34m',  // Blue
      [LogLevel.WARN]: '\x1b[33m',  // Yellow
      [LogLevel.ERROR]: '\x1b[31m', // Red
      [LogLevel.SUCCESS]: '\x1b[32m' // Green
    };
    const reset = '\x1b[0m';
    return `${colors[level]}${level}${reset}`;
  }

  private writeToFile(entry: LogEntry): void {
    if (!this.enableFile) return;

    try {
      const logLine = this.formatMessage(entry.level, entry.message, entry.context);
      fs.appendFileSync(this.logFilePath, logLine + '\n', 'utf8');
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  private writeToConsole(entry: LogEntry): void {
    if (!this.enableConsole) return;

    const coloredLevel = this.getColoredLevel(entry.level);
    const timestamp = this.formatTimestamp();
    const prefix = `[${timestamp}] [${coloredLevel}]`;
    
    if (entry.level === LogLevel.ERROR && entry.error) {
      console.error(`${prefix} ${entry.message}`, entry.error);
    } else {
      console.log(`${prefix} ${entry.message}`);
    }

    if (entry.context && Object.keys(entry.context).length > 0) {
      console.log('  Context:', entry.context);
    }
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>, error?: Error): void {
    const entry: LogEntry = {
      timestamp: this.formatTimestamp(),
      level,
      message,
      context,
      error
    };

    this.writeToConsole(entry);
    this.writeToFile(entry);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, context);
  }

  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, context, error);
  }

  success(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.SUCCESS, message, context);
  }

  // Special methods for API operations
  apiRequest(method: string, endpoint: string, payload?: unknown, requestId?: string): void {
    const context: Record<string, any> = { payload };
    if (requestId) {
      context.requestId = requestId;
    }
    this.debug(`API Request: ${method} ${endpoint}`, context);
  }

  apiResponse(method: string, endpoint: string, statusCode: number, duration: number): void {
    const level = statusCode >= 400 ? LogLevel.ERROR : LogLevel.DEBUG;
    this.log(level, `API Response: ${method} ${endpoint}`, {
      statusCode,
      duration: `${duration}ms`
    });
  }

  apiError(method: string, endpoint: string, error: Error): void {
    this.error(`API Error: ${method} ${endpoint}`, error);
  }

  // Progress tracking for bulk operations
  progress(current: number, total: number, operation: string): void {
    const percentage = Math.round((current / total) * 100);
    this.info(`Progress: ${current}/${total} (${percentage}%) - ${operation}`);
  }

  // Section headers for better log organization
  section(title: string): void {
    const separator = '='.repeat(80);
    this.info(`\n${separator}\n${title}\n${separator}`);
  }

  // Summary at end of operations
  summary(title: string, stats: Record<string, unknown>): void {
    this.section(title);
    Object.entries(stats).forEach(([key, value]) => {
      this.info(`  ${key}: ${value}`);
    });
  }
}

// Singleton instance
let loggerInstance: Logger | null = null;

export function getLogger(logFilePath?: string, enableConsole = true): Logger {
  if (!loggerInstance) {
    loggerInstance = new Logger(logFilePath, enableConsole);
  }
  return loggerInstance;
}

export function setLogger(logger: Logger): void {
  loggerInstance = logger;
}
